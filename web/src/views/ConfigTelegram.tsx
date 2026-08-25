import React, { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useSecrets } from '../hooks/useSecrets';
import { Settings, SecretsUpdate } from '../api/types';
import { Field } from '../components/Field';
import { Toggle } from '../components/Toggle';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { Send, Key, ShieldCheck, UserCheck, CheckCircle2, AlertCircle, Save, ExternalLink } from 'lucide-react';

export function ConfigTelegram() {
  const { settings, loading: loadingSettings, error: errorSettings, saveSettings } = useSettings();
  const { status, loading: loadingSecrets, error: errorSecrets, saveSecrets } = useSecrets();
  const { toast } = useToast();

  const [botToken, setBotToken] = useState('');
  const [userIdsText, setUserIdsText] = useState('');
  const [confirmRisky, setConfirmRisky] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (status) {
      setBotToken(status.telegram_bot_token_set ? '***' : '');
    }
  }, [status]);

  useEffect(() => {
    if (settings) {
      setUserIdsText(settings.allowed_user_ids.join(', '));
      setConfirmRisky(settings.confirm_risky);
    }
  }, [settings]);

  const isLoading = (loadingSettings && !settings) || (loadingSecrets && !status);
  const generalError = errorSettings || errorSecrets;

  if (isLoading) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat konfigurasi Telegram...</div>;
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setSaving(true);
    try {
      // 1. Save Bot Token if changed
      if (botToken !== '***' && botToken.trim() !== '') {
        const payload: SecretsUpdate = { telegram_bot_token: botToken.trim() };
        await saveSecrets(payload);
      }

      // 2. Save Telegram Settings (Whitelist & Confirm Risky)
      const userIds = userIdsText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));

      const updatedSettings: Settings = {
        ...settings,
        allowed_user_ids: userIds,
        confirm_risky: confirmRisky,
      };

      const ok = await saveSettings(updatedSettings);
      if (ok) {
        toast('Pengaturan Telegram berhasil disimpan!', 'ok');
      } else {
        toast('Gagal menyimpan pengaturan Telegram.', 'err');
      }
    } catch {
      toast('Terjadi kesalahan saat menyimpan pengaturan Telegram.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const isConnected = status?.telegram_bot_token_set;

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h3 className="settings-section-heading">Telegram Bot & Remote Control</h3>
        <p className="settings-panel-desc">
          Hubungkan asisten dengan Telegram untuk berinteraksi lewat chat, menerima notifikasi, menyetujui aksi, dan transkripsi suara jarak jauh.
        </p>
      </div>

      {generalError && (
        <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: '6px', color: 'var(--err)', fontSize: '12px' }}>
          {String(generalError)}
        </div>
      )}

      {/* Status Connection Card */}
      <div style={{
        background: '#06090e',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '6px',
        padding: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: isConnected ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isConnected ? '#22c55e' : 'var(--text-dim)',
          }}>
            <Send size={18} />
          </div>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text)' }}>
              Status Bot Telegram
            </div>
            <div style={{ fontSize: '12px', color: isConnected ? '#22c55e' : 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              {isConnected ? (
                <>
                  <CheckCircle2 size={12} />
                  <span>Bot Token Aktif & Terkonfigurasi</span>
                </>
              ) : (
                <>
                  <AlertCircle size={12} />
                  <span>Belum ada token — Bot tidak aktif</span>
                </>
              )}
            </div>
          </div>
        </div>

        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: '11.5px',
            color: 'var(--accent)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            textDecoration: 'none',
            padding: '4px 8px',
            borderRadius: '4px',
            background: 'rgba(56, 189, 248, 0.08)',
          }}
        >
          <span>Buka @BotFather</span>
          <ExternalLink size={11} />
        </a>
      </div>

      {/* Bot Token Configuration */}
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
          <Key size={14} style={{ color: 'var(--accent)' }} />
          <span>Telegram Bot Token</span>
        </div>

        <Field
          label="Bot Token"
          helpText="Dapatkan token dari @BotFather di Telegram dengan perintah /newbot (format: 123456789:ABCdef...)"
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type={showToken ? 'text' : 'password'}
              className="field-input"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={status?.telegram_bot_token_set ? 'Sudah tersimpan (ketik baru untuk mengganti)' : 'Masukkan Telegram Bot Token...'}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowToken(!showToken)}
              style={{ padding: '0 12px', fontSize: '11px', whiteSpace: 'nowrap' }}
            >
              {showToken ? 'Sembunyikan' : 'Lihat'}
            </button>
          </div>
        </Field>
      </div>

      {/* Whitelist & Security Gate */}
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
          <ShieldCheck size={14} style={{ color: '#22c55e' }} />
          <span>Whitelist & Keamanan Eksekusi</span>
        </div>

        <Field
          label="Allowed Telegram User IDs"
          helpText="Hanya ID numeric yang terdaftar yang dapat memberi perintah ke bot. Cek ID Anda di Telegram lewat @userinfobot (pisahkan koma jika lebih dari satu)."
        >
          <input
            type="text"
            className="field-input"
            value={userIdsText}
            onChange={(e) => setUserIdsText(e.target.value)}
            placeholder="mis. 123456789, 987654321"
          />
        </Field>

        <div style={{ paddingTop: '4px' }}>
          <Toggle
            checked={confirmRisky}
            onChange={(e) => setConfirmRisky(e)}
            label="Konfirmasi Aksi Berisiko (Interactive Approval Buttons)"
            helpText="Kirim tombol persetujuan inline di Telegram sebelum bot menjalankan git push, penghapusan file, atau akses folder di luar repositori."
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
        <Button variant="primary" type="submit" loading={saving}>
          <Save size={13} />
          <span>Simpan Pengaturan Telegram</span>
        </Button>
      </div>
    </form>
  );
}
