import React, { useEffect, useState, useMemo } from 'react';
import { api, errorMessage } from '../api/client';
import { McpServer, IntegrateRun } from '../api/types';
import { Field } from '../components/Field';
import { Toggle } from '../components/Toggle';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';
import {
  Puzzle,
  Plus,
  Play,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Globe,
  Database,
  FolderGit2,
  Brain,
  MessageSquare,
  Search,
  FileText,
  Terminal,
  Sparkles,
  Link2,
  Download,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface PresetServer {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: any;
  command: string;
  args: string[];
  requiresEnv?: { key: string; label: string; placeholder: string; isSecret?: boolean }[];
  requiresArgs?: { label: string; placeholder: string; defaultValue?: string }[];
}

const MCP_CATALOG: PresetServer[] = [
  {
    id: 'puppeteer',
    name: 'Puppeteer / Web Browser',
    category: 'Web Automation',
    description: 'Otomatisasi browser, ambil tangkapan layar (screenshot), dan interaksi halaman web dinamis.',
    icon: Globe,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  },
  {
    id: 'github',
    name: 'GitHub Integration',
    category: 'Developer & Git',
    description: 'Cari repositori, baca kode, kelola issues, pull requests, dan riwayat commits langsung dari chat.',
    icon: FolderGit2,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiresEnv: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token (PAT)',
        placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        isSecret: true,
      },
    ],
  },
  {
    id: 'filesystem',
    name: 'Local Filesystem',
    category: 'Files & Storage',
    description: 'Akses baca dan tulis berkas lokal yang aman pada folder workspace operator.',
    icon: FileText,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users'],
    requiresArgs: [
      {
        label: 'Root Directory Path',
        placeholder: 'C:\\Users\\faris',
        defaultValue: 'C:\\Users\\faris',
      },
    ],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL Database',
    category: 'Databases',
    description: 'Jalankan kueri data SQL, inspeksi skema tabel, dan analisis database secara instan.',
    icon: Database,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    requiresArgs: [
      {
        label: 'Connection String (URL)',
        placeholder: 'postgresql://postgres:password@localhost:5432/mydb',
        defaultValue: 'postgresql://postgres:password@localhost:5432/mydb',
      },
    ],
  },
  {
    id: 'memory',
    name: 'Knowledge Graph Memory',
    category: 'AI Memory',
    description: 'Penyimpanan memori relasional berbasis graph untuk mengingat fakta antar sesi obrolan.',
    icon: Brain,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'brave-search',
    name: 'Brave Web Search',
    category: 'Search & Web',
    description: 'Pencarian web publik dan berita real-time menggunakan Brave Search API.',
    icon: Search,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    requiresEnv: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave Search API Key',
        placeholder: 'BSA_xxxxxxxxxxxxxxxxxxxx',
        isSecret: true,
      },
    ],
  },
  {
    id: 'slack',
    name: 'Slack Workspace',
    category: 'Communication',
    description: 'Baca saluran obrolan, kirim pesan, dan otomatisasi komunikasi di tim Slack.',
    icon: MessageSquare,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    requiresEnv: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Slack Bot User Token',
        placeholder: 'xoxb-xxxxxxxxxxxxxxxxxxxx',
        isSecret: true,
      },
      {
        key: 'SLACK_TEAM_ID',
        label: 'Slack Team ID',
        placeholder: 'T0123456789',
      },
    ],
  },
];

