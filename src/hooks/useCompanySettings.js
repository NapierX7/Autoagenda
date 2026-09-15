import { useCallback, useEffect, useState } from 'react';
import { getCompanySettings } from '../services/companySettingsService';
import { getDefaultScheduleConfig, normalizeScheduleConfig } from '../utils/scheduleConfig';

export function useCompanySettings(currentUser) {
  const [settings, setSettings] = useState({
    companyId: currentUser?.companyId ?? '',
    displayName: currentUser?.companyName ?? 'Empresa sem nome configurada',
    timezone: 'America/Sao_Paulo',
    contactPhone: '',
    scheduleConfig: getDefaultScheduleConfig(),
  });
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSource, setSettingsSource] = useState('mock');

  const loadSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    setSettingsError('');

    try {
      const response = await getCompanySettings(currentUser?.companyId);
      setSettings({
        ...response,
        scheduleConfig: normalizeScheduleConfig(response.scheduleConfig),
      });
      setSettingsSource(response.source);
    } catch (error) {
      setSettings((current) => ({
        ...current,
        companyId: currentUser?.companyId ?? current.companyId,
        displayName: currentUser?.companyName ?? current.displayName,
        scheduleConfig: normalizeScheduleConfig(current.scheduleConfig),
      }));
      setSettingsError(error.message ?? 'Não foi possível carregar as configurações da empresa.');
    } finally {
      setIsLoadingSettings(false);
    }
  }, [currentUser?.companyId, currentUser?.companyName]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return {
    settings,
    isLoadingSettings,
    settingsError,
    settingsSource,
    refreshSettings: loadSettings,
  };
}
