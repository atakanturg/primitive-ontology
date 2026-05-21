"""
primitive_onboarding.providers.slack_provider
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Slack integration — Tier-Aware "System-Push" provisioning.

Tier-Aware Lifecycle
--------------------
provision() implements a 4-step decision tree:

  Step 1 — CHECK
    Call users.lookupByEmail with the bot token.
    • Found   → store Slack UID, jump to Step 3.
    • Not found → proceed to Step 2.

  Step 2 — GOLD INVITE (requires SLACK_ADMIN_TOKEN / xoxp-)
    Try admin.users.invite via the admin token.
    • Success       → log "Enterprise invite sent."
                       Return status=INVITED.  Stop here.
    • Plan error    → log "ACTION REQUIRED: Plan does not support
                       auto-invite.  Manually invite <email> then
                       re-run Primitive Onboarding."
                       Return status=PENDING_MANUAL_INVITE.  Stop here.
    • No admin token → fall through to PENDING_MANUAL_INVITE immediately.

  Step 3 — SYSTEM-PUSH (user is in the workspace)
    For every channel mapped to user.role in .env:
      a. Bot self-joins (conversations.join) — idempotent.
      b. Invites user (conversations.invite) — ignore already_in_channel.

  Step 4 — WELCOME DM
    Open a DM and send the personalised onboarding message.
    Return status=PROVISIONED.

Intermediate statuses (INVITED, PENDING_MANUAL_INVITE) are stored in
state.json and are NOT treated as completed, so a re-run will retry
Step 1 automatically after the user has accepted their invitation.

Dual-token setup
----------------
  TENANT_<ID>_SLACK_BOT_TOKEN   xoxb-  channel management + DMs
  TENANT_<ID>_SLACK_ADMIN_TOKEN xoxp-  admin.users.invite
"""

from __future__ import annotations

import logging
from typing import Any

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from core.exceptions import (
    ProviderAuthError,
    ProviderError,
    RetryableProviderError,
)
from core.schema import TenantConfig, UserPayload
from providers.base import BaseProvider

logger = logging.getLogger(__name__)

# Slack API error codes that indicate the workspace plan doesn't permit
# admin.users.invite via a user token.
_INVITE_PLAN_ERRORS = frozenset(
    {
        "not_allowed",
        "not_allowed_token_type",
        "paid_teams_only",
        "feature_not_enabled",
        "enterprise_is_restricted",
        "cannot_invite_to_org",
        "missing_scope",
    }
)


