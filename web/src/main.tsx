import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoute } from './router';
import { ConfigGeneral } from './pages/ConfigGeneral';
import { ConfigSecrets } from './pages/ConfigSecrets';
import { ConfigMcp } from './pages/ConfigMcp';
import { ConfigProjects } from './pages/ConfigProjects';
import { ConfigVoice } from './pages/ConfigVoice';
import { Dashboard } from './pages/Dashboard';
import { TaskDetail } from './pages/TaskDetail';
import { ToastProvider } from './components/Toast';
import { TasksProvider, useTasksContext } from './api/events';
import { useSecrets } from './hooks/useSecrets';
import { ErrorBoundary } from './components/ErrorBoundary';

import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';

function formatTime(unixSeconds: number | undefined): string {
  if (!unixSeconds) return '--:--';
  const date = new Date(unixSeconds * 1000);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function AppContent() {
  const { path, taskId, sessionId, navigate } = useRoute();
  const { status: secretsStatus } = useSecrets();

  const [sessions, setSessions] = useState<{ session_id: string; title: string; created: number }[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [focusedNode, setFocusedNode] = useState<{ id: string; label: string; type: string; details?: string; status?: string } | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Gagal memuat daftar sesi:', err);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const createNewSession = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        await fetchSessions();
        navigate(`#/session/${data.session_id}`);
      }
    } catch (err) {
      console.error('Gagal membuat sesi baru:', err);
    }
  }, [fetchSessions, navigate]);

  const handleDeleteSession = useCallback(async (sid: string) => {
    if (!window.confirm('Hapus percakapan ini beserta seluruh tugas di dalamnya?')) return;
    try {
      const res = await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchSessions();
        if (sessionId === sid) {
          navigate('#/');
        }
      }
    } catch (err) {
      console.error('Gagal menghapus sesi:', err);
    }
  }, [fetchSessions, sessionId, navigate]);

  useEffect(() => {
    if (path === '/' && !sessionId && !loadingSessions) {
      if (sessions.length > 0) {
        navigate(`#/session/${sessions[0].session_id}`);
      } else {
        createNewSession();
      }
    }
  }, [path, sessionId, loadingSessions, sessions, navigate, createNewSession]);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    e.preventDefault();
    navigate(hash);
  };

  const isConfigRoute = path.startsWith('/config');

  return (
    <div className="app-container">
      {/* Permanent Left Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-text">
            <span>⬡</span> LAIL HERMES
          </div>
          <div className="sidebar-logo-badge">SYS</div>
        </div>

        {/* INSPECTOR */}
        <div className="inspector-card">
          <div className="inspector-title">Inspector</div>
          <div className="inspector-body">
            {focusedNode ? (
              <div>
                <div style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>
                  [{focusedNode.type}]
                </div>
                <div style={{ color: 'var(--text)', fontSize: '12px', marginBottom: '6px', wordBreak: 'break-all' }}>
                  {focusedNode.label}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
                  ID: {focusedNode.id}
                </div>
                {focusedNode.status && (
                  <div style={{ fontSize: '10px', marginTop: '4px' }}>
                    STATUS: <span style={{ color: 'var(--accent)' }}>{focusedNode.status.toUpperCase()}</span>
                  </div>
                )}
                {focusedNode.details && (
                  <div style={{ marginTop: '6px', fontSize: '10px', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                    {focusedNode.details}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>
                Click a node to focus it. Shift-click a second to trace the path.
              </div>
            )}
          </div>
        </div>

        <nav className="sidebar-nav">
          <a
            href="#/"
            className={`nav-item ${path === '/' ? 'active' : ''}`}
            onClick={(e) => handleNavClick(e, '#/')}
          >
            Dashboard
          </a>
          <a
            href="#/config/general"
            className={`nav-item ${isConfigRoute ? 'active' : ''}`}
            onClick={(e) => handleNavClick(e, '#/config/general')}
          >
            Configure
          </a>
        </nav>

        <div className="sidebar-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Chats ({sessions.length})</span>
          <button
            onClick={createNewSession}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              padding: '2px 8px',
              borderRadius: 'var(--r-sm)',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
            title="Percakapan Baru"
          >
            [+ NEW]
          </button>
        </div>
        <div className="task-list">
          {loadingSessions ? (
            <div style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-faint)', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)' }}>
              CONNECTING TO DATA STREAMS...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-faint)', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)' }}>
              NO CHAT LOGS FOUND
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.session_id}
                style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                className={`task-item-container ${sessionId === s.session_id ? 'active' : ''}`}
              >
                <a
                  href={`#/session/${s.session_id}`}
                  className={`task-item ${sessionId === s.session_id ? 'active' : ''}`}
                  onClick={(e) => handleNavClick(e, `#/session/${s.session_id}`)}
                  style={{ flex: 1, paddingRight: '32px' }}
                >
                  <div className="task-time">{formatTime(s.created)}</div>
                  <div className="task-desc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                </a>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleDeleteSession(s.session_id);
                  }}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-faint)',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '4px',
                    zIndex: 2,
                  }}
                  title="Hapus percakapan"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="status-indicator">
            <span className={`status-dot ${secretsStatus?.telegram_bot_token_set ? 'ready' : 'error'}`}></span>
            <span>BOT: {secretsStatus?.telegram_bot_token_set ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          <div className="status-indicator">
            <span className={`status-dot ${secretsStatus?.nvidia_api_key_set ? 'ready' : 'error'}`}></span>
            <span>NIM: {secretsStatus?.nvidia_api_key_set ? 'STABLE' : 'MISSING'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <div className="page-container">
          {path === '/' && <Dashboard sessionId={sessionId} onRefreshSessions={fetchSessions} onSelectNode={setFocusedNode} />}

          {path === '/task' && (
            <div className="config-container">
              <TaskDetail />
            </div>
          )}

          {isConfigRoute && (
            <div className="config-container">
              <header className="page-header">
                <h1 className="page-title">Configuration</h1>
                <p className="page-subtitle">Atur setting utama, API keys, MCP servers, dan proyek Anda</p>
              </header>

              {/* Sub-navigation for configuration tabs */}
              <div className="config-tab-bar">
                <a
                  href="#/config/general"
                  onClick={(e) => handleNavClick(e, '#/config/general')}
                  className={`config-tab-item ${path === '/config/general' ? 'active' : ''}`}
                >
                  General
                </a>
                <a
                  href="#/config/secrets"
                  onClick={(e) => handleNavClick(e, '#/config/secrets')}
                  className={`config-tab-item ${path === '/config/secrets' ? 'active' : ''}`}
                >
                  Secrets
                </a>
                <a
                  href="#/config/mcp"
                  onClick={(e) => handleNavClick(e, '#/config/mcp')}
                  className={`config-tab-item ${path === '/config/mcp' ? 'active' : ''}`}
                >
                  MCP Servers
                </a>
                <a
                  href="#/config/projects"
                  onClick={(e) => handleNavClick(e, '#/config/projects')}
                  className={`config-tab-item ${path === '/config/projects' ? 'active' : ''}`}
                >
                  Projects
                </a>
                <a
                  href="#/config/voice"
                  onClick={(e) => handleNavClick(e, '#/config/voice')}
                  className={`config-tab-item ${path === '/config/voice' ? 'active' : ''}`}
                >
                  Voice Output
                </a>
              </div>

              <div>
                {path === '/config/general' && <ConfigGeneral />}
                {path === '/config/secrets' && <ConfigSecrets />}
                {path === '/config/mcp' && <ConfigMcp />}
                {path === '/config/projects' && <ConfigProjects />}
                {path === '/config/voice' && <ConfigVoice />}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <TasksProvider>
          <AppContent />
        </TasksProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
