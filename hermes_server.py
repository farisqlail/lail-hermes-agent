"""Hermes Server Entrypoint for standalone executable packaging."""
import asyncio
import os
import sys
from pathlib import Path

# Ensure repo root is on sys.path if not frozen
if not getattr(sys, "frozen", False):
    root = Path(__file__).resolve().parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

from hermes.main import run

if __name__ == "__main__":
    # --selftest: reaching this line means the whole app graph imported, which is
    # exactly what the v0.0.2 engine could not do (its PYZ was missing
    # hermes.config). CI runs it against the built exe before the installer ships.
    if "--selftest" in sys.argv:
        print("selftest ok: hermes imports cleanly")
        sys.exit(0)
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"[Hermes Engine Error] {e}", file=sys.stderr)
        sys.exit(1)
