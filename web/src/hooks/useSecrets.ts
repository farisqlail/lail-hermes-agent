import { useState, useEffect, useCallback } from 'react';
import { api, errorMessage } from '../api/client';
import { SecretsStatus, SecretsUpdate } from '../api/types';

export function useSecrets() {
  const [status, setStatus] = useState<SecretsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSecretsStatus();
      setStatus(data);
    } catch (err) {
      setError(errorMessage(err, 'Gagal memuat status kredensial'));
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSecrets = async (secrets: SecretsUpdate) => {
    setError(null);
    try {
      const result = await api.saveSecrets(secrets);
      if (result.ok) {
        await fetchStatus();
        return true;
      }
      return false;
    } catch (err) {
      setError(errorMessage(err, 'Gagal menyimpan kredensial'));
      throw err;
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, loading, error, saveSecrets, refresh: fetchStatus };
}
