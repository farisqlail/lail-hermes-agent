import React, { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { api, errorMessage } from '../api/client';
import { EngineModels, Settings } from '../api/types';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { Cpu, Terminal, Sparkles, Save } from 'lucide-react';

export function ConfigEngines() {
  const { settings, loading, error, saveSettings, refresh } = useSettings();
  const { toast } = useToast();
  const [formState, setFormState] = useState<Settings | null>(null);
  const [engineModels, setEngineModels] = useState<EngineModels | null>(null);
  const [saving, setSaving] = useState(false);

  const [claudeModelMode, setClaudeModelMode] = useState<'select' | 'custom'>('select');
  const [claudeCustomVal, setClaudeCustomVal] = useState('');
  const [agyModelMode, setAgyModelMode] = useState<'select' | 'custom'>('select');
  const [agyCustomVal, setAgyCustomVal] = useState('');

  useEffect(() => {
    async function loadModels() {
      try {
        const models = await api.getEngineModels();
        setEngineModels(models);
      } catch (err) {
        console.error('Gagal memuat model engine:', err);
      }
    }
    loadModels();
  }, []);

  useEffect(() => {
    if (settings) {
      setFormState({ ...settings });
    }
  }, [settings]);

  useEffect(() => {
    if (formState && engineModels) {
      if (formState.claude_model === '' || engineModels.claude.includes(formState.claude_model)) {
        setClaudeModelMode('select');
        setClaudeCustomVal('');
      } else {
        setClaudeModelMode('custom');
        setClaudeCustomVal(formState.claude_model);
      }

      if (formState.agy_model === '' || engineModels.agy.includes(formState.agy_model)) {
        setAgyModelMode('select');
        setAgyCustomVal('');
      } else {
        setAgyModelMode('custom');
        setAgyCustomVal(formState.agy_model);
      }
    }
  }, [formState, engineModels]);

  if (error && !formState) {
    return (
      <div style={{ padding: '14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: '6px', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span>Gagal memuat pengaturan: {String(error)}</span>
        <Button variant="danger" type="button" onClick={refresh}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading || !formState) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat pengaturan engine...</div>;
  }

  const handleChange = (field: keyof Settings, value: any) => {
    setFormState((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState) return;

    setSaving(true);
    const finalSettings: Settings = {
      ...formState,
      claude_model: (claudeModelMode === 'custom' ? claudeCustomVal : formState.claude_model || '').trim(),
      agy_model: (agyModelMode === 'custom' ? agyCustomVal : formState.agy_model || '').trim(),
    };

    try {
      const ok = await saveSettings(finalSettings);
      if (ok) {
        toast('Pengaturan Execution Engines berhasil disimpan!', 'ok');
      } else {
        toast('Gagal menyimpan pengaturan engine.', 'err');
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
        <h3 className="settings-section-heading">Execution Engines (Coding Agents)</h3>
        <p className="settings-panel-desc">Pilih engine CLI default dan model yang digunakan untuk tugas pemrograman.</p>
      </div>

      <Field label="Default Coding Engine" helpText="Mesin eksekusi utama yang dipanggil saat mengerjakan kode">
        <select
          className="field-select"
          value={formState.default_engine}
          onChange={(e) => handleChange('default_engine', e.target.value)}
        >
          <option value="auto">Auto (Dianalisis otomatis oleh Planner)</option>
          <option value="claude">Claude CLI (claude -p)</option>
          <option value="antigravity">Antigravity CLI (agy -p)</option>
        </select>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        {/* Claude CLI Card */}
        <div style={{
          background: '#06090e',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '6px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Terminal size={14} style={{ color: '#f59e0b' }} />
            <span>Claude CLI Settings</span>
          </div>

          <Field label="Claude Model ID">
            <select
              className="field-select"
              value={claudeModelMode === 'custom' ? '__custom__' : formState.claude_model}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__custom__') {
                  setClaudeModelMode('custom');
                } else {
                  setClaudeModelMode('select');
                  handleChange('claude_model', val);
                }
              }}
            >
              <option value="">Default CLI Model</option>
              {engineModels?.claude.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="__custom__">Custom Model...</option>
            </select>
          </Field>

          {claudeModelMode === 'custom' && (
            <input
              type="text"
              className="field-input"
              placeholder="claude-3-7-sonnet-20250219"
              value={claudeCustomVal}
              onChange={(e) => setClaudeCustomVal(e.target.value)}
            />
          )}

          <Field label="Effort Level" helpText="Beban berpikir (Thinking effort Claude 3.7+)">
            <select
              className="field-select"
              value={formState.claude_effort}
              onChange={(e) => handleChange('claude_effort', e.target.value)}
            >
              <option value="">Default CLI (Off)</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra High</option>
              <option value="max">Max</option>
            </select>
          </Field>
        </div>

        {/* Antigravity CLI Card */}
        <div style={{
          background: '#06090e',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '6px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={14} style={{ color: '#38bdf8' }} />
            <span>Antigravity CLI Settings</span>
          </div>

          <Field label="Antigravity Model ID">
            <select
              className="field-select"
              value={agyModelMode === 'custom' ? '__custom__' : formState.agy_model}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__custom__') {
                  setAgyModelMode('custom');
                } else {
                  setAgyModelMode('select');
                  handleChange('agy_model', val);
                }
              }}
            >
              <option value="">Default CLI Model</option>
              {engineModels?.agy.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="__custom__">Custom Model...</option>
            </select>
          </Field>

          {agyModelMode === 'custom' && (
            <input
              type="text"
              className="field-input"
              placeholder="gemini-2.5-pro"
              value={agyCustomVal}
              onChange={(e) => setAgyCustomVal(e.target.value)}
            />
          )}

          <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0, lineHeight: 1.4 }}>
            Antigravity CLI dieksekusi secara lokal melalui RTK proxy token optimizer.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
        <Button variant="primary" type="submit" loading={saving}>
          <Save size={13} />
          <span>Simpan Pengaturan Engine</span>
        </Button>
      </div>
    </form>
  );
}
