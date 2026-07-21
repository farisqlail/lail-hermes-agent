"""The `ask_user` tool the engine calls, and the MCP server that carries it.

The engine (`claude -p`) runs non-interactively: it has no stdin UI, so a
question it needs answered cannot go to its own console. This module exposes a
single MCP tool, `ask_user`, that blocks on an `AskRegistry` Future — the same
Future a Telegram tap resolves. The human answers in the chat; the engine reads
the answer as the tool's return value.

Transport is streamable-HTTP, mounted in-process on the bot's own uvicorn
server, because the tool must resolve against the *live* registry the Telegram
handlers write to. A stdio subprocess server would run in its own process and
share nothing.

Identity: every engine invocation gets a run token from `AskRegistry.open_run`,
which Hermes bakes into the `--mcp-config` it hands claude (see
`engine_runner.mcp_config_dict`). claude sends it back as a header on every
tool call, and `resolve_ask` maps it to the run whose chat and deadline the ask
belongs to. An unknown token means the engine reached a registry that never
opened its run — treated as "no channel", never an error.

Everything above `build_ask_server` is a pure function, testable without the
MCP SDK or a socket.
"""
from __future__ import annotations
import asyncio
from mcp.server.fastmcp import Context, FastMCP
from .ask import AskRegistry, NO_CHANNEL, NO_STREAM

SERVER_NAME = "hermes"          # claude namespaces the tool as mcp__hermes__ask_user
TOOL_NAME = "ask_user"
TOKEN_HEADER = "X-Hermes-Token"
MOUNT_PREFIX = "/ask-mcp"       # where main.py mounts the streamable-http app
STREAM_PATH = "/mcp"            # FastMCP's default; the client URL is PREFIX + PATH
# claude resets its ~60s tools/call timeout on every progress notification, so a
# question awaiting a human for up to DEFAULT_ASK_TIMEOUT_S must be kept warm
# well inside that window.
HEARTBEAT_S = 25

NEED_QUESTION = "ask_user requires a non-empty 'question'."

TOOL_DESCRIPTION = (
    "Ask the human operator a question and wait for their answer. Use ONLY when "
    "genuinely blocked on a decision the task text does not settle (which package, "
    "which of two valid designs) and a wrong guess would waste real work. Do not "
    "use it for confirmations you can make yourself. 'options' are tappable choices, "
    "each an object with a 'label' and an optional 'description'; provide 2-4 when the "
    "answer is a choice, or omit them for a free-text-only question. The operator can "
    "always reply in free text instead. Set 'multi' to allow more than one choice. "
    "Returns the operator's answer, or a fallback instruction if no one answers in "
    "time — in which case proceed with your best assumption and state it.")


def _norm_options(raw) -> list[dict]:
    """Coerce the engine's `options` into the `{label, description}` dicts the
    registry and Telegram renderer expect. A bare list of strings is accepted —
    a model that skips the object wrapper still gets tappable buttons instead of
    a silently empty keyboard."""
    out = []
    for item in raw or []:
        if isinstance(item, dict):
            label = str(item.get("label", "")).strip()
            if not label:
                continue
            opt = {"label": label}
            desc = str(item.get("description", "")).strip()
            if desc:
                opt["description"] = desc
            out.append(opt)
        else:
            label = str(item).strip()
            if label:
                out.append({"label": label})
    return out


async def resolve_ask(registry: AskRegistry, token: str, question,
                      options, multi, can_stream: bool,
                      heartbeat=None, interval: float = HEARTBEAT_S) -> str:
    """Pure core of the tool: turn one `ask_user` call into an answer string.

    `can_stream` is False when the client sent no progressToken — it cannot be
    held open long enough to reach a human, so say so immediately instead of
    starting a wait nobody will see resolved. `heartbeat`, when given, is an
    async callable invoked every `interval` seconds while waiting, so the
    transport's idle timer never fires under a slow operator.
    """
    if not can_stream:
        return NO_STREAM
    run = registry.run_for_token(token)
    if run is None:
        return NO_CHANNEL
    q = str(question or "").strip()
    if not q:
        return NEED_QUESTION
    ask_task = asyncio.ensure_future(
        registry.ask(run, q, _norm_options(options), bool(multi)))
    if heartbeat is None:
        return await ask_task
    try:
        while True:
            done, _ = await asyncio.wait({ask_task}, timeout=interval)
            if ask_task in done:
                return ask_task.result()
            try:
                await heartbeat()
            except Exception:
                # A failed keepalive is not worth dropping the answer already in
                # flight; the registry's own timeout remains the backstop.
                pass
    except asyncio.CancelledError:
        ask_task.cancel()
        raise


def build_ask_server(registry: AskRegistry):
    """Build the FastMCP server exposing `ask_user`, bound to `registry`.

    Thin by design: it reads the run token and progressToken off the live
    request, then defers every decision to `resolve_ask`. Verified end-to-end
    only against a live claude — fold into the smoke run.
    """
    mcp = FastMCP(SERVER_NAME, stateless_http=True, streamable_http_path=STREAM_PATH)

    @mcp.tool(name=TOOL_NAME, description=TOOL_DESCRIPTION)
    async def ask_user(question: str, options: list[dict] | None = None,
                       multi: bool = False, ctx: Context = None) -> str:
        rc = ctx.request_context if ctx is not None else None
        req = getattr(rc, "request", None)
        token = req.headers.get(TOKEN_HEADER, "") if req is not None else ""
        meta = getattr(rc, "meta", None)
        can_stream = getattr(meta, "progressToken", None) is not None

        async def beat():
            await ctx.report_progress(0.0, None, "waiting for operator")

        return await resolve_ask(registry, token, question, options, multi,
                                 can_stream, heartbeat=beat)

    return mcp
