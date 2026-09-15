import AvailabilityHero from '../components/dashboard/AvailabilityHero';
import CompanySettingsCard from '../components/dashboard/CompanySettingsCard';
import WeekSummary from '../components/dashboard/WeekSummary';
import WeeklySchedulePreview from '../components/dashboard/WeeklySchedulePreview';
import { useAuth } from '../contexts/AuthContext';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useWeeklyAvailability } from '../hooks/useWeeklyAvailability';

export default function DashboardPage() {
  const { currentUser } = useAuth();
  const { settings, isLoadingSettings, settingsError, settingsSource } = useCompanySettings(currentUser);
  const { summary, board, isLoading, error, source } = useWeeklyAvailability(currentUser, settings.scheduleConfig);

  return (
    <div className="page-stack">
      <AvailabilityHero available={summary.available} occupied={summary.occupied} finalized={summary.finalized} />
      {source === 'mock' && (
        <section className="info-panel compact">
          <span className="section-tag">Modo demo</span>
          <p>Os indicadores e a agenda ainda estão usando dados simulados até a conexão real com o Supabase ser concluída.</p>
        </section>
      )}
      {error && (
        <section className="info-panel compact error-panel">
          <span className="section-tag">Erro</span>
          <p>{error}</p>
        </section>
      )}
      {settingsError && (
        <section className="info-panel compact error-panel">
          <span className="section-tag">Configuração</span>
          <p>{settingsError}</p>
        </section>
      )}
      {isLoadingSettings ? (
        <section className="info-panel compact">
          <span className="section-tag">Carregando configuração</span>
          <p>Buscando as configurações da empresa para montar a agenda da semana.</p>
        </section>
      ) : (
        <CompanySettingsCard settings={settings} source={settingsSource} />
      )}
      <WeekSummary summary={summary} />
      {isLoading ? (
        <section className="info-panel compact">
          <span className="section-tag">Carregando</span>
          <p>Carregando os horários e agendamentos da semana.</p>
        </section>
      ) : (
        <WeeklySchedulePreview board={board} title="Painel semanal de disponibilidade" />
      )}
    </div>
  );
}
