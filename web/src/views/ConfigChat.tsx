import React, { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { Settings } from '../api/types';
import { Field } from '../components/Field';
import { Toggle } from '../components/Toggle';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { MessageSquare, Save, ShieldCheck, Calendar, UserCheck } from 'lucide-react';

export function ConfigChat() {
  const { settings, loading, error, saveSettings, refresh } = useSettings();
  const { toast } = useToast();
  const [formState, setFormState] = useState<Settings | null>(null);
  const [userIdsText, setUserIdsText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setFormState({ ...settings });
      setUserIdsText(settings.allowed_user_ids.join(', '));
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
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat pengaturan chat...</div>;
  }

  const handleChange = (field: keyof Settings, value: any) => {
    setFormState((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState) return;

    setSaving(true);
    const userIds = userIdsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));

    const finalSettings: Settings = {
      ...formState,
      allowed_user_ids: userIds,
    };

    try {
      const ok = await saveSettings(finalSettings);
      if (ok) {
        toast('Pengaturan Chat & Persona berhasil disimpan!', 'ok');
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
        <h3 className="settings-section-heading">Chat & Persona Settings</h3>
        <p className="settings-panel-desc">Konfigurasi nama identitas asisten, kreativitas respons obrolan, dan kalender.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <Field label="Agent Name" helpText="Nama asisten AI yang tampil di antarmuka">
          <input
            type="text"
            className="field-input"
            value={formState.agent_name || ''}
            onChange={(e) => handleChange('agent_name', e.target.value)}
            placeholder="Lail Hermes"
          />
        </Field>

        <Field label="Chat Model ID (Optional)" helpText="Model khusus untuk percakapan (kosongkan untuk default)">
          <input
            type="text"
            className="field-input"
            value={formState.chat_model || ''}
            onChange={(e) => handleChange('chat_model', e.target.value)}
            placeholder="mis. deepseek-ai/deepseek-v3"
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <Field label="Chat Temperature (0.0 - 1.0)" helpText="Tingkat kreativitas respons (Default: 0.3)">
          <input
            type="number"
            step="0.05"
            min="0"
            max="1.5"
            className="field-input"
            value={formState.chat_temperature ?? 0.3}
            onChange={(e) => handleChange('chat_temperature', parseFloat(e.target.value) || 0.3)}
            required
          />
        </Field>

        <Field label="Google Calendar iCal URL" helpText="Alamat rahasia format iCal untuk agenda">
          <input
            type="text"
            className="field-input"
            value={formState.calendar_ics_url || ''}
            onChange={(e) => handleChange('calendar_ics_url', e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          />
        </Field>
      </div>

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
          <ShieldCheck size={14} style={{ color: 'var(--accent)' }} />
          <span>Keamanan & Whitelist Telegram</span>
        </div>

        <Field label="Telegram User Whitelist" helpText="Daftar ID Telegram numeric yang diizinkan (pisahkan dengan koma)">
          <input
            type="text"
            className="field-input"
            value={userIdsText}
            onChange={(e) => setUserIdsText(e.target.value)}
            placeholder="123456789, 987654321"
          />
        </Field>

        <Toggle
          checked={formState.confirm_risky}
          onChange={(e) => handleChange('confirm_risky', e)}
          label="Konfirmasi Aksi Berisiko (Confirm Risky Actions)"
          helpText="Minta persetujuan pengguna sebelum melakukan git push, modifikasi file sensitif, atau penghapusan berkas."
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
        <Button variant="primary" type="submit" loading={saving}>
          <Save size={13} />
          <span>Simpan Pengaturan Chat</span>
        </Button>
      </div>
    </form>
  );
}
