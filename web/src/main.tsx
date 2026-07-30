import React from 'react';
import { createRoot } from 'react-dom/client';
import { useRoute } from './router';
import { ConfigGeneral } from './pages/ConfigGeneral';
import { ConfigSecrets } from './pages/ConfigSecrets';
import { ConfigMcp } from './pages/ConfigMcp';
import { ConfigProjects } from './pages/ConfigProjects';
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
  const { path, taskId, navigate } = useRoute();
  const { tasks, loading: loadingTasks } = useTasksContext();
  const { status: secretsStatus } = useSecrets();

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
          <span>⬢</span> Lail Hermes
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

        <div className="sidebar-section-title">
          Tasks ({tasks.length})
        </div>
        <div className="task-list">
          {loadingTasks ? (
            <div style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-faint)', fontSize: 'var(--t-xs)' }}>
              Memuat tugas...
            </div>
          ) : tasks.length === 0 ? (
            <div style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-faint)', fontSize: 'var(--t-xs)' }}>
              Belum ada tugas.
            </div>
          ) : (
            tasks.map((t) => (
              <a
                key={t.task_id}
                href={`#/task/${t.task_id}`}
                className={`task-item ${t.status} ${taskId === t.task_id ? 'active' : ''}`}
                onClick={(e) => handleNavClick(e, `#/task/${t.task_id}`)}
              >
                <div className="task-time">{formatTime(t.created)} • {t.task_id}</div>
                <div className="task-desc">{t.text}</div>
              </a>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="status-indicator">
            <span className={`status-dot ${secretsStatus?.telegram_bot_token_set ? 'ready' : 'error'}`}></span>
            <span>Bot: {secretsStatus?.telegram_bot_token_set ? 'Active' : 'Missing'}</span>
          </div>
          <div className="status-indicator">
            <span className={`status-dot ${secretsStatus?.nvidia_api_key_set ? 'ready' : 'error'}`}></span>
            <span>NIM: {secretsStatus?.nvidia_api_key_set ? 'Ready' : 'Missing'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <div className="page-container">
          {path === '/' && <Dashboard />}

          {path === '/task' && <TaskDetail />}

          {isConfigRoute && (
            <div>
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
              </div>

              <div>
                {path === '/config/general' && <ConfigGeneral />}
                {path === '/config/secrets' && <ConfigSecrets />}
                {path === '/config/mcp' && <ConfigMcp />}
                {path === '/config/projects' && <ConfigProjects />}
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
