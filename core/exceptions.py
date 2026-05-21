"""
primitive_onboarding.core.exceptions
~~~~~~~~~~~~~~~~~~~~~

Hierarchical exception taxonomy for the Primitive Onboarding provisioning engine.

Design notes
------------
* Every exception carries a machine-readable ``code`` so callers can
  branch on type *or* string code without ``isinstance`` chains.
* ``ProviderError`` is the root for anything that originates inside a
  provider's network boundary.  ``RetryableProviderError`` is the subset
  the circuit-breaker is allowed to retry; everything else fails fast.
"""

from __future__ import annotations

from typing import Any


# ── Base ─────────────────────────────────────────────────────────────

class PrimitiveOnboardingError(Exception):
    """Root exception for every error raised inside the Primitive Onboarding engine."""

    code: str = "PRIMITIVE_ONBOARDING_GENERIC"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        self.details = details or {}
        super().__init__(message)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(code={self.code!r}, msg={str(self)!r})"


# ── Validation ───────────────────────────────────────────────────────

class ValidationError(PrimitiveOnboardingError):
    """Input failed Pydantic / schema validation – fail fast."""

    code = "VALIDATION_FAILED"


class TenantConfigError(PrimitiveOnboardingError):
    """Tenant configuration is missing or incomplete."""

    code = "TENANT_CONFIG_MISSING"


# ── State / Idempotency ─────────────────────────────────────────────

class StateCorruptionError(PrimitiveOnboardingError):
    """The local state file is unreadable or structurally invalid."""

    code = "STATE_CORRUPTION"


class StateWriteError(PrimitiveOnboardingError):
    """Failed to persist a state update to disk."""

    code = "STATE_WRITE_FAILED"


# ── Provider hierarchy ───────────────────────────────────────────────

class ProviderError(PrimitiveOnboardingError):
    """Any error originating from a downstream provider API call."""

    code = "PROVIDER_ERROR"

    def __init__(
        self,
        message: str,
        *,
        provider: str = "unknown",
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.provider = provider
        self.status_code = status_code
        super().__init__(message, details=details)


class RetryableProviderError(ProviderError):
    """A transient failure the circuit-breaker *should* retry.

    Raised on HTTP 429, 500, 502, 503, 504 and network timeouts.
    """

    code = "PROVIDER_RETRYABLE"


class RateLimitExhaustedError(RetryableProviderError):
    """All retry budget consumed while honouring a 429 rate-limit."""

    code = "RATE_LIMIT_EXHAUSTED"


class ProviderAuthError(ProviderError):
    """Authentication or authorisation failure (401/403).  Not retryable."""

    code = "PROVIDER_AUTH_FAILED"


class ProviderNotFoundError(ProviderError):
    """The target resource does not exist (404) on the provider side."""

    code = "PROVIDER_NOT_FOUND"


class ProviderConflictError(ProviderError):
    """The resource already exists or is in a conflicting state (409)."""

    code = "PROVIDER_CONFLICT"


# ── Orchestration ────────────────────────────────────────────────────

class DryRunInterrupt(PrimitiveOnboardingError):
    """Sentinel used internally to abort execution in dry-run mode.

    This is *not* an error – it's a structured halt.
    """

    code = "DRY_RUN_HALT"


class ProviderHealthCheckError(PrimitiveOnboardingError):
    """One or more providers failed their pre-flight health check."""

    code = "HEALTH_CHECK_FAILED"
