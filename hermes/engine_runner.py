from __future__ import annotations
import asyncio, json, os, shutil, tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal
from .engine_result import EngineOutcome, parse_agy_stream, parse_claude_json

# each entry maps a prompt to an argv list; overridable in tests
# Both CLIs run non-interactively (-p): neither can prompt for tool
# permissions, so without --dangerously-skip-permissions every command/file
# edit is auto-denied and the model churns until timeout — agy's own stderr
# names this exact flag as the fix. Safe here: engines run inside an isolated
# project dir and risky tasks are gated behind Telegram confirmation.
COMMANDS: dict[str, Callable[[str], list[str]]] = {
    # stream-json (not json): the same result envelope still ends the run — so
    # engine_result.parse_claude_json reads it unchanged, scanning lines from
    # the back — but everything leading up to it now arrives too, which is what
    # the task timeline renders. --verbose is what makes the CLI emit the
    # intermediate turns rather than the envelope alone.
    "claude": lambda p: ["claude", "-p", "--dangerously-skip-permissions",
                         "--output-format", "stream-json", "--verbose"],
    # agy gained --output-format (text|json|stream-json) after this module was
    # written; verified against `agy --help` 2026-09-02. Its stream is shaped
    # nothing like claude's — see engine_stream.distill_agy_line — but it
    # carries the same substance: per-step tool calls, token usage, and a
    # closing envelope. Switching it here is what makes final_text come from
    # `result.response` instead of scraped prose, so PARSERS must know about
    # it too or every reader gets JSONL.
    "antigravity": lambda p: ["agy", "-p", p, "--dangerously-skip-permissions",
                              "--output-format", "stream-json"],
}
# Whose stdout is line-delimited JSON worth handing to a live consumer.
STREAMING = {"claude", "antigravity"}
# engines that read the prompt from stdin instead of argv: sidesteps cmd.exe
# quoting of newlines/quotes and the 8191-char command-line limit on Windows
STDIN_PROMPT = {"claude"}
# which tuning flags each CLI accepts (verified against --help 2026-07-17):
# both take --model; only claude has --effort. An unknown flag crashes the
# engine on every step, so unsupported tuning is dropped, not passed through.
MODEL_FLAG = {"claude", "antigravity"}
EFFORT_FLAG = {"claude"}
# Engines whose sessions Hermes can name and reopen. agy has --conversation,
# and since the switch to stream-json its `result` envelope does print the
# `conversation_id` it issued — so the old blocker (no id to hand back) is
# gone. Still excluded: agy has no way to *name* a session up front, so
# resuming it needs the id threaded back from the previous round rather than
# the pre-assigned uuid claude takes. Left for its own change.
RESUMABLE = {"claude"}
# agy's own print-mode budget defaults to 5m. Left alone, a 15m code step is
# killed by the engine at minute five and surfaces as an engine failure rather
# than a timeout. claude has no equivalent flag; asyncio's wait_for is its only
# clock.
PRINT_TIMEOUT_FLAG = {"antigravity"}
# Whose stdout carries a machine-readable envelope. Absent here means the
# engine is read as plain text, exactly as before this module existed. Both
# entries are load-bearing now that both CLIs run in stream-json: without a
# parser, final_text degrades to raw stdout, which is JSONL rather than prose.
PARSERS = {"claude": parse_claude_json, "antigravity": parse_agy_stream}
# Whose CLI accepts --mcp-config pointing at Hermes' in-process ask_user server.
# claude namespaces the tool as mcp__hermes__ask_user; --dangerously-skip-
# permissions (always passed) auto-approves it. agy's MCP config shape differs
# and its ask path is not wired, so it stays off.
MCP_CONFIG_FLAG = {"claude"}


def mcp_config_dict(url: str, token: str) -> dict:
    """The claude --mcp-config payload wiring one engine run to Hermes' ask
    server. The token rides as a header, not in the URL, so it never lands in a
    log line that records the endpoint."""
    from .ask_server import SERVER_NAME, TOKEN_HEADER
    return {"mcpServers": {SERVER_NAME: {
        "type": "http", "url": url, "headers": {TOKEN_HEADER: token}}}}

