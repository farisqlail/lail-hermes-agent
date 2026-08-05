import os
import pytest


@pytest.fixture(autouse=True)
def _reset_openai_client_cache():
    # main._client memoizes one AsyncOpenAI per (endpoint, key, timeout) so the
    # bot doesn't rebuild a client (new TLS handshake) on every completion. The
    # cache is process-global and would otherwise hand one test's fake client
    # to the next — tests monkeypatch main.AsyncOpenAI expecting a fresh build.
    from hermes import main
    main._CLIENT_CACHE.clear()
    yield
    main._CLIENT_CACHE.clear()


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return tmp_path
