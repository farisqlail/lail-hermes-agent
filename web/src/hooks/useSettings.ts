import { useState, useEffect, useCallback } from 'react';
import { api, errorMessage } from '../api/client';
import { Settings } from '../api/types';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch (err) {
      setError(errorMessage(err, 'Gagal memuat pengaturan'));
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSettings = async (newSettings: Settings) => {
    setError(null);
    try {
      const result = await api.saveSettings(newSettings);
      if (result.ok) {
        setSettings(newSettings);
        return true;
      }
      return false;
    } catch (err) {
      setError(errorMessage(err, 'Gagal menyimpan pengaturan'));
      throw err;
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, loading, error, saveSettings, refresh: fetchSettings };
}
