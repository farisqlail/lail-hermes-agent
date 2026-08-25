import React, { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { Settings } from '../api/types';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { Smartphone, Save } from 'lucide-react';

export function ConfigAndroid() {
  const { settings, loading, error, saveSettings, refresh } = useSettings();
  const { toast } = useToast();
  const [formState, setFormState] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setFormState({ ...settings });
    }
  }, [settings]);

  if (error) {
    return (
      <div style={{ padding: '14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: '6px', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span>Gagal memuat pengaturan: {error}</span>
        <Button variant="danger" type="button" onClick={refresh}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading || !formState) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat konfigurasi Android...</div>;
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
        toast('Pengaturan Android SDK berhasil disimpan!', 'ok');
      } else {
        toast('Gagal menyimpan pengaturan.', 'err');
      }
    } catch {
      toast('Terjadi kesalahan saat menyimpan pengaturan Android.', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h3 className="settings-section-heading">Android SDK & Emulator Settings</h3>
        <p className="settings-panel-desc">Pengaturan environment untuk pengujian aplikasi Android pada virtual device.</p>
      </div>

      <Field label="Android SDK Path" helpText="Lokasi direktori Android SDK di sistem">
        <input
          type="text"
          className="field-input"
          value={formState.android_sdk_path || ''}
          onChange={(e) => handleChange('android_sdk_path', e.target.value)}
          placeholder="C:\\Users\\faris\\AppData\\Local\\Android\\Sdk"
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <Field label="AVD Device Name" helpText="Nama Android Virtual Device emulator">
          <input
            type="text"
            className="field-input"
            value={formState.emulator_avd || ''}
            onChange={(e) => handleChange('emulator_avd', e.target.value)}
            placeholder="Pixel_8_API_34"
          />
        </Field>

        <Field label="Default Test Mode" helpText="Target runner pengujian default">
          <select
            className="field-select"
            value={formState.default_test_mode || 'none'}
            onChange={(e) => handleChange('default_test_mode', e.target.value)}
          >
            <option value="none">None (Tanpa test runner)</option>
            <option value="browser">Headless Browser (Playwright)</option>
            <option value="emulator">Android Emulator (ADB)</option>
          </select>
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
        <Button variant="primary" type="submit" loading={saving}>
          <Save size={13} />
          <span>Simpan Pengaturan Android</span>
        </Button>
      </div>
    </form>
  );
}
