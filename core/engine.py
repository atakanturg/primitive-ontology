"""
primitive_onboarding.core.engine
~~~~~~~~~~~~~~~~~

Central orchestrator for the Primitive Onboarding provisioning engine.

Responsibilities
----------------
1. **State management** – Reads/writes ``data/state.json`` with atomic
   commits.  Every successful provider call is persisted *before* the
   next call begins (write-ahead, crash-safe via temp-file rename).
2. **Idempotency gate** – Before dispatching a mutative call, the
   engine checks whether the (tenant, user, provider, action) tuple
   already succeeded.  If so, the call is skipped.
3. **Provider orchestration** – Iterates the registered providers,
   runs health checks, and fans out provision/deprovision calls.
4. **Dry-run mode** – When enabled, every provider is instantiated
   with ``dry_run=True`` so they log intent without side-effects.
"""

from __future__ import annotations

import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import settings
from core.exceptions import (
    PrimitiveOnboardingError,
    ProviderHealthCheckError,
    StateCorruptionError,
    StateWriteError,
)
from core.schema import ProvisionAction, TenantConfig, UserPayload
from providers.base import BaseProvider

logger = logging.getLogger(__name__)


# ── State tracker ────────────────────────────────────────────────────

class StateManager:
    """Thread-safe*, transactional JSON state file handler.

    *Thread-safety is achieved via atomic rename.  For multi-process
    safety, layer ``fcntl.flock`` — omitted here for portability.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or settings.get_state_file_path()
        self._state: dict[str, Any] = self._load()

    # ── Read ─────────────────────────────────────────────────────────

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            logger.info("State file absent — initialising empty state.")
            return self._empty()

        try:
            with open(self._path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            raise StateCorruptionError(
                f"Cannot parse state file {self._path}: {exc}"
            ) from exc

        if "tenants" not in data:
            raise StateCorruptionError("State file missing 'tenants' key.")

        logger.debug("Loaded state from %s", self._path)
        return data

    @staticmethod
    def _empty() -> dict[str, Any]:
        return {
            "_meta": {
                "version": 1,
                "engine": "primitive-onboarding",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_modified": None,
            },
            "tenants": {},
        }

    # ── Write (atomic) ───────────────────────────────────────────────

    def _commit(self) -> None:
        """Persist the in-memory state to disk atomically.

        Strategy: write to a temp file in the same directory, then
        ``os.replace`` (POSIX rename) so the operation is atomic on
        any POSIX filesystem and on NTFS.
        """
        self._state["_meta"]["last_modified"] = datetime.now(
            timezone.utc
        ).isoformat()

        self._path.parent.mkdir(parents=True, exist_ok=True)

        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=self._path.parent,
                suffix=".tmp",
                delete=False,
                encoding="utf-8",
            ) as tmp:
                json.dump(self._state, tmp, indent=2, default=str)
                tmp_path = Path(tmp.name)

            tmp_path.replace(self._path)
            logger.debug("State committed → %s", self._path)

        except OSError as exc:
            raise StateWriteError(
                f"Failed to write state file: {exc}"
            ) from exc

    # ── Query ────────────────────────────────────────────────────────

    def has_completed(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        action: ProvisionAction,
    ) -> bool:
        """Return ``True`` if this exact (tenant, user, provider, action)
        has already succeeded."""
        user_record = (
            self._state.get("tenants", {})
            .get(tenant_id, {})
            .get(user_id, {})
            .get(provider, {})
        )
        if not user_record:
            return False

        return user_record.get("action") == action.value and user_record.get(
            "status"
        ) in {"provisioned", "deprovisioned"}

    # ── Mutation ─────────────────────────────────────────────────────

    def record_success(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        action: ProvisionAction,
        result: dict[str, Any],
    ) -> None:
        """Persist a successful provider action and commit immediately."""
        tenants = self._state.setdefault("tenants", {})
        tenant = tenants.setdefault(tenant_id, {})
        user = tenant.setdefault(user_id, {})
        user[provider] = {
            "action": action.value,
            "status": result.get("status", action.value),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": result,
        }
        self._commit()
        logger.info(
            "State ✔ tenant=%s user=%s provider=%s action=%s",
            tenant_id,
            user_id,
            provider,
            action.value,
        )

    def record_failure(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        action: ProvisionAction,
        error: str,
    ) -> None:
        """Record a provider failure without marking the action complete."""
        tenants = self._state.setdefault("tenants", {})
        tenant = tenants.setdefault(tenant_id, {})
        user = tenant.setdefault(user_id, {})
        user[provider] = {
            "action": action.value,
            "status": "failed",
            "failed_at": datetime.now(timezone.utc).isoformat(),
            "error": error,
        }
        self._commit()
        logger.error(
            "State ✘ tenant=%s user=%s provider=%s error=%s",
            tenant_id,
            user_id,
            provider,
            error,
        )

    @property
    def raw(self) -> dict[str, Any]:
        """Expose the full state dict (read-only intent)."""
        return self._state


# ── Orchestrator ─────────────────────────────────────────────────────

class PrimitiveOnboardingEngine:
    """Top-level orchestrator that ties providers, state, and CLI
    together.

    Parameters
    ----------
    tenant_config : TenantConfig
        The resolved configuration for the active tenant.
    providers : list[BaseProvider]
        Pre-initialised provider instances.
    dry_run : bool
        Passed to providers; also gates state writes.
    state_manager : StateManager | None
        Inject a custom ``StateManager`` for testing.
    """

    def __init__(
        self,
        tenant_config: TenantConfig,
        providers: list[BaseProvider],
        *,
        dry_run: bool = False,
        state_manager: StateManager | None = None,
    ) -> None:
        self._config = tenant_config
        self._providers = providers
        self._dry_run = dry_run
        self._state = state_manager or StateManager()

    # ── Pre-flight ───────────────────────────────────────────────────

    def preflight(self) -> None:
        """Run health checks on every registered provider.

        Raises
        ------
        ProviderHealthCheckError
            If any provider fails its connectivity check.
        """
        failed: list[str] = []
        for provider in self._providers:
            name = provider.PROVIDER_NAME
            logger.info("Health-checking provider: %s", name)
            try:
                ok = provider.health_check()
                if not ok:
                    failed.append(name)
                    logger.error("Health check FAILED for %s", name)
                else:
                    logger.info("Health check OK for %s", name)
            except Exception as exc:
                failed.append(name)
                logger.error("Health check exception for %s: %s", name, exc)

        if failed:
            raise ProviderHealthCheckError(
                f"Pre-flight failed for providers: {', '.join(failed)}"
            )

    # ── Execute ──────────────────────────────────────────────────────

    def execute(
        self,
        users: list[UserPayload],
        action: ProvisionAction,
    ) -> dict[str, Any]:
        """Run the provisioning (or deprovisioning) pipeline.

        Returns
        -------
        dict
            Summary with ``succeeded``, ``skipped``, and ``failed``
            counters plus per-user detail.
        """
        summary: dict[str, Any] = {
            "tenant": self._config.tenant_id,
            "action": action.value,
            "dry_run": self._dry_run,
            "total_users": len(users),
            "succeeded": 0,       # fully provisioned (channels joined + DM sent)
            "invited": 0,         # enterprise invite sent; awaiting workspace join
            "pending_manual": 0,  # plan restriction; operator must invite manually
            "skipped": 0,
            "failed": 0,
            "details": [],
        }

        for user in users:
            user_detail: dict[str, Any] = {
                "user_id": user.user_id,
                "email": user.email,
                "providers": {},
            }

            for provider in self._providers:
                pname = provider.PROVIDER_NAME
                logger.info(
                    "▸ %s | user=%s | provider=%s",
                    action.value,
                    user.user_id,
                    pname,
                )

                # ── Idempotency gate ─────────────────────────────────
                if self._state.has_completed(
                    self._config.tenant_id, user.user_id, pname, action
                ):
                    logger.info(
                        "⏭  Skipping %s for %s — already completed.",
                        pname,
                        user.user_id,
                    )
                    user_detail["providers"][pname] = "skipped"
                    summary["skipped"] += 1
                    continue

                # ── Dispatch ─────────────────────────────────────────
                try:
                    if action == ProvisionAction.PROVISION:
                        result = provider.provision(user)
                    else:
                        result = provider.deprovision(user)

                    # ── Transactional state commit ───────────────────
                    result_status = result.get("status", "")

                    if not self._dry_run:
                        self._state.record_success(
                            self._config.tenant_id,
                            user.user_id,
                            pname,
                            action,
                            result,
                        )

                    if result_status == "invited":
                        user_detail["providers"][pname] = "invited"
                        summary["invited"] += 1
                    elif result_status == "pending_manual_invite":
                        user_detail["providers"][pname] = "pending_manual_invite"
                        summary["pending_manual"] += 1
                    else:
                        user_detail["providers"][pname] = "success"
                        summary["succeeded"] += 1

                except PrimitiveOnboardingError as exc:
                    logger.error(
                        "Provider %s failed for user %s: %s",
                        pname,
                        user.user_id,
                        exc,
                    )
                    if not self._dry_run:
                        self._state.record_failure(
                            self._config.tenant_id,
                            user.user_id,
                            pname,
                            action,
                            str(exc),
                        )
                    user_detail["providers"][pname] = f"failed: {exc.code}"
                    summary["failed"] += 1

                except Exception as exc:
                    logger.exception(
                        "Unexpected error from %s for user %s",
                        pname,
                        user.user_id,
                    )
                    if not self._dry_run:
                        self._state.record_failure(
                            self._config.tenant_id,
                            user.user_id,
                            pname,
                            action,
                            str(exc),
                        )
                    user_detail["providers"][pname] = f"failed: {exc!r}"
                    summary["failed"] += 1

            summary["details"].append(user_detail)

        logger.info(
            "Engine run complete — "
            "succeeded=%d  invited=%d  pending_manual=%d  skipped=%d  failed=%d",
            summary["succeeded"],
            summary["invited"],
            summary["pending_manual"],
            summary["skipped"],
            summary["failed"],
        )
        return summary
