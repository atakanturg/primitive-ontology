"""
primitive_onboarding.config.settings
~~~~~~~~~~~~~~~~~~~~~

Centralised settings loader for the Primitive Onboarding engine.
All credential access flows through
this module—nothing else in the codebase touches ``os.environ``
directly.

Multi-tenancy
-------------
Environment variables follow the convention::

    TENANT_<TENANT_ID>_<KEY>

For example ``TENANT_ACME_SLACK_BOT_TOKEN``.

Role-to-channel mapping
-----------------------
Each role's target Slack channels are declared as::

    TENANT_<ID>_CHANNELS_<ROLE>=C0123456789,C0987654321

This is the *only* change needed to onboard a new role.  The loader
scans all ``TENANT_<ID>_CHANNELS_*`` keys automatically and populates
``TenantConfig.slack_role_channels``.  The resulting dict keys also
define the tenant's ``valid_roles`` set.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from core.exceptions import TenantConfigError
from core.schema import TenantConfig

logger = logging.getLogger(__name__)

# ── Bootstrap ────────────────────────────────────────────────────────

_ENV_LOADED = False


def _ensure_env() -> None:
    """Load ``.env`` exactly once, idempotently."""
    global _ENV_LOADED  # noqa: PLW0603
    if _ENV_LOADED:
        return

    # Walk up from this file to locate the project root .env.
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]
    for candidate in candidates:
        if candidate.is_file():
            load_dotenv(candidate, override=False)
            logger.debug("Loaded env from %s", candidate)
            break
    else:
        logger.debug("No .env file found; relying on exported env vars.")

    _ENV_LOADED = True


# ── Public API ───────────────────────────────────────────────────────

def get(key: str, *, default: str | None = None, required: bool = False) -> str | None:
    """Read a single environment variable.

    Parameters
    ----------
    key : str
        Variable name (case-sensitive).
    default : str | None
        Fallback when the variable is unset.
    required : bool
        When ``True``, raise ``TenantConfigError`` if unset.
    """
    _ensure_env()
    value = os.environ.get(key, default)
    if required and value is None:
        raise TenantConfigError(f"Required env var {key!r} is not set.")
    return value


def load_tenant(tenant_id: str) -> TenantConfig:
    """Build a ``TenantConfig`` from environment variables.

    Reads every ``TENANT_<ID>_*`` key and maps it into the Pydantic
    model.  Missing optional fields fall back to model defaults.

    The role→channel mapping is built by scanning all keys of the form
    ``TENANT_<ID>_CHANNELS_<ROLE>``.  Each value is a comma-separated
    list of Slack channel IDs (e.g. ``C0123456789,C0987654321``).

    Raises
    ------
    TenantConfigError
        If the minimum required variables (``DOMAIN``, ``ORG_NAME``)
        are absent, or if no ``CHANNELS_*`` entries are found at all.
    """
    _ensure_env()
    prefix = f"TENANT_{tenant_id.upper()}_"
    channels_prefix = f"{prefix}CHANNELS_"
    logger.info("Loading tenant config with prefix %s", prefix)

    def _get(suffix: str, *, required: bool = False) -> str | None:
        return get(f"{prefix}{suffix}", required=required)

    # ── Scan for CHANNELS_<ROLE> keys ────────────────────────────────
    role_channels: dict[str, list[str]] = {}
    for key, value in os.environ.items():
        if key.startswith(channels_prefix) and value.strip():
            role = key[len(channels_prefix):].lower()  # e.g. "engineering"
            channel_ids = [ch.strip() for ch in value.split(",") if ch.strip()]
            if channel_ids:
                role_channels[role] = channel_ids
                logger.debug(
                    "Role %r → %d channel(s): %s", role, len(channel_ids), channel_ids
                )

    if not role_channels:
        logger.warning(
            "No CHANNELS_<ROLE> entries found for tenant %r. "
            "Define at least one TENANT_%s_CHANNELS_<ROLE> variable.",
            tenant_id,
            tenant_id.upper(),
        )

    try:
        config = TenantConfig(
            tenant_id=tenant_id,
            domain=_get("DOMAIN", required=True),       # type: ignore[arg-type]
            org_name=_get("ORG_NAME", required=True),   # type: ignore[arg-type]
            slack_bot_token=_get("SLACK_BOT_TOKEN"),
            slack_admin_token=_get("SLACK_ADMIN_TOKEN"),
            slack_role_channels=role_channels,
        )
    except Exception as exc:
        raise TenantConfigError(
            f"Failed to build config for tenant {tenant_id!r}: {exc}"
        ) from exc

    logger.info(
        "Tenant %r loaded — domain=%s, slack=%s, admin_invite=%s, roles=%s",
        config.tenant_id,
        config.domain,
        config.slack_enabled,
        config.slack_admin_enabled,
        sorted(config.valid_roles),
    )
    return config


def get_state_file_path() -> Path:
    """Resolve the state file location, respecting ``PRIMITIVE_ONBOARDING_STATE_FILE``."""
    _ensure_env()
    raw = os.environ.get("PRIMITIVE_ONBOARDING_STATE_FILE", "data/state.json")
    return Path(raw).resolve()


def get_log_level() -> str:
    """Resolve the log level from ``PRIMITIVE_ONBOARDING_LOG_LEVEL``, defaulting to INFO."""
    _ensure_env()
    return os.environ.get("PRIMITIVE_ONBOARDING_LOG_LEVEL", "INFO").upper()
