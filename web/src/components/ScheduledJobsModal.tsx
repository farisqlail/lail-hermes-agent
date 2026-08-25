import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal } from './Modal';
import { ConfirmModal } from './ConfirmModal';
import { Button } from './Button';
import { Field } from './Field';
import { useToast } from './Toast';
import {
  Clock,
  Play,
  Trash2,
  Plus,
  RefreshCw,
  Calendar,
  AlertCircle,
  CheckCircle2,
  RotateCw,
  Sparkles,
  X,
} from 'lucide-react';

export interface ScheduledJob {
  job_id: string;
  description: string;
  interval_s: number;
  next_run_ts: number;
  last_run_ts: number | null;
  enabled: number;
  chat_id: number;
  created: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function formatCountdown(targetTs: number): string {
  const now = Date.now() / 1000;
  const diff = Math.round(targetTs - now);
  if (diff <= 0) return 'sekarang / overdue';
  if (diff < 60) return `dalam ${diff} detik`;
  if (diff < 3600) return `dalam ${Math.floor(diff / 60)} menit`;
  if (diff < 86400) return `dalam ${(diff / 3600).toFixed(1)} jam`;
  return `dalam ${(diff / 86400).toFixed(1)} hari`;
}

function formatInterval(interval_s: number): string {
  if (!interval_s || interval_s <= 0) return '1x jalan (One-shot)';
  if (interval_s < 60) return `Tiap ${interval_s} detik`;
  if (interval_s < 3600) return `Tiap ${Math.floor(interval_s / 60)} menit`;
  if (interval_s < 86400) return `Tiap ${Math.floor(interval_s / 3600)} jam`;
  return `Tiap ${Math.floor(interval_s / 86400)} hari (Harian)`;
}

export function ScheduledJobsModal({ isOpen, onClose }: Props) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<ScheduledJob | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  // Form State
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState<'5m' | '15m' | '1h' | 'every_15m' | 'every_1h' | 'every_6h' | 'daily' | 'custom'>('every_1h');
  const [customDelayS, setCustomDelayS] = useState('3600');
  const [customIntervalS, setCustomIntervalS] = useState('3600');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { toast } = useToast();

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/scheduled-jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(Array.isArray(data) ? data : data.jobs || []);
      }
    } catch (err) {
      console.error('Failed to fetch scheduled jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchJobs();
    }
  }, [isOpen, fetchJobs]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast('Deskripsi tugas wajib diisi', 'err');
      return;
    }

    let delay_s = 60;
    let interval_s = 0;

    switch (preset) {
      case '5m':
        delay_s = 300;
        interval_s = 0;
        break;
      case '15m':
        delay_s = 900;
        interval_s = 0;
        break;
      case '1h':
        delay_s = 3600;
        interval_s = 0;
        break;
      case 'every_15m':
        delay_s = 900;
        interval_s = 900;
        break;
      case 'every_1h':
        delay_s = 3600;
        interval_s = 3600;
        break;
      case 'every_6h':
        delay_s = 21600;
        interval_s = 21600;
        break;
      case 'daily':
        delay_s = 86400;
        interval_s = 86400;
        break;
      case 'custom':
        delay_s = Math.max(1, parseInt(customDelayS, 10) || 60);
        interval_s = Math.max(0, parseInt(customIntervalS, 10) || 0);
        break;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          delay_s,
          interval_s,
          chat_id: 0,
        }),
      });

      if (res.ok) {
        toast('Tugas terjadwal berhasil dibuat!', 'ok');
        setDescription('');
        setShowAddForm(false);
        await fetchJobs();
      } else {
        toast('Gagal membuat tugas terjadwal', 'err');
      }
    } catch {
      toast('Terjadi kesalahan saat menyimpan jadwal', 'err');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunNow = async (job: ScheduledJob) => {
    try {
      setRunningJobId(job.job_id);
      const res = await fetch(`/api/scheduled-jobs/${job.job_id}/run`, {
        method: 'POST',
      });
      if (res.ok) {
        toast(`Tugas "${job.description.slice(0, 30)}..." dieksekusi di latar belakang`, 'ok');
        await fetchJobs();
      } else {
        toast('Gagal menjalankan tugas', 'err');
      }
    } catch {
      toast('Gagal menghubungi backend scheduler', 'err');
    } finally {
      setRunningJobId(null);
    }
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete) return;
    try {
      const res = await fetch(`/api/scheduled-jobs/${jobToDelete.job_id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast('Tugas terjadwal berhasil dibatalkan', 'ok');
        setJobs((prev) => prev.filter((j) => j.job_id !== jobToDelete.job_id));
      } else {
        toast('Gagal membatalkan tugas', 'err');
      }
    } catch {
      toast('Terjadi kesalahan saat membatalkan tugas', 'err');
    } finally {
      setJobToDelete(null);
    }
  };

  const handleApplyPresetSuggestion = (desc: string, p: typeof preset) => {
    setDescription(desc);
    setPreset(p);
    setShowAddForm(true);
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="⏱️ Scheduled Tasks & Background Cron">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '380px' }}>
          {/* Header Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
              Total Jadwal Aktif: <strong style={{ color: 'var(--text)' }}>{jobs.length}</strong>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={fetchJobs}
                title="Refresh jobs list"
              >
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                <Plus size={12} />
                <span>{showAddForm ? 'Tutup Form' : 'Jadwalkan Tugas'}</span>
              </button>
            </div>
          </div>

          {/* Add Job Form */}
          {showAddForm && (
            <form
              onSubmit={handleCreateJob}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>
                Buat Tugas Otomatis Baru
              </div>

              <Field
                label="Instruksi Tugas / Prompt"
                helpText="Perintah atau tugas yang akan dieksekusi oleh agen Hermes saat jadwal tiba."
              >
                <textarea
                  className="field-textarea"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contoh: Periksa status server API dan beri laporan ringkas jika ada endpoint offline"
                  required
                />
              </Field>

              <Field label="Frekuensi Eksekusi">
                <select
                  className="field-select"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as any)}
                >
                  <option value="5m">5 Menit lagi (1x jalan)</option>
                  <option value="15m">15 Menit lagi (1x jalan)</option>
                  <option value="1h">1 Jam lagi (1x jalan)</option>
                  <option value="every_15m">Setiap 15 Menit (Berulang)</option>
                  <option value="every_1h">Setiap 1 Jam (Berulang)</option>
                  <option value="every_6h">Setiap 6 Jam (Berulang)</option>
                  <option value="daily">Harian / Setiap 24 Jam (Berulang)</option>
                  <option value="custom">Kustom (Tentukan detik)</option>
                </select>
              </Field>

              {preset === 'custom' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <Field label="Delay Awal (detik)">
                    <input
                      type="number"
                      className="field-input"
                      value={customDelayS}
                      onChange={(e) => setCustomDelayS(e.target.value)}
                      placeholder="60"
                      min={1}
                    />
                  </Field>
                  <Field label="Interval Pengulangan (detik, 0 = 1x)">
                    <input
                      type="number"
                      className="field-input"
                      value={customIntervalS}
                      onChange={(e) => setCustomIntervalS(e.target.value)}
                      placeholder="3600"
                      min={0}
                    />
                  </Field>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setShowAddForm(false)}
                >
                  Batal
                </button>
                <Button variant="primary" type="submit" loading={isSubmitting}>
                  Simpan Jadwal
                </Button>
              </div>
            </form>
          )}

          {/* Jobs List */}
          <div style={{
            maxHeight: '340px',
            overflowY: 'auto',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            borderRadius: '6px',
            background: 'rgba(0, 0, 0, 0.2)',
          }}>
            {loading && jobs.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '12px' }}>
                Memuat daftar tugas terjadwal...
              </div>
            ) : jobs.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                <Clock size={28} style={{ opacity: 0.35, margin: '0 auto 8px auto', display: 'block', color: 'var(--text-faint)' }} />
                <div style={{ fontSize: '12.5px', color: 'var(--text-dim)', marginBottom: '4px' }}>
                  Belum ada tugas otomatis yang terjadwal.
                </div>
                <p style={{ fontSize: '11.5px', color: 'var(--text-faint)', maxWidth: '380px', margin: '0 auto 16px auto' }}>
                  Hermes dapat memantau API, menjalankan health check, atau merangkum commit secara berkala di latar belakang.
                </p>

                {/* Suggested Presets */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '380px', margin: '0 auto', textAlign: 'left' }}>
                  <button
                    type="button"
                    className="aux-model-row"
                    onClick={() => handleApplyPresetSuggestion('Periksa kesehatan server lokal dan status API gateway', 'every_1h')}
                    style={{ cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div className="aux-row-left">
                      <span className="aux-name">🩺 Server & API Health Check</span>
                      <div className="aux-model-name">Jalankan setiap 1 jam secara otomatis</div>
                    </div>
                    <span className="aux-badge">+ Pasang</span>
                  </button>

                  <button
                    type="button"
                    className="aux-model-row"
                    onClick={() => handleApplyPresetSuggestion('Periksa error log dan ringkas isu penting yang terjadi', 'every_6h')}
                    style={{ cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div className="aux-row-left">
                      <span className="aux-name">📋 Periodic Log & Issue Summarizer</span>
                      <div className="aux-model-name">Jalankan setiap 6 jam</div>
                    </div>
                    <span className="aux-badge">+ Pasang</span>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {jobs.map((job) => (
                  <div
                    key={job.job_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      gap: '12px',
                    }}
                    className="artifact-row-hover"
                  >
                    {/* Left Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                        <span style={{
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono)',
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: 'var(--accent)',
                          padding: '1px 5px',
                          borderRadius: '3px',
                        }}>
                          {job.job_id}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={10} />
                          <span>{formatInterval(job.interval_s)}</span>
                        </span>
                      </div>

                      <div style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {job.description}
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '2px', display: 'flex', gap: '8px' }}>
                        <span>Next: <strong style={{ color: 'var(--text-dim)' }}>{formatCountdown(job.next_run_ts)}</strong></span>
                        <span>•</span>
                        <span>Last: {job.last_run_ts ? new Date(job.last_run_ts * 1000).toLocaleTimeString() : 'Belum pernah'}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <button
                        type="button"
                        className="aux-action-btn primary"
                        onClick={() => handleRunNow(job)}
                        disabled={runningJobId === job.job_id}
                        title="Eksekusi Sekarang (Run Now)"
                      >
                        <Play size={11} className={runningJobId === job.job_id ? 'spin' : ''} />
                        <span>{runningJobId === job.job_id ? 'Running...' : 'Run'}</span>
                      </button>

                      <button
                        type="button"
                        className="aux-action-btn"
                        onClick={() => setJobToDelete(job)}
                        title="Batalkan & Hapus Jadwal"
                        style={{ color: 'var(--err)' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={jobToDelete !== null}
        onClose={() => setJobToDelete(null)}
        onConfirm={handleDeleteJob}
        title="Batalkan Tugas Terjadwal"
        message={`Apakah Anda yakin ingin membatalkan tugas otomatis "${jobToDelete?.description.slice(0, 40)}..."? Tugas tidak akan dieksekusi lagi di masa mendatang.`}
        confirmText="Hapus Jadwal"
      />
    </>
  );
}
