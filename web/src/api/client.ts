import { Settings, SecretsStatus, SecretsUpdate, EngineModels, ChatModels, Project, McpServer, IntegrateRun, Skill, Employee, Team, WorkItem, Meeting, ChatMessage, OfficeSession, OfficeSendMessageResult, PendingAction } from './types';

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: any) {
    let msg = 'Unknown error';
    if (typeof detail === 'string') {
      msg = detail;
    } else if (Array.isArray(detail)) {
      msg = detail.map((d: any) => {
        if (typeof d === 'string') return d;
        const loc = d.loc ? d.loc.filter((p: any) => p !== 'body').join('.') : '';
        return `${loc ? loc + ': ' : ''}${d.msg || JSON.stringify(d)}`;
      }).join('; ');
    } else if (detail && typeof detail === 'object') {
      msg = detail.msg || detail.detail || JSON.stringify(detail);
    }
    super(`API Error ${status}: ${msg}`);
    this.status = status;
    this.detail = String(msg);
    this.name = 'ApiError';
  }
}

/** The message worth showing an operator: FastAPI's own `detail` when the server
 *  sent one, the thrown Error's message otherwise. The validators in config.py
 *  and web_ui.py write text meant to be read, so `detail` wins over `message`. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return String(err.detail || fallback);
  if (err instanceof Error) return String(err.message || fallback);
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) {
    return err.map((d: any) => (typeof d === 'string' ? d : d.msg || JSON.stringify(d))).join('; ');
  }
  if (err && typeof err === 'object') {
    return (err as any).msg || (err as any).detail || JSON.stringify(err);
  }
  return fallback;
}

/** FastAPI's `detail` alone, for routing a validator message to the field that
 *  caused it. Null when the failure did not come from the API at all. */
