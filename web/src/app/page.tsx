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

function formatRelativeTime(unixSeconds: number | undefined): string {
  if (!unixSeconds) return 'now';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  const date = new Date(unixSeconds * 1000);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

type ModalType = 'capabilities' | 'messaging' | 'artifacts' | 'jobs' | 'settings' | null;

function AppContent() {
  const { path, taskId, sessionId, navigate } = useRoute();
  const { status: secretsStatus } = useSecrets();
  const { tasks } = useTasksContext();
  const { toast } = useToast();

  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'bots'>('sessions');
  const [sessions, setSessions] = useState<{ session_id: string; title: string; created: number }[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedSessionIds, setPinnedSessionIds] = useState<string[]>([]);
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [configSubTab, setConfigSubTab] = useState<'general' | 'secrets' | 'mcp' | 'projects' | 'voice'>('general');
  const [version, setVersion] = useState('v0.20.5');

  // Load pinned sessions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('hermes_pinned_sessions');
      if (stored) setPinnedSessionIds(JSON.parse(stored));
    } catch {}
  }, []);

  const savePinnedSessions = (ids: string[]) => {
    setPinnedSessionIds(ids);
    try {
      localStorage.setItem('hermes_pinned_sessions', JSON.stringify(ids));
    } catch {}
  };

  const togglePinSession = (sid: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (pinnedSessionIds.includes(sid)) {
      savePinnedSessions(pinnedSessionIds.filter((id) => id !== sid));
      toast('Sesi dilepas dari Pinned', 'ok');
    } else {
      savePinnedSessions([...pinnedSessionIds, sid]);
      toast('Sesi disematkan ke Pinned', 'ok');
    }
  };

  // Get app version if desktop
  useEffect(() => {
    if (typeof window !== 'undefined' && window.hermesDesktop) {
      window.hermesDesktop.getAppVersion().then((v) => setVersion(`v${v}`)).catch(() => {});
    }
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
        toast('Sesi baru dibuat', 'ok');
      }
    } catch (err) {
      console.error('Gagal membuat sesi baru:', err);
    }
  }, [fetchSessions, navigate, toast]);

  // Global keyboard shortcut: Ctrl+N / Cmd+N for New Session
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        createNewSession();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewSession]);

  const handleDeleteSession = useCallback(async (sid: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Hapus percakapan ini beserta seluruh tugas di dalamnya?')) return;
    try {
      const res = await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
      if (res.ok) {
        savePinnedSessions(pinnedSessionIds.filter((id) => id !== sid));
        await fetchSessions();
        if (sessionId === sid) {
          navigate('#/');
        }
        toast('Sesi berhasil dihapus', 'ok');
      }
    } catch (err) {
      console.error('Gagal menghapus sesi:', err);
    }
  }, [fetchSessions, sessionId, navigate, pinnedSessionIds, toast]);

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

  // Filtered Sessions
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const pinnedSessionsList = useMemo(() => {
    return filteredSessions.filter((s) => pinnedSessionIds.includes(s.session_id));
  }, [filteredSessions, pinnedSessionIds]);

  const unpinnedSessionsList = useMemo(() => {
    return filteredSessions.filter((s) => !pinnedSessionIds.includes(s.session_id));
  }, [filteredSessions, pinnedSessionIds]);

  // Window control actions
  const handleMinimize = () => window.hermesDesktop?.minimize();
  const handleMaximize = () => window.hermesDesktop?.maximize();
  const handleClose = () => window.hermesDesktop?.close();

  const isConfigRoute = path.startsWith('/config');

  return (
    <div className="app-container">
      {/* ------------------------------------------------------------------
          Top Window Title Bar
          ------------------------------------------------------------------ */}
      <header className="window-titlebar">
        <div className="titlebar-left">
          {/* Sidebar Toggle Button [ | ] */}
          <button
            type="button"
            className={`titlebar-btn ${isSidebarOpen ? 'active' : ''}`}
            title="Toggle sidebar"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            ◫
          </button>
          {/* Refresh / Switch Button ⇄ */}
          <button
            type="button"
            className="titlebar-btn"
            title="Refresh sesi dan data"
            onClick={() => fetchSessions()}
          >
            ⇄
          </button>
        </div>

        <div className="titlebar-center">
          {sessionId && (
            <span>
              {sessions.find((s) => s.session_id === sessionId)?.title || 'Hermes Agent Session'}
            </span>
          )}
        </div>

        <div className="titlebar-right">
          {/* Side Panel / Inspector Toggle [ | ] */}
          <button
            type="button"
            className={`titlebar-btn ${isDrawerOpen ? 'active' : ''}`}
            title="Toggle Inspector & Constellation Graph"
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          >
            ◫
          </button>
          {/* Chat Focus / View Toggle */}
          <button
            type="button"
            className="titlebar-btn active"
            title="Chat view"
            onClick={() => {
              if (sessionId) navigate(`#/session/${sessionId}`);
              else navigate('#/');
            }}
          >
            💬
          </button>
          {/* Sound / Voice Toggle */}
          <button
            type="button"
            className="titlebar-btn"
            title="Pengaturan Suara"
            onClick={() => {
              setConfigSubTab('voice');
              setActiveModal('settings');
            }}
          >
            🔊
          </button>
          {/* Settings Gear ⚙️ */}
          <button
            type="button"
            className="titlebar-btn"
            title="Pengaturan Konfigurasi"
            onClick={() => {
              setConfigSubTab('general');
              setActiveModal('settings');
            }}
          >
            ⚙️
          </button>

          {/* Desktop Window Controls */}
          <div className="window-controls">
            <button type="button" className="window-control-btn" title="Minimize" onClick={handleMinimize}>
              —
            </button>
            <button type="button" className="window-control-btn" title="Maximize" onClick={handleMaximize}>
              □
            </button>
            <button type="button" className="window-control-btn close" title="Close" onClick={handleClose}>
              ✕
            </button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------
          App Body Layout (Sidebar + Main Content View)
          ------------------------------------------------------------------ */}
      <div className="app-body">
        {/* Left Sidebar */}
        <aside className={`sidebar ${isSidebarOpen ? '' : 'collapsed'}`}>
          {/* Tabs: SESSIONS / BOTS */}
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

          {/* Sidebar Action Menu */}
          <div className="sidebar-actions-menu">
            {/* New Session Button */}
            <button
              type="button"
              className="sidebar-action-item"
              onClick={createNewSession}
              title="Buat sesi percakapan baru (Ctrl+N)"
            >
              <div className="action-item-left">
                <span className="action-item-icon">👤</span>
                <span>New session</span>
              </div>
              <div className="kbd-shortcut-badge">
                <span className="kbd-key">Ctrl</span>
                <span className="kbd-key">N</span>
              </div>
            </button>

            {/* Capabilities */}
            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('capabilities')}
            >
              <div className="action-item-left">
                <span className="action-item-icon">🧩</span>
                <span>Capabilities</span>
              </div>
            </button>

            {/* Messaging */}
            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('messaging')}
            >
              <div className="action-item-left">
                <span className="action-item-icon">💬</span>
                <span>Messaging</span>
              </div>
            </button>

            {/* Artifacts */}
            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('artifacts')}
            >
              <div className="action-item-left">
                <span className="action-item-icon">📄</span>
                <span>Artifacts</span>
              </div>
            </button>

            {/* Scheduled jobs */}
            <button
              type="button"
              className="sidebar-action-item"
              onClick={() => setActiveModal('jobs')}
            >
              <div className="action-item-left">
                <span className="action-item-icon">⏱</span>
                <span>Scheduled jobs</span>
              </div>
            </button>
          </div>

          {/* Search Box */}
          <div className="sidebar-search-box">
            <span className="sidebar-search-icon">🔍</span>
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
                style={{ background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '10px' }}
              >
                ✕
              </button>
            )}
          </div>

          {sidebarTab === 'sessions' ? (
            <div className="session-list-scroll">
              {/* PINNED Section */}
              <div className="pinned-section">
                <div className="sidebar-section-header">
                  <div className="section-header-title">
                    <span className="section-square-bullet">■</span>
                    <span>PINNED</span>
                  </div>
                </div>

                {pinnedSessionsList.length === 0 ? (
                  <div className="pinned-empty-hint">
                    <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>📌</span>
                    <span>Shift-click a chat to pin</span>
                  </div>
                ) : (
                  pinnedSessionsList.map((s) => (
                    <div
                      key={s.session_id}
                      className={`session-row ${sessionId === s.session_id ? 'active' : ''}`}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          togglePinSession(s.session_id, e);
                        } else {
                          navigate(`#/session/${s.session_id}`);
                        }
                      }}
                      title="Shift-click untuk unpin"
                    >
                      <div className="session-row-left">
                        <span className="session-bullet" style={{ color: 'var(--accent)' }}>📌</span>
                        <span className="session-title-text">{s.title || 'Untitled Session'}</span>
                      </div>
                      <div className="session-row-right">
                        <span className="session-time">{formatRelativeTime(s.created)}</span>
                        <button
                          type="button"
                          className="session-action-btn"
                          title="Hapus sesi"
                          onClick={(e) => handleDeleteSession(s.session_id, e)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* SESSIONS Section */}
              <div className="sidebar-section-header" style={{ marginTop: '6px' }}>
                <div className="section-header-title">
                  <span className="section-square-bullet">■</span>
                  <span>SESSIONS</span>
                </div>
                <button
                  type="button"
                  className="section-header-action-btn"
                  title="Urutkan sesi"
                  onClick={() => setSessions((prev) => [...prev].reverse())}
                >
                  ▼
                </button>
              </div>

              {loadingSessions ? (
                <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-faint)' }}>
                  Memuat sesi...
                </div>
              ) : unpinnedSessionsList.length === 0 ? (
                <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-faint)' }}>
                  {searchQuery ? 'Tidak ada sesi yang cocok' : 'Belum ada sesi'}
                </div>
              ) : (
                unpinnedSessionsList.map((s) => (
                  <div
                    key={s.session_id}
                    className={`session-row ${sessionId === s.session_id ? 'active' : ''}`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        togglePinSession(s.session_id, e);
                      } else {
                        navigate(`#/session/${s.session_id}`);
                      }
                    }}
                    title="Shift-click untuk sematkan (Pin)"
                  >
                    <div className="session-row-left">
                      <span className="session-bullet">•</span>
                      <span className="session-title-text">{s.title || 'Untitled Session'}</span>
                    </div>
                    <div className="session-row-right">
                      <span className="session-time">{formatRelativeTime(s.created)}</span>
                      <button
                        type="button"
                        className="session-action-btn"
                        title="Hapus sesi"
                        onClick={(e) => handleDeleteSession(s.session_id, e)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* BOTS Tab Content */
            <div className="session-list-scroll" style={{ padding: '8px 12px' }}>
              <div className="sidebar-section-header">
                <div className="section-header-title">
                  <span className="section-square-bullet">■</span>
                  <span>AVAILABLE AGENTS</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                <div className="session-row active" style={{ margin: 0 }}>
                  <div className="session-row-left">
                    <span style={{ fontSize: '14px' }}>⚡</span>
                    <span className="session-title-text">Hermes Core Agent</span>
                  </div>
                  <span className="session-time">Ready</span>
                </div>
                <div className="session-row" style={{ margin: 0 }}>
                  <div className="session-row-left">
                    <span style={{ fontSize: '14px' }}>🟧</span>
                    <span className="session-title-text">Claude Code Engine</span>
                  </div>
                </div>
                <div className="session-row" style={{ margin: 0 }}>
                  <div className="session-row-left">
                    <span style={{ fontSize: '14px' }}>🟩</span>
                    <span className="session-title-text">Antigravity Engine</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sidebar Footer */}
          <div className="sidebar-footer-container">
            <div className="sidebar-icon-bar">
              <div className="sidebar-icon-group">
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  title="Dashboard Beranda"
                  onClick={() => navigate('#/')}
                >
                  ⌂
                </button>
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  title="Sesi Baru (+)"
                  onClick={createNewSession}
                >
                  +
                </button>
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  title="Artifacts"
                  onClick={() => setActiveModal('artifacts')}
                >
                  📄
                </button>
              </div>
              <div className="sidebar-icon-group">
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  title="Pengaturan"
                  onClick={() => {
                    setConfigSubTab('general');
                    setActiveModal('settings');
                  }}
                >
                  ···
                </button>
                <button
                  type="button"
                  className="sidebar-footer-btn"
                  title={`Status Gateway: ${secretsStatus?.nvidia_api_key_set ? 'Online' : 'Offline'}`}
                >
                  ⑂
                </button>
              </div>
            </div>

            <div className="sidebar-status-bar">
              <div className="status-left">
                <span className="gateway-pulse-dot" />
                <span>Gateway ready</span>
              </div>
              <span className="status-version"># {version}</span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="main-content">
          <div className="page-container">
            {path === '/' && (
              <Dashboard
                sessionId={sessionId}
                onRefreshSessions={fetchSessions}
                isDrawerOpen={isDrawerOpen}
                onToggleDrawer={() => setIsDrawerOpen(!isDrawerOpen)}
              />
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

      {/* ------------------------------------------------------------------
          Interactive Modals (Capabilities, Messaging, Artifacts, Jobs, Settings)
          ------------------------------------------------------------------ */}
      {activeModal && (
        <div className="hermes-modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="hermes-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="hermes-modal-header">
              <div className="hermes-modal-title">
                {activeModal === 'capabilities' && <><span>🧩</span> Capabilities & Skills</>}
                {activeModal === 'messaging' && <><span>💬</span> Messaging Channels</>}
                {activeModal === 'artifacts' && <><span>📄</span> Generated Artifacts</>}
                {activeModal === 'jobs' && <><span>⏱</span> Scheduled Jobs & Background Tasks</>}
                {activeModal === 'settings' && <><span>⚙️</span> Configuration & Settings</>}
              </div>
              <button
                type="button"
                className="hermes-modal-close-btn"
                onClick={() => setActiveModal(null)}
              >
                ✕
              </button>
            </div>

            <div className="hermes-modal-body">
              {activeModal === 'capabilities' && (
                <div>
                  <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginBottom: '16px' }}>
                    Hermes Agent dilengkapi dengan kemampuan eksekusi MCP tools, coding engine (Claude & Antigravity), vision camera recognition, dan TTS voice.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                    <div style={{ padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>⚡ Auto Coding Engines</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Claude Code (!claude) & Antigravity (!agy)</div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>📷 Object Vision & Camera</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Deteksi kamera real-time COCO-SSD & WebGPU</div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>🎙️ Voice STT & Neural TTS</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Voice recognition & Microsoft Edge TTS Neural</div>
                    </div>
                  </div>
                </div>
              )}

              {activeModal === 'messaging' && (
                <div>
                  <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginBottom: '16px' }}>
                    Status koneksi integrasi bot perpesanan:
                  </p>
                  <div style={{ padding: '14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600 }}>Telegram Bot Integration</span>
                      <span style={{ fontSize: '11px', color: secretsStatus?.telegram_bot_token_set ? 'var(--ok)' : 'var(--err)', fontWeight: 'bold' }}>
                        {secretsStatus?.telegram_bot_token_set ? 'ONLINE' : 'OFFLINE (Token Missing)'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                      Dapat berinteraksi langsung melalui Telegram untuk delegasi tugas coding dan monitoring.
                    </div>
                  </div>
                </div>
              )}

              {activeModal === 'artifacts' && (
                <div>
                  <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginBottom: '16px' }}>
                    Daftar dokumen dan artifak yang dihasilkan oleh Hermes Agent:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {tasks.length === 0 ? (
                      <div style={{ color: 'var(--text-faint)', fontSize: '12px', textAlign: 'center', padding: '24px 0' }}>
                        Belum ada berkas artifak tersimpan.
                      </div>
                    ) : (
                      tasks.slice(0, 10).map((t) => (
                        <div
                          key={t.task_id}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}
                        >
                          <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Task #{t.task_id.substring(0, 8)}</span>
                          <span style={{ fontSize: '11px', color: 'var(--accent)' }}>{t.status.toUpperCase()}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeModal === 'jobs' && (
                <div>
                  <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginBottom: '16px' }}>
                    Antrean tugas latar belakang dan cron jobs berkala:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                      <span style={{ fontSize: '12px' }}>Heartbeat Poller</span>
                      <span style={{ fontSize: '11px', color: 'var(--ok)', fontWeight: 'bold' }}>ACTIVE</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                      <span style={{ fontSize: '12px' }}>Cognitive Event Stream</span>
                      <span style={{ fontSize: '11px', color: 'var(--ok)', fontWeight: 'bold' }}>CONNECTED</span>
                    </div>
                  </div>
                </div>
              )}

              {activeModal === 'settings' && (
                <div>
                  <div className="config-tab-bar" style={{ marginBottom: '16px' }}>
                    <button
                      type="button"
                      className={`config-tab-item ${configSubTab === 'general' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('general')}
                    >
                      General
                    </button>
                    <button
                      type="button"
                      className={`config-tab-item ${configSubTab === 'secrets' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('secrets')}
                    >
                      Secrets
                    </button>
                    <button
                      type="button"
                      className={`config-tab-item ${configSubTab === 'mcp' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('mcp')}
                    >
                      MCP
                    </button>
                    <button
                      type="button"
                      className={`config-tab-item ${configSubTab === 'projects' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('projects')}
                    >
                      Projects
                    </button>
                    <button
                      type="button"
                      className={`config-tab-item ${configSubTab === 'voice' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('voice')}
                    >
                      Voice
                    </button>
                  </div>
                  <div>
                    {configSubTab === 'general' && <ConfigGeneral />}
                    {configSubTab === 'secrets' && <ConfigSecrets />}
                    {configSubTab === 'mcp' && <ConfigMcp />}
                    {configSubTab === 'projects' && <ConfigProjects />}
                    {configSubTab === 'voice' && <ConfigVoice />}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#08090d', color: '#e5e7eb', fontFamily: 'monospace' }}>
        LOADING HERMES AGENT INTERFACE...
      </div>
    );
  }

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

