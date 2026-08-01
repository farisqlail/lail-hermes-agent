import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Project } from '../api/types';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

export function ConfigProjects() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null); // null means adding
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch (err) {
      setError(errorMessage(err, 'Gagal memuat daftar proyek'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const openAddModal = () => {
    setEditingName(null);
    setProjectName('');
    setProjectPath('');
    setFieldError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (p: Project) => {
    setEditingName(p.name);
    setProjectName(p.name);
    setProjectPath(p.path);
    setFieldError(null);
    setIsModalOpen(true);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFieldError(null);

    const nameKey = projectName.trim();
    const pathVal = projectPath.trim();

    if (!nameKey || !pathVal) {
      setSaving(false);
      return;
    }

    // Build the updated dictionary payload
    const payload: Record<string, string> = {};
    
    // Add existing projects except the one being edited (if name is changing)
    projects.forEach((p) => {
      if (p.name !== editingName) {
        payload[p.name] = p.path;
      }
    });

    // Add / overwrite the current project
    payload[nameKey] = pathVal;

    try {
      const res = await api.saveProjects(payload);
      if (res.ok) {
        toast(editingName ? 'Proyek berhasil diperbarui!' : 'Proyek baru berhasil ditambahkan!', 'ok');
        await fetchProjects(); // reload from backend to get verified `exists` disk status
        setIsModalOpen(false);
      }
    } catch (err) {
      setFieldError(errorMessage(err, 'Gagal menyimpan proyek'));
      toast('Gagal menyimpan proyek.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async (name: string) => {
    if (!window.confirm(`Hapus pendaftaran proyek "${name}"?`)) return;

    const payload: Record<string, string> = {};
    projects.forEach((p) => {
      if (p.name !== name) {
        payload[p.name] = p.path;
      }
    });

    try {
      const res = await api.saveProjects(payload);
      if (res.ok) {
        toast('Proyek berhasil dihapus', 'ok');
        await fetchProjects();
      }
    } catch (err) {
      toast(errorMessage(err, 'Gagal menghapus proyek'), 'err');
    }
  };

  if (error) {
    return (
      <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        <span>Gagal memuat daftar proyek: {error}</span>
        <Button variant="danger" type="button" onClick={fetchProjects}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: 'var(--text-dim)' }}>Memuat daftar proyek...</div>;
  }

  return (
    <div className="cyber-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 className="cyber-section-header" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>
          📁 Registered Projects
        </h3>
        <Button variant="primary" onClick={openAddModal}>
          + Register Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          NO REGISTERED PROJECTS DETECTED. USE THE BUTTON ABOVE TO REGISTER A PROJECT.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="md-table">
            <thead>
              <tr style={{ color: 'var(--accent)' }}>
                <th style={{ padding: '12px 16px', fontWeight: 'bold' }}>Project Name</th>
                <th style={{ padding: '12px 16px', fontWeight: 'bold' }}>Absolute Directory Path</th>
                <th style={{ padding: '12px 16px', fontWeight: 'bold', width: '100px' }}>Status</th>
                <th style={{ padding: '12px 16px', fontWeight: 'bold', width: '150px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.name}>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    @{p.name}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    {p.path}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 'bold',
                        padding: '2px 8px',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: p.exists ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: p.exists ? 'var(--ok)' : 'var(--err)',
                        border: `1px solid ${p.exists ? 'var(--ok)' : 'var(--err)'}`,
                      }}
                    >
                      {p.exists ? 'OK' : 'MISSING'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <Button variant="secondary" onClick={() => openEditModal(p)} style={{ minHeight: '30px', height: '30px', padding: '0 12px' }}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => handleDeleteProject(p.name)} style={{ minHeight: '30px', height: '30px', padding: '0 12px' }}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingName === null ? 'Register Project' : 'Edit Project Path'}
      >
        <form onSubmit={handleSaveProject} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {fieldError && (
            <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', fontSize: 'var(--t-sm)' }}>
              {fieldError}
            </div>
          )}

          <Field
            label="Project Name"
            helpText="Nama pengenal unik (mis. myprofit, counter-app). Harus diawali huruf/angka."
          >
            <input
              type="text"
              className="field-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="myprofit"
              required
              disabled={editingName !== null} // Name is project key, cannot edit key
            />
          </Field>

          <Field
            label="Absolute Path"
            helpText="Path direktori absolut proyek Anda di disk local"
          >
            <input
              type="text"
              className="field-input"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="E:\Projects\myprofit"
              required
            />
          </Field>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={saving}>
              Save Project
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
