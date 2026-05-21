"""
primitive_onboarding.core.schema
~~~~~~~~~~~~~~~~~

Pydantic v2 models that gate every byte entering the Primitive Onboarding engine.

Design notes
------------
* ``UserPayload`` is the canonical data contract between the CLI layer
  and the orchestrator.  Everything downstream receives typed objects—
  never raw dicts.
* Role validation is driven by a class-level ``_valid_roles`` set that
  is injected at runtime from ``TenantConfig.slack_role_channels`` keys.
  Adding a new ``TENANT_<ID>_CHANNELS_<ROLE>`` line in ``.env`` is the
  *only* change needed to support a new role.
* All validators use ``mode="before"`` so raw strings from CSV / JSON
  ingestion are normalised before the rest of the model sees them.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from enum import Enum
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


# ── Constants ────────────────────────────────────────────────────────

# RFC-5322-lite – rejects absurdities like consecutive dots or trailing
# hyphens while staying readable.  Production systems should layer an
# MX lookup on top.
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9](?:[a-zA-Z0-9._%+\-]*[a-zA-Z0-9])?@"
    r"[a-zA-Z0-9](?:[a-zA-Z0-9\-]*[a-zA-Z0-9])?\.+"
    r"[a-zA-Z]{2,63}$"
)


# ── Enumerations ─────────────────────────────────────────────────────

class ProvisionAction(str, Enum):
    """Direction of an orchestration run."""

    PROVISION = "provision"
    DEPROVISION = "deprovision"


# ── User payload ─────────────────────────────────────────────────────

class UserPayload(BaseModel):
    """Canonical user record consumed by every provider.

    Attributes
    ----------
    user_id : str
        Globally unique, opaque identifier (UUID recommended).
    email : str
        Corporate email — validated against ``_EMAIL_RE``.
    first_name / last_name : str
        Display names; whitespace-stripped automatically.
    role : str
        Free-form role string, lowercased on input.  No allowed-set
        validation is performed here — role validity is checked at the
        provider level against the .env channel map.  To add a new role
        add ``TENANT_<ID>_CHANNELS_<ROLE>`` to .env; no Python changes
        needed.
    department : str | None
        Optional organisational unit.
    start_date : date | None
        ISO-8601 date for onboarding.
    metadata : dict
        Escape hatch for provider-specific key/value pairs.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        str_min_length=1,
        extra="forbid",
    )

    user_id: Annotated[str, Field(min_length=1, max_length=128)]
    email: Annotated[str, Field(max_length=254)]
    first_name: Annotated[str, Field(min_length=1, max_length=128)]
    last_name: Annotated[str, Field(min_length=1, max_length=128)]
    role: Annotated[str, Field(min_length=1, max_length=64)]
    department: str | None = None
    start_date: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    # ── Validators ───────────────────────────────────────────────────

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str) -> str:
        v = v.lower().strip()
        if not _EMAIL_RE.match(v):
            raise ValueError(f"Malformed email address: {v!r}")
        return v

    @field_validator("start_date", mode="before")
    @classmethod
    def _coerce_start_date(cls, v: Any) -> date | None:
        if v is None:
            return None
        if isinstance(v, datetime):
            return v.date()
        if isinstance(v, str):
            try:
                return date.fromisoformat(v)
            except ValueError as exc:
                raise ValueError(
                    f"start_date must be ISO-8601 (YYYY-MM-DD), got {v!r}"
                ) from exc
        return v

    @field_validator("role")
    @classmethod
    def _normalise_role(cls, v: str) -> str:
        """Lowercase and strip the role; no allowed-set check."""
        return v.strip().lower()

    # ── Convenience ──────────────────────────────────────────────────

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


# ── Tenant config model ─────────────────────────────────────────────

class TenantConfig(BaseModel):
    """Runtime configuration for a single Slack-only tenant.

    Channel mapping is driven entirely by ``slack_role_channels``:
    a dict of  role_name → [channel_id, ...] pairs.  The keys of this
    dict automatically define the ``valid_roles`` set, so adding one
    ``TENANT_<ID>_CHANNELS_<ROLE>`` line in ``.env`` is all it takes to
    onboard a new role.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    tenant_id: Annotated[str, Field(min_length=1, max_length=64)]
    domain: Annotated[str, Field(min_length=3, max_length=253)]
    org_name: Annotated[str, Field(min_length=1, max_length=256)]

    # Bot token (xoxb-) — used for channel management (join, invite, DM).
    slack_bot_token: str | None = None

    # Admin/user token (xoxp-) — used for workspace-level admin.users.invite.
    # Optional: if absent, auto-invite is skipped and the engine falls back
    # to PENDING_MANUAL_INVITE state.
    slack_admin_token: str | None = None

    # role → [channel_id, ...] mapping built from CHANNELS_<ROLE> env vars.
    slack_role_channels: dict[str, list[str]] = Field(default_factory=dict)

    @field_validator("domain")
    @classmethod
    def _validate_domain(cls, v: str) -> str:
        v = v.lower().strip()
        if not re.match(r"^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z]{2,})+$", v):
            raise ValueError(f"Invalid domain: {v!r}")
        return v

    @property
    def valid_roles(self) -> set[str]:
        """Derive the allowed role set from the channel map keys."""
        return set(self.slack_role_channels.keys())

    @property
    def slack_enabled(self) -> bool:
        """Slack is enabled if a bot token is configured."""
        return bool(self.slack_bot_token)

    @property
    def slack_admin_enabled(self) -> bool:
        """Admin-level workspace invite is available if an admin token exists."""
        return bool(self.slack_admin_token)


# ── Batch input ──────────────────────────────────────────────────────

class BatchPayload(BaseModel):
    """Wrapper for bulk provisioning runs."""

    model_config = ConfigDict(extra="forbid")

    action: ProvisionAction
    tenant_id: str
    users: list[UserPayload] = Field(min_length=1)
