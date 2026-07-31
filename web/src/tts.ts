/** Voice-output settings, shared by the Dashboard (which speaks) and the Voice
 *  Output config tab (which chooses). Kept in one place so the default voice
 *  cannot drift between the two, and so it stays in step with TTS_VOICES in
 *  hermes/web_ui.py. */

export interface TtsVoice {
  id: string;
  name: string;
}

/** Shown until GET /api/tts/voices answers. Same order as the server's list:
 *  Indonesian first, because the agent replies in Bahasa and an English voice
 *  reads Indonesian text with English phonetics. */
export const TTS_VOICES_FALLBACK: TtsVoice[] = [
  { id: 'id-ID-ArdiNeural', name: 'Ardi (Pria ID - Natural)' },
  { id: 'id-ID-GadisNeural', name: 'Gadis (Wanita ID - Natural)' },
  { id: 'en-GB-RyanNeural', name: 'Ryan (Male UK - Jarvis Style)' },
  { id: 'en-US-GuyNeural', name: 'Guy (Male US - Professional)' },
  { id: 'en-US-JennyNeural', name: 'Jenny (Female US - Soft)' },
];

export const TTS_VOICE_DEFAULT = TTS_VOICES_FALLBACK[0].id;

const ENABLED_KEY = 'hermes_tts_enabled';
const VOICE_KEY = 'hermes_tts_voice';

export function loadTtsEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === 'true';
}

/** The operator's saved voice, or the default when they have never saved one.
 *  Only the config tab writes, so an unsaved browser follows the default
 *  instead of being frozen on whatever shipped earlier. */
export function loadTtsVoice(): string {
  return localStorage.getItem(VOICE_KEY) || TTS_VOICE_DEFAULT;
}

export function saveTtsSettings(enabled: boolean, voice: string): void {
  localStorage.setItem(ENABLED_KEY, enabled.toString());
  localStorage.setItem(VOICE_KEY, voice);
}

// ── Smart TTS (Jarvis voice) settings ──
const MODE_KEY = 'hermes_tts_mode';
const MAX_WORDS_KEY = 'hermes_tts_max_words';
const GREETING_KEY = 'hermes_tts_greeting';
const TASK_NOTIFY_KEY = 'hermes_tts_task_notify';
const PERSONALITY_KEY = 'hermes_tts_personality';

export type TtsMode = 'smart' | 'verbatim';
export type TtsPersonality = 'professional' | 'friendly' | 'jarvis';

export function loadTtsMode(): TtsMode {
  return (localStorage.getItem(MODE_KEY) as TtsMode) || 'smart';
}

export function loadTtsMaxWords(): number {
  return parseInt(localStorage.getItem(MAX_WORDS_KEY) || '40', 10);
}

export function loadTtsGreeting(): boolean {
  return localStorage.getItem(GREETING_KEY) !== 'false'; // default true
}

export function loadTtsTaskNotify(): boolean {
  return localStorage.getItem(TASK_NOTIFY_KEY) === 'true'; // default false
}

export function loadTtsPersonality(): TtsPersonality {
  return (localStorage.getItem(PERSONALITY_KEY) as TtsPersonality) || 'professional';
}

export function saveSmartTtsSettings(
  mode: TtsMode,
  maxWords: number,
  greeting: boolean,
  taskNotify: boolean,
  personality: TtsPersonality,
): void {
  localStorage.setItem(MODE_KEY, mode);
  localStorage.setItem(MAX_WORDS_KEY, maxWords.toString());
  localStorage.setItem(GREETING_KEY, greeting.toString());
  localStorage.setItem(TASK_NOTIFY_KEY, taskNotify.toString());
  localStorage.setItem(PERSONALITY_KEY, personality);
}
