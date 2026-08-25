import React, { useEffect, useState } from 'react';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../api/client';
import { SttStatus, fetchSttStatus } from '../stt';
import {
  Volume2,
  Brain,
  MessageSquare,
  Mic,
  Radio,
  Play,
  Save,
  Activity,
  AlertCircle,
} from 'lucide-react';
import {
  TtsVoice,
  TTS_VOICES_FALLBACK,
  TtsMode,
  TtsPersonality,
  loadTtsSettings,
  saveTtsSettings,
  ttsRequest,
  loadVoiceSettings,
  saveVoiceSettings,
  VoiceSettings,
  VOICE_SETTINGS_DEFAULT,
  VadSensitivity,
} from '../tts';

export function ConfigVoice() {
  const { toast } = useToast();

  const [ttsEnabled, setTtsEnabled] = useState<boolean>(false);
  const [ttsVoice, setTtsVoice] = useState<string>('en-US-AndrewMultilingualNeural');
  const [voices, setVoices] = useState<TtsVoice[]>(TTS_VOICES_FALLBACK);

  // Smart TTS settings
  const [ttsMode, setTtsMode] = useState<TtsMode>('smart');
  const [maxWords, setMaxWords] = useState<number>(40);
  const [greeting, setGreeting] = useState<boolean>(true);
  const [taskNotify, setTaskNotify] = useState<boolean>(false);
  const [narrate, setNarrate] = useState<boolean>(false);
  const [personality, setPersonality] = useState<TtsPersonality>('professional');

  const [saving, setSaving] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [voice, setVoice] = useState<VoiceSettings>(VOICE_SETTINGS_DEFAULT);

  const [sttEnabled, setSttEnabled] = useState(true);
  const [sttLanguage, setSttLanguage] = useState('id');
  const [sttModel, setSttModel] = useState<'tiny' | 'base' | 'small' | 'medium' | 'large'>('base');
  const [sttStatus, setSttStatus] = useState<SttStatus | null>(null);

  useEffect(() => {
    fetchSttStatus()
      .then((s) => {
        setSttStatus(s);
      })
      .catch(() => setSttStatus(null));

    loadTtsSettings().then((s) => {
      setTtsEnabled(s.tts_enabled);
      setTtsVoice(s.tts_voice);
      setTtsMode(s.tts_mode);
      setMaxWords(s.tts_max_words);
      setGreeting(s.tts_greeting);
      setTaskNotify(s.tts_task_notify);
      setNarrate(s.tts_narrate);
      setPersonality(s.tts_personality);
    }).catch(() => {});

    api.getSettings().then((s) => {
      setSttEnabled(s.stt_enabled);
      setSttLanguage(s.stt_language);
      setSttModel(s.stt_model ?? 'base');
    }).catch(() => {});

    loadVoiceSettings().then(setVoice).catch(() => {});
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
      await saveTtsSettings({
        tts_enabled: ttsEnabled,
        tts_voice: ttsVoice,
        tts_mode: ttsMode,
        tts_max_words: maxWords,
        tts_greeting: greeting,
        tts_task_notify: taskNotify,
        tts_narrate: narrate,
        tts_personality: personality,
      });
      await saveVoiceSettings(voice);
      const current = await api.getSettings();
      await api.saveSettings({
        ...current,
        stt_enabled: sttEnabled,
        stt_language: sttLanguage,
        stt_model: sttModel,
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
      const { endpoint, payload } = ttsRequest(ttsMode, 'summary', {
        voice: ttsVoice,
        agentName: '',
        maxWords,
        personality,
        text: 'Halo! Saya sudah siap membantu Anda hari ini. Ada yang bisa saya kerjakan?',
      });
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
    padding: '18px 20px',
    borderRadius: 'var(--r-lg)',
    border: '1px solid var(--border)',
  };

  const headingStyle: React.CSSProperties = {
    fontFamily: 'var(--font-title)',
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '16px',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const checkboxStyle: React.CSSProperties = {
    width: '16px',
    height: '16px',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  };

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 'var(--r-md)',
    backgroundColor: 'var(--surface-2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '650px' }}>
      {/* Section 1: Basic Voice Settings */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>
          <Volume2 size={16} style={{ color: 'var(--accent)' }} />
          <span>Voice Output (TTS) Settings</span>
        </h3>

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

        <div style={{ height: '16px' }} />

        <Field
          label="Model Suara (Voice Model)"
          helpText="Pilih model suara neural yang digunakan untuk berbicara"
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

      {/* Section 2: Smart TTS Mode */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>
          <Brain size={16} style={{ color: 'var(--accent)' }} />
          <span>Mode Suara Cerdas (Smart TTS)</span>
        </h3>

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
              <span>Smart — Ringkasan cerdas</span>
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
              <span>Verbatim — Baca lengkap</span>
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
                <option value="professional">Professional — Formal, ringkas, to-the-point</option>
                <option value="friendly">Friendly — Santai, hangat, supportive</option>
                <option value="jarvis">Classic — Formal British, elegan</option>
              </select>
            </Field>
          </>
        )}
      </section>

      {/* Section 3: Proactive Voice Features */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>
          <MessageSquare size={16} style={{ color: 'var(--accent)' }} />
          <span>Suara Proaktif</span>
        </h3>

        <Field
          label="Greeting Otomatis"
          helpText="Asisten menyapa saat sesi baru dibuka"
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

        <div style={{ height: '12px' }} />

        <Field
          label="Narasi Langkah"
          helpText="Asisten mengucapkan setiap langkah saat dimulai"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={narrate}
                onChange={(e) => setNarrate(e.target.checked)}
                style={checkboxStyle}
              />
              <span>Narasikan tiap langkah saat berjalan</span>
            </label>
          </div>
        </Field>
      </section>

      {/* Section 4: Percakapan & VAD */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>
          <Activity size={16} style={{ color: 'var(--accent)' }} />
          <span>Percakapan & Interupsi (Barge-in)</span>
        </h3>

        <Field
          label="Sela Otomatis (Barge-in)"
          helpText="Bicara kapan saja untuk menghentikan asisten yang sedang berbicara."
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)', marginTop: '8px' }}>
            <input
              type="checkbox"
              checked={voice.voice_barge_in}
              onChange={(e) => setVoice({ ...voice, voice_barge_in: e.target.checked })}
              style={checkboxStyle}
            />
            <span>Boleh menyela asisten dengan suara</span>
          </label>
        </Field>

        <div style={{ height: '12px' }} />

        <Field
          label="Mode Bebas Tangan (Hands-free)"
          helpText="Mikrofon terus mendengar; ucapan dikirim otomatis saat Anda berhenti bicara."
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)', marginTop: '8px' }}>
            <input
              type="checkbox"
              checked={voice.voice_handsfree}
              onChange={(e) => setVoice({ ...voice, voice_handsfree: e.target.checked })}
              style={checkboxStyle}
            />
            <span>Aktifkan mode bebas tangan</span>
          </label>
        </Field>

        <div style={{ height: '16px' }} />

        <Field
          label={`Jeda Akhir Bicara: ${voice.voice_silence_ms} ms`}
          helpText="Berapa lama hening sebelum ucapan dianggap selesai"
        >
          <input
            type="range"
            min={300}
            max={3000}
            step={100}
            value={voice.voice_silence_ms}
            onChange={(e) => setVoice({ ...voice, voice_silence_ms: parseInt(e.target.value, 10) })}
            style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
        </Field>

        <div style={{ height: '16px' }} />

        <Field
          label="Sensitivitas Mikrofon"
          helpText="Turunkan bila ruangan berisik"
        >
          <select
            className="field-select"
            value={voice.voice_sensitivity}
            onChange={(e) => setVoice({ ...voice, voice_sensitivity: e.target.value as VadSensitivity })}
            style={selectStyle}
          >
            <option value="low">Rendah — ruangan berisik</option>
            <option value="medium">Sedang — default</option>
            <option value="high">Tinggi — ruangan sunyi / headset</option>
          </select>
        </Field>
      </section>

      {/* Section 5: Wake Word */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>
          <Radio size={16} style={{ color: 'var(--accent)' }} />
          <span>Kata Pemicu (Wake Word) — Mode Siaga</span>
        </h3>
        <p style={{ color: 'var(--text-faint)', marginBottom: '12px', fontSize: 'var(--t-sm)' }}>
          Dijalankan oleh tray helper: <code>python -m hermes.tray</code>.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', cursor: 'pointer', color: 'var(--text)' }}>
          <input
            type="checkbox"
            style={checkboxStyle}
            checked={voice.wakeword_enabled}
            onChange={(e) => setVoice({ ...voice, wakeword_enabled: e.target.checked })}
          />
          <span>Aktifkan kata pemicu (mode siaga selalu mendengar)</span>
        </label>

        <Field
          label="Model Wake Word"
          helpText="'auto' = ikut Nama Agent atau nama bawaan openWakeWord"
        >
          <input
            type="text"
            className="field-input"
            value={voice.wakeword_model}
            onChange={(e) => setVoice({ ...voice, wakeword_model: e.target.value })}
            placeholder="auto"
            style={{ width: '100%' }}
          />
        </Field>
      </section>

      {/* Section 6: Voice Input (STT) */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>
          <Mic size={16} style={{ color: 'var(--accent)' }} />
          <span>Voice Input (STT)</span>
        </h3>

        {sttStatus && !sttStatus.available && (
          <p style={{ color: 'var(--warn)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={14} />
            faster-whisper belum terinstal.
          </p>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <input
            type="checkbox"
            style={checkboxStyle}
            checked={sttEnabled}
            onChange={(e) => setSttEnabled(e.target.checked)}
          />
          <span>Aktifkan input suara (tombol mic)</span>
        </label>

        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-dim)' }}>Bahasa Ucapan</label>
        <select
          style={selectStyle}
          value={sttLanguage}
          onChange={(e) => setSttLanguage(e.target.value)}
        >
          <option value="id">Indonesia</option>
          <option value="en">Inggris</option>
          <option value="">Deteksi otomatis</option>
        </select>

        <label style={{ display: 'block', margin: '16px 0 8px', fontSize: '13px', color: 'var(--text-dim)' }}>
          Model Transkripsi (kecepatan vs akurasi)
        </label>
        <select
          style={selectStyle}
          value={sttModel}
          onChange={(e) => setSttModel(e.target.value as typeof sttModel)}
        >
          <option value="tiny">Tiny — tercepat, akurasi rendah</option>
          <option value="base">Base — cepat, seimbang (default)</option>
          <option value="small">Small — lebih akurat</option>
          <option value="medium">Medium — paling akurat</option>
        </select>
      </section>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <Button variant="primary" type="submit" loading={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
          <Save size={14} />
          <span>Simpan Konfigurasi</span>
        </Button>
        <Button variant="secondary" type="button" onClick={testVoice} loading={testLoading} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px' }}>
          <Play size={14} />
          <span>Test Voice</span>
        </Button>
      </div>
    </form>
  );
}
