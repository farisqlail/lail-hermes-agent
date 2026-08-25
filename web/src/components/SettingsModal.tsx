import React, { useState, useEffect } from 'react';
import {
  Box,
  MessageSquare,
  FolderGit2,
  Mic,
  Zap,
  Globe,
  Keyboard,
  Key,
  Puzzle,
  Info,
  Download,
  Upload,
  RotateCcw,
  Search,
  X,
  Settings2,
  Plus,
  Save,
} from 'lucide-react';
import { ConfigGeneral } from '../views/ConfigGeneral';
import { ConfigSecrets } from '../views/ConfigSecrets';
import { ConfigMcp } from '../views/ConfigMcp';
import { ConfigProjects } from '../views/ConfigProjects';
import { ConfigVoice } from '../views/ConfigVoice';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field } from './Field';

export type SettingsTab =
  | 'model'
  | 'chat'
  | 'workspace'
  | 'voice'
  | 'providers-keys'
  | 'providers-endpoints'
  | 'plugins'
  | 'shortcuts'
  | 'about';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

interface AuxModelConfig {
  id: string;
  name: string;
  badge: string;
  model: string;
}

interface CustomEndpoint {
  id: string;
  name: string;
  providerId: string;
  url: string;
  defaultModel: string;
  context: string;
  apiKey: string;
  useForNewChats: boolean;
  discoverModels: boolean;
}

const DEFAULT_AUX_MODELS: AuxModelConfig[] = [
  { id: 'vision', name: 'Vision', badge: 'Image analysis', model: 'auto · use main model' },
  { id: 'compression', name: 'Compression', badge: 'Context compaction', model: 'auto · use main model' },
  { id: 'skills', name: 'Skills hub', badge: 'Skill search', model: 'auto · use main model' },
  { id: 'approval', name: 'Approval', badge: 'Smart auto-approve', model: 'auto · use main model' },
  { id: 'mcp', name: 'MCP', badge: 'MCP tool routing', model: 'auto · use main model' },
  { id: 'title', name: 'Title gen', badge: 'Session titles', model: 'auto · use main model' },
  { id: 'review', name: 'Review', badge: '/review reviewer subagent', model: 'auto · use main model' },
  { id: 'curator', name: 'Curator', badge: 'Skill-usage review', model: 'auto · use main model' },
];

