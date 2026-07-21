"""Run the planner evals and print a scorecard.

    python -m hermes.evals                 # every case once
    python -m hermes.evals --repeat 5      # measure how steady a case is
    python -m hermes.evals --only web-fix-detail-page
    python -m hermes.evals --list

Drives the real `build_nim_planner` and the real `_plan_context`. Anything
reimplemented here would be a fork of the prompt or of the context assembly,
and a fork scores itself rather than the thing that runs in production.

Exit codes: 0 all rules held, 1 at least one rule was violated, 2 nothing could
be measured (missing credentials, or every case errored).
"""
from __future__ import annotations
import argparse, asyncio, sys, tempfile
from pathlib import Path

from .. import config, orchestrator as orch_mod, project_detect
from ..mcp_hub import McpHub
from ..main import build_nim_planner, real_mcp_session_factory
from ..session_store import Store
from . import rules as rules_mod
from .cases import CASES, Case

PASS, FAIL, ERROR = "PASS", "FAIL", "ERROR"


def _materialise(case: Case, root: Path) -> Path:
    """Write the case's fixture project to disk and return its directory.

    A real directory rather than a stub: `_plan_context` runs the production
    `detect` and tree summary over it, so the context under test is assembled
    from files exactly as it is for a live task.
    """
    proj = root / (case.name or case.id)
    proj.mkdir(parents=True, exist_ok=True)
    for rel, body in case.files.items():
        f = proj / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body, encoding="utf-8")
    return proj


def _context_for(case: Case, proj: Path, settings) -> str:
    """Build the planner context through the orchestrator, not beside it.

    `_plan_context` reads only `self.deps`, so the store here is inert — no
    schema is created and nothing is written. Reassembling the context locally
    would fork the very code this eval exists to exercise.
    """
    inert_store = Store(proj / "never-written.db")
    orch = orch_mod.Orchestrator(settings, inert_store, planner=None,
                                 deps={"detect": project_detect.detect})
    return orch._plan_context(proj, case.greenfield)


async def _run_case(case: Case, planner, settings, root: Path):
    """Plan one case. Returns (status, violations, plan-or-error)."""
    proj = _materialise(case, root)
    try:
        context = _context_for(case, proj, settings)
        raw = await planner(case.text, context)
        steps = orch_mod.parse_plan(raw)
    except Exception as e:
        # A model outage or a malformed response is not a quality regression,
        # and must never be scored as one.
        return ERROR, [], f"{type(e).__name__}: {e}"
    violations = [(rid, why) for rid, why in rules_mod.check(steps, case) if why]
    return (FAIL if violations else PASS), violations, steps


def _print_case(case: Case, status: str, violations, payload, n: int, total: int):
    tag = f"[{n}/{total}]" if total > 1 else ""
    print(f"{status:5}  {case.id} {tag}")
    if status == ERROR:
        print(f"       could not measure: {payload}")
        return
    if status == FAIL:
        for rid, why in violations:
            print(f"       {rid}: {why}")
        print(f"       plan: {[s.get('type') for s in payload]}")


async def _main() -> int:
    ap = argparse.ArgumentParser(prog="python -m hermes.evals")
    ap.add_argument("--repeat", type=int, default=1,
                    help="run each case N times; with temperature 0 one pass "
                         "is usually enough, more measures steadiness")
    ap.add_argument("--only", action="append", default=[],
                    help="case id (repeatable)")
    ap.add_argument("--list", action="store_true", help="list case ids and exit")
    args = ap.parse_args()

    cases = [c for c in CASES if not args.only or c.id in args.only]
    if args.list:
        for c in cases:
            print(f"{c.id:28} rules={','.join(c.rules)}")
        return 0
    if not cases:
        print("no cases matched --only", file=sys.stderr)
        return 2

    settings = config.load_settings()
    secrets = config.load_secrets()
    if not secrets.nvidia_api_key:
        print("No NVIDIA API key configured — evals call the real planner.\n"
              "Set it in the settings UI at http://127.0.0.1:8799 first.",
              file=sys.stderr)
        return 2

    print(f"model: {settings.model}   temperature: {settings.planner_temperature}   "
          f"cases: {len(cases)}   repeat: {args.repeat}\n")

    hub = McpHub(settings.mcp_servers, session_factory=real_mcp_session_factory)
    planner = build_nim_planner(settings, secrets, hub)

    tally = {PASS: 0, FAIL: 0, ERROR: 0}
    with tempfile.TemporaryDirectory(prefix="hermes-eval-") as tmp:
        root = Path(tmp)
        for case in cases:
            for n in range(1, args.repeat + 1):
                status, violations, payload = await _run_case(
                    case, planner, settings, root / f"{case.id}-{n}")
                tally[status] += 1
                _print_case(case, status, violations, payload, n, args.repeat)

    runs = sum(tally.values())
    print(f"\n{tally[PASS]}/{runs} runs held every rule they were scored on "
          f"({tally[FAIL]} violated, {tally[ERROR]} could not be measured)")
    if tally[FAIL]:
        return 1
    return 2 if tally[PASS] == 0 else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
