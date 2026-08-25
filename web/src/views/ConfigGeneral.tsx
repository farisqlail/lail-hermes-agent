import React, { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { api, errorMessage, errorDetail } from '../api/client';
import { EngineModels, Settings } from '../api/types';
import { Field } from '../components/Field';
import { Toggle } from '../components/Toggle';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import {
  Brain,
  Cpu,
  Terminal,
  Sparkles,
  Clock,
  Smartphone,
  ShieldCheck,
  Save,
} from 'lucide-react';

export function ConfigGeneral() {
  const { settings, loading, error, saveSettings, refresh } = useSettings();
  const { toast } = useToast();
  
  const [formState, setFormState] = useState<Settings | null>(null);
  const [engineModels, setEngineModels] = useState<EngineModels | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [claudeModelMode, setClaudeModelMode] = useState<'select' | 'custom'>('select');
  const [claudeCustomVal, setClaudeCustomVal] = useState('');
  const [agyModelMode, setAgyModelMode] = useState<'select' | 'custom'>('select');
  const [agyCustomVal, setAgyCustomVal] = useState('');
  
  const [userIdsText, setUserIdsText] = useState('');

  useEffect(() => {
    async function loadModels() {
      setLoadingModels(true);
      try {
        const models = await api.getEngineModels();
        setEngineModels(models);
      } catch (err) {
        console.error('Gagal memuat daftar model mesin:', err);
      } finally {
        setLoadingModels(false);
      }
    }
    loadModels();
  }, []);

  useEffect(() => {
    if (settings) {
      setFormState({ ...settings });
      setUserIdsText(settings.allowed_user_ids.join(', '));
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

  if (error) {
    return (
      <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        <span>Gagal memuat pengaturan: {error}</span>
        <Button variant="danger" type="button" onClick={refresh}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading || !formState) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat pengaturan...</div>;
  }

  const handleChange = (field: keyof Settings, value: string | number | number[] | boolean) => {
    setFormState((prev) => {
      if (!prev) return null;
      return { ...prev, [field]: value };
    });
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState) return;

    setSaving(true);
    setFormErrors({});

    const userIds = userIdsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));

    const finalSettings: Settings = {
      ...formState,
      allowed_user_ids: userIds,
      claude_model: claudeModelMode === 'custom' ? claudeCustomVal : formState.claude_model,
      agy_model: agyModelMode === 'custom' ? agyCustomVal : formState.agy_model,
    };

    try {
      const ok = await saveSettings(finalSettings);
      if (ok) {
        toast('Pengaturan berhasil disimpan!', 'ok');
      } else {
        toast('Gagal menyimpan pengaturan.', 'err');
      }
    } catch (err) {
      toast(errorMessage(err, 'Gagal menyimpan pengaturan.'), 'err');
      const detail = errorDetail(err);
      if (detail) {
        const lowered = detail.toLowerCase();
        if (lowered.includes('claude model')) {
          setFormErrors({ claude_model: detail });
        } else if (lowered.includes('agy model')) {
          setFormErrors({ agy_model: detail });
        } else {
          setFormErrors({ general: detail });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {formErrors.general && (
        <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', fontSize: 'var(--t-sm)' }}>
          {formErrors.general}
        </div>
      )}

      {/* AI Brain Section */}
      <section style={{ backgroundColor: 'var(--surface-1)', padding: '18px 20px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Brain size={16} style={{ color: 'var(--accent)' }} />
          <span>LLM Brain Settings (Planner)</span>
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <Field label="AI Provider" helpText="Pilih penyedia layanan model AI Anda">
            <select
              className="field-select"
              value={formState.ai_provider || 'nvidia'}
              onChange={(e) => {
                const val = e.target.value as 'nvidia' | 'deepseek' | 'custom';
                handleChange('ai_provider', val);
                if (val === 'nvidia') {
                  handleChange('nvidia_base_url', 'https://integrate.api.nvidia.com/v1');
                  handleChange('model', 'deepseek-ai/deepseek-v3');
                } else if (val === 'deepseek') {
                  handleChange('nvidia_base_url', 'https://api.deepseek.com/v1');
                  handleChange('model', 'deepseek-chat');
                }
              }}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 'var(--r-md)',
                backgroundColor: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="nvidia">NVIDIA NIM</option>
              <option value="deepseek">DeepSeek Official</option>
              <option value="custom">Custom (OpenAI Compatible)</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <Field label="API Base URL" helpText="Endpoint URL untuk API planner">
            <input
              type="text"
              className="field-input"
              value={formState.nvidia_base_url}
              onChange={(e) => handleChange('nvidia_base_url', e.target.value)}
              required
            />
          </Field>
          
          <Field label="Model ID" helpText="Model ID untuk perencanaan tugas">
            <input
              type="text"
              className="field-input"
              value={formState.model}
              onChange={(e) => handleChange('model', e.target.value)}
              required
            />
          </Field>

          <Field label="Planner Temperature" helpText="Suhu kreativitas planner (Disarankan 0.0)">
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              className="field-input"
              value={formState.planner_temperature}
              onChange={(e) => handleChange('planner_temperature', parseFloat(e.target.value) || 0.0)}
              required
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginTop: '16px' }}>
          <Field label="Chat Model ID" helpText="Biarkan kosong untuk menyamai NIM Model ID">
            <input
              type="text"
              className="field-input"
              placeholder={formState.model}
              value={formState.chat_model}
              onChange={(e) => handleChange('chat_model', e.target.value)}
            />
          </Field>

          <Field label="Chat Temperature" helpText="Suhu kreativitas untuk live chat pane (Disarankan 0.3)">
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              className="field-input"
              value={formState.chat_temperature}
              onChange={(e) => handleChange('chat_temperature', parseFloat(e.target.value) || 0.3)}
              required
            />
          </Field>

          <Field label="Agent Name" helpText="Nama identitas asisten chat AI Anda (Default: Lail Hermes)">
            <input
              type="text"
              className="field-input"
              placeholder="Lail Hermes"
              value={formState.agent_name || ''}
              onChange={(e) => handleChange('agent_name', e.target.value)}
            />
          </Field>

          <Field
            label="Calendar iCal URL"
            helpText="Google Calendar → Setelan kalender → Alamat rahasia format iCal."
            error={formErrors.calendar_ics_url}
          >
            <input
              type="text"
              className="field-input"
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              value={formState.calendar_ics_url || ''}
              onChange={(e) => handleChange('calendar_ics_url', e.target.value)}
            />
          </Field>
        </div>
      </section>

      {/* Execution Engines Tuning */}
      <section style={{ backgroundColor: 'var(--surface-1)', padding: '18px 20px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Cpu size={16} style={{ color: 'var(--accent)' }} />
          <span>Execution Engines (Coding Agents)</span>
        </h3>
        
        <Field label="Default Engine" helpText="Agent pengodean utama">
          <select
            className="field-select"
            value={formState.default_engine}
            onChange={(e) => handleChange('default_engine', e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 'var(--r-md)',
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="auto">Auto (Berdasarkan analisis planner)</option>
            <option value="claude">Claude CLI (claude -p)</option>
            <option value="antigravity">Antigravity CLI (agy -p)</option>
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '16px' }}>
          {/* Claude CLI tuning */}
          <div style={{ padding: '16px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)' }}>
              <Terminal size={14} style={{ opacity: 0.8 }} />
              <span>Claude CLI Settings</span>
            </h4>
            
            <Field label="Claude Model Alias/ID" error={formErrors.claude_model}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--r-md)',
                    backgroundColor: 'var(--surface-1)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">Default CLI Model</option>
                  {engineModels?.claude.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom Model...</option>
                </select>
                
                {claudeModelMode === 'custom' && (
                  <input
                    type="text"
                    className="field-input"
                    placeholder="Masukkan custom model ID..."
                    value={claudeCustomVal}
                    onChange={(e) => setClaudeCustomVal(e.target.value)}
                  />
                )}
              </div>
            </Field>

            <div style={{ marginTop: '12px' }}>
              <Field label="Claude Effort Level" helpText="Beban berpikir model (Hanya di Claude 3.7+)">
                <select
                  className="field-select"
                  value={formState.claude_effort}
                  onChange={(e) => handleChange('claude_effort', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--r-md)',
                    backgroundColor: 'var(--surface-1)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
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
          </div>

          {/* Antigravity CLI tuning */}
          <div style={{ padding: '16px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                <span>Antigravity CLI Settings</span>
              </div>
              {engineModels && !engineModels.agy_live && (
                <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: 'var(--warn)', color: 'var(--surface-0)', borderRadius: 'var(--r-sm)', fontWeight: 'bold' }}>
                  Offline Fallback
                </span>
              )}
            </h4>

            <Field label="Antigravity Model ID" error={formErrors.agy_model}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--r-md)',
                    backgroundColor: 'var(--surface-1)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">Default CLI Model</option>
                  {engineModels?.agy.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom Model...</option>
                </select>

                {agyModelMode === 'custom' && (
                  <input
                    type="text"
                    className="field-input"
                    placeholder="Masukkan custom model ID..."
                    value={agyCustomVal}
                    onChange={(e) => setAgyCustomVal(e.target.value)}
                  />
                )}
              </div>
            </Field>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '8px' }}>
              Model agy dimuat secara lokal. Default: {engineModels && engineModels.agy[0]}.
            </p>
          </div>
        </div>
      </section>

      {/* Timeout settings */}
      <section style={{ backgroundColor: 'var(--surface-1)', padding: '18px 20px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={16} style={{ color: 'var(--accent)' }} />
          <span>Execution Timeouts & Budget</span>
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
          <Field label="Coding Timeout (detik)" helpText="Batas waktu penulisan kode">
            <input
              type="number"
              className="field-input"
              value={formState.timeout_code_s}
              onChange={(e) => handleChange('timeout_code_s', parseInt(e.target.value, 10) || 900)}
              required
            />
          </Field>

          <Field label="Build Timeout (detik)" helpText="Batas waktu build package">
            <input
              type="number"
              className="field-input"
              value={formState.timeout_build_s}
              onChange={(e) => handleChange('timeout_build_s', parseInt(e.target.value, 10) || 1200)}
              required
            />
          </Field>

          <Field
            label="Batas Biaya per Task (USD)"
            helpText="0 = tanpa batas biaya."
          >
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

          <Field label="Testing Timeout (detik)" helpText="Batas waktu test runner">
            <input
              type="number"
              className="field-input"
              value={formState.timeout_test_s}
              onChange={(e) => handleChange('timeout_test_s', parseInt(e.target.value, 10) || 600)}
              required
            />
          </Field>
        </div>
      </section>

      {/* Android SDK & Testing */}
      <section style={{ backgroundColor: 'var(--surface-1)', padding: '18px 20px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Smartphone size={16} style={{ color: 'var(--accent)' }} />
          <span>Android SDK & Emulator Settings</span>
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <Field label="Android SDK Path" helpText="Lokasi absolut Android SDK di komputer">
            <input
              type="text"
              className="field-input"
              value={formState.android_sdk_path}
              onChange={(e) => handleChange('android_sdk_path', e.target.value)}
              placeholder="mis. C:\Users\User\AppData\Local\Android\Sdk"
            />
          </Field>

          <Field label="AVD Device Name" helpText="Nama Android Virtual Device emulator">
            <input
              type="text"
              className="field-input"
              value={formState.emulator_avd}
              onChange={(e) => handleChange('emulator_avd', e.target.value)}
              placeholder="mis. Pixel_8_API_34"
            />
          </Field>

          <Field label="Default Test Mode" helpText="Target default runner pengujian">
            <select
              className="field-select"
              value={formState.default_test_mode}
              onChange={(e) => handleChange('default_test_mode', e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 'var(--r-md)',
                backgroundColor: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="none">None (Tidak ada pengujian)</option>
              <option value="browser">Headless Browser (Playwright)</option>
              <option value="emulator">Android Emulator (ADB)</option>
            </select>
          </Field>
        </div>
      </section>

      {/* Security & Access Whitelist */}
      <section style={{ backgroundColor: 'var(--surface-1)', padding: '18px 20px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
          <span>Security & Whitelisting</span>
        </h3>
        
        <Field label="Telegram User Whitelist" helpText="Daftar ID user numeric Telegram. Pisahkan dengan koma.">
          <input
            type="text"
            className="field-input"
            value={userIdsText}
            onChange={(e) => setUserIdsText(e.target.value)}
            placeholder="mis. 123456789, 987654321"
          />
        </Field>

        <div style={{ marginTop: '16px' }}>
          <Toggle
            checked={formState.confirm_risky}
            onChange={(e) => handleChange('confirm_risky', e)}
            label="Confirm Risky Actions"
            helpText="Tanyakan konfirmasi sebelum aksi sensitif seperti git push, menghapus berkas, atau akses direktori luar."
          />
        </div>
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <Button variant="primary" type="submit" loading={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
          <Save size={14} />
          <span>Simpan Setting</span>
        </Button>
      </div>
    </form>
  );
}
