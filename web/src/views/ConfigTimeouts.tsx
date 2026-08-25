import React, { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { Settings } from '../api/types';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { Clock, DollarSign, Save } from 'lucide-react';

export function ConfigTimeouts() {
  const { settings, loading, error, saveSettings, refresh } = useSettings();
  const { toast } = useToast();
  const [formState, setFormState] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setFormState({ ...settings });
    }
  }, [settings]);

  if (error && !formState) {
    return (
      <div style={{ padding: '14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: '6px', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span>Gagal memuat pengaturan: {String(error)}</span>
        <Button variant="danger" type="button" onClick={refresh}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading || !formState) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat batas waktu...</div>;
  }

  const handleChange = (field: keyof Settings, value: any) => {
    setFormState((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState) return;

    setSaving(true);
    try {
      const ok = await saveSettings(formState);
      if (ok) {
        toast('Batas waktu dan budget berhasil disimpan!', 'ok');
      } else {
        toast('Gagal menyimpan pengaturan.', 'err');
      }
    } catch {
      toast('Terjadi kesalahan saat menyimpan batas waktu.', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && (
        <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: '6px', color: 'var(--err)', fontSize: '12px' }}>
          {String(error)}
        </div>
      )}
      <div>
        <h3 className="settings-section-heading">Execution Timeouts & Cost Budget</h3>
        <p className="settings-panel-desc">Batasi durasi eksekusi tiap fase tugas dan proteksi anggaran biaya per task.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <Field label="Batas Biaya Maksimal per Task (USD)" helpText="0 = tanpa batas proteksi biaya">
          <input
            type="number"
            step="0.5"
            min="0"
            className="field-input"
            value={formState.max_task_cost_usd ?? 10}
            onChange={(e) => handleChange('max_task_cost_usd', parseFloat(e.target.value) || 0)}
            required
          />
        </Field>

        <Field label="Coding Phase Timeout (detik)" helpText="Batas waktu proses penulisan kode (Default: 900s)">
          <input
            type="number"
            className="field-input"
            value={formState.timeout_code_s}
            onChange={(e) => handleChange('timeout_code_s', parseInt(e.target.value, 10) || 900)}
            required
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <Field label="Build Phase Timeout (detik)" helpText="Batas waktu kompilasi / build package (Default: 1200s)">
          <input
            type="number"
            className="field-input"
            value={formState.timeout_build_s}
            onChange={(e) => handleChange('timeout_build_s', parseInt(e.target.value, 10) || 1200)}
            required
          />
        </Field>

        <Field label="Testing Phase Timeout (detik)" helpText="Batas waktu runner pengujian (Default: 600s)">
          <input
            type="number"
            className="field-input"
            value={formState.timeout_test_s}
            onChange={(e) => handleChange('timeout_test_s', parseInt(e.target.value, 10) || 600)}
            required
          />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
        <Button variant="primary" type="submit" loading={saving}>
          <Save size={13} />
          <span>Simpan Batas Waktu & Budget</span>
        </Button>
      </div>
    </form>
  );
}
