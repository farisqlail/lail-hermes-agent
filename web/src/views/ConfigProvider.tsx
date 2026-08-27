import React, { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { Settings } from '../api/types';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { useToast } from '../components/Toast';
import { Brain, Save } from 'lucide-react';

interface AuxFeatureRowProps {
  label: string;
  helpText: string;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}

function AuxFeatureRow({ label, helpText, enabled, onToggle }: AuxFeatureRowProps) {
  return (
    <div style={{
      padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      backgroundColor: 'var(--surface-2)',
    }}>
      <Toggle checked={enabled} onChange={onToggle} label={label} helpText={helpText} />
    </div>
  );
}

export function ConfigProvider() {
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
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat pengaturan provider...</div>;
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
        toast('Pengaturan AI Provider berhasil disimpan!', 'ok');
      } else {
        toast('Gagal menyimpan pengaturan.', 'err');
      }
    } catch {
      toast('Terjadi kesalahan saat menyimpan pengaturan.', 'err');
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
        <h3 className="settings-section-heading" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Brain size={15} style={{ color: 'var(--accent)' }} />
          <span>AI Provider (Planner)</span>
        </h3>
        <p className="settings-panel-desc">Penyedia inferensi untuk planner. Ganti ke NVIDIA NIM, DeepSeek Official, atau endpoint custom (mis. 9Router).</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
        <Field label="AI Provider" helpText="Pilih penyedia layanan model AI Anda">
          <select
            className="field-select"
            value={formState.ai_provider || 'nvidia'}
            onChange={(e) => {
              const val = e.target.value as 'nvidia' | 'deepseek' | 'custom';
              setFormState((prev) => {
                if (!prev) return prev;
                const next = { ...prev, ai_provider: val };
                if (val === 'nvidia') {
                  next.nvidia_base_url = 'https://integrate.api.nvidia.com/v1';
                  next.model = 'deepseek-ai/deepseek-v3';
                } else if (val === 'deepseek') {
                  next.nvidia_base_url = 'https://api.deepseek.com/v1';
                  next.model = 'deepseek-chat';
                }
                return next;
              });
            }}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 'var(--r-md)',
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="nvidia">NVIDIA NIM</option>
            <option value="deepseek">DeepSeek Official</option>
            <option value="custom">Custom (OpenAI Compatible, mis. 9Router)</option>
          </select>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <Field label="API Base URL" helpText="Endpoint URL untuk API planner">
          <input
            type="text"
            className="field-input"
            value={formState.nvidia_base_url || ''}
            onChange={(e) => handleChange('nvidia_base_url', e.target.value)}
            required
          />
        </Field>

        <Field label="Model ID" helpText="Model ID untuk perencanaan tugas">
          <input
            type="text"
            className="field-input"
            value={formState.model || ''}
            onChange={(e) => handleChange('model', e.target.value)}
            required
          />
        </Field>
      </div>

      <div>
        <h3 className="settings-section-heading">Auxiliary Features</h3>
        <p className="settings-panel-desc">
          Tinggal aktif/nonaktifkan — otomatis pakai model &amp; provider yang sama dengan AI Provider di atas, gak perlu isi apa-apa lagi.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
        <AuxFeatureRow
          label="Vision"
          helpText="Otomatis kirim ke provider yang sama kalau chat ada attachment gambar."
          enabled={formState.vision_enabled}
          onToggle={(v) => handleChange('vision_enabled', v)}
        />

        <AuxFeatureRow
          label="Title Generator"
          helpText="Generate judul percakapan otomatis dari pesan pertama."
          enabled={formState.title_gen_enabled}
          onToggle={(v) => handleChange('title_gen_enabled', v)}
        />

        <AuxFeatureRow
          label="Context Compression"
          helpText="Ringkas riwayat chat lama otomatis biar konteks gak membengkak."
          enabled={formState.compression_enabled}
          onToggle={(v) => handleChange('compression_enabled', v)}
        />

        <AuxFeatureRow
          label="Approval Note"
          helpText="Nambahin penjelasan risiko singkat di kartu aksi tertahan. Cuma informasi — konfirmasi manual tetap wajib."
          enabled={formState.approval_note_enabled}
          onToggle={(v) => handleChange('approval_note_enabled', v)}
        />

        <AuxFeatureRow
          label="MCP Tool Routing"
          helpText="Nyaring tool MCP relevan otomatis kalau server yang terhubung banyak (>15 tool)."
          enabled={formState.mcp_routing_enabled}
          onToggle={(v) => handleChange('mcp_routing_enabled', v)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
        <Field label="Planner Temperature" helpText="Suhu kreativitas planner (Disarankan 0.0)">
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            className="field-input"
            value={formState.planner_temperature ?? 0.0}
            onChange={(e) => handleChange('planner_temperature', parseFloat(e.target.value) || 0.0)}
            required
          />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
        <Button variant="primary" type="submit" loading={saving}>
          <Save size={13} />
          <span>Simpan AI Provider</span>
        </Button>
      </div>
    </form>
  );
}
