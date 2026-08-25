'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRoute } from '../router';
import { ConfigGeneral } from '../views/ConfigGeneral';
import { ConfigSecrets } from '../views/ConfigSecrets';
import { ConfigMcp } from '../views/ConfigMcp';
import { ConfigProjects } from '../views/ConfigProjects';
import { ConfigVoice } from '../views/ConfigVoice';
import { Dashboard } from '../views/Dashboard';
import { TaskDetail } from '../views/TaskDetail';
import { ToastProvider, useToast } from '../components/Toast';
import { TasksProvider, useTasksContext } from '../api/events';
import { useSecrets } from '../hooks/useSecrets';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { SettingsModal } from '../components/SettingsModal';
import { ArtifactsModal } from '../components/ArtifactsModal';
import { ScheduledJobsModal } from '../components/ScheduledJobsModal';
import {
  PlusCircle,
  Plus,
  Zap,
  MessageSquare,
  FileText,
  Clock,
  Search,
  Pin,
  List,
  SlidersHorizontal,
  Home as HomeIcon,
  GitBranch,
  Settings,
  MoreHorizontal,
  PanelLeft,
  X,
  Send,
  Sparkles,
} from 'lucide-react';

import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/layout.css';
function formatRelativeTime(unixSeconds: number | undefined): string {
  if (!unixSeconds) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function AppContent() {
  const { path, taskId, sessionId, navigate } = useRoute();
  const { status: secretsStatus } = useSecrets();
  const { toast } = useToast();

  const [sessions, setSessions] = useState<{ session_id: string; title: string; created: number }[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'bots'>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Modals for capabilities / artifacts / scheduled jobs
  const [activeModal, setActiveModal] = useState<'capabilities' | 'messaging' | 'artifacts' | 'jobs' | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  // Pinned session IDs saved to localStorage
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('hermes_pinned_sessions') || '[]');
    } catch {
      return [];
    }
  });

  const togglePinSession = useCallback((sid: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid];
      try {
        localStorage.setItem('hermes_pinned_sessions', JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save pinned sessions:', err);
      }
      return next;
    });
  }, []);

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

  const confirmDeleteSession = useCallback(async () => {
    if (!sessionToDelete) return;
    try {
      const res = await fetch(`/api/sessions/${sessionToDelete}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchSessions();
        if (sessionId === sessionToDelete) {
          navigate('#/');
        }
      }
    } catch (err) {
      console.error('Gagal menghapus sesi:', err);
    }
  }, [fetchSessions, sessionId, navigate, sessionToDelete]);

  // Comprehensive Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. New session: Ctrl+N or Cmd+N
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createNewSession();
      }
      // 2. Settings toggle: Ctrl+, or Cmd+,
      else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen((prev) => !prev);
      }
      // 3. Search Settings / Command: Ctrl+K or Cmd+K
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSettingsOpen(true);
        setTimeout(() => {
          const searchInput = document.getElementById('settings-search-input') as HTMLInputElement | null;
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
        }, 60);
      }
      // 4. Toggle sidebar: Ctrl+B or Cmd+B
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
      // 5. Open Artifacts: Ctrl+Shift+A or Cmd+Shift+A
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setActiveModal((prev) => (prev === 'artifacts' ? null : 'artifacts'));
      }
      // 6. Open Scheduled Jobs: Ctrl+Shift+J or Cmd+Shift+J
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setActiveModal((prev) => (prev === 'jobs' ? null : 'jobs'));
      }
      // 7. Focus Chat Prompt: Alt+Space
      else if (e.altKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault();
        const inputEl = (document.getElementById('chat-input') ||
          document.querySelector('.ask-main-input-field')) as HTMLInputElement | null;
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }
      // 8. Escape: Close modals
      else if (e.key === 'Escape') {
        if (activeModal) {
          e.preventDefault();
          setActiveModal(null);
        } else if (isSettingsOpen) {
          e.preventDefault();
          setIsSettingsOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewSession, activeModal, isSettingsOpen]);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    e.preventDefault();
    navigate(hash);
  };

  // Filtered session lists
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.session_id.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const pinnedSessions = useMemo(() => {
    return filteredSessions.filter((s) => pinnedIds.includes(s.session_id));
  }, [filteredSessions, pinnedIds]);

  const unpinnedSessions = useMemo(() => {
    return filteredSessions.filter((s) => !pinnedIds.includes(s.session_id));
  }, [filteredSessions, pinnedIds]);

  const isConfigRoute = path.startsWith('/config');

  return (
    <div className="app-container">
      {/* Main App Body (Sidebar + Content) */}
      <div className="app-body">
        {/* Left Sidebar (Matching Screenshot Reference) */}
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          {/* Top Tabs: SESSIONS / BOTS */}
          <div className="sidebar-tabs">
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'sessions' ? 'active' : ''}`}
              onClick={() => setSidebarTab('sessions')}
            >
              SESSIONS
            </button>
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'bots' ? 'active' : ''}`}
              onClick={() => setSidebarTab('bots')}
            >
              BOTS
            </button>
          </div>

          {/* Primary Action Menu */}
          <div className="sidebar-actions-menu">
            <button
              type="button"
              className="sidebar-action-item"
              onClick={createNewSession}
              title="Create new conversation (Ctrl+N)"
            >
              <div className="action-item-left">
                <PlusCircle size={14} className="action-item-icon" />
                <span>New session</span>
              </div>
              <div className="kbd-shortcut-badge">
                <span className="kbd-key">Ctrl</span>
                <span className="kbd-key">N</span>
              </div>
            </button>

            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('capabilities')}
              title="Capabilities & Tools"
            >
              <div className="action-item-left">
                <Zap size={14} className="action-item-icon" />
                <span>Capabilities</span>
              </div>
            </button>

            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('messaging')}
              title="Messaging & Telegram Integration"
            >
              <div className="action-item-left">
                <MessageSquare size={14} className="action-item-icon" />
                <span>Messaging</span>
              </div>
            </button>

            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('artifacts')}
              title="Generated Artifacts"
            >
              <div className="action-item-left">
                <FileText size={14} className="action-item-icon" />
                <span>Artifacts</span>
              </div>
            </button>

            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('jobs')}
              title="Scheduled Tasks & Background Jobs"
            >
              <div className="action-item-left">
                <Clock size={14} className="action-item-icon" />
                <span>Scheduled jobs</span>
              </div>
            </button>
          </div>

          {/* Search Box */}
          <div className="sidebar-search-box">
            <Search size={13} className="sidebar-search-icon" style={{ opacity: 0.6 }} />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* PINNED Section */}
          <div className="pinned-section">
            <div className="sidebar-section-header">
              <div className="section-header-title">
                <Pin size={11} style={{ transform: 'rotate(45deg)', opacity: 0.8 }} />
                <span>PINNED</span>
              </div>
            </div>

            {pinnedSessions.length === 0 ? (
              <div className="pinned-empty-hint">
                <span style={{ transform: 'rotate(180deg)', display: 'inline-block', fontSize: '11px' }}>↳</span>
                <span>Shift-click a chat to pin</span>
              </div>
            ) : (
              pinnedSessions.map((s) => (
                <div
                  key={s.session_id}
                  className={`session-row ${sessionId === s.session_id ? 'active' : ''}`}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      togglePinSession(s.session_id);
                    } else {
                      handleNavClick(e as any, `#/session/${s.session_id}`);
                    }
                  }}
                  title="Shift-click to unpin"
                >
                  <div className="session-row-left">
                    <Pin size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span className="session-title-text">{s.title || 'Untitled session'}</span>
                  </div>
                  <div className="session-row-right">
                    <span className="session-time">{formatRelativeTime(s.created)}</span>
                    <button
                      type="button"
                      className="session-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSessionToDelete(s.session_id);
                      }}
                      title="Delete session"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* SESSIONS List Section */}
          <div className="sidebar-section-header" style={{ marginTop: '4px' }}>
            <div className="section-header-title">
              <List size={12} style={{ opacity: 0.8 }} />
              <span>SESSIONS</span>
            </div>
            <button type="button" className="section-header-action-btn" title="Sort & Filter">
              <SlidersHorizontal size={11} />
            </button>
          </div>

          <div className="session-list-scroll">
            {loadingSessions ? (
              <div style={{ padding: '8px 12px', color: 'var(--text-faint)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                CONNECTING TO SESSIONS...
              </div>
            ) : unpinnedSessions.length === 0 ? (
              <div style={{ padding: '8px 12px', color: 'var(--text-faint)', fontSize: '11px', fontStyle: 'italic' }}>
                {searchQuery ? 'No matching sessions' : 'No recent sessions'}
              </div>
            ) : (
              unpinnedSessions.map((s) => (
                <div
                  key={s.session_id}
                  className={`session-row ${sessionId === s.session_id ? 'active' : ''}`}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      togglePinSession(s.session_id);
                    } else {
                      handleNavClick(e as any, `#/session/${s.session_id}`);
                    }
                  }}
                  title="Shift-click to pin this chat"
                >
                  <div className="session-row-left">
                    <span className="session-bullet">•</span>
                    <span className="session-title-text">{s.title || 'Initial greeting and hello'}</span>
                  </div>
                  <div className="session-row-right">
                    <span className="session-time">{formatRelativeTime(s.created)}</span>
                    <button
                      type="button"
                      className="session-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSessionToDelete(s.session_id);
                      }}
                      title="Delete session"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Sidebar Footer */}
          <div className="sidebar-footer-container">
            <div className="sidebar-icon-bar">
              <div className="sidebar-icon-group">
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  onClick={() => navigate('#/')}
                  title="Dashboard Home"
                >
                  <HomeIcon size={14} />
                </button>
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  onClick={createNewSession}
                  title="New Session (Ctrl+N)"
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  onClick={() => navigate('#/config/projects')}
                  title="Projects & Git Workspace"
                >
                  <GitBranch size={14} />
                </button>
              </div>

              <div className="sidebar-icon-group">
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  onClick={() => setIsSettingsOpen(true)}
                  title="Settings & Models (Ctrl+,)"
                >
                  <Settings size={14} />
                </button>
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  onClick={() => setIsSettingsOpen(true)}
                  title="More Settings"
                >
                  <MoreHorizontal size={14} />
                </button>
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  title="Pin / Toggle Sidebar"
                >
                  <PanelLeft size={14} />
                </button>
              </div>
            </div>

            <div className="sidebar-status-bar">
              <div className="status-left">
                <span className="gateway-pulse-dot" />
                <Sparkles size={11} style={{ color: 'var(--accent)' }} />
                <span>Gateway ready</span>
              </div>
              <span className="status-version"># v0.20.5</span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="main-content">
          <div className="page-container">
            {path === '/' && (
              <Dashboard sessionId={sessionId} onRefreshSessions={fetchSessions} />
            )}

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

      {/* Capabilities Modal */}
      <Modal
        isOpen={activeModal === 'capabilities'}
        onClose={() => setActiveModal(null)}
        title="⚡ Lail Hermes Capabilities"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
          <p style={{ color: 'var(--text-dim)' }}>
            Lail Hermes dilengkapi dengan berbagai modul perencanaan mandiri dan eksekusi coding:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>🤖 LLM Planner</div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Perencana multi-langkah otonom dengan konfirmasi tindakan berisiko.</div>
            </div>
            <div style={{ padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>🔌 MCP Tools</div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Integrasi alat eksternal via Model Context Protocol (stdio & SSE).</div>
            </div>
            <div style={{ padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>🎙️ Voice Loop</div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Voice-in / voice-out interaktif dengan barge-in dan ringkasan suara.</div>
            </div>
            <div style={{ padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>🛠️ Multi-Engine Runner</div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Claude CLI, Antigravity CLI, dan sub-agent runner.</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button
              type="button"
              className="config-tab-item active"
              onClick={() => {
                setActiveModal(null);
                navigate('#/config/mcp');
              }}
            >
              Kelola MCP Servers →
            </button>
          </div>
        </div>
      </Modal>

      {/* Messaging Modal */}
      <Modal
        isOpen={activeModal === 'messaging'}
        onClose={() => setActiveModal(null)}
        title="💬 Messaging & Telegram Integration"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>📱</span>
            <div>
              <div style={{ fontWeight: 600 }}>Telegram Bot Gateway</div>
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                Status Bot:{' '}
                <strong style={{ color: secretsStatus?.telegram_bot_token_set ? 'var(--ok)' : 'var(--err)' }}>
                  {secretsStatus?.telegram_bot_token_set ? 'ONLINE & SIAP' : 'TOKEN BELUM DIATUR'}
                </strong>
              </div>
            </div>
          </div>
          <p style={{ color: 'var(--text-dim)' }}>
            Anda dapat berinteraksi dengan Hermes langsung melalui aplikasi Telegram menggunakan bot yang telah dikonfigurasi.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button
              type="button"
              className="config-tab-item active"
              onClick={() => {
                setActiveModal(null);
                navigate('#/config/secrets');
              }}
            >
              Atur Token Telegram →
            </button>
          </div>
        </div>
      </Modal>

      {/* Real Interactive Artifacts Hub Modal */}
      <ArtifactsModal
        isOpen={activeModal === 'artifacts'}
        onClose={() => setActiveModal(null)}
      />

      {/* Real Interactive Scheduled Jobs Modal */}
      <ScheduledJobsModal
        isOpen={activeModal === 'jobs'}
        onClose={() => setActiveModal(null)}
      />

      {/* Full-Featured Multi-Category Settings Modal (Matching Reference UI) */}
      <ConfirmModal
        isOpen={sessionToDelete !== null}
        onClose={() => setSessionToDelete(null)}
        onConfirm={async () => {
          await confirmDeleteSession();
          setSessionToDelete(null);
        }}
        title="Hapus Percakapan"
        message="Apakah Anda yakin ingin menghapus sesi percakapan ini beserta seluruh rekaman tugas di dalamnya?"
        confirmText="Hapus Sesi"
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

export default function Home() {
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
