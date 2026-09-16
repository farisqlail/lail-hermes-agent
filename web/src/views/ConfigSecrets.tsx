import React, { useEffect, useState } from 'react';
import { useSecrets } from '../hooks/useSecrets';
import { SecretsUpdate } from '../api/types';
import { errorMessage, errorDetail } from '../api/client';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { Key, Save } from 'lucide-react';

export function ConfigSecrets() {
  const { status, loading, error, saveSecrets, refresh } = useSecrets();
  const { toast } = useToast();

  const [nvidiaKey, setNvidiaKey] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status) {
      setNvidiaKey(status.nvidia_api_key_set ? '***' : '');
      setTelegramToken(status.telegram_bot_token_set ? '***' : '');
    }
  }, [status]);

  if (error) {
    return (
      <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        <span>Gagal memuat kredensial: {error}</span>
        <Button variant="danger" type="button" onClick={refresh}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading || !status) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat data kredensial...</div>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const payload: SecretsUpdate = {};
    if (nvidiaKey !== '***') {
      payload.nvidia_api_key = nvidiaKey;
    }
    if (telegramToken !== '***') {
      payload.telegram_bot_token = telegramToken;
    }

    try {
      const ok = await saveSecrets(payload);
      if (ok) {
        toast('Kredensial berhasil disimpan!', 'ok');
      } else {
        toast('Gagal menyimpan kredensial.', 'err');
      }
    } catch (err) {
      toast(errorMessage(err, 'Gagal menyimpan kredensial.'), 'err');
      const detail = errorDetail(err);
      if (detail) {
        const lowered = detail.toLowerCase();
        if (lowered.includes('nvidia')) {
          setFieldErrors({ nvidia_api_key: detail });
        } else if (lowered.includes('telegram')) {
          setFieldErrors({ telegram_bot_token: detail });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
      <section className="cyber-section">
        <h3 className="cyber-section-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Key size={16} style={{ color: 'var(--accent)' }} />
          <span>API Keys & Bot Tokens</span>
        </h3>

        <Field
          label="AI API Key (NVIDIA NIM / DeepSeek / Custom)"
          error={fieldErrors.nvidia_api_key}
          helpText="Masukkan NVIDIA API Key ('nvapi-...') atau DeepSeek API Key ('sk-...')"
        >
          <input
            type="password"
            className="field-input"
            value={nvidiaKey}
            onChange={(e) => setNvidiaKey(e.target.value)}
            placeholder={status?.nvidia_api_key_set ? 'Sudah tersimpan' : 'Masukkan API Key Anda'}
          />
        </Field>

        <div style={{ height: '16px' }} />

        <Field
          label="Telegram Bot Token"
          error={fieldErrors.telegram_bot_token}
          helpText="Token bot Telegram yang didapatkan dari @BotFather"
        >
          <input
            type="password"
            className="field-input"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            placeholder={status?.telegram_bot_token_set ? 'Sudah tersimpan' : 'Masukkan Telegram Bot Token'}
          />
        </Field>
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <Button variant="primary" type="submit" loading={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
          <Save size={14} />
          <span>Simpan Kredensial</span>
        </Button>
      </div>
    </form>
  );
}
