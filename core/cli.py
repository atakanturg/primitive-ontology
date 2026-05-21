"""
primitive_onboarding.core.cli
~~~~~~~~~~~~~~

Professional argparse-based CLI for the Primitive Onboarding provisioning engine.

Usage examples::

    # Provision a single user (dry-run)
    python main.py --tenant acme --dry-run provision \\
        --user-id u-001 --email alice@acme.com \\
        --first-name Alice --last-name Smith --role member

    # Deprovision from a JSON batch file
    python main.py --tenant acme deprovision --batch users.json

    # Full onboarding run
    python main.py --tenant acme provision \\
        --user-id u-002 --email bob@acme.com \\
        --first-name Bob --last-name Jones --role admin
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Sequence

from core.schema import BatchPayload, ProvisionAction, UserPayload

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    """Construct the Primitive Onboarding CLI argument parser."""

    parser = argparse.ArgumentParser(
        prog="primitive-onboarding",
        description=(
            "Primitive Onboarding — fault-tolerant, idempotent, multi-tenant "
            "Slack provisioning engine."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # ── Global flags ─────────────────────────────────────────────────

    parser.add_argument(
        "--tenant",
        required=True,
        help="Tenant ID whose environment variables to load.",
    )
    parser.add_argument(
        "--skip-health", 
        action="store_true", 
        help="Bypass provider pre-flight checks"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Log the execution graph without making mutative API calls.",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default=None,
        help="Override the log level (default: from env or INFO).",
    )

    # ── Sub-commands ─────────────────────────────────────────────────

    subparsers = parser.add_subparsers(dest="action", help="Provisioning action.")

    # -- provision -------------------------------------------------
    prov = subparsers.add_parser("provision", help="Onboard one or more users.")
    _add_user_args(prov)

    # -- deprovision -----------------------------------------------
    deprov = subparsers.add_parser(
        "deprovision", help="Offboard / deactivate one or more users."
    )
    _add_user_args(deprov)

    # -- health ----------------------------------------------------
    subparsers.add_parser(
        "health", help="Run provider health checks without provisioning."
    )

    return parser


def _add_user_args(sub: argparse.ArgumentParser) -> None:
    """Attach user specification flags to a sub-command."""

    group = sub.add_mutually_exclusive_group(required=True)

    group.add_argument(
        "--batch",
        type=str,
        metavar="FILE",
        help="Path to a JSON file containing an array of user objects.",
    )

    group.add_argument(
        "--user-id",
        type=str,
        help="Single-user mode: unique user identifier.",
    )

    # Single-user fields (only required when --user-id is used).
    sub.add_argument("--email", type=str, help="User email address.")
    sub.add_argument("--first-name", type=str, help="User first name.")
    sub.add_argument("--last-name", type=str, help="User last name.")
    sub.add_argument("--role", type=str, help="User role (e.g. member, admin).")
    sub.add_argument("--department", type=str, default=None, help="Department.")
    sub.add_argument(
        "--start-date", type=str, default=None, help="ISO-8601 start date."
    )


# ── Parsing helpers ──────────────────────────────────────────────────

def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments and return a ``Namespace``."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.action is None:
        parser.print_help()
        sys.exit(1)

    return args


def resolve_users(args: argparse.Namespace) -> list[UserPayload]:
    """Convert CLI arguments into validated ``UserPayload`` objects.

    Supports both single-user mode (``--user-id``) and batch mode
    (``--batch``).

    Raises
    ------
    SystemExit
        On validation failure (fail-fast before any network I/O).
    """
    if getattr(args, "batch", None):
        return _load_batch(args.batch)

    # Single-user mode — all fields mandatory.
    missing = [
        f for f in ("user_id", "email", "first_name", "last_name", "role")
        if getattr(args, f.replace("-", "_"), None) is None
    ]
    if missing:
        logger.error("Missing required fields for single-user mode: %s", missing)
        sys.exit(1)

    try:
        user = UserPayload(
            user_id=args.user_id,
            email=args.email,
            first_name=args.first_name,
            last_name=args.last_name,
            role=args.role,
            department=args.department,
            start_date=args.start_date,
        )
    except Exception as exc:
        logger.error("Input validation failed: %s", exc)
        sys.exit(1)

    return [user]


def _load_batch(path_str: str) -> list[UserPayload]:
    """Load and validate a JSON batch file."""
    path = Path(path_str)
    if not path.is_file():
        logger.error("Batch file not found: %s", path)
        sys.exit(1)

    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("Cannot read batch file %s: %s", path, exc)
        sys.exit(1)

    if not isinstance(raw, list):
        logger.error("Batch file must contain a JSON array of user objects.")
        sys.exit(1)

    users: list[UserPayload] = []
    for idx, item in enumerate(raw):
        try:
            users.append(UserPayload(**item))
        except Exception as exc:
            logger.error("Validation failed for entry #%d: %s", idx, exc)
            sys.exit(1)

    if not users:
        logger.error("Batch file is empty.")
        sys.exit(1)

    return users


def resolve_action(args: argparse.Namespace) -> ProvisionAction:
    """Map the sub-command string to a ``ProvisionAction`` enum."""
    return ProvisionAction(args.action)