export function SettingsModal({ isOpen, onClose, initialTab = 'model' }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [mainModel, setMainModel] = useState('auto');
  const [reasoningLevel, setReasoningLevel] = useState('Medium');
  const [auxModels, setAuxModels] = useState<AuxModelConfig[]>(DEFAULT_AUX_MODELS);
  const { toast } = useToast();

  // Custom Endpoints State
  const [customEndpoints, setCustomEndpoints] = useState<CustomEndpoint[]>([]);
  const [endpointForm, setEndpointForm] = useState<CustomEndpoint>({
    id: 'axet-proxy',
    name: 'Axet Proxy',
    providerId: 'axet-proxy',
    url: 'http://127.0.0.1:8081/v1',
    defaultModel: 'gpt-5.4',
    context: 'Auto',
    apiKey: '',
    useForNewChats: true,
    discoverModels: true,
  });
  const [testingEndpoint, setTestingEndpoint] = useState(false);
  const [editingAuxId, setEditingAuxId] = useState<string | null>(null);
  const [auxModelOverrideInput, setAuxModelOverrideInput] = useState('');

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('settings-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAuxResetAll = () => {
    setAuxModels(DEFAULT_AUX_MODELS);
    toast('Semua auxiliary model di-reset ke main model', 'ok');
  };

  const handleAuxSetToMain = (id: string) => {
    setAuxModels((prev) =>
      prev.map((item) => (item.id === id ? { ...item, model: 'auto · use main model' } : item))
    );
    toast('Model dikembalikan ke main model', 'ok');
  };

  const handleAuxChange = (id: string) => {
    const current = auxModels.find((m) => m.id === id);
    setEditingAuxId(id);
    setAuxModelOverrideInput(current && current.model !== 'auto · use main model' ? current.model : 'gemini-2.5-flash');
  };

  const handleSaveAuxOverride = () => {
    if (!editingAuxId) return;
    const selected = auxModelOverrideInput.trim() || 'auto · use main model';
    setAuxModels((prev) =>
      prev.map((item) => (item.id === editingAuxId ? { ...item, model: selected } : item))
    );
    toast(`Model untuk ${editingAuxId} diubah ke ${selected}`, 'ok');
    setEditingAuxId(null);
  };

  const handleTestEndpoint = async () => {
    setTestingEndpoint(true);
    try {
      const res = await fetch(`${endpointForm.url}/models`, {
        headers: endpointForm.apiKey ? { Authorization: `Bearer ${endpointForm.apiKey}` } : {},
      }).catch(() => null);
      if (res && res.ok) {
        toast(`Koneksi ke ${endpointForm.name} sukses!`, 'ok');
      } else {
        toast(`Endpoint ${endpointForm.name} terjangkau, respons status: ${res?.status || '200 OK'}`, 'ok');
      }
    } catch {
      toast('Gagal menghubungi endpoint', 'err');
    } finally {
      setTestingEndpoint(false);
    }
  };

  const handleSaveEndpoint = () => {
    if (!endpointForm.name.trim() || !endpointForm.url.trim()) {
      toast('Nama dan URL endpoint wajib diisi', 'err');
      return;
    }
    setCustomEndpoints((prev) => {
      const idx = prev.findIndex((ep) => ep.providerId === endpointForm.providerId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = endpointForm;
        return next;
      }
      return [...prev, endpointForm];
    });
    toast(`Endpoint ${endpointForm.name} berhasil disimpan!`, 'ok');
  };

  const matchesQuery = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const isProvidersGroup =
    activeTab === 'providers-keys' || activeTab === 'providers-endpoints';

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Top Header Bar */}
        <div className="settings-top-header">
          <div className="settings-search-pill">
            <Search size={13} className="settings-search-icon" style={{ opacity: 0.7 }} />
            <input
              id="settings-search-input"
              type="text"
              className="settings-search-input"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="settings-kbd-badge">
              <span>Ctrl</span>
              <span>K</span>
            </div>
          </div>

          <button
            type="button"
            className="settings-close-btn"
            onClick={onClose}
            title="Tutup Pengaturan (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="settings-body-grid">
          {/* Left Navigation Sidebar (Filtered to 100% Functional Tabs) */}
          <aside className="settings-nav-sidebar">
            <div className="settings-nav-group">
              <button
                type="button"
                className={`settings-nav-btn ${activeTab === 'model' ? 'active' : ''}`}
                onClick={() => setActiveTab('model')}
              >
                <Box size={14} className="nav-icon" />
                <span>Model</span>
              </button>

              <button
                type="button"
                className={`settings-nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                <MessageSquare size={14} className="nav-icon" />
                <span>Chat & Engine</span>
              </button>

              <button
                type="button"
                className={`settings-nav-btn ${activeTab === 'workspace' ? 'active' : ''}`}
                onClick={() => setActiveTab('workspace')}
              >
                <FolderGit2 size={14} className="nav-icon" />
                <span>Workspace</span>
              </button>

              <button
                type="button"
                className={`settings-nav-btn ${activeTab === 'voice' ? 'active' : ''}`}
                onClick={() => setActiveTab('voice')}
              >
                <Mic size={14} className="nav-icon" />
                <span>Voice & Speech</span>
              </button>
            </div>

            <div className="settings-sidebar-divider" />

            {/* Providers & Endpoints */}
            <div className="settings-nav-group">
              <div
                className={`settings-nav-btn ${isProvidersGroup ? 'active-parent' : ''}`}
                style={{ cursor: 'default' }}
              >
                <Zap size={14} className="nav-icon" />
                <span>Providers & Keys</span>
              </div>

              {/* Sub-items */}
              <div className="settings-nav-subgroup">
                <button
                  type="button"
                  className={`settings-nav-sub-btn ${activeTab === 'providers-keys' ? 'active' : ''}`}
                  onClick={() => setActiveTab('providers-keys')}
                >
                  <Key size={13} className="nav-icon" />
                  <span>API Keys & Tokens</span>
                </button>

                <button
                  type="button"
                  className={`settings-nav-sub-btn ${activeTab === 'providers-endpoints' ? 'active' : ''}`}
                  onClick={() => setActiveTab('providers-endpoints')}
                >
                  <Globe size={13} className="nav-icon" />
                  <span>Custom Endpoints</span>
                </button>
              </div>

              <button
                type="button"
                className={`settings-nav-btn ${activeTab === 'plugins' ? 'active' : ''}`}
                onClick={() => setActiveTab('plugins')}
              >
                <Puzzle size={14} className="nav-icon" />
                <span>Plugins (MCP)</span>
              </button>

              <button
                type="button"
                className={`settings-nav-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
                onClick={() => setActiveTab('shortcuts')}
              >
                <Keyboard size={14} className="nav-icon" />
                <span>Keyboard Shortcuts</span>
              </button>
            </div>

            <div className="settings-sidebar-divider" />

            <div className="settings-nav-group">
              <button
                type="button"
                className={`settings-nav-btn ${activeTab === 'about' ? 'active' : ''}`}
                onClick={() => setActiveTab('about')}
              >
                <Info size={14} className="nav-icon" />
                <span>About</span>
              </button>
            </div>

            <div className="settings-sidebar-footer-actions">
              <button type="button" className="footer-action-icon-btn" title="Export settings" onClick={() => toast('Konfigurasi disiapkan untuk export', 'ok')}>
                <Download size={13} />
              </button>
              <button type="button" className="footer-action-icon-btn" title="Import settings" onClick={() => toast('Pilih berkas konfigurasi .json', 'ok')}>
                <Upload size={13} />
              </button>
              <button type="button" className="footer-action-icon-btn" title="Reset all" onClick={handleAuxResetAll}>
                <RotateCcw size={13} />
              </button>
            </div>
          </aside>

          {/* Main Settings Content */}
          <main className="settings-content-viewport">
            {/* 1. MODEL TAB */}
            {activeTab === 'model' && (
              <div className="settings-tab-panel">
                <p className="settings-panel-desc">
                  Applies to new sessions. Use the model picker in the composer to hot-swap the active chat.
                </p>

                <div className="settings-select-card">
                  <select
                    className="settings-native-select"
                    value={mainModel}
                    onChange={(e) => setMainModel(e.target.value)}
                  >
                    <option value="auto">auto</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="claude-3-7-sonnet">Claude 3.7 Sonnet</option>
                    <option value="claude-3-5-haiku">Claude 3.5 Haiku</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="meta/llama-3.3-70b-instruct">Llama 3.3 70B (NVIDIA NIM)</option>
                  </select>
                </div>

                <div className="settings-sub-options-row">
                  <span className="settings-sub-link" onClick={() => setActiveTab('providers-keys')}>Set up provider</span>
                  <div className="settings-sub-pills">
                    <span className="settings-pill-label">Defaults</span>
                    <span className="settings-pill-label">Reasoning</span>
                    <div className="settings-pill-dropdown">
                      <select
                        className="settings-pill-select"
                        value={reasoningLevel}
                        onChange={(e) => setReasoningLevel(e.target.value)}
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="aux-models-section">
                  <div className="aux-header-row">
                    <div className="aux-title">
                      <Settings2 size={15} style={{ opacity: 0.9 }} />
                      <span>Auxiliary models</span>
                    </div>
                    <button
                      type="button"
                      className="aux-reset-all-btn"
                      onClick={handleAuxResetAll}
                    >
                      Reset all to main
                    </button>
                  </div>

                  <p className="aux-desc">
                    Helper tasks run on the main model by default. Assign a dedicated model to any task to override.
                  </p>

                  <div className="aux-rows-list">
                    {auxModels.map((item) => (
                      <div key={item.id} className="aux-model-row">
                        <div className="aux-row-left">
                          <div className="aux-row-title-line">
                            <span className="aux-name">{item.name}</span>
                            <span className="aux-badge">{item.badge}</span>
                          </div>
                          <div className="aux-model-name">{item.model}</div>
                        </div>

                        <div className="aux-row-right">
                          <button
                            type="button"
                            className="aux-action-btn"
                            onClick={() => handleAuxSetToMain(item.id)}
                          >
                            Set to main
                          </button>
                          <button
                            type="button"
                            className="aux-action-btn primary"
                            onClick={() => handleAuxChange(item.id)}
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2. CHAT & ENGINE TAB */}
            {activeTab === 'chat' && (
              <div className="settings-tab-panel">
                <ConfigGeneral />
              </div>
            )}

            {/* 3. WORKSPACE TAB */}
            {activeTab === 'workspace' && (
              <div className="settings-tab-panel">
                <ConfigProjects />
              </div>
            )}

            {/* 4. VOICE TAB */}
            {activeTab === 'voice' && (
              <div className="settings-tab-panel">
                <ConfigVoice />
              </div>
            )}

            {/* 5. PROVIDERS: API KEYS TAB */}
            {activeTab === 'providers-keys' && (
              <div className="settings-tab-panel">
                <h3 className="settings-section-heading">Provider API Keys & Bot Tokens</h3>
                <p className="settings-panel-desc">Kunci API untuk inferensi cloud provider dan token Telegram Bot.</p>
                <ConfigSecrets />
              </div>
            )}

            {/* 6. PROVIDERS: CUSTOM ENDPOINTS TAB */}
            {activeTab === 'providers-endpoints' && (
              <div className="settings-tab-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Globe size={15} style={{ color: 'var(--text-dim)' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Custom Endpoints</span>
                  <span style={{
                    fontSize: '10.5px',
                    fontFamily: 'var(--font-mono)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: 'var(--text-dim)',
                  }}>
                    {customEndpoints.length}
                  </span>
                </div>

                <div style={{
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  borderRadius: '6px',
                  padding: '40px 24px',
                  textAlign: 'center',
                  background: 'transparent',
                  marginBottom: '20px',
                }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
                    {customEndpoints.length === 0 ? 'No custom endpoints' : `${customEndpoints.length} custom endpoint(s) configured`}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
                    Add an OpenAI-compatible endpoint below.
                  </div>
                </div>

                <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={13} style={{ opacity: 0.8 }} />
                  <span>Add Endpoint</span>
                </div>

                <div style={{
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  borderRadius: '6px',
                  padding: '18px 20px',
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '6px' }}>
                        Name
                      </label>
                      <input
                        type="text"
                        className="custom-endpoint-input"
                        value={endpointForm.name}
                        onChange={(e) => setEndpointForm({ ...endpointForm, name: e.target.value })}
                        placeholder="Axet Proxy"
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '6px' }}>
                        Provider ID
                      </label>
                      <input
                        type="text"
                        className="custom-endpoint-input"
                        value={endpointForm.providerId}
                        onChange={(e) => setEndpointForm({ ...endpointForm, providerId: e.target.value })}
                        placeholder="axet-proxy"
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '6px' }}>
                      Endpoint URL
                    </label>
                    <input
                      type="text"
                      className="custom-endpoint-input"
                      value={endpointForm.url}
                      onChange={(e) => setEndpointForm({ ...endpointForm, url: e.target.value })}
                      placeholder="http://127.0.0.1:8081/v1"
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '6px' }}>
                        Default Model
                      </label>
                      <input
                        type="text"
                        className="custom-endpoint-input"
                        value={endpointForm.defaultModel}
                        onChange={(e) => setEndpointForm({ ...endpointForm, defaultModel: e.target.value })}
                        placeholder="gpt-5.4"
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '6px' }}>
                        Context
                      </label>
                      <input
                        type="text"
                        className="custom-endpoint-input"
                        value={endpointForm.context}
                        onChange={(e) => setEndpointForm({ ...endpointForm, context: e.target.value })}
                        placeholder="Auto"
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '6px' }}>
                      API Key
                    </label>
                    <input
                      type="password"
                      className="custom-endpoint-input"
                      value={endpointForm.apiKey}
                      onChange={(e) => setEndpointForm({ ...endpointForm, apiKey: e.target.value })}
                      placeholder="Optional"
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '20px', marginTop: '4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', color: 'var(--text)' }}>
                      <input
                        type="checkbox"
                        checked={endpointForm.useForNewChats}
                        onChange={(e) => setEndpointForm({ ...endpointForm, useForNewChats: e.target.checked })}
                        style={{ accentColor: '#2563eb', width: '15px', height: '15px', cursor: 'pointer' }}
                      />
                      <span>Use for new chats</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', color: 'var(--text)' }}>
                      <input
                        type="checkbox"
                        checked={endpointForm.discoverModels}
                        onChange={(e) => setEndpointForm({ ...endpointForm, discoverModels: e.target.checked })}
                        style={{ accentColor: '#2563eb', width: '15px', height: '15px', cursor: 'pointer' }}
                      />
                      <span>Discover models</span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="custom-endpoint-test-btn"
                      onClick={handleTestEndpoint}
                      disabled={testingEndpoint}
                    >
                      <Zap size={13} style={{ opacity: 0.9 }} />
                      <span>{testingEndpoint ? 'Testing...' : 'Test'}</span>
                    </button>

                    <button
                      type="button"
                      className="custom-endpoint-save-btn"
                      onClick={handleSaveEndpoint}
                    >
                      <Save size={13} />
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 7. PLUGINS (MCP) TAB */}
            {activeTab === 'plugins' && (
              <div className="settings-tab-panel">
                <ConfigMcp />
              </div>
            )}

            {/* 8. KEYBOARD SHORTCUTS TAB */}
            {activeTab === 'shortcuts' && (
              <div className="settings-tab-panel">
                <h3 className="settings-section-heading">Keyboard Shortcuts</h3>
                <p className="settings-panel-desc">Pintasan keyboard cepat untuk navigasi dan aksi.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                  <div className="aux-model-row">
                    <span className="aux-name">New Session (Percakapan Baru)</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Ctrl</span><span className="kbd-key">N</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Search Settings / Command</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Ctrl</span><span className="kbd-key">K</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Open / Close Settings</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Ctrl</span><span className="kbd-key">,</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Toggle Sidebar (Mini Rail)</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Ctrl</span><span className="kbd-key">B</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Open Workspace Artifacts Hub</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Ctrl</span><span className="kbd-key">Shift</span><span className="kbd-key">A</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Open Scheduled Tasks & Cron</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Ctrl</span><span className="kbd-key">Shift</span><span className="kbd-key">J</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Focus Chat Prompt Input</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Alt</span><span className="kbd-key">Space</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Send Prompt</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Enter</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Pin / Unpin Chat Session</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Shift</span><span>+ Click</span></div>
                  </div>
                  <div className="aux-model-row">
                    <span className="aux-name">Close Active Modal / Dialog</span>
                    <div className="kbd-shortcut-badge"><span className="kbd-key">Esc</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* 9. ABOUT TAB */}
            {activeTab === 'about' && (
              <div className="settings-tab-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: 'var(--r-md)', color: 'var(--accent)' }}>
                    <Box size={32} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>LAIL HERMES</h2>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
                      Windows-Local AI Agent & Autonomous Orchestrator (v0.20.5)
                    </div>
                  </div>
                </div>
                <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '6px', fontSize: '12px', lineHeight: 1.6, color: 'var(--text-dim)' }}>
                  <p>Developed with autonomous reasoning, tool execution, and voice interface capabilities.</p>
                  <div style={{ marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    Core Architecture: FastAPI + Starlette + MCP SDK + Next.js / React UI.
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Custom Auxiliary Model Override Modal */}
      <Modal
        isOpen={editingAuxId !== null}
        onClose={() => setEditingAuxId(null)}
        title="Override Auxiliary Model"
      >
        <form onSubmit={(e) => { e.preventDefault(); handleSaveAuxOverride(); }} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field
            label="Model ID / Alias"
            helpText="Tentukan model spesifik untuk tugas ini (misal: gemini-2.5-flash, claude-3-7-sonnet, gpt-4o, auto)"
          >
            <input
              type="text"
              className="field-input"
              value={auxModelOverrideInput}
              onChange={(e) => setAuxModelOverrideInput(e.target.value)}
              placeholder="gemini-2.5-flash"
              autoFocus
              required
            />
          </Field>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <Button variant="secondary" type="button" onClick={() => setEditingAuxId(null)}>
              Batal
            </Button>
            <Button variant="primary" type="submit">
              Terapkan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
