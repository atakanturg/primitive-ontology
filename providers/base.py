"""
primitive_onboarding.providers.base
~~~~~~~~~~~~~~~~~~~~

Abstract Base Class that every provider must implement.

Design notes
------------
* The four abstract methods form the *minimum viable contract*.
  Providers may expose additional public helpers, but ``provision``,
  ``deprovision``, ``sync_state``, and ``health_check`` are the only
  methods the orchestrator will ever call directly.
* ``_api_call`` is the single choke-point for every outbound HTTP
  request.  It applies tenacity retry/backoff, translates HTTP status
  codes into the ``PrimitiveOnboardingError`` hierarchy, and hashes payloads for the
  debug log.  Sub-classes should **always** use it instead of raw SDK
  calls.
"""

from __future__ import annotations

import hashlib
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Callable

from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from core.exceptions import (
    ProviderAuthError,
    ProviderError,
    RateLimitExhaustedError,
    RetryableProviderError,
)
from core.schema import TenantConfig, UserPayload

logger = logging.getLogger(__name__)


# ── Retry helpers ────────────────────────────────────────────────────

_MAX_RETRIES = 5
_EXP_BASE = 2       # seconds
_EXP_MAX = 30       # ceiling
_JITTER_MAX = 1.5   # random ±seconds


def _log_before_retry(retry_state: RetryCallState) -> None:
    """Emit a warning before each retry attempt (skip the first)."""
    if retry_state.attempt_number <= 1:
        return
    logger.warning(
        "Retry attempt %d for %s (last error: %s)",
        retry_state.attempt_number,
        retry_state.fn.__qualname__ if retry_state.fn else "unknown",
        retry_state.outcome.exception() if retry_state.outcome else "n/a",
    )


def _raise_exhausted(retry_state: RetryCallState) -> None:
    """Convert exhausted retries into ``RateLimitExhaustedError``."""
    last_exc = retry_state.outcome.exception() if retry_state.outcome else None
    raise RateLimitExhaustedError(
        f"Retry budget exhausted after {retry_state.attempt_number} attempts",
        provider=getattr(last_exc, "provider", "unknown"),
        status_code=getattr(last_exc, "status_code", None),
    ) from last_exc


# Pre-built tenacity decorator for provider I/O.
provider_retry = retry(
    retry=retry_if_exception_type(RetryableProviderError),
    wait=wait_exponential_jitter(
        initial=_EXP_BASE,
        max=_EXP_MAX,
        jitter=_JITTER_MAX,
    ),
    stop=stop_after_attempt(_MAX_RETRIES),
    before=_log_before_retry,
    retry_error_callback=_raise_exhausted,
    reraise=True,
)


# ── Abstract base ───────────────────────────────────────────────────

class BaseProvider(ABC):
    """Contract every Primitive Onboarding provider implementation must honour.

    Parameters
    ----------
    tenant_config : TenantConfig
        Organisation-specific credentials and preferences.
    dry_run : bool
        When ``True``, mutative methods log their intent but skip the
        actual API call.
    """

    # Human-readable name used in logs and state keys.
    PROVIDER_NAME: str = "base"

    def __init__(self, tenant_config: TenantConfig, *, dry_run: bool = False) -> None:
        self._config = tenant_config
        self._dry_run = dry_run
        self._log = logging.getLogger(f"{__name__}.{self.PROVIDER_NAME}")

    # ── Abstract API ─────────────────────────────────────────────────

    @abstractmethod
    def provision(self, user: UserPayload) -> dict[str, Any]:
        """Create all resources for *user*.

        Returns
        -------
        dict
            A result payload stored in the state file.  Must include at
            minimum ``{"status": "provisioned"}``.
        """

    @abstractmethod
    def deprovision(self, user: UserPayload) -> dict[str, Any]:
        """Tear down / deactivate all resources for *user*.

        Returns
        -------
        dict
            A result payload.  Must include
            ``{"status": "deprovisioned"}``.
        """

    @abstractmethod
    def sync_state(self) -> dict[str, Any]:
        """Pull the authoritative state from the remote provider.

        Used for state reconciliation / drift detection.

        Returns
        -------
        dict
            Provider-specific snapshot that can be diffed against local
            state.
        """

    @abstractmethod
    def health_check(self) -> bool:
        """Verify connectivity, auth, and quota.

        Returns
        -------
        bool
            ``True`` if the provider is reachable and authenticated.
        """

    # ── Shared infrastructure ────────────────────────────────────────

    @provider_retry
    def _api_call(
        self,
        operation: str,
        callable_: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Single choke-point for all outbound API requests.

        Parameters
        ----------
        operation : str
            Human-readable label, e.g. ``"create_user"``.
        callable_ : Callable
            The SDK / HTTP function to execute.
        *args, **kwargs
            Forwarded to *callable_*.

        Raises
        ------
        RetryableProviderError
            On transient failures (429, 5xx, network).
        ProviderAuthError
            On 401 / 403 (not retried).
        ProviderError
            Catch-all for unexpected provider failures.
        """
        payload_hash = self._hash_payload(args, kwargs)
        self._log.debug(
            "API ▸ %s | op=%s | payload_sha256=%s",
            self.PROVIDER_NAME,
            operation,
            payload_hash,
        )

        if self._dry_run:
            self._log.info(
                "[DRY-RUN] Would execute %s on %s (payload %s)",
                operation,
                self.PROVIDER_NAME,
                payload_hash,
            )
            return {"dry_run": True, "operation": operation}

        try:
            result = callable_(*args, **kwargs)
            self._log.debug(
                "API ✔ %s | op=%s completed", self.PROVIDER_NAME, operation
            )
            return result
        except Exception as exc:
            self._translate_exception(operation, exc)

    def _translate_exception(self, operation: str, exc: Exception) -> None:
        """Map SDK / HTTP exceptions into the Primitive Onboarding hierarchy.

        Sub-classes should override this for SDK-specific mappings.
        The base implementation re-raises unknown exceptions as
        ``ProviderError``.
        """
        status = getattr(exc, "status_code", None) or getattr(exc, "status", None)

        if isinstance(exc, (RetryableProviderError, ProviderAuthError)):
            raise

        if isinstance(status, int):
            if status in {429}:
                raise RetryableProviderError(
                    f"[{self.PROVIDER_NAME}] Rate limited on {operation}",
                    provider=self.PROVIDER_NAME,
                    status_code=status,
                ) from exc
            if status in {500, 502, 503, 504}:
                raise RetryableProviderError(
                    f"[{self.PROVIDER_NAME}] Server error on {operation}",
                    provider=self.PROVIDER_NAME,
                    status_code=status,
                ) from exc
            if status in {401, 403}:
                raise ProviderAuthError(
                    f"[{self.PROVIDER_NAME}] Auth failure on {operation}",
                    provider=self.PROVIDER_NAME,
                    status_code=status,
                ) from exc

        raise ProviderError(
            f"[{self.PROVIDER_NAME}] Unhandled error on {operation}: {exc}",
            provider=self.PROVIDER_NAME,
            status_code=status,
        ) from exc

    @staticmethod
    def _hash_payload(*parts: Any) -> str:
        """SHA-256 digest of the JSON-serialised call arguments."""
        raw = json.dumps(parts, default=str, sort_keys=True)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]
