import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { McpServer } from '../api/types';
import { Field } from '../components/Field';
import { Toggle } from '../components/Toggle';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

export function ConfigMcp() {
  const { toast } = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null means adding
  const [serverForm, setServerForm] = useState<McpServer>({
    name: '',
    type: 'stdio',
    command: '',
    args: [],
    url: '',
    env: {},
    enabled: true,
  });

  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');

  // Testing states
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; ok: boolean; tools?: string[]; error?: string } | null>(null);

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
    setServerForm({
      name: '',
      type: 'stdio',
      command: '',
      args: [],
      url: '',
      env: {},
      enabled: true,
    });
    setArgsText('');
    setEnvText('');
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

    // Parse args and env
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

  const handleDeleteServer = async (idx: number) => {
    if (!window.confirm(`Hapus MCP Server "${servers[idx].name}"?`)) return;
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
    return <div style={{ color: 'var(--text-dim)' }}>Memuat daftar MCP Server...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--t-lg)', fontWeight: '600', color: 'var(--text)' }}>
          🔌 Registered MCP Servers
        </h3>
        <Button variant="primary" onClick={openAddModal}>
          + Add Server
        </Button>
      </div>

      {servers.length === 0 ? (
        <div style={{ padding: '24px', backgroundColor: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', textAlign: 'center', color: 'var(--text-dim)' }}>
          Belum ada MCP Server yang terdaftar.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                  <h4 style={{ fontSize: 'var(--t-lg)', fontWeight: '600', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {s.name}
                    <span
                      style={{
                        fontSize: 'var(--t-xs)',
                        padding: '2px 8px',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: s.enabled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                        color: s.enabled ? 'var(--ok)' : 'var(--text-faint)',
                        border: `1px solid ${s.enabled ? 'var(--ok)' : 'var(--border)'}`,
                      }}
                    >
                      {s.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
                      {s.type}
                    </span>
                  </h4>
                  <p style={{ fontSize: 'var(--t-sm)', color: 'var(--text-dim)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                    {s.type === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button variant="secondary" onClick={() => handleTestServer(idx)} loading={testingIndex === idx}>
                    Test Server
                  </Button>
                  <Button variant="secondary" onClick={() => openEditModal(idx)}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => handleDeleteServer(idx)}>
                    Delete
                  </Button>
                </div>
              </div>

              {/* Render test results inside the server card if matching */}
              {testResult && testResult.name === s.name && (
                <div
                  style={{
                    backgroundColor: testResult.ok ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                    border: `1px solid ${testResult.ok ? 'var(--ok)' : 'var(--err)'}`,
                    borderRadius: 'var(--r-md)',
                    padding: '12px',
                    fontSize: 'var(--t-sm)',
                  }}
                >
                  {testResult.ok ? (
                    <div>
                      <div style={{ color: 'var(--ok)', fontWeight: '600', marginBottom: '8px' }}>✓ Koneksi Sukses. Tersedia {testResult.tools?.length || 0} tools:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {testResult.tools?.map((tool) => (
                          <span
                            key={tool}
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--t-xs)',
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
                    <div style={{ color: 'var(--err)' }}>
                      <strong>✗ Koneksi Gagal:</strong> {testResult.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingIndex === null ? 'Add MCP Server' : 'Edit MCP Server'}
      >
        <form onSubmit={handleSaveServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Server Name">
            <input
              type="text"
              className="field-input"
              value={serverForm.name}
              onChange={(e) => setServerForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="mis. github-tools"
              required
              disabled={editingIndex !== null} // name acts as key, disable edit
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
                  placeholder="-y&#10;@modelcontextprotocol/server-github"
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
      </Modal>
    </div>
  );
}
