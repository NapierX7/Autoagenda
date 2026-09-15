import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  getAllAppointments,
} from '../services/appointmentsService';
import {
  format,
  isSameDay,
  isSameMonth,
  isSameWeek,
  isToday,
  parseISO,
  isFuture,
  startOfDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

function downloadBase64File(base64Url, filename) {
  try {
    if (!base64Url || typeof base64Url !== 'string') return false;
    const commaIndex = base64Url.indexOf(',');
    const base64Data = commaIndex >= 0 ? base64Url.substring(commaIndex + 1) : base64Url;
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    let mimeType = 'application/pdf';
    if (base64Url.startsWith('data:')) {
      const head = base64Url.substring(0, commaIndex);
      const match = head.match(/data:([^;]+)/);
      if (match && match[1]) mimeType = match[1];
    }
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'laudo.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (err) {
    console.error('Erro ao baixar arquivo base64:', err);
    return false;
  }
}

function handleLaudoDownload(laudoFileUrl, laudoFileName, showToastFallback) {
  if (!laudoFileUrl) return;
  if (laudoFileUrl.startsWith('data:')) {
    const ok = downloadBase64File(laudoFileUrl, laudoFileName || 'laudo.pdf');
    if (!ok && showToastFallback) {
      showToastFallback({
        title: 'Não foi possível baixar',
        message: 'Abra o laudo clicando em "Visualizar" e salve manualmente.',
        tone: 'warning',
      });
    }
  } else {
    window.open(laudoFileUrl, '_blank', 'noopener,noreferrer');
  }
}

function getSellerStats(appointments, sellerFilter, currentUser) {
  const scope = sellerFilter
    ? appointments.filter((a) => a.createdBy === sellerFilter || a.sellerEmail === sellerFilter || a.sellerName === sellerFilter)
    : appointments;

  const scheduled = scope.filter((a) => a.status === 'scheduled' || a.status === 'completed' || a.status === 'cancelled');
  const finalized = scope.filter((a) => a.status === 'completed');
  const cancelled = scope.filter((a) => a.status === 'cancelled');
  const approvals = finalized.filter((a) => a.laudoResult === 'approved');
  const reprovals = finalized.filter((a) => a.laudoResult === 'rejected');
  const vouchers = scope.filter((a) => a.isVoucher);

  const today = new Date();
  const todayItems = scope.filter((a) => a.appointmentDate && isSameDay(parseISO(a.appointmentDate), today));
  const weekItems = scope.filter((a) => a.appointmentDate && isSameWeek(parseISO(a.appointmentDate), today, { weekStartsOn: 1 }));
  const monthItems = scope.filter((a) => a.appointmentDate && isSameMonth(parseISO(a.appointmentDate), today));

  const approvalRate = finalized.length > 0
    ? Math.round((approvals.length / finalized.length) * 100)
    : 0;

  return {
    total: scheduled.length,
    finalized: finalized.length,
    cancelled: cancelled.length,
    approvals: approvals.length,
    reprovals: reprovals.length,
    approvalRate,
    vouchers: vouchers.length,
    todayCount: todayItems.length,
    weekCount: weekItems.length,
    monthCount: monthItems.length,
  };
}

function formatResultLabel(result) {
  if (result === 'approved') return { text: 'Aprovado', tone: 'approved' };
  if (result === 'rejected') return { text: 'Reprovado', tone: 'rejected' };
  return { text: 'Pendente', tone: 'pending' };
}

const MONTH_OPTIONS = [
  { value: 0, label: 'Janeiro' },
  { value: 1, label: 'Fevereiro' },
  { value: 2, label: 'Março' },
  { value: 3, label: 'Abril' },
  { value: 4, label: 'Maio' },
  { value: 5, label: 'Junho' },
  { value: 6, label: 'Julho' },
  { value: 7, label: 'Agosto' },
  { value: 8, label: 'Setembro' },
  { value: 9, label: 'Outubro' },
  { value: 10, label: 'Novembro' },
  { value: 11, label: 'Dezembro' },
];

function buildYearOptions() {
  const current = new Date().getFullYear();
  const options = [];
  for (let y = current - 3; y <= current + 1; y++) {
    options.push({ value: y, label: String(y) });
  }
  return options;
}

export default function PerformancePage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [appointments, setAppointments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState('mock');
  const [sellerFilter, setSellerFilter] = useState(currentUser?.role === 'seller' ? (currentUser.id || currentUser.email) : 'all');
  const todayMonthRef = new Date();
  const [selectedMonth, setSelectedMonth] = useState(todayMonthRef.getMonth());
  const [selectedYear, setSelectedYear] = useState(todayMonthRef.getFullYear());
  const yearOptions = useMemo(() => buildYearOptions(), []);

  const isSellerView = currentUser?.role === 'seller';
  const isManager = currentUser?.role === 'admin';

  const referenceDate = useMemo(
    () => new Date(selectedYear, selectedMonth, 1),
    [selectedYear, selectedMonth],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError('');
        const response = await getAllAppointments(currentUser?.companyId);
        if (!cancelled) {
          setAppointments(response.items || []);
          setSource(response.source);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message ?? 'Não foi possível carregar os dados de desempenho.');
          showToast({
            title: 'Falha ao carregar',
            message: e.message ?? 'Não foi possível carregar os indicadores.',
            tone: 'error',
          });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentUser, showToast]);

  const sellers = useMemo(() => {
    const map = new Map();
    for (const item of appointments) {
      const key = item.createdBy || item.sellerEmail || item.sellerName;
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: item.sellerName || key,
          email: item.sellerEmail || '',
        });
      }
    }
    return Array.from(map.values());
  }, [appointments]);

  const filterKey = isSellerView
    ? (currentUser.id || currentUser.email || currentUser.fullName)
    : sellerFilter === 'all' ? null : sellerFilter;

  const allMyAppointments = useMemo(() => {
    if (!filterKey) return appointments;
    return appointments.filter((a) =>
      a.createdBy === filterKey || a.sellerEmail === filterKey || a.sellerName === filterKey,
    );
  }, [appointments, filterKey]);

  const myAppointments = useMemo(() => {
    return allMyAppointments.filter((a) => {
      if (!a.appointmentDate) return false;
      return isSameMonth(parseISO(a.appointmentDate), referenceDate);
    });
  }, [allMyAppointments, referenceDate]);

  const selectedSellerStats = useMemo(
    () => getSellerStats(myAppointments, null, currentUser),
    [myAppointments, currentUser],
  );

  const allSellersStats = useMemo(() => {
    if (!isManager) return [];
    const monthScoped = appointments.filter((a) => {
      if (!a.appointmentDate) return false;
      return isSameMonth(parseISO(a.appointmentDate), referenceDate);
    });
    return sellers.map((s) => ({
      ...s,
      stats: getSellerStats(monthScoped, s.key, currentUser),
    }));
  }, [sellers, appointments, isManager, currentUser, referenceDate]);

  const recentLaudos = useMemo(() => {
    return myAppointments
      .filter((a) => a.status === 'completed')
      .sort((a, b) => {
        const dateA = (a.laudoFinalizedAt || a.appointmentDate || '').localeCompare(b.laudoFinalizedAt || b.appointmentDate || '');
        return -dateA;
      })
      .slice(0, isSellerView ? 500 : 8);
  }, [myAppointments, isSellerView]);

  const upcomingScheduled = useMemo(() => {
    const todayStart = startOfDay(new Date());
    return myAppointments
      .filter((a) => a.status === 'scheduled')
      .filter((a) => {
        if (!a.appointmentDate) return false;
        const apptDate = parseISO(a.appointmentDate);
        return isToday(apptDate) || isFuture(apptDate);
      })
      .sort((a, b) => {
        const comp = (a.appointmentDate || '').localeCompare(b.appointmentDate || '');
        if (comp !== 0) return comp;
        return (a.time || '').localeCompare(b.time || '');
      })
      .slice(0, isSellerView ? 200 : 8);
  }, [myAppointments, isSellerView]);

  const allMonthAppointmentsSummary = useMemo(() => {
    const total = myAppointments.length;
    const finalized = myAppointments.filter((a) => a.status === 'completed').length;
    const scheduled = myAppointments.filter((a) => a.status === 'scheduled').length;
    const cancelled = myAppointments.filter((a) => a.status === 'cancelled').length;
    return { total, finalized, scheduled, cancelled };
  }, [myAppointments]);

  function SummaryCard({ tone, icon, value, label, helper }) {
    return (
      <div className={`summary-card ${tone}`}>
        <div className="summary-card-icon" aria-hidden>{icon}</div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{helper}</small>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="info-panel">
        <span className="section-tag">
          {isSellerView ? '📈 Meu desempenho' : '📊 Desempenho da equipe'}
        </span>
        <h2>
          {isSellerView ? 'Seus números e laudos.' : 'Indicadores do time no período.'}
        </h2>
        <p>
          {isSellerView
            ? 'Resultados vinculados à sua conta, atualizados em tempo real.'
            : 'Visão consolidada do gerente — compare vendedores individualmente.'}
        </p>
      </section>

      {source === 'mock' && (
        <section className="info-panel compact">
          <span className="section-tag warning-tag">🧪 Modo demo</span>
          <p>Indicadores com dados simulados até a conexão com o banco ser concluída.</p>
        </section>
      )}

      {error && (
        <section className="info-panel compact error-panel">
          <span className="section-tag">⚠️ Erro</span>
          <p>{error}</p>
        </section>
      )}

      <section className="info-panel compact">
        <div className="section-heading">
          <div>
            <span className="section-tag">🗓️ Período histórico</span>
            <h3>Filtre por mês, ano e vendedor.</h3>
          </div>
        </div>
        <div className="filters-grid">
          <label>
            Mês
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ano
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </select>
          </label>
          {!isSellerView && isManager && (
            <label>
              Vendedor
              <select
                value={sellerFilter}
                onChange={(e) => setSellerFilter(e.target.value)}
              >
                <option value="all">Todos (acumulado)</option>
                {sellers.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="section-summary-row">
          <span className="eyebrow">
            📋 <strong>{allMonthAppointmentsSummary.total}</strong> agendamentos em{' '}
            <strong>{format(referenceDate, 'MMMM/yyyy', { locale: ptBR })}</strong>
          </span>
          <span className="eyebrow success-tag">✅ Finalizados: <strong>{allMonthAppointmentsSummary.finalized}</strong></span>
          <span className="eyebrow warning-tag">📌 Agendados: <strong>{allMonthAppointmentsSummary.scheduled}</strong></span>
          <span className="eyebrow danger-tag">🚫 Cancelados: <strong>{allMonthAppointmentsSummary.cancelled}</strong></span>
        </div>
      </section>

      {isLoading ? (
        <section className="info-panel compact">
          <div className="section-heading">
            <div>
              <span className="section-tag">⏳ Calculando indicadores</span>
              <h3>Carregando desempenho…</h3>
            </div>
          </div>
          <div className="summary-grid" style={{ marginTop: '16px' }}>
            {Array.from({ length: isSellerView ? 5 : 10 }).map((_, idx) => (
              <div key={idx} className="summary-card skeleton-card">
                <div className="skeleton skeleton-line w-20" />
                <div className="skeleton skeleton-line w-40" />
                <div className="skeleton skeleton-line w-60" />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {isSellerView ? (
            <div className="summary-grid">
              <SummaryCard tone="info" icon="📋" value={selectedSellerStats.total} label="Total no mês" helper="Agendamentos criados por você." />
              <SummaryCard tone="success" icon="✅" value={selectedSellerStats.approvals} label="Aprovações" helper="Veículos aprovados cautelarmente." />
              <SummaryCard tone="danger" icon="❌" value={selectedSellerStats.reprovals} label="Reprovações" helper="Veículos reprovados cautelarmente." />
              <SummaryCard tone="warning" icon="🎯" value={`${selectedSellerStats.approvalRate}%`} label="Taxa de aprovação" helper="Aprovações / Laudos finalizados." />
              <SummaryCard tone="muted" icon="🎟️" value={selectedSellerStats.vouchers} label="Vouchers" helper="Agendamentos com voucher." />
            </div>
          ) : (
            <div className="summary-grid">
              <SummaryCard tone="info" icon="📋" value={selectedSellerStats.total} label="Total geral" helper="Todos no período." />
              <SummaryCard tone="success" icon="✅" value={selectedSellerStats.finalized} label="Finalizados" helper="Laudos concluídos." />
              <SummaryCard tone="danger" icon="🚫" value={selectedSellerStats.cancelled} label="Cancelados" helper="Solicitações aprovadas." />
              <SummaryCard tone="success" icon="🟢" value={selectedSellerStats.approvals} label="Aprovações" helper="Veículos aprovados." />
              <SummaryCard tone="danger" icon="🔴" value={selectedSellerStats.reprovals} label="Reprovações" helper="Veículos reprovados." />
              <SummaryCard tone="warning" icon="🎯" value={`${selectedSellerStats.approvalRate}%`} label="Taxa de aprovação" helper="Aprovações / Finalizados." />
              <SummaryCard tone="muted" icon="🎟️" value={selectedSellerStats.vouchers} label="Vouchers" helper="Uso de vouchers." />
              <SummaryCard tone="info" icon="📍" value={selectedSellerStats.todayCount} label="Hoje" helper={format(new Date(), 'dd/MM/yyyy')} />
              <SummaryCard tone="info" icon="🗓️" value={selectedSellerStats.weekCount} label="Esta semana" helper="Seg a dom." />
              <SummaryCard tone="info" icon="📅" value={selectedSellerStats.monthCount} label="Este mês" helper={format(new Date(), 'MMMM/yyyy', { locale: ptBR })} />
            </div>
          )}

          {isSellerView && (
            <>
              <section className="info-panel compact">
                <div className="section-heading">
                  <div>
                    <span className="section-tag">📚 Meu histórico ({format(referenceDate, 'MMMM/yyyy', { locale: ptBR })})</span>
                    <h3>Laudos finalizados no período</h3>
                  </div>
                </div>
                {recentLaudos.length === 0 ? (
                  <div className="empty-state-inline">
                    <div className="empty-state-visual" aria-hidden>📭</div>
                    <p>Nenhum laudo finalizado neste mês. Assim que forem concluídos, aparecerão aqui.</p>
                  </div>
                ) : (
                  <div className="users-list">
                    {recentLaudos.map((apt) => {
                      const result = formatResultLabel(apt.laudoResult);
                      return (
                        <article key={apt.id} className="history-card user-card laudo-card">
                          <div>
                            <span className={`section-tag result-tag ${result.tone}`}>
                              {apt.laudoResult === 'approved' ? '🟢' : apt.laudoResult === 'rejected' ? '🔴' : '⚪'} {result.text}
                            </span>
                            <h3>
                              {apt.vehiclePlate || 'Placa'} · {apt.vehicleModel || 'Sem modelo'} · {apt.vehicleYear || ''}
                            </h3>
                            <p>
                              {apt.customerName || 'Cliente'} · {apt.appointmentDate ? format(parseISO(apt.appointmentDate), 'dd/MM/yyyy') : ''} {apt.time || ''}
                            </p>
                            {apt.laudoFinalizedAt && (
                              <small style={{ color: '#64748b' }}>
                                ✔️ Finalizado em {format(parseISO(apt.laudoFinalizedAt), "dd/MM/yyyy 'às' HH:mm")}
                              </small>
                            )}
                          </div>
                          <div>
                            {apt.laudoRejectionReason && (
                              <div className="laudo-rejection-box">
                                <strong>Motivo da reprovação:</strong>
                                <p>{apt.laudoRejectionReason}</p>
                              </div>
                            )}
                            <div className="card-actions-end" style={{ gap: '8px', flexWrap: 'wrap' }}>
                              {apt.laudoFileUrl && (
                                <>
                                  <button
                                    type="button"
                                    className="primary-button"
                                    onClick={() => handleLaudoDownload(apt.laudoFileUrl, apt.laudoFileName, showToast)}
                                  >
                                    📥 Baixar laudo
                                  </button>
                                  <a
                                    className="ghost-button"
                                    href={apt.laudoFileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    👁️ Visualizar
                                  </a>
                                </>
                              )}
                              {!apt.laudoFileUrl && apt.status === 'completed' && (
                                <span className="muted-tag">
                                  Sem arquivo anexado
                                </span>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="info-panel compact">
                <div className="section-heading">
                  <div>
                    <span className="section-tag">⏰ Próximos agendamentos</span>
                    <h3>Seus horários marcados</h3>
                  </div>
                </div>
                {upcomingScheduled.length === 0 ? (
                  <div className="empty-state-inline">
                    <div className="empty-state-visual" aria-hidden>🌿</div>
                    <p>Nenhum agendamento marcado para os próximos dias neste mês.</p>
                  </div>
                ) : (
                  <div className="users-list">
                    {upcomingScheduled.map((apt) => (
                      <article key={apt.id} className="history-card user-card">
                        <div>
                          <span className={`section-tag ${apt.isVoucher ? 'warning-tag' : 'success-tag'}`}>
                            {apt.isVoucher ? '🎟️ Voucher' : '✅ Agendado'}
                          </span>
                          <h3>
                            📍 {apt.appointmentDate ? format(parseISO(apt.appointmentDate), 'dd/MM') : ''} · ⏰ {apt.time || ''}
                          </h3>
                          <p>
                            {apt.customerName || 'Cliente'} · {apt.vehiclePlate || 'Placa'}
                          </p>
                        </div>
                        <div>
                          <dl>
                            <div>
                              <dt>Modelo / Ano</dt>
                              <dd>{apt.vehicleModel || '-'} {apt.vehicleYear || ''}</dd>
                            </div>
                            <div>
                              <dt>Vendedor</dt>
                              <dd>{apt.sellerName || currentUser?.fullName || '-'}</dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {!isSellerView && (
            <>
              <section className="info-panel compact">
                <div className="section-heading">
                  <div>
                    <span className="section-tag">✅ Laudos recentes</span>
                    <h3>Últimos laudos do período</h3>
                  </div>
                </div>
                {recentLaudos.length === 0 ? (
                  <div className="empty-state-inline">
                    <div className="empty-state-visual" aria-hidden>📭</div>
                    <p>Nenhum laudo finalizado neste período.</p>
                  </div>
                ) : (
                  <div className="users-list">
                    {recentLaudos.map((apt) => {
                      const result = formatResultLabel(apt.laudoResult);
                      return (
                        <article key={apt.id} className="history-card user-card laudo-card">
                          <div>
                            <span className={`section-tag result-tag ${result.tone}`}>
                              {apt.laudoResult === 'approved' ? '🟢' : apt.laudoResult === 'rejected' ? '🔴' : '⚪'} {result.text}
                            </span>
                            <h3>
                              {apt.vehiclePlate || 'Placa'} · {apt.vehicleModel || 'Sem modelo'} · {apt.vehicleYear || ''}
                            </h3>
                            <p>
                              {apt.customerName || 'Cliente'} · {apt.appointmentDate ? format(parseISO(apt.appointmentDate), 'dd/MM/yyyy') : ''} {apt.time || ''}
                            </p>
                            {apt.sellerName && <small style={{ color: '#64748b' }}>👤 Vendedor: {apt.sellerName}</small>}
                          </div>
                          <div>
                            {apt.laudoRejectionReason && (
                              <div className="laudo-rejection-box">
                                <strong>Motivo da reprovação:</strong>
                                <p>{apt.laudoRejectionReason}</p>
                              </div>
                            )}
                            <div className="card-actions-end">
                              {apt.laudoFileUrl && (
                                <a
                                  className="primary-button"
                                  href={apt.laudoFileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  📄 {apt.laudoFileName || 'Abrir laudo'}
                                </a>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="info-panel compact">
                <div className="section-heading">
                  <div>
                    <span className="section-tag">⏰ Próximos agendamentos</span>
                    <h3>Horários a partir de hoje</h3>
                  </div>
                </div>
                {upcomingScheduled.length === 0 ? (
                  <div className="empty-state-inline">
                    <div className="empty-state-visual" aria-hidden>🌿</div>
                    <p>Nenhum agendamento marcado para os próximos dias.</p>
                  </div>
                ) : (
                  <div className="users-list">
                    {upcomingScheduled.map((apt) => (
                      <article key={apt.id} className="history-card user-card">
                        <div>
                          <span className={`section-tag ${apt.isVoucher ? 'warning-tag' : 'success-tag'}`}>
                            {apt.isVoucher ? '🎟️ Voucher' : '✅ Agendado'}
                          </span>
                          <h3>
                            📍 {apt.appointmentDate ? format(parseISO(apt.appointmentDate), 'dd/MM') : ''} · ⏰ {apt.time || ''}
                          </h3>
                          <p>
                            {apt.customerName || 'Cliente'} · {apt.vehiclePlate || 'Placa'}
                          </p>
                        </div>
                        <div>
                          <dl>
                            <div>
                              <dt>Modelo / Ano</dt>
                              <dd>{apt.vehicleModel || '-'} {apt.vehicleYear || ''}</dd>
                            </div>
                            <div>
                              <dt>Vendedor</dt>
                              <dd>{apt.sellerName || '-'}</dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {isManager && allSellersStats.length > 0 && (
            <section className="info-panel compact">
              <div className="section-heading">
                <div>
                  <span className="section-tag">🏆 Ranking individual</span>
                  <h3>Comparativo por vendedor ({format(referenceDate, 'MMMM/yyyy', { locale: ptBR })})</h3>
                </div>
              </div>
              <div className="seller-ranking-grid">
                {allSellersStats
                  .sort((a, b) => b.stats.total - a.stats.total)
                  .map((s, index) => (
                    <article key={s.key} className="seller-ranking-card">
                      <header>
                        <span className="section-tag">#{index + 1}</span>
                        <div>
                          <strong>{s.name}</strong>
                          {s.email && <small>✉️ {s.email}</small>}
                        </div>
                      </header>
                      <dl className="seller-mini-stats">
                        <div>
                          <dt>📋 Total</dt>
                          <dd>{s.stats.total}</dd>
                        </div>
                        <div>
                          <dt>✅ Finalizados</dt>
                          <dd>{s.stats.finalized}</dd>
                        </div>
                        <div>
                          <dt>🟢 Aprovações</dt>
                          <dd>{s.stats.approvals}</dd>
                        </div>
                        <div>
                          <dt>🔴 Reprovações</dt>
                          <dd>{s.stats.reprovals}</dd>
                        </div>
                        <div>
                          <dt>🎯 Taxa</dt>
                          <dd>{s.stats.approvalRate}%</dd>
                        </div>
                        <div>
                          <dt>🎟️ Vouchers</dt>
                          <dd>{s.stats.vouchers}</dd>
                        </div>
                        <div>
                          <dt>🚫 Cancelados</dt>
                          <dd>{s.stats.cancelled}</dd>
                        </div>
                        <div>
                          <dt>📅 Mês</dt>
                          <dd>{s.stats.monthCount}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