def _argv(engine: str, prompt: str, model: str = "", effort: str = "",
          session_id: str = "", resume_id: str = "",
          timeout_s: int = 0, mcp_config_path: str = "") -> list[str]:
    argv = [str(x) for x in COMMANDS[engine](str(prompt))]
    if model and engine in MODEL_FLAG:
        argv += ["--model", str(model)]
    if effort and engine in EFFORT_FLAG:
        argv += ["--effort", str(effort)]
    if mcp_config_path and engine in MCP_CONFIG_FLAG:
        argv += ["--mcp-config", str(mcp_config_path)]
    if engine in RESUMABLE:
        # Resume wins: passing both would ask claude to open a new session and
        # reopen an old one in the same invocation.
        if resume_id:
            argv += ["--resume", str(resume_id)]
        elif session_id:
            argv += ["--session-id", str(session_id)]
    if timeout_s and engine in PRINT_TIMEOUT_FLAG:
        argv += ["--print-timeout", f"{timeout_s}s"]
    return argv

@dataclass
class RunResult:
    ok: bool
    stdout: str
    stderr: str
    timed_out: bool
    returncode: int | None
    # None means the engine was read as text: either it emits no envelope, or
    # this run's stdout could not be parsed as one.
    outcome: EngineOutcome | None = None

    @property
    def final_text(self) -> str:
        """What the engine said last, as trustworthily as this run allows.

        With an outcome this is the model's own closing message — never tool
        output, never an echo of the prompt. Without one it degrades to raw
        stdout, which is what every caller read before structured output
        existed.
        """
        return self.outcome.final_text if self.outcome else self.stdout

def _extra_tool_dirs() -> list[str]:
    """Well-known install dirs for the engine CLIs, searched when the bot's
    PATH predates their install.

    A cmd window caches PATH at launch; start.bat's auto-restart loop reuses
    that env on every restart. A CLI installed (or PATH-registered) after the
    window opened is invisible to Hermes until the window is reopened — the
    "'claude' not found on PATH" trap even though `claude` runs fine in a fresh
    shell. npm publishes global shims to %APPDATA%\\npm; the antigravity CLI
    installs to %LOCALAPPDATA%\\agy\\bin. Searching these directly defuses it.
    Only existing dirs are returned, so a missing var never widens the search.
    """
    candidates = []
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(os.path.join(appdata, "npm"))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(os.path.join(local, "agy", "bin"))
    return [d for d in candidates if os.path.isdir(d)]

def _resolve(argv: list[str]) -> list[str]:
    """Resolve argv[0] to something CreateProcess can actually run.

    npm installs CLIs as .cmd/.ps1 shims; create_subprocess_exec does not apply
    PATHEXT, so bare names like "claude" raise WinError 2. Prefer a real .exe,
    then wrap script shims in their interpreter. The search covers PATH plus the
    known CLI install dirs (_extra_tool_dirs), so a stale-PATH bot process still
    finds an installed engine.
    """
    name = argv[0]
    search = os.pathsep.join(
        d for d in [os.environ.get("PATH", ""), *_extra_tool_dirs()] if d)
    exe = None
    for ext in (".exe", ".cmd", ".bat", ".ps1"):
        exe = shutil.which(name + ext, path=search)
        if exe:
            break
    exe = exe or shutil.which(name, path=search)
    if exe is None:
        raise FileNotFoundError(
            f"engine executable {name!r} not found on PATH — is it installed?")
    low = exe.lower()
    if low.endswith(".ps1"):
        return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", exe, *argv[1:]]
    if low.endswith((".cmd", ".bat")):
        return ["cmd", "/c", exe, *argv[1:]]
    return [exe, *argv[1:]]

async def _pump(proc, send, on_line=None):
    """`proc.communicate(send)`, but every stdout line reaches `on_line` as it
    arrives instead of only at the end.

    Keeps communicate's contract exactly — write stdin then close it, drain
    both pipes concurrently, return the complete `(stdout, stderr)` bytes — so
    every caller downstream, `parse_claude_json` included, is unaffected.
    Draining stderr concurrently is not optional: a subprocess that fills its
    stderr pipe blocks forever while we are still reading its stdout.
    """
    async def feed():
        if send is None:
            return
        try:
            proc.stdin.write(send)
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            # Engine died before reading the prompt. Its stdout/stderr still
            # carry why, so this is reported by the caller, not raised here.
            pass
        finally:
            try:
                proc.stdin.close()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

    def emit(raw: bytes):
        if on_line is None:
            return
        try:
            on_line(raw.decode(errors="replace").rstrip("\r\n"))
        except Exception:
            # A broken trace consumer must never take down a run whose real
            # work is fine. Same posture as engine_result's parser.
            pass

    async def read_out():
        # Chunked reads split by hand, deliberately not readline(): one
        # stream-json line carrying a large tool result routinely beats
        # asyncio's StreamReader limit, and readline() *clears its buffer*
        # before raising — losing the very bytes the envelope parser needs to
        # tell a finished run from a failed one.
        chunks: list[bytes] = []
        pending = b""
        while True:
            chunk = await proc.stdout.read(65536)
            if not chunk:
                break
            chunks.append(chunk)
            if on_line is None:
                continue
            pending += chunk
            while True:
                nl = pending.find(b"\n")
                if nl < 0:
                    break
                emit(pending[:nl])
                pending = pending[nl + 1:]
        if pending.strip():
            emit(pending)  # last line, unterminated
        return b"".join(chunks)

    _, out, err = await asyncio.gather(feed(), read_out(), proc.stderr.read())
    await proc.wait()
    return out, err


