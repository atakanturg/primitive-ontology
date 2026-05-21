#!/usr/bin/env python3
"""
Primitive Onboarding – Main entry point (Slack-only mode).

Wires together the CLI, settings loader, Slack provider, and the
orchestration engine.  This file stays *thin*; all logic lives in its
respective module.
"""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from config import settings
from core import cli
from core.engine import PrimitiveOnboardingEngine
from core.exceptions import PrimitiveOnboardingError
from core.schema import ProvisionAction
from providers.slack_provider import SlackProvider

logger = logging.getLogger("primitive-onboarding")


# ── Logging bootstrap ────────────────────────────────────────────────

def _configure_logging(level_override: str | None = None) -> None:
    """Set up dual-sink logging: console (INFO+) and file (DEBUG+)."""
    level_str = level_override or settings.get_log_level()
    console_level = getattr(logging, level_str, logging.INFO)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)  # Capture everything; sinks filter.

    # ── Console handler ──────────────────────────────────────────────
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(console_level)
    console.setFormatter(
        logging.Formatter(
            "%(asctime)s │ %(levelname)-7s │ %(name)s │ %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    root.addHandler(console)

    # ── Rotating file handler ────────────────────────────────────────
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    file_handler = RotatingFileHandler(
        log_dir / "primitive-onboarding.log",
        maxBytes=50 * 1024 * 1024,  # 50 MiB
        backupCount=10,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(
        logging.Formatter(
            "%(asctime)s | %(levelname)-7s | %(name)s | %(funcName)s:%(lineno)d | %(message)s",
        )
    )
    root.addHandler(file_handler)


# ── Main ─────────────────────────────────────────────────────────────

def main() -> int:
    """Parse arguments, load config, run the engine, return exit code."""
    args = cli.parse_args()
    _configure_logging(args.log_level)

    logger.info("═" * 60)
    logger.info("Primitive Onboarding provisioning engine starting")
    logger.info("Tenant: %s | Action: %s | Dry-run: %s", args.tenant, args.action, args.dry_run)
    logger.info("═" * 60)

    # ── Load tenant config ───────────────────────────────────────────
    try:
        tenant_config = settings.load_tenant(args.tenant)
    except PrimitiveOnboardingError as exc:
        logger.error("Configuration error: %s", exc)
        return 1

    # ── Validate Slack is configured ─────────────────────────────────
    if not tenant_config.slack_enabled:
        logger.error(
            "No SLACK_BOT_TOKEN configured for tenant %s. Aborting.", args.tenant
        )
        return 1

    if not tenant_config.valid_roles:
        logger.error(
            "No CHANNELS_<ROLE> entries found for tenant %s. "
            "Add at least one TENANT_%s_CHANNELS_<ROLE> line to .env.",
            args.tenant,
            args.tenant.upper(),
        )
        return 1

    logger.info(
        "Slack provider active — %d role(s) configured: %s",
        len(tenant_config.valid_roles),
        sorted(tenant_config.valid_roles),
    )

    # ── Instantiate provider & engine ────────────────────────────────
    provider = SlackProvider(tenant_config, dry_run=args.dry_run)
    engine = PrimitiveOnboardingEngine(tenant_config, [provider], dry_run=args.dry_run)

    # ── Health-check-only mode ───────────────────────────────────────
    if args.action == "health":
        try:
            engine.preflight()
            logger.info("All provider health checks passed.")
            return 0
        except PrimitiveOnboardingError as exc:
            logger.error("Health check failed: %s", exc)
            return 1

    # ── Resolve users (fail-fast validation) ─────────────────────────
    action = cli.resolve_action(args)
    users = cli.resolve_users(args)

    logger.info("Validated %d user(s) for %s", len(users), action.value)

    # ── Pre-flight ───────────────────────────────────────────────────
    if not args.dry_run and not getattr(args, "skip_health", False):
        try:
            engine.preflight()
        except PrimitiveOnboardingError as exc:
            logger.error("Pre-flight failed: %s", exc)
            return 1

    # ── Execute ──────────────────────────────────────────────────────
    try:
        summary = engine.execute(users, action)
    except PrimitiveOnboardingError as exc:
        logger.error("Engine execution failed: %s", exc)
        return 1

    # ── Report ───────────────────────────────────────────────────────
    logger.info("─" * 60)
    logger.info("SUMMARY")
    logger.info("  Tenant:          %s", summary["tenant"])
    logger.info("  Action:          %s", summary["action"])
    logger.info("  Dry-run:         %s", summary["dry_run"])
    logger.info("  Total users:     %d", summary["total_users"])
    logger.info("  ────────────────────────────────────────")
    logger.info("  ✔ Provisioned:   %d", summary["succeeded"])
    logger.info("  ✉ Invited:       %d  (awaiting workspace join)", summary["invited"])
    logger.info("  ⚠ Manual needed: %d  (re-run after manually inviting)", summary["pending_manual"])
    logger.info("  ⏭ Skipped:       %d  (already completed)", summary["skipped"])
    logger.info("  ✘ Failed:        %d", summary["failed"])
    logger.info("─" * 60)

    return 1 if summary["failed"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
