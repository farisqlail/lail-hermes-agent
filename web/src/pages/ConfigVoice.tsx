import React, { useEffect, useState } from 'react';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import {
  TtsVoice,
  TTS_VOICES_FALLBACK,
  loadTtsEnabled,
  loadTtsVoice,
  saveTtsSettings,
} from '../tts';

export function ConfigVoice() {
  const { toast } = useToast();

  const [ttsEnabled, setTtsEnabled] = useState<boolean>(loadTtsEnabled);
  const [ttsVoice, setTtsVoice] = useState<string>(loadTtsVoice);
  const [voices, setVoices] = useState<TtsVoice[]>(TTS_VOICES_FALLBACK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/tts/voices')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setVoices(data);
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      saveTtsSettings(ttsEnabled, ttsVoice);
      toast('Konfigurasi suara berhasil disimpan!', 'ok');
    } catch (err) {
      toast('Gagal menyimpan konfigurasi suara.', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '600px' }}>
      <section style={{ backgroundColor: 'var(--surface-1)', padding: '20px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--t-lg)', fontWeight: '600', marginBottom: '16px', color: 'var(--accent)' }}>🔊 Voice Output (TTS) Settings</h3>

        <Field
          label="Status Suara Asisten"
          helpText="Aktifkan agar asisten AI mengeluarkan suara saat merespons obrolan"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => setTtsEnabled(e.target.checked)}
                style={{
                  width: '18px',
                  height: '18px',
                  accentColor: 'var(--accent)',
                  cursor: 'pointer'
                }}
              />
              <span>Aktifkan Suara Asisten (Speech Synthesis)</span>
            </label>
          </div>
        </Field>

        <div style={{ height: '20px' }} />

        <Field
          label="Model Suara (Voice Model)"
          helpText="Pilih model suara neural yang digunakan untuk berbicara (Ryan beraksen Inggris khas Jarvis)"
        >
          <select
            className="field-select"
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 'var(--r-md)',
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            {voices.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </Field>
      </section>

      <div>
        <Button variant="primary" type="submit" loading={saving} style={{ width: '180px' }}>
          Simpan Konfigurasi
        </Button>
      </div>
    </form>
  );
}