export function errorDetail(err: unknown): string | null {
  if (err instanceof ApiError) return typeof err.detail === 'string' ? err.detail : String(err.detail);
  return null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    let detail: any = 'Unknown error';
    try {
      const data = await res.json();
      detail = data.detail || data;
    } catch {
      try {
        detail = await res.text();
      } catch {}
    }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (settings: Settings) =>
    request<{ ok: boolean }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  getSecretsStatus: () => request<SecretsStatus>('/api/secrets/status'),
  saveSecrets: (secrets: SecretsUpdate) =>
    request<{ ok: boolean }>('/api/secrets', {
      method: 'POST',
      body: JSON.stringify(secrets),
    }),

  getEngineModels: () => request<EngineModels>('/api/engine-models'),
  getChatModels: () => request<ChatModels>('/api/chat-models'),

  getProjects: () => request<Project[]>('/api/projects'),
  saveProjects: (projects: Record<string, string>) =>
    request<{ ok: boolean }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(projects),
    }),

  getMcpServers: () => request<McpServer[]>('/api/mcp'),
  saveMcpServers: (servers: McpServer[]) =>
    request<{ ok: boolean }>('/api/mcp', {
      method: 'POST',
      body: JSON.stringify(servers),
    }),

  getSkills: () => request<Skill[]>('/api/skills'),
  saveSkills: (skillList: Skill[]) =>
    request<{ ok: boolean }>('/api/skills', {
      method: 'POST',
      body: JSON.stringify(skillList),
    }),
  installSkillTap: (tap: string, skillPath: string) =>
    request<Skill>('/api/skills/install_tap', {
      method: 'POST',
      body: JSON.stringify({ tap, skill_path: skillPath }),
    }),

  getSkillsCatalog: (force = false) =>
    request<{ slug: string; name: string; description: string }[]>(
      `/api/skills/catalog${force ? '?force=true' : ''}`),
  installSkillCatalog: (slug: string) =>
    request<Skill>('/api/skills/install_catalog', {
      method: 'POST',
      body: JSON.stringify({ slug }),
    }),

  testMcpServer: (server: McpServer) =>
    request<{ ok: boolean; tools?: string[]; error?: string }>('/api/mcp/test', {
      method: 'POST',
      body: JSON.stringify(server),
    }),

  startIntegrate: (link: string) =>
    request<{ run_id: string }>('/api/mcp/integrate', {
      method: 'POST',
      body: JSON.stringify({ link }),
    }),

  getIntegrate: (runId: string) =>
    request<IntegrateRun>(`/api/mcp/integrate/${runId}`),

  answerIntegrateSecret: (runId: string, value: string) =>
    request<{ ok: boolean }>(`/api/mcp/integrate/${runId}/secret`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),

  // --- Office mode: AI-employee roster ---
  getEmployees: (teamId?: string) =>
    request<Employee[]>(`/api/office/employees${teamId ? `?team_id=${encodeURIComponent(teamId)}` : ''}`),
  createEmployee: (body: Partial<Employee>) =>
    request<Employee>('/api/office/employees', { method: 'POST', body: JSON.stringify(body) }),
  updateEmployee: (employeeId: string, body: Partial<Employee>) =>
    request<Employee>(`/api/office/employees/${employeeId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteEmployee: (employeeId: string) =>
    request<{ ok: boolean }>(`/api/office/employees/${employeeId}`, { method: 'DELETE' }),

  getTeams: () => request<Team[]>('/api/office/teams'),
  createTeam: (body: { name: string; description?: string }) =>
    request<Team>('/api/office/teams', { method: 'POST', body: JSON.stringify(body) }),
  updateTeam: (teamId: string, body: { name?: string; description?: string }) =>
    request<Team>(`/api/office/teams/${teamId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTeam: (teamId: string) =>
    request<{ ok: boolean }>(`/api/office/teams/${teamId}`, { method: 'DELETE' }),

  getWorkItems: (params?: { employeeId?: string; teamId?: string; parentWorkId?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.employeeId) q.set('employee_id', params.employeeId);
    if (params?.teamId) q.set('team_id', params.teamId);
    if (params?.parentWorkId) q.set('parent_work_id', params.parentWorkId);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<WorkItem[]>(`/api/office/work-items${qs ? `?${qs}` : ''}`);
  },
  getWorkItem: (workId: string) => request<WorkItem>(`/api/office/work-items/${workId}`),

  assignEmployeeTask: (employeeId: string, body: { prompt: string; project?: string }) =>
    request<WorkItem>(`/api/office/employees/${employeeId}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  assignTeamTask: (teamId: string, body: { prompt: string; project?: string }) =>
    request<WorkItem>(`/api/office/teams/${teamId}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createMeeting: (body: { team_id: string; participant_ids: string[]; topic: string; project?: string }) =>
    request<Meeting>('/api/office/meetings', { method: 'POST', body: JSON.stringify(body) }),
  getMeetings: (teamId?: string, triggeredBy?: string) => {
    const params = new URLSearchParams();
    if (teamId) params.set('team_id', teamId);
    if (triggeredBy) params.set('triggered_by', triggeredBy);
    const qs = params.toString();
    return request<Meeting[]>(`/api/office/meetings${qs ? `?${qs}` : ''}`);
  },
  runStandup: (teamId: string, project?: string) =>
    request<Meeting>(`/api/office/teams/${teamId}/standup`, {
      method: 'POST',
      body: JSON.stringify({ project }),
    }),

  getOfficeSessions: (employeeId?: string) =>
    request<OfficeSession[]>(`/api/office/sessions${employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : ''}`),
  createOfficeSession: (body: { employee_id: string; title?: string; project?: string; model?: string; engine?: string }) =>
    request<OfficeSession>('/api/office/sessions', { method: 'POST', body: JSON.stringify(body) }),
  getOfficeSession: (sessionId: string) => request<OfficeSession>(`/api/office/sessions/${sessionId}`),
  updateOfficeSession: (sessionId: string, body: { title?: string; project?: string; model?: string; engine?: string; chat_model?: string }) =>
    request<OfficeSession>(`/api/office/sessions/${sessionId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteOfficeSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/office/sessions/${sessionId}`, { method: 'DELETE' }),
  getOfficeSessionMessages: (sessionId: string) =>
    request<ChatMessage[]>(`/api/office/sessions/${sessionId}/messages`),
  sendOfficeSessionMessage: (
    sessionId: string, text: string,
    reply?: { snippet: string; role: 'user' | 'assistant' },
  ) =>
    request<OfficeSendMessageResult>(`/api/office/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, reply_snippet: reply?.snippet, reply_role: reply?.role }),
    }),
  resumeOfficeSession: (sessionId: string) =>
    request<OfficeSendMessageResult>(`/api/office/sessions/${sessionId}/resume`, { method: 'POST' }),

  // Shared with the main chat pane — a write action an employee's persona
  // parks mid-turn shows up here too, keyed by the same session_id.
  getChatPending: (sessionId: string) =>
    request<PendingAction[]>(`/api/chat/pending?session_id=${encodeURIComponent(sessionId)}`),
  resolveChatPending: (sessionId: string, id: string, approved: boolean) =>
    request<{ ok: boolean; resume?: boolean }>('/api/chat/pending/resolve', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, id, approved }),
    }),
};
