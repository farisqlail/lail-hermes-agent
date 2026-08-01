/** Voice-output settings, shared by the Dashboard (which speaks) and the Voice
 *  Output config tab (which chooses). Kept in one place so the default voice
 *  cannot drift between the two, and so it stays in step with TTS_VOICES in
 *  hermes/voice.py. */

import { api } from './api/client';
import type { VadSensitivity } from './vad';
export type { VadSensitivity };


export interface TtsVoice {
  id: string;
  name: string;
}

/** Shown until GET /api/tts/voices answers. Same order as the server's list in
 *  voice.py: multilingual first, because replies mix Bahasa with English terms
 *  and a single-locale voice mispronounces the other language. */
export const TTS_VOICES_FALLBACK: TtsVoice[] = [
  { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew (Pria - Multibahasa ID+EN)' },
  { id: 'en-US-AvaMultilingualNeural', name: 'Ava (Wanita - Multibahasa ID+EN)' },
  { id: 'en-US-BrianMultilingualNeural', name: 'Brian (Pria - Multibahasa ID+EN)' },
  { id: 'en-US-EmmaMultilingualNeural', name: 'Emma (Wanita - Multibahasa ID+EN)' },
  { id: 'id-ID-ArdiNeural', name: 'Ardi (Pria ID - Bahasa saja)' },
  { id: 'id-ID-GadisNeural', name: 'Gadis (Wanita ID - Bahasa saja)' },
  { id: 'en-GB-RyanNeural', name: 'Ryan (Male UK - Jarvis Style)' },
  { id: 'en-US-GuyNeural', name: 'Guy (Male US - Professional)' },
  { id: 'en-US-JennyNeural', name: 'Jenny (Female US - Soft)' },
];

export const TTS_VOICE_DEFAULT = TTS_VOICES_FALLBACK[0].id;

export type TtsMode = 'smart' | 'verbatim';
export type TtsPersonality = 'professional' | 'friendly' | 'jarvis';

export interface TtsSettings {
  tts_enabled: boolean;
  tts_voice: string;
  tts_mode: TtsMode;
  tts_max_words: number;
  tts_greeting: boolean;
  tts_task_notify: boolean;
  tts_personality: TtsPersonality;
}

export async function loadTtsSettings(): Promise<TtsSettings> {
  const s = await api.getSettings();
  return {
    tts_enabled: s.tts_enabled ?? false,
    tts_voice: s.tts_voice ?? TTS_VOICE_DEFAULT,
    tts_mode: (s.tts_mode as TtsMode) ?? 'smart',
    tts_max_words: s.tts_max_words ?? 40,
    tts_greeting: s.tts_greeting !== false,
    tts_task_notify: s.tts_task_notify ?? false,
    tts_personality: (s.tts_personality as TtsPersonality) ?? 'professional',
  };
}

export async function saveTtsSettings(s: Partial<TtsSettings>): Promise<void> {
  const current = await api.getSettings();
  const next = { ...current };
  if (s.tts_enabled !== undefined) next.tts_enabled = s.tts_enabled;
  if (s.tts_voice !== undefined) next.tts_voice = s.tts_voice;
  if (s.tts_mode !== undefined) next.tts_mode = s.tts_mode;
  if (s.tts_max_words !== undefined) next.tts_max_words = s.tts_max_words;
  if (s.tts_greeting !== undefined) next.tts_greeting = s.tts_greeting;
  if (s.tts_task_notify !== undefined) next.tts_task_notify = s.tts_task_notify;
  if (s.tts_personality !== undefined) next.tts_personality = s.tts_personality;
  await api.saveSettings(next);
}

export type TtsIntent = 'summary' | 'greeting' | 'notify';

export interface TtsRequestOptions {
  voice: string;
  agentName: string;
  maxWords: number;
  personality: TtsPersonality;
  text?: string;
  taskText?: string;
  taskStatus?: 'done' | 'failed';
}

/** Build the endpoint and body for one spoken utterance.
 *
 *  Nothing here writes a prompt. The server owns the instruction wording for
 *  every intent — a client-side prompt was previously read aloud verbatim
 *  whenever the summariser call failed. */
export function ttsRequest(
  mode: TtsMode,
  intent: TtsIntent,
  opts: TtsRequestOptions,
): { endpoint: string; payload: Record<string, unknown> } {
  if (mode === 'verbatim') {
    return {
      endpoint: '/api/tts',
      payload: { text: opts.text ?? '', voice: opts.voice },
    };
  }
  const payload: Record<string, unknown> = {
    intent,
    voice: opts.voice,
    agent_name: opts.agentName,
    max_words: opts.maxWords,
    personality: opts.personality,
  };
  if (intent === 'summary') payload.text = opts.text ?? '';
  if (intent === 'notify') {
    payload.task_text = opts.taskText ?? '';
    payload.task_status = opts.taskStatus ?? 'done';
  }
  return { endpoint: '/api/tts/smart', payload };
}

const GREETED_PREFIX = 'hermes_greeted_';

/** Has this browser tab already greeted for this conversation?
 *
 *  Per session_id, in sessionStorage: the Dashboard is not remounted when the
 *  operator switches sessions, so a component ref stayed `true` forever and
 *  every session after the first went ungreeted. A null session id, or a
 *  runtime with no sessionStorage (the node test runner), reports "already
 *  greeted" — silence is the safe failure. */
export function hasGreeted(sessionId: string | null): boolean {
  if (!sessionId || typeof sessionStorage === 'undefined') return true;
  return sessionStorage.getItem(GREETED_PREFIX + sessionId) === 'true';
}

export function markGreeted(sessionId: string | null): void {
  if (!sessionId || typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(GREETED_PREFIX + sessionId, 'true');
}

export interface VoiceSettings {
  voice_barge_in: boolean;
  voice_handsfree: boolean;
  voice_silence_ms: number;
  voice_sensitivity: VadSensitivity;
  // Wake word ("Hey Ev"), run by the native tray helper. The browser only reads
  // these to show/set them; the listener itself lives in python.
  wakeword_enabled: boolean;
  wakeword_model: string;
  wakeword_threshold: number;
  wakeword_cooldown_ms: number;
}

export const VOICE_SETTINGS_DEFAULT: VoiceSettings = {
  voice_barge_in: true,
  voice_handsfree: false,
  voice_silence_ms: 800,
  voice_sensitivity: 'medium',
  wakeword_enabled: false,
  wakeword_model: 'auto',
  wakeword_threshold: 0.5,
  wakeword_cooldown_ms: 2000,
};

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  const s = await api.getSettings();
  return {
    voice_barge_in: s.voice_barge_in ?? VOICE_SETTINGS_DEFAULT.voice_barge_in,
    voice_handsfree: s.voice_handsfree ?? VOICE_SETTINGS_DEFAULT.voice_handsfree,
    voice_silence_ms: s.voice_silence_ms ?? VOICE_SETTINGS_DEFAULT.voice_silence_ms,
    voice_sensitivity: (s.voice_sensitivity as VadSensitivity)
      ?? VOICE_SETTINGS_DEFAULT.voice_sensitivity,
    wakeword_enabled: s.wakeword_enabled ?? VOICE_SETTINGS_DEFAULT.wakeword_enabled,
    wakeword_model: s.wakeword_model ?? VOICE_SETTINGS_DEFAULT.wakeword_model,
    wakeword_threshold: s.wakeword_threshold ?? VOICE_SETTINGS_DEFAULT.wakeword_threshold,
    wakeword_cooldown_ms: s.wakeword_cooldown_ms
      ?? VOICE_SETTINGS_DEFAULT.wakeword_cooldown_ms,
  };
}

export async function saveVoiceSettings(s: Partial<VoiceSettings>): Promise<void> {
  const current = await api.getSettings();
  await api.saveSettings({ ...current, ...s });
}

