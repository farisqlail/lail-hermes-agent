import { test } from 'node:test';
import assert from 'node:assert';
import { ttsRequest, hasGreeted, markGreeted, loadTtsSettings, saveTtsSettings } from './tts';

const base = { voice: 'id-ID-ArdiNeural', agentName: 'Lail Agent',
               maxWords: 40, personality: 'professional' as const };

test('verbatim mode posts the raw text to /api/tts', () => {
  const { endpoint, payload } = ttsRequest('verbatim', 'summary', { ...base, text: 'halo' });
  assert.equal(endpoint, '/api/tts');
  assert.deepEqual(payload, { text: 'halo', voice: 'id-ID-ArdiNeural' });
});

test('smart greeting sends no text at all', () => {
  const { endpoint, payload } = ttsRequest('smart', 'greeting', base);
  assert.equal(endpoint, '/api/tts/smart');
  assert.equal((payload as Record<string, unknown>).intent, 'greeting');
  // the greeting carries no content: the server owns the wording and the clock
  assert.equal((payload as Record<string, unknown>).text, undefined);
});

test('smart notify sends the task as data, not as an instruction', () => {
  const { payload } = ttsRequest('smart', 'notify', {
    ...base, taskText: 'jalankan pengujian', taskStatus: 'failed',
  });
  const p = payload as Record<string, unknown>;
  assert.equal(p.intent, 'notify');
  assert.equal(p.task_text, 'jalankan pengujian');
  assert.equal(p.task_status, 'failed');
  assert.equal(p.text, undefined);
});

test('smart summary carries the reply text', () => {
  const { payload } = ttsRequest('smart', 'summary', { ...base, text: 'hasilnya begini' });
  const p = payload as Record<string, unknown>;
  assert.equal(p.intent, 'summary');
  assert.equal(p.text, 'hasilnya begini');
  assert.equal(p.max_words, 40);
  assert.equal(p.personality, 'professional');
});

test('hasGreeted defaults to true in node/test environments without sessionStorage', () => {
  assert.equal(hasGreeted('session-123'), true);
});

test('hasGreeted and markGreeted read/write window.sessionStorage when present', () => {
  const store: Record<string, string> = {};
  const fakeSessionStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    clear: () => {},
    key: () => null,
    removeItem: () => {},
    length: 0,
  };
  globalThis.sessionStorage = fakeSessionStorage as any;
  try {
    assert.equal(hasGreeted('session-123'), false);
    markGreeted('session-123');
    assert.equal(hasGreeted('session-123'), true);
    assert.equal(hasGreeted('session-456'), false);
  } finally {
    // clean up global scope
    delete (globalThis as any).sessionStorage;
  }
});

test('loadTtsSettings parses settings from server response', async () => {
  const mockSettings = {
    tts_enabled: true,
    tts_voice: 'en-US-GuyNeural',
    tts_mode: 'verbatim' as const,
    tts_max_words: 30,
    tts_greeting: false,
    tts_task_notify: true,
    tts_personality: 'friendly' as const,
  };
  globalThis.fetch = async (url: any) => {
    assert.equal(url, '/api/settings');
    return {
      ok: true,
      json: async () => mockSettings,
    } as any;
  };
  try {
    const s = await loadTtsSettings();
    assert.deepEqual(s, mockSettings);
  } finally {
    delete (globalThis as any).fetch;
  }
});

test('saveTtsSettings loads, merges and posts settings to server', async () => {
  let posted: any = null;
  const mockSettings = {
    ai_provider: 'nvidia',
    tts_enabled: false,
    tts_voice: 'id-ID-ArdiNeural',
  };
  globalThis.fetch = async (url: any, opts: any) => {
    if (opts?.method === 'POST') {
      assert.equal(url, '/api/settings');
      posted = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true }) } as any;
    } else {
      assert.equal(url, '/api/settings');
      return { ok: true, json: async () => mockSettings } as any;
    }
  };
  try {
    await saveTtsSettings({ tts_enabled: true });
    assert.deepEqual(posted, {
      ai_provider: 'nvidia',
      tts_enabled: true,
      tts_voice: 'id-ID-ArdiNeural',
    });
  } finally {
    delete (globalThis as any).fetch;
  }
});
