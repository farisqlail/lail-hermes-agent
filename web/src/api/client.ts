import { Settings, SecretsStatus, SecretsUpdate, EngineModels, Project, McpServer } from './types';

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`API Error ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
    this.name = 'ApiError';
  }
}

/** The message worth showing an operator: FastAPI's own `detail` when the server
 *  sent one, the thrown Error's message otherwise. The validators in config.py
 *  and web_ui.py write text meant to be read, so `detail` wins over `message`. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.detail || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** FastAPI's `detail` alone, for routing a validator message to the field that
 *  caused it. Null when the failure did not come from the API at all. */
export function errorDetail(err: unknown): string | null {
  return err instanceof ApiError ? err.detail : null;
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
    let detail = 'Unknown error';
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
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

  testMcpServer: (server: McpServer) =>
    request<{ ok: boolean; tools?: string[]; error?: string }>('/api/mcp/test', {
      method: 'POST',
      body: JSON.stringify(server),
    }),
};
