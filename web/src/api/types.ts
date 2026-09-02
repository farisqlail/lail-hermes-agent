export interface McpServer {
  name: string;
  type: 'stdio' | 'http';
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
  transport: '' | 'streamable-http' | 'sse';
  headers: Record<string, string>;
  oauth: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
}

export interface IntegrateEvent {
  kind: 'round' | 'attempt' | 'login' | 'need_secret' | 'done';
  action?: string;
  ok?: boolean;
  error?: string;
  url?: string;
  name?: string;
  hint?: string;
  reason?: string;
}

export interface IntegrateRun {
  state: 'running' | 'done';
  events: IntegrateEvent[];
  pending_secret: string;
  login_url: string;
  server: McpServer | null;
}

export interface Settings {
  ai_provider: 'nvidia' | 'deepseek' | 'custom';
  nvidia_base_url: string;
  model: string;
  planner_temperature: number;
  chat_model: string;
  vision_enabled: boolean;
  vision_model: string;
  title_gen_enabled: boolean;
  title_model: string;
  compression_enabled: boolean;
  compression_model: string;
  approval_note_enabled: boolean;
  approval_model: string;
  mcp_routing_enabled: boolean;
  mcp_routing_model: string;
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
  max_task_cost_usd: number;
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
  office_meetings_enabled: boolean;
  office_meeting_cooldown_s: number;
  office_max_auto_meetings_per_day: number;
  office_standup_enabled: boolean;
  office_standup_time: string;
  mcp_servers: McpServer[];
  // Skill content lives on disk (SKILL.md), not in Settings — use
  // api.getSkills()/saveSkills() (backed by /api/skills), not this object.
  calendar_ics_url: string;
}

export interface SecretsStatus {
  nvidia_api_key_set: boolean;
  telegram_bot_token_set: boolean;
  github_app_configured: boolean;
}

export interface SecretsUpdate {
  nvidia_api_key?: string;
  telegram_bot_token?: string;
  github_app_id?: string;
  github_app_private_key?: string;
  github_app_installation_id?: string;
}

export interface EngineModels {
  claude: string[];
  agy: string[];
  agy_live: boolean;
}

/** Live catalog of the conversational LLM's models — whatever endpoint
 *  Settings.nvidia_base_url points at (NVIDIA NIM, DeepSeek, a local
 *  9Router gateway, or any other OpenAI-compatible "custom" target). See
 *  GET /api/chat-models. Distinct from EngineModels, which is about the
 *  claude/agy CLI that runs background @project tasks, not casual chat. */
export interface ChatModels {
  models: string[];
  live: boolean;
  default: string;
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
  /** The conversation this task was started from. Optional: the column was
   *  added later, so rows written before it carry no session. */
  session_id?: string;
  /** Where the task was started, when `session_id` cannot say. `"office"` for
   *  employee work, which belongs to a roster rather than a chat. */
  origin?: string;
}

export interface Artifact {
  kind: string;
  path: string;
}

/** A write action (send email, delete file, …) the chat agent proposed and
 *  the operator must approve — by button or by voice ("konfirmasi" / "batal").
 *  Shared shape: same PendingStore backs the main chat pane and Office's
 *  employee chat, both scoped by session_id. */
export interface PendingAction {
  id: string;
  tool: string;
  summary: string;
  args: Record<string, unknown>;
  risk_note: string;
}

export interface PendingAsk {
  ask_id: string;
  question: string;
  options?: Array<string | { label?: string }>;
  multi: boolean;
}

export interface Employee {
  employee_id: string;
  name: string;
  role: string;
  avatar: string;
  personality: string;
  model: string;
  engine: string;
  skill_ids: string[];
  team_id: string | null;
  energy: number;
  status: 'idle' | 'working' | 'on_break' | 'in_meeting';
  pos_x: number;
  pos_y: number;
  active: boolean;
  is_lead: boolean;
  created: number;
  updated: number;
}

export interface Team {
  team_id: string;
  name: string;
  description: string;
  member_count: number;
  created: number;
}

export interface WorkItem {
  work_id: string;
  employee_id: string;
  team_id: string | null;
  kind: 'code_task' | 'chat_output' | 'meeting_transcript' | 'delegation' | 'decision_made';
  task_id: string | null;
  prompt: string;
  output_text: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  cost_usd: number;
  parent_work_id: string | null;
  created: number;
  updated: number;
}

export interface Meeting {
  meeting_id: string;
  team_id: string;
  participant_ids: string[];
  topic: string;
  transcript: string;
  triggered_by: string;
  created: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reply_snippet?: string | null;
  reply_role?: 'user' | 'assistant' | null;
}

export interface OfficeSession {
  session_id: string;
  employee_id: string;
  title: string;
  project: string | null;
  model: string;
  engine: string;
  chat_model: string | null;
  created: number;
  updated: number;
}

export interface OfficeSendMessageResult {
  kind: 'chat' | 'task';
  reply?: string;
  work_id?: string;
}

/** One planner step. `detail` is the step object as JSON — the planner's own
 *  shape, so it is parsed defensively where it is read. */
export interface Step {
  id: number;
  idx: number;
  kind: string;
  detail: string;
  status: string;
}

export interface TaskDetailResponse {
  task: Task;
  logs: string[];
  artifacts: Artifact[];
  steps: Step[];
  pending_confirm: string[] | null;
  pending_ask: PendingAsk | null;
}
