import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';

export function ConfigMcp() {
  const { toast } = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [link, setLink] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<IntegrateRun | null>(null);
  const [secret, setSecret] = useState('');

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
            toast('MCP Server berhasil ditambahkan!', 'ok');
            setIsModalOpen(false);
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
      toast(errorMessage(err, 'Gagal memulai integrasi'), 'err');
    }
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
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

  const openAddModal = () => {
    setEditingIndex(null);
    setLink('');
    setRunId(null);
    setRun(null);
    setSecret('');
    setIsModalOpen(true);
  };

  const openEditModal = (idx: number) => {
    const s = servers[idx];
    setEditingIndex(idx);
    setServerForm({ ...s });
    setArgsText(s.args.join('\n'));
    setEnvText(Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n'));
    setIsModalOpen(true);
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
        toast('Daftar MCP Server berhasil diperbarui!', 'ok');
        setServers(updatedList);
        setIsModalOpen(false);
      }
    } catch (err) {
      toast(errorMessage(err, 'Gagal menyimpan MCP Server'), 'err');
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
        toast(`Test ${s.name} sukses!`, 'ok');
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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '15px', fontWeight: '600', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Puzzle size={16} style={{ color: 'var(--accent)' }} />
          <span>Registered MCP Servers & Plugins</span>
        </h3>
        <Button variant="primary" onClick={openAddModal} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Plus size={14} />
          <span>Add Server</span>
        </Button>
      </div>

      {servers.length === 0 ? (
        <div style={{ padding: '24px', backgroundColor: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
          Belum ada MCP Server yang terdaftar.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {servers.map((s, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: 'var(--surface-1)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {s.name}
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: s.enabled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                        color: s.enabled ? 'var(--ok)' : 'var(--text-faint)',
                        border: `1px solid ${s.enabled ? 'var(--ok)' : 'var(--border)'}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      {s.enabled ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                      {s.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                      {s.type}
                    </span>
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                    {s.type === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <Button variant="secondary" onClick={() => handleTestServer(idx)} loading={testingIndex === idx} style={{ minHeight: '28px', height: '28px', padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Play size={11} />
                    <span>Test</span>
                  </Button>
                  <Button variant="secondary" onClick={() => openEditModal(idx)} style={{ minHeight: '28px', height: '28px', padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Edit2 size={11} />
                    <span>Edit</span>
                  </Button>
                  <Button variant="danger" onClick={() => setServerToDeleteIdx(idx)} style={{ minHeight: '28px', height: '28px', padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Trash2 size={11} />
                    <span>Delete</span>
                  </Button>
                </div>
              </div>

              {testResult && testResult.name === s.name && (
                <div
                  style={{
                    backgroundColor: testResult.ok ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                    border: `1px solid ${testResult.ok ? 'var(--ok)' : 'var(--err)'}`,
                    borderRadius: 'var(--r-md)',
                    padding: '12px',
                    fontSize: '12px',
                  }}
                >
                  {testResult.ok ? (
                    <div>
                      <div style={{ color: 'var(--ok)', fontWeight: '600', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={13} />
                        <span>Koneksi Sukses. Tersedia {testResult.tools?.length || 0} tools:</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {testResult.tools?.map((tool) => (
                          <span
                            key={tool}
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              padding: '2px 6px',
                              backgroundColor: 'var(--surface-2)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--r-sm)',
                            }}
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--err)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <XCircle size={13} />
                      <span><strong>Koneksi Gagal:</strong> {testResult.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingIndex === null ? 'Add MCP Server' : 'Edit MCP Server'}
      >
        {editingIndex === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Field label="Pasang dari link"
                   helpText="URL server MCP remote, link GitHub/npm, atau nama paket npm.">
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="field-input" value={link} autoFocus
                       onChange={(e) => setLink(e.target.value)}
                       placeholder="https://mcp.notion.com/mcp" />
                <Button onClick={handleIntegrate}
                        loading={run?.state === 'running'}
                        disabled={!link.trim() || run?.state === 'running'}>Integrate</Button>
              </div>
            </Field>

            {run && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                {run.events.map((ev, i) => (
                  <div key={i} style={{ color: ev.ok === false ? 'var(--err)' : 'var(--fg)' }}>
                    {ev.kind === 'attempt' && `${ev.ok ? '✓' : '✗'} ${ev.action} ${ev.error || ''}`}
                    {ev.kind === 'round' && `→ ${ev.action}`}
                    {ev.kind === 'login' && 'menunggu login di jendela baru…'}
                    {ev.kind === 'done' && `selesai: ${ev.reason}`}
                  </div>
                ))}
                {run.pending_secret && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <input className="field-input" value={secret} type="password"
                           placeholder={`isi ${run.pending_secret}`}
                           onChange={(e) => setSecret(e.target.value)} />
                    <Button onClick={async () => {
                      await api.answerIntegrateSecret(runId!, secret);
                      setSecret('');
                    }}>Kirim</Button>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
                Tutup
              </Button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSaveServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Server Name">
            <input
              type="text"
              className="field-input"
              value={serverForm.name}
              onChange={(e) => setServerForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="mis. github-tools"
              required
              disabled={editingIndex !== null}
            />
          </Field>

          <Field label="Connection Type">
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
              <Field label="Command / Executable" helpText="Perintah CLI untuk dijalankan">
                <input
                  type="text"
                  className="field-input"
                  value={serverForm.command}
                  onChange={(e) => setServerForm((prev) => ({ ...prev, command: e.target.value }))}
                  placeholder="mis. npx"
                  required
                />
              </Field>

              <Field label="Arguments" helpText="Argumen perintah CLI (satu per baris)">
                <textarea
                  className="field-textarea"
                  rows={3}
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder="-y\n@modelcontextprotocol/server-github"
                />
              </Field>

              <Field label="Environment Variables" helpText="Variabel lingkungan, format: KEY=VALUE (satu per baris)">
                <textarea
                  className="field-textarea"
                  rows={3}
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=your_token_here"
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
                placeholder="mis. http://127.0.0.1:3000/sse"
                required
              />
            </Field>
          )}

          <div style={{ marginTop: '8px' }}>
            <Toggle
              checked={serverForm.enabled}
              onChange={(e) => setServerForm((prev) => ({ ...prev, enabled: e }))}
              label="Enabled"
              helpText="Aktifkan server ini untuk digunakan oleh planner"
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Save Server
            </Button>
          </div>
        </form>
        )}
      </Modal>

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
