import React, { useEffect, useState } from 'react';
import { useSecrets } from '../hooks/useSecrets';
import { SecretsUpdate } from '../api/types';
import { errorMessage, errorDetail } from '../api/client';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

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
    return <div style={{ color: 'var(--text-dim)' }}>Memuat data kredensial...</div>;
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
      // SecretsUpdate's validators say which secret was rejected (web_ui.py:126-147).
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '600px' }}>
      <section style={{ backgroundColor: 'var(--surface-1)', padding: '20px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--t-lg)', fontWeight: '600', marginBottom: '16px', color: 'var(--accent)' }}>🔑 API Keys & Bot Tokens</h3>

        <Field
          label="NVIDIA API Key"
          error={fieldErrors.nvidia_api_key}
          helpText="Dibutuhkan untuk pemanggilan model planner NVIDIA NIM (format 'nvapi-...')"
        >
          <input
            type="password"
            className="field-input"
            value={nvidiaKey}
            onChange={(e) => setNvidiaKey(e.target.value)}
            placeholder={status?.nvidia_api_key_set ? 'Sudah tersimpan' : 'Masukkan NVIDIA API Key'}
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

      <div>
        <Button variant="primary" type="submit" loading={saving} style={{ width: '150px' }}>
          Simpan Kredensial
        </Button>
      </div>
    </form>
  );
}
