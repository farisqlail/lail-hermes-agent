import React, { useEffect, useState } from 'react';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../api/client';
import { SttStatus, fetchSttStatus } from '../stt';
import {
  TtsVoice,
  TTS_VOICES_FALLBACK,
  TtsMode,
  TtsPersonality,
  loadTtsEnabled,
  loadTtsVoice,
  loadTtsMode,
  loadTtsMaxWords,
  loadTtsGreeting,
  loadTtsTaskNotify,
  loadTtsPersonality,
  saveTtsSettings,
  saveSmartTtsSettings,
} from '../tts';

export function ConfigVoice() {
  const { toast } = useToast();

  const [ttsEnabled, setTtsEnabled] = useState<boolean>(loadTtsEnabled);
  const [ttsVoice, setTtsVoice] = useState<string>(loadTtsVoice);
  const [voices, setVoices] = useState<TtsVoice[]>(TTS_VOICES_FALLBACK);

  // Smart TTS settings
  const [ttsMode, setTtsMode] = useState<TtsMode>(loadTtsMode);
  const [maxWords, setMaxWords] = useState<number>(loadTtsMaxWords);
  const [greeting, setGreeting] = useState<boolean>(loadTtsGreeting);
  const [taskNotify, setTaskNotify] = useState<boolean>(loadTtsTaskNotify);
  const [personality, setPersonality] = useState<TtsPersonality>(loadTtsPersonality);

  const [saving, setSaving] = useState(false);
  const [testLoading, setTestLoading] = useState(false);

  // Voice input lives in server Settings, not localStorage: the model runs on
  // the server, and a wake-word service later will need to read the same
  // values without a browser.
  const [sttEnabled, setSttEnabled] = useState(true);
  const [sttLanguage, setSttLanguage] = useState('id');
  const [sttStatus, setSttStatus] = useState<SttStatus | null>(null);

  useEffect(() => {
    fetchSttStatus()
      .then((s) => {
        setSttStatus(s);
        setSttEnabled(s.enabled);
        setSttLanguage(s.language);
      })
      .catch(() => setSttStatus(null));
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      saveTtsSettings(ttsEnabled, ttsVoice);
      saveSmartTtsSettings(ttsMode, maxWords, greeting, taskNotify, personality);
      const current = await api.getSettings();
      await api.saveSettings({
        ...current,
        stt_enabled: sttEnabled,
        stt_language: sttLanguage,
      });
      toast('Konfigurasi suara berhasil disimpan!', 'ok');
    } catch (err) {
      toast(errorMessage(err, 'Gagal menyimpan konfigurasi suara.'), 'err');
    } finally {
      setSaving(false);
    }
  };

  const testVoice = async () => {
    setTestLoading(true);
    try {
      const endpoint = ttsMode === 'smart' ? '/api/tts/smart' : '/api/tts';
      const payload: Record<string, unknown> = {
        text: 'Halo! Saya sudah siap membantu Anda hari ini. Ada yang bisa saya kerjakan?',
        voice: ttsVoice,
      };
      if (ttsMode === 'smart') {
        payload.max_words = maxWords;
        payload.personality = personality;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Server ${res.status}: ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast(`Gagal memutar test voice: ${detail}`, 'err');
    } finally {
      setTestLoading(false);
    }
  };

  const sectionStyle: React.CSSProperties = {
    backgroundColor: 'var(--surface-1)',
    padding: '20px',
    borderRadius: 'var(--r-lg)',
    border: '1px solid var(--border)',
  };

  const headingStyle: React.CSSProperties = {
    fontFamily: 'var(--font-title)',
    fontSize: 'var(--t-lg)',
    fontWeight: '600',
    marginBottom: '16px',
    color: 'var(--accent)',
  };

  const checkboxStyle: React.CSSProperties = {
    width: '18px',
    height: '18px',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  };

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 'var(--r-md)',
    backgroundColor: 'var(--surface-2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '600px' }}>
      {/* Section 1: Basic Voice Settings */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>🔊 Voice Output (TTS) Settings</h3>

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
                style={checkboxStyle}
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
            style={selectStyle}
          >
            {voices.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </Field>
      </section>

      {/* Section 2: Smart TTS Mode (Jarvis) */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>🧠 Mode Suara Cerdas (Jarvis)</h3>

        <Field
          label="Mode Respons Suara"
          helpText="Smart: AI merangkum respons jadi 1-2 kalimat natural. Verbatim: baca seluruh teks."
        >
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)' }}>
              <input
                type="radio"
                name="tts_mode"
                value="smart"
                checked={ttsMode === 'smart'}
                onChange={() => setTtsMode('smart')}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span>🤖 Smart (Jarvis) — Ringkasan cerdas</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)' }}>
              <input
                type="radio"
                name="tts_mode"
                value="verbatim"
                checked={ttsMode === 'verbatim'}
                onChange={() => setTtsMode('verbatim')}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span>📖 Verbatim — Baca semua</span>
            </label>
          </div>
        </Field>

        {ttsMode === 'smart' && (
          <>
            <div style={{ height: '16px' }} />

            <Field
              label={`Panjang Maksimal Ringkasan: ${maxWords} kata`}
              helpText="Batas jumlah kata untuk ringkasan suara (hanya aktif di mode Smart)"
            >
              <input
                type="range"
                min={15}
                max={80}
                value={maxWords}
                onChange={(e) => setMaxWords(parseInt(e.target.value, 10))}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--t-xs)', color: 'var(--text-faint)', marginTop: '4px' }}>
                <span>15 kata</span>
                <span>80 kata</span>
              </div>
            </Field>

            <div style={{ height: '16px' }} />

            <Field
              label="Gaya Bicara (Personality)"
              helpText="Pilih karakter suara asisten: Professional, Friendly, atau Jarvis Classic"
            >
              <select
                className="field-select"
                value={personality}
                onChange={(e) => setPersonality(e.target.value as TtsPersonality)}
                style={selectStyle}
              >
                <option value="professional">🎯 Professional — Formal, ringkas, to-the-point</option>
                <option value="friendly">😊 Friendly — Santai, hangat, supportive</option>
                <option value="jarvis">🎩 Jarvis Classic — Formal British, elegan</option>
              </select>
            </Field>
          </>
        )}
      </section>

      {/* Section 3: Proactive Voice Features */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>💬 Suara Proaktif</h3>

        <Field
          label="Greeting Otomatis"
          helpText="Asisten menyapa saat sesi baru dibuka (mis. 'Selamat siang! Ada yang bisa dibantu?')"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={greeting}
                onChange={(e) => setGreeting(e.target.checked)}
                style={checkboxStyle}
              />
              <span>Greeting saat sesi baru</span>
            </label>
          </div>
        </Field>

        <div style={{ height: '12px' }} />

        <Field
          label="Notifikasi Suara Task"
          helpText="Asisten mengumumkan saat task selesai atau gagal"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={taskNotify}
                onChange={(e) => setTaskNotify(e.target.checked)}
                style={checkboxStyle}
              />
              <span>Notifikasi suara saat task selesai</span>
            </label>
          </div>
        </Field>
      </section>

      {/* Section 4: Voice Input (STT) */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>🎤 Voice Input (STT)</h3>

        {sttStatus && !sttStatus.available && (
          <p style={{ color: 'var(--warn)', marginBottom: '12px' }}>
            faster-whisper belum terinstal. Jalankan <code>pip install -e .[voice]</code> lalu
            restart Hermes.
          </p>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <input
            type="checkbox"
            style={checkboxStyle}
            checked={sttEnabled}
            onChange={(e) => setSttEnabled(e.target.checked)}
          />
          <span>Aktifkan input suara (tombol mic dan Ctrl+Space)</span>
        </label>

        <label style={{ display: 'block', marginBottom: '8px' }}>Bahasa Ucapan</label>
        <select
          style={selectStyle}
          value={sttLanguage}
          onChange={(e) => setSttLanguage(e.target.value)}
        >
          <option value="id">Indonesia</option>
          <option value="en">Inggris</option>
          <option value="">Deteksi otomatis</option>
        </select>

        <p style={{ opacity: 0.7, marginTop: '12px', fontSize: 'var(--t-sm)' }}>
          Model: <code>{sttStatus?.model ?? '—'}</code>
          {sttStatus?.loaded === false && ' · transkripsi pertama lebih lambat karena model dimuat dulu'}
        </p>
      </section>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <Button variant="primary" type="submit" loading={saving} style={{ width: '180px' }}>
          Simpan Konfigurasi
        </Button>
        <Button variant="secondary" type="button" onClick={testVoice} loading={testLoading} style={{ width: '140px' }}>
          ▶ Test Voice
        </Button>
      </div>
    </form>
  );
}
