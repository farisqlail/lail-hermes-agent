export interface McpServer {
  name: string;
  type: 'stdio' | 'http';
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
}

export interface Settings {
  ai_provider: 'nvidia' | 'deepseek' | 'custom';
  nvidia_base_url: string;
  model: string;
  planner_temperature: number;
  chat_model: string;
  chat_temperature: number;
  agent_name: string;
  allowed_user_ids: number[];
  default_engine: 'claude' | 'antigravity' | 'auto';
  claude_model: string;
  claude_effort: '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  agy_model: string;
  projects_path: string;
  projects: Record<string, string>; // name -> path
  android_sdk_path: string;
  emulator_avd: string;
  default_test_mode: 'browser' | 'emulator' | 'none';
  confirm_risky: boolean;
  timeout_code_s: number;
  timeout_build_s: number;
  timeout_test_s: number;
  stt_enabled: boolean;
  stt_language: string;
  stt_model: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  tts_enabled: boolean;
  tts_voice: string;
  tts_mode: 'smart' | 'verbatim';
  tts_max_words: number;
  tts_greeting: boolean;
  tts_task_notify: boolean;
  tts_narrate: boolean;
  tts_personality: 'professional' | 'friendly' | 'jarvis';
  voice_barge_in: boolean;
  voice_handsfree: boolean;
  voice_silence_ms: number;
  voice_sensitivity: 'low' | 'medium' | 'high';
  wakeword_enabled: boolean;
  wakeword_model: string;
  wakeword_threshold: number;
  wakeword_cooldown_ms: number;
  mcp_servers: McpServer[];
}

export interface SecretsStatus {
  nvidia_api_key_set: boolean;
  telegram_bot_token_set: boolean;
}

export interface SecretsUpdate {
  nvidia_api_key?: string;
  telegram_bot_token?: string;
}

export interface EngineModels {
  claude: string[];
  agy: string[];
  agy_live: boolean;
}

export interface Project {
  name: string;
  path: string;
  exists: boolean;
}

export interface Task {
  task_id: string;
  status: 'queued' | 'awaiting_confirm' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';
  text: string;
  chat_id: number;
  created: number;
}

export interface Artifact {
  kind: string;
  path: string;
}

export interface PendingAsk {
  ask_id: string;
  question: string;
  options?: Array<string | { label?: string }>;
  multi: boolean;
}

export interface TaskDetailResponse {
  task: Task;
  logs: string[];
  artifacts: Artifact[];
  pending_confirm: string[] | null;
  pending_ask: PendingAsk | null;
}