async def _await_within(work, deadline, poll_s: float = 1.0):
    """Await `work`, bounded by a pausable `Deadline` instead of a fixed
    timeout. While the engine blocks on `ask_user`, the registry pauses the
    deadline, so `expired()` stays False and the subprocess is not killed for
    the length of the operator's think — the whole reason Deadline exists.
    Raises `asyncio.TimeoutError` on expiry so the caller's kill path is shared
    with the fixed-timeout branch.

    Split from `_communicate_within` so the clock rule can be read and tested
    without a process: what is awaited is not this function's concern.
    """
    fut = asyncio.ensure_future(work)
    try:
        while True:
            done, _ = await asyncio.wait({fut}, timeout=poll_s)
            if fut in done:
                return fut.result()
            if deadline.expired():
                raise asyncio.TimeoutError
    finally:
        if not fut.done():
            fut.cancel()


async def _communicate_within(proc, send, deadline, on_line=None, poll_s: float = 1.0):
    """`_pump`, bounded by a pausable `Deadline`."""
    return await _await_within(_pump(proc, send, on_line), deadline, poll_s)

async def run_engine(engine: Literal["claude", "antigravity"], prompt: str,
                     cwd: Path, timeout_s: int,
                     extra_env: dict | None = None,
                     model: str = "", effort: str = "",
                     session_id: str = "", resume_id: str = "",
                     ask_url: str = "", ask_token: str = "",
                     deadline=None, on_event=None) -> RunResult:
    """`on_event(line)` receives each stdout line of a streaming engine as it
    arrives — the hook the live task timeline hangs off. It stays a plain
    callback taking a string: this module has no business knowing about the
    store, so distilling and persisting belong to the caller."""
    # A wedged engine must never leave the config behind: it carries the run
    # token, and a stale one on disk would let a later engine reach a closed run.
    mcp_config_path = ""
    if ask_url and ask_token and engine in MCP_CONFIG_FLAG:
        fd, mcp_config_path = tempfile.mkstemp(prefix="hermes-mcp-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(mcp_config_dict(ask_url, ask_token), f)
    import time
    _t0 = time.monotonic()
    try:
        argv = _resolve(_argv(engine, prompt, model, effort,
                              session_id, resume_id, timeout_s, mcp_config_path))
        env = {**os.environ, **(extra_env or {})}
        send = prompt.encode() if engine in STDIN_PROMPT else None
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=str(cwd), env=env,
            stdin=asyncio.subprocess.PIPE if send is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        on_line = on_event if engine in STREAMING else None
        try:
            if deadline is None:
                out, err = await asyncio.wait_for(
                    _pump(proc, send, on_line), timeout=timeout_s)
            else:
                out, err = await _communicate_within(proc, send, deadline, on_line)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            print(f"[timing engine] {engine} TIMEOUT after {time.monotonic() - _t0:.1f}s "
                  f"(limit {timeout_s}s, model={model or 'default'})")
            return RunResult(False, "", "", True, None)
        print(f"[timing engine] {engine} {time.monotonic() - _t0:.1f}s "
              f"(model={model or 'default'}, effort={effort or 'default'})")
        stdout = out.decode(errors="replace")
        parser = PARSERS.get(engine)
        outcome = parser(stdout) if parser else None
        # An API error kills the session but still exits 0, so returncode alone
        # called that a success. The envelope is the first thing able to see it.
        ok = proc.returncode == 0 and (outcome is None or outcome.api_error is None)
        return RunResult(ok, stdout, err.decode(errors="replace"),
                         False, proc.returncode, outcome)
    finally:
        if mcp_config_path:
            try:
                os.unlink(mcp_config_path)
            except OSError:
                pass