class SlackProvider(BaseProvider):
    """Slack provisioning provider — tier-aware, role-channel mapped."""

    PROVIDER_NAME = "slack"

    def __init__(self, tenant_config: TenantConfig, *, dry_run: bool = False) -> None:
        super().__init__(tenant_config, dry_run=dry_run)
        # Bot client (xoxb-) — channel management and DMs.
        self._client = WebClient(token=tenant_config.slack_bot_token or "")
        # Admin client (xoxp-) — workspace invite. May be None.
        self._admin_client: WebClient | None = (
            WebClient(token=tenant_config.slack_admin_token)
            if tenant_config.slack_admin_token
            else None
        )
        # role → [channel_id, ...]
        self._role_channels: dict[str, list[str]] = dict(
            tenant_config.slack_role_channels
        )

    # ── ABC implementation ───────────────────────────────────────────

    def provision(self, user: UserPayload) -> dict[str, Any]:
        """Tier-aware provisioning: check → invite → push → DM."""
        self._log.info(
            "Provisioning Slack for %s (%s) — role=%s",
            user.display_name,
            user.email,
            user.role,
        )

        # ── Validate role → channel mapping exists first ─────────────
        channels = self._role_channels.get(user.role)
        if not channels:
            msg = (
                f"Error: No channel configuration found in .env for role: {user.role}. "
                f"Add TENANT_{self._config.tenant_id.upper()}_CHANNELS_{user.role.upper()}=<channel_ids> "
                f"to your .env file."
            )
            self._log.error(msg)
            raise ProviderError(msg, provider="slack")

        # ── Step 1: CHECK — does the user exist in the workspace? ────
        slack_user_id = self._find_user_by_email(user.email)

        if slack_user_id is None:
            # ── Step 2: GOLD INVITE ──────────────────────────────────
            return self._handle_workspace_invite(user)

        self._log.info(
            "User %s found in workspace → Slack UID %s",
            user.email,
            slack_user_id,
        )

        # ── Step 3: SYSTEM-PUSH ──────────────────────────────────────
        joined = self._push_to_channels(slack_user_id, channels)

        # ── Step 4: WELCOME DM ───────────────────────────────────────
        self._send_welcome_dm(slack_user_id, user, joined)

        return {
            "status": "provisioned",
            "slack_user_id": slack_user_id,
            "channels_joined": joined,
        }

    def deprovision(self, user: UserPayload) -> dict[str, Any]:
        """Remove user from all channels mapped to their role."""
        self._log.info(
            "Deprovisioning Slack for %s (%s) — role=%s",
            user.display_name,
            user.email,
            user.role,
        )

        slack_user_id = self._find_user_by_email(user.email)
        if slack_user_id is None:
            self._log.warning(
                "User %s not found in workspace — nothing to deprovision.", user.email
            )
            return {"status": "deprovisioned", "skipped": True, "reason": "user_not_found"}

        channels = self._role_channels.get(user.role, [])
        removed: list[str] = []
        for channel_id in channels:
            self._remove_user_from_channel(slack_user_id, channel_id)
            removed.append(channel_id)

        return {
            "status": "deprovisioned",
            "slack_user_id": slack_user_id,
            "channels_removed": removed,
        }

    def sync_state(self) -> dict[str, Any]:
        """Pull current channel membership for all mapped channels."""
        self._log.info("Syncing Slack state for tenant %s", self._config.tenant_id)
        state: dict[str, Any] = {"channels": {}}

        all_channels: set[str] = set()
        for ids in self._role_channels.values():
            all_channels.update(ids)

        for channel_id in all_channels:
            try:
                members_resp = self._api_call(
                    "conversations_members",
                    self._client.conversations_members,
                    channel=channel_id,
                    limit=1000,
                )
                state["channels"][channel_id] = {
                    "member_count": len(members_resp.get("members", [])),
                }
            except ProviderError as exc:
                self._log.warning("Could not fetch members for %s: %s", channel_id, exc)

        return state

    def health_check(self) -> bool:
        """Verify the bot token is valid via auth.test."""
        try:
            resp = self._api_call("auth_test", self._client.auth_test)
            ok = resp.get("ok", False) if hasattr(resp, "get") else False
            self._log.info("Slack auth.test → ok=%s", ok)
            return ok
        except ProviderError:
            return False

    # ── Step 2 internals ─────────────────────────────────────────────

    def _handle_workspace_invite(self, user: UserPayload) -> dict[str, Any]:
        """Attempt admin.users.invite; degrade gracefully on plan errors."""
        if self._dry_run:
            self._log.info(
                "[DRY-RUN] Would attempt workspace invite for %s", user.email
            )
            return {"status": "invited", "email": user.email, "dry_run": True}

        if self._admin_client is None:
            self._log.warning(
                "ACTION REQUIRED: No admin token configured. "
                "Manually invite %s to the workspace then re-run Primitive Onboarding.",
                user.email,
            )
            return {
                "status": "pending_manual_invite",
                "email": user.email,
                "reason": "no_admin_token",
            }

        try:
            self._api_call(
                "admin_users_invite",
                self._admin_client.admin_users_invite,
                team_id=self._get_team_id(),
                email=user.email,
                channel_ids=",".join(
                    self._role_channels.get(user.role, [])
                ),
                is_restricted=False,
            )
            self._log.info(
                "Enterprise invite sent to %s (role=%s).", user.email, user.role
            )
            return {"status": "invited", "email": user.email}

        except ProviderError as exc:
            error_str = str(exc)
            is_plan_error = any(code in error_str for code in _INVITE_PLAN_ERRORS)

            if is_plan_error:
                self._log.warning(
                    "ACTION REQUIRED: Plan does not support auto-invite. "
                    "Manually invite %s then re-run Primitive Onboarding.",
                    user.email,
                )
                return {
                    "status": "pending_manual_invite",
                    "email": user.email,
                    "reason": "plan_restriction",
                    "detail": error_str,
                }

            # Any other error (auth failure, network, etc.) is a real failure.
            raise

    def _get_team_id(self) -> str:
        """Retrieve the workspace team_id via auth.test on the admin client."""
        assert self._admin_client is not None
        resp = self._api_call("admin_auth_test", self._admin_client.auth_test)
        team_id: str = resp.get("team_id", "")
        if not team_id:
            raise ProviderError(
                "[slack] Could not determine team_id from admin token.",
                provider="slack",
            )
        return team_id

    # ── Step 3 internals ─────────────────────────────────────────────

    def _push_to_channels(
        self, slack_user_id: str, channel_ids: list[str]
    ) -> list[str]:
        """Bot joins each channel then pushes the user in. Returns joined IDs."""
        joined: list[str] = []
        for channel_id in channel_ids:
            self._bot_join_channel(channel_id)
            self._invite_user_to_channel(slack_user_id, channel_id)
            joined.append(channel_id)
        return joined

    # ── Shared helpers ────────────────────────────────────────────────

    def _find_user_by_email(self, email: str) -> str | None:
        """Return the Slack UID for *email*, or None if not in workspace."""
        if self._dry_run:
            return f"dry-run-{email}"
        try:
            resp = self._api_call(
                "users_lookupByEmail",
                self._client.users_lookupByEmail,
                email=email,
            )
            uid: str = resp["user"]["id"]
            self._log.debug("Resolved %s → Slack UID %s", email, uid)
            return uid
        except ProviderError as exc:
            # users_not_found means the email is simply not in the workspace.
            if "users_not_found" in str(exc):
                self._log.info(
                    "User %s not found in workspace — will attempt invite.", email
                )
                return None
            raise

    def _bot_join_channel(self, channel_id: str) -> None:
        """Ensure the bot is in *channel_id* before inviting others (idempotent)."""
        try:
            self._api_call(
                "conversations_join",
                self._client.conversations_join,
                channel=channel_id,
            )
            self._log.debug("Bot joined channel %s", channel_id)
        except ProviderError as exc:
            if "already_in_channel" in str(exc) or "method_not_supported" in str(exc):
                self._log.debug("Bot already in channel %s — skipping join.", channel_id)
            else:
                raise

    def _invite_user_to_channel(self, slack_user_id: str, channel_id: str) -> None:
        """Invite *slack_user_id* to *channel_id* — idempotent."""
        try:
            self._api_call(
                "conversations_invite",
                self._client.conversations_invite,
                channel=channel_id,
                users=slack_user_id,
            )
            self._log.info(
                "Invited user %s to channel %s", slack_user_id, channel_id
            )
        except ProviderError as exc:
            if "already_in_channel" in str(exc):
                self._log.info(
                    "User %s already in channel %s — skipping.", slack_user_id, channel_id
                )
            else:
                raise

    def _remove_user_from_channel(self, slack_user_id: str, channel_id: str) -> None:
        """Kick *slack_user_id* from *channel_id* — idempotent."""
        try:
            self._api_call(
                "conversations_kick",
                self._client.conversations_kick,
                channel=channel_id,
                user=slack_user_id,
            )
            self._log.info(
                "Removed user %s from channel %s", slack_user_id, channel_id
            )
        except ProviderError as exc:
            if "not_in_channel" in str(exc):
                self._log.info(
                    "User %s not in channel %s — skipping.", slack_user_id, channel_id
                )
            else:
                raise

    def _send_welcome_dm(
        self, slack_user_id: str, user: UserPayload, channel_ids: list[str]
    ) -> None:
        """Open a DM and send the Welcome Pack message."""
        dm_resp = self._api_call(
            "conversations_open",
            self._client.conversations_open,
            users=slack_user_id,
        )
        if dm_resp.get("dry_run"):
            self._log.info("[DRY-RUN] Would send welcome DM to %s", user.email)
            return

        dm_channel = dm_resp["channel"]["id"]
        channel_list = ", ".join(channel_ids)

        welcome_text = (
            f"Hi {user.first_name}! Primitive Onboarding has automatically onboarded you. "
            f"You have been added to the following channels: {channel_list}."
        )

        self._api_call(
            "chat_postMessage",
            self._client.chat_postMessage,
            channel=dm_channel,
            text=welcome_text,
        )
        self._log.info("Welcome DM sent to %s", user.email)

    # ── Exception translation ─────────────────────────────────────────

    def _translate_exception(self, operation: str, exc: Exception) -> None:
        """Map SlackApiError into the Primitive Onboarding hierarchy."""
        if isinstance(exc, SlackApiError):
            resp = exc.response
            status = resp.status_code if hasattr(resp, "status_code") else None
            error_code = resp.get("error", "") if isinstance(resp.data, dict) else ""

            if status == 429 or error_code == "ratelimited":
                raise RetryableProviderError(
                    f"[slack] Rate limited on {operation}",
                    provider="slack",
                    status_code=429,
                ) from exc

            if error_code in {"invalid_auth", "token_revoked", "not_authed"}:
                raise ProviderAuthError(
                    f"[slack] Auth failure on {operation}: {error_code}",
                    provider="slack",
                    status_code=status,
                ) from exc

            if status and status >= 500:
                raise RetryableProviderError(
                    f"[slack] Server error on {operation}",
                    provider="slack",
                    status_code=status,
                ) from exc

            raise ProviderError(
                f"[slack] API error on {operation}: {error_code}",
                provider="slack",
                status_code=status,
            ) from exc

        super()._translate_exception(operation, exc)