export function ConfigMcp() {
  const { toast } = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active View Tab inside Plugins page
  const [viewTab, setViewTab] = useState<'installed' | 'catalog' | 'link' | 'manual'>('installed');

  // Link integration state
  const [link, setLink] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<IntegrateRun | null>(null);
  const [secret, setSecret] = useState('');

  // Preset Install Modal State
  const [selectedPreset, setSelectedPreset] = useState<PresetServer | null>(null);
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});
  const [presetArgValues, setPresetArgValues] = useState<Record<string, string>>({});
  const [installingPreset, setInstallingPreset] = useState(false);

  // Manual / Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [serverForm, setServerForm] = useState<McpServer>({
    name: '',
    type: 'stdio',
    command: '',
    args: [],
    url: '',
    env: {},
    enabled: true,
    transport: '',
    headers: {},
    oauth: false,
  });

  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');

  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; ok: boolean; tools?: string[]; error?: string } | null>(null);
  const [serverToDeleteIdx, setServerToDeleteIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!runId) return;
    const id = setInterval(async () => {
      try {
        const r = await api.getIntegrate(runId);
        setRun(r);
        if (r.login_url) {
          window.open(r.login_url, '_blank', 'width=520,height=640');
        }
        if (r.state === 'done') {
          clearInterval(id);
          fetchServers();
          if (r.events.some((ev) => ev.kind === 'done' && ev.ok)) {
            toast('MCP Server berhasil diintegrasikan!', 'ok');
            setViewTab('installed');
            setLink('');
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [runId]);

  const handleIntegrate = async () => {
    try {
      const { run_id } = await api.startIntegrate(link);
      setRunId(run_id);
      setRun(null);
    } catch (err) {
      toast(errorMessage(err, 'Gagal memulai integrasi link'), 'err');
    }
  };

  const fetchServers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMcpServers();
      setServers(data);
    } catch (err) {
      setError(errorMessage(err, 'Gagal memuat daftar MCP Server'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const openManualAdd = () => {
    setEditingIndex(null);
    setServerForm({
      name: '',
      type: 'stdio',
      command: 'npx',
      args: [],
      url: '',
      env: {},
      enabled: true,
      transport: '',
      headers: {},
      oauth: false,
    });
    setArgsText('');
    setEnvText('');
    setIsEditModalOpen(true);
  };

  const openEditModal = (idx: number) => {
    const s = servers[idx];
    setEditingIndex(idx);
    setServerForm({ ...s });
    setArgsText(s.args.join('\n'));
    setEnvText(Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n'));
    setIsEditModalOpen(true);
  };

  const handleToggleServerEnabled = async (idx: number, enabled: boolean) => {
    const updatedList = [...servers];
    updatedList[idx] = { ...updatedList[idx], enabled };
    try {
      const result = await api.saveMcpServers(updatedList);
      if (result.ok) {
        setServers(updatedList);
        toast(`Server ${updatedList[idx].name} ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`, 'ok');
      }
    } catch (err) {
      toast(errorMessage(err, 'Gagal mengubah status server'), 'err');
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverForm.name.trim()) return;

    const parsedArgs = argsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const parsedEnv: Record<string, string> = {};
    envText.split('\n').forEach((line) => {
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const k = line.substring(0, eqIdx).trim();
        const v = line.substring(eqIdx + 1).trim();
        if (k) parsedEnv[k] = v;
      }
    });

    const updatedServer: McpServer = {
      ...serverForm,
      args: parsedArgs,
      env: parsedEnv,
    };

    let updatedList = [...servers];
    if (editingIndex === null) {
      updatedList.push(updatedServer);
    } else {
      updatedList[editingIndex] = updatedServer;
    }

    try {
      const result = await api.saveMcpServers(updatedList);
      if (result.ok) {
        toast('Konfigurasi MCP Server berhasil disimpan!', 'ok');
        setServers(updatedList);
        setIsEditModalOpen(false);
        setViewTab('installed');
      }
    } catch (err) {
      toast(errorMessage(err, 'Gagal menyimpan MCP Server'), 'err');
    }
  };

  const handleOpenPresetModal = (preset: PresetServer) => {
    // If no extra inputs required, install immediately!
    if (!preset.requiresEnv?.length && !preset.requiresArgs?.length) {
      handleInstallPresetDirectly(preset, {}, {});
      return;
    }
    setSelectedPreset(preset);
    const initEnv: Record<string, string> = {};
    preset.requiresEnv?.forEach((e) => {
      initEnv[e.key] = '';
    });
    setPresetEnvValues(initEnv);

    const initArgs: Record<string, string> = {};
    preset.requiresArgs?.forEach((a, i) => {
      initArgs[i.toString()] = a.defaultValue || '';
    });
    setPresetArgValues(initArgs);
  };

  const handleInstallPresetDirectly = async (
    preset: PresetServer,
    env: Record<string, string>,
    argVals: Record<string, string>
  ) => {
    try {
      setInstallingPreset(true);
      const finalArgs = [...preset.args];
      if (preset.requiresArgs?.length) {
        preset.requiresArgs.forEach((_, i) => {
          if (argVals[i.toString()]) {
            finalArgs.push(argVals[i.toString()]);
          }
        });
      }

      const newServer: McpServer = {
        name: preset.id,
        type: 'stdio',
        command: preset.command,
        args: finalArgs,
        url: '',
        env: env,
        enabled: true,
        transport: '',
        headers: {},
        oauth: false,
      };

      // Filter out existing server with same name if replacing
      const updatedList = servers.filter((s) => s.name !== preset.id).concat(newServer);
      const result = await api.saveMcpServers(updatedList);
      if (result.ok) {
        toast(`Plugin "${preset.name}" berhasil dipasang!`, 'ok');
        setServers(updatedList);
        setSelectedPreset(null);
        setViewTab('installed');
      } else {
        toast('Gagal memasang plugin', 'err');
      }
    } catch (err) {
      toast(errorMessage(err, 'Terjadi kesalahan saat memasang plugin'), 'err');
    } finally {
      setInstallingPreset(false);
    }
  };

  const confirmDeleteServer = async () => {
    if (serverToDeleteIdx === null) return;
    const idx = serverToDeleteIdx;
    const updatedList = servers.filter((_, i) => i !== idx);

    try {
      const result = await api.saveMcpServers(updatedList);
      if (result.ok) {
        toast('MCP Server berhasil dihapus', 'ok');
        setServers(updatedList);
        if (testResult && testResult.name === servers[idx].name) {
          setTestResult(null);
        }
      }
    } catch (err) {
      toast(errorMessage(err, 'Gagal menghapus MCP Server'), 'err');
    }
  };

  const handleTestServer = async (idx: number) => {
    const s = servers[idx];
    setTestingIndex(idx);
    setTestResult(null);
    try {
      const res = await api.testMcpServer(s);
      setTestResult({
        name: s.name,
        ok: res.ok,
        tools: res.tools,
        error: res.error,
      });
      if (res.ok) {
        toast(`Test ${s.name} sukses! (${res.tools?.length || 0} tools tersedia)`, 'ok');
      } else {
        toast(`Test ${s.name} gagal.`, 'err');
      }
    } catch (err) {
      setTestResult({
        name: s.name,
        ok: false,
        error: errorMessage(err, 'Koneksi gagal'),
      });
      toast(`Test ${s.name} gagal.`, 'err');
    } finally {
      setTestingIndex(null);
    }
  };

  const isPresetInstalled = (presetId: string) => {
    return servers.some((s) => s.name === presetId);
  };

  if (error) {
    return (
      <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        <span>Gagal memuat daftar MCP Server: {error}</span>
        <Button variant="danger" type="button" onClick={fetchServers}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat daftar MCP Server...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Puzzle size={16} style={{ color: 'var(--accent)' }} />
            <span>MCP Plugins & Extensible Tools</span>
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Ekspansi kemampuan agen Lail Hermes dengan menghubungkan tools browser, database, git, dan API eksternal.
          </p>
        </div>
      </div>

      {/* View Switcher Pills */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '10px' }}>
        <button
          type="button"
          onClick={() => setViewTab('installed')}
          style={{
            padding: '6px 12px',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            border: '1px solid',
            borderColor: viewTab === 'installed' ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
            background: viewTab === 'installed' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: viewTab === 'installed' ? '#ffffff' : 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Layers size={13} />
          <span>Terpasang ({servers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setViewTab('catalog')}
          style={{
            padding: '6px 12px',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            border: '1px solid',
            borderColor: viewTab === 'catalog' ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
            background: viewTab === 'catalog' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: viewTab === 'catalog' ? '#ffffff' : 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Sparkles size={13} style={{ color: '#38bdf8' }} />
          <span>Katalog 1-Klik Populer</span>
        </button>

        <button
          type="button"
          onClick={() => setViewTab('link')}
          style={{
            padding: '6px 12px',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            border: '1px solid',
            borderColor: viewTab === 'link' ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
            background: viewTab === 'link' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: viewTab === 'link' ? '#ffffff' : 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Link2 size={13} />
          <span>Auto-Discover Link</span>
        </button>

        <button
          type="button"
          onClick={openManualAdd}
          style={{
            padding: '6px 12px',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'transparent',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginLeft: 'auto',
          }}
        >
          <Plus size={13} />
          <span>Manual Form</span>
        </button>
      </div>

      {/* 1. INSTALLED PLUGINS VIEW */}
      {viewTab === 'installed' && (
        <>
          {servers.length === 0 ? (
            <div style={{
              padding: '36px 20px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '6px',
              border: '1px dashed rgba(255, 255, 255, 0.12)',
              textAlign: 'center',
            }}>
              <Puzzle size={28} style={{ opacity: 0.35, margin: '0 auto 8px auto', display: 'block' }} />
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                Belum ada MCP Server yang terpasang
              </div>
              <p style={{ fontSize: '11.5px', color: 'var(--text-faint)', maxWidth: '380px', margin: '4px auto 16px auto' }}>
                Pasang alat populer seperti Browser Automation, GitHub, atau Database SQL dalam 1 klik.
              </p>
              <Button variant="primary" onClick={() => setViewTab('catalog')}>
                <Sparkles size={12} />
                <span>Buka Katalog 1-Klik</span>
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {servers.map((s, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#06090e',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '6px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '4px',
                        background: 'rgba(59, 130, 246, 0.12)',
                        color: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <Puzzle size={14} />
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{s.name}</span>
                          <span style={{
                            fontSize: '9.5px',
                            textTransform: 'uppercase',
                            fontFamily: 'var(--font-mono)',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: 'var(--text-faint)',
                          }}>
                            {s.type}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                          {s.type === 'stdio' ? `${s.command} ${s.args.slice(0, 2).join(' ')}` : s.url}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Active Status Switch */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11.5px', color: s.enabled ? 'var(--ok)' : 'var(--text-faint)' }}>
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e) => handleToggleServerEnabled(idx, e.target.checked)}
                          style={{ accentColor: '#22c55e', cursor: 'pointer' }}
                        />
                        <span>{s.enabled ? 'Aktif' : 'Nonaktif'}</span>
                      </label>

                      <button
                        type="button"
                        className="aux-action-btn primary"
                        onClick={() => handleTestServer(idx)}
                        disabled={testingIndex === idx}
                        title="Uji Koneksi dan Periksa Tools"
                      >
                        <Play size={11} className={testingIndex === idx ? 'spin' : ''} />
                        <span>{testingIndex === idx ? 'Testing...' : 'Test'}</span>
                      </button>

                      <button
                        type="button"
                        className="aux-action-btn"
                        onClick={() => openEditModal(idx)}
                        title="Edit Konfigurasi"
                      >
                        <Edit2 size={11} />
                      </button>

                      <button
                        type="button"
                        className="aux-action-btn"
                        onClick={() => setServerToDeleteIdx(idx)}
                        title="Hapus Server"
                        style={{ color: 'var(--err)' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Test Result Live Banner */}
                  {testResult && testResult.name === s.name && (
                    <div
                      style={{
                        backgroundColor: testResult.ok ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.06)',
                        border: `1px solid ${testResult.ok ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        borderRadius: '5px',
                        padding: '10px 12px',
                        fontSize: '11.5px',
                      }}
                    >
                      {testResult.ok ? (
                        <div>
                          <div style={{ color: 'var(--ok)', fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <CheckCircle2 size={12} />
                            <span>Koneksi Sukses! Tersedia {testResult.tools?.length || 0} tools:</span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {testResult.tools?.map((tool) => (
                              <span
                                key={tool}
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '10.5px',
                                  padding: '2px 6px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                                  border: '1px solid rgba(255, 255, 255, 0.08)',
                                  borderRadius: '3px',
                                  color: '#cbd5e1',
                                }}
                              >
                                {tool}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: 'var(--err)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <XCircle size={12} />
                          <span><strong>Gagal:</strong> {testResult.error}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 2. 1-CLICK POPULAR CATALOG VIEW */}
      {viewTab === 'catalog' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {MCP_CATALOG.map((preset) => {
            const Icon = preset.icon;
            const installed = isPresetInstalled(preset.id);
            return (
              <div
                key={preset.id}
                style={{
                  background: '#06090e',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '4px',
                        background: 'rgba(59, 130, 246, 0.12)',
                        color: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <Icon size={14} />
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                        {preset.name}
                      </span>
                    </div>

                    <span style={{
                      fontSize: '10px',
                      color: 'var(--text-faint)',
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '2px 6px',
                      borderRadius: '3px',
                    }}>
                      {preset.category}
                    </span>
                  </div>

                  <p style={{ fontSize: '11.5px', color: 'var(--text-dim)', lineHeight: 1.4, margin: 0 }}>
                    {preset.description}
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '10px' }}>
                  <span style={{ fontSize: '10.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                    {preset.command} {preset.args[1] || ''}
                  </span>

                  {installed ? (
                    <span style={{ fontSize: '11px', color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                      <CheckCircle2 size={12} />
                      <span>Terpasang</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => handleOpenPresetModal(preset)}
                    >
                      <Download size={11} />
                      <span>1-Klik Pasang</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. AUTO-DISCOVER LINK VIEW */}
      {viewTab === 'link' && (
        <div style={{
          background: '#06090e',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '6px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            Integrasikan dari URL / Paket
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: 0 }}>
            Tempelkan link GitHub repo MCP, URL remote server (mis. <code>https://mcp.notion.com/mcp</code>), atau nama paket npm (<code>@modelcontextprotocol/server-github</code>). Sistem akan otomatis mendeteksi konfigurasi dan autentikasi.
          </p>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="field-input"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Contoh: https://mcp.notion.com/mcp atau @modelcontextprotocol/server-github"
              autoFocus
            />
            <Button
              variant="primary"
              onClick={handleIntegrate}
              loading={run?.state === 'running'}
              disabled={!link.trim() || run?.state === 'running'}
            >
              Integrate
            </Button>
          </div>

          {run && (
            <div style={{
              background: '#040608',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '5px',
              padding: '12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11.5px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              {run.events.map((ev, i) => (
                <div key={i} style={{ color: ev.ok === false ? 'var(--err)' : '#94a3b8' }}>
                  {ev.kind === 'attempt' && `${ev.ok ? '✓' : '✗'} ${ev.action} ${ev.error || ''}`}
                  {ev.kind === 'round' && `→ ${ev.action}`}
                  {ev.kind === 'login' && 'Menunggu autentikasi login di jendela browser...'}
                  {ev.kind === 'done' && `Selesai: ${ev.reason}`}
                </div>
              ))}
              {run.pending_secret && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <input
                    className="field-input"
                    value={secret}
                    type="password"
                    placeholder={`Masukkan ${run.pending_secret}`}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  <Button onClick={async () => {
                    await api.answerIntegrateSecret(runId!, secret);
                    setSecret('');
                  }}>
                    Kirim Token
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Preset Param / API Key Install Modal */}
      {selectedPreset && (
        <Modal
          isOpen={selectedPreset !== null}
          onClose={() => setSelectedPreset(null)}
          title={`Pasang Plugin: ${selectedPreset.name}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '12.5px', color: 'var(--text-dim)', margin: 0 }}>
              {selectedPreset.description}
            </p>

            {selectedPreset.requiresEnv?.map((envItem) => (
              <Field
                key={envItem.key}
                label={envItem.label}
                helpText={`Variabel lingkungan: ${envItem.key}`}
              >
                <input
                  type={envItem.isSecret ? 'password' : 'text'}
                  className="field-input"
                  value={presetEnvValues[envItem.key] || ''}
                  onChange={(e) =>
                    setPresetEnvValues({
                      ...presetEnvValues,
                      [envItem.key]: e.target.value,
                    })
                  }
                  placeholder={envItem.placeholder}
                  required
                />
              </Field>
            ))}

            {selectedPreset.requiresArgs?.map((argItem, idx) => (
              <Field key={idx} label={argItem.label}>
                <input
                  type="text"
                  className="field-input"
                  value={presetArgValues[idx.toString()] || ''}
                  onChange={(e) =>
                    setPresetArgValues({
                      ...presetArgValues,
                      [idx.toString()]: e.target.value,
                    })
                  }
                  placeholder={argItem.placeholder}
                  required
                />
              </Field>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setSelectedPreset(null)}
              >
                Batal
              </button>
              <Button
                variant="primary"
                loading={installingPreset}
                onClick={() =>
                  handleInstallPresetDirectly(
                    selectedPreset,
                    presetEnvValues,
                    presetArgValues
                  )
                }
              >
                Pasang Plugin
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Manual Add / Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={editingIndex === null ? 'Tambah MCP Server Manual' : 'Edit MCP Server'}
      >
        <form onSubmit={handleSaveServer} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Nama Server">
            <input
              type="text"
              className="field-input"
              value={serverForm.name}
              onChange={(e) => setServerForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="mis. custom-tools"
              required
              disabled={editingIndex !== null}
            />
          </Field>

          <Field label="Tipe Koneksi">
            <select
              className="field-select"
              value={serverForm.type}
              onChange={(e) => setServerForm((prev) => ({ ...prev, type: e.target.value as 'stdio' | 'http' }))}
            >
              <option value="stdio">stdio (Local Command)</option>
              <option value="http">http (Remote SSE Server)</option>
            </select>
          </Field>

          {serverForm.type === 'stdio' ? (
            <>
              <Field label="Command / Executable" helpText="Executable untuk dijalankan (mis. npx, python, uvx)">
                <input
                  type="text"
                  className="field-input"
                  value={serverForm.command}
                  onChange={(e) => setServerForm((prev) => ({ ...prev, command: e.target.value }))}
                  placeholder="npx"
                  required
                />
              </Field>

              <Field label="Argumen Perintah" helpText="Argumen per baris">
                <textarea
                  className="field-textarea"
                  rows={3}
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder="-y\n@modelcontextprotocol/server-github"
                />
              </Field>

              <Field label="Environment Variables" helpText="Format: KEY=VALUE (satu per baris)">
                <textarea
                  className="field-textarea"
                  rows={3}
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder="API_KEY=your_token_here"
                />
              </Field>
            </>
          ) : (
            <Field label="Server URL" helpText="Endpoint SSE server MCP remote">
              <input
                type="url"
                className="field-input"
                value={serverForm.url}
                onChange={(e) => setServerForm((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="http://127.0.0.1:3000/sse"
                required
              />
            </Field>
          )}

          <div style={{ marginTop: '4px' }}>
            <Toggle
              checked={serverForm.enabled}
              onChange={(e) => setServerForm((prev) => ({ ...prev, enabled: e }))}
              label="Aktifkan Plugin"
              helpText="Aktifkan tools server ini untuk dapat dipanggil otomatis oleh agen"
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => setIsEditModalOpen(false)}
            >
              Batal
            </button>
            <Button variant="primary" type="submit">
              Simpan Server
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={serverToDeleteIdx !== null}
        onClose={() => setServerToDeleteIdx(null)}
        onConfirm={async () => {
          await confirmDeleteServer();
          setServerToDeleteIdx(null);
        }}
        title="Hapus MCP Server"
        message={`Apakah Anda yakin ingin menghapus MCP Server "${serverToDeleteIdx !== null && servers[serverToDeleteIdx] ? servers[serverToDeleteIdx].name : ''}"?`}
        confirmText="Hapus Server"
      />
    </div>
  );
}
