import { useEffect, useMemo, useState } from 'react';
import { getAppointmentStatusFilterValue, getAppointmentStatusLabel } from '../utils/appointmentStatus';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getAllAppointments } from '../services/appointmentsService';
import { format, parseISO, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

export default function HistoryPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState('mock');

  const todayRef = new Date();
  const [selectedMonth, setSelectedMonth] = useState(todayRef.getMonth());
  const [selectedYear, setSelectedYear] = useState(todayRef.getFullYear());
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const [filters, setFilters] = useState({
    status: 'all',
    vehiclePlate: '',
    sellerName: '',
  });

  const isSellerRole = currentUser?.role === 'seller';
  const scopeOwnerKey = isSellerRole ? (currentUser.id || currentUser.email) : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError('');
        const response = await getAllAppointments(currentUser?.companyId);
        if (!cancelled) {
          setHistory(response.items || []);
          setSource(response.source);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e.message ?? 'Não foi possível carregar o histórico completo.';
          setError(msg);
          showToast({
            title: 'Falha ao carregar',
            message: msg,
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

  const filteredHistory = useMemo(() => {
    const monthFilter = new Date(selectedYear, selectedMonth, 1);
    return history
      .filter((item) => {
        if (isSellerRole && scopeOwnerKey) {
          const createdBy = String(item.createdBy || '');
          const sellerEmail = String(item.sellerEmail || '').toLowerCase();
          const sellerName = String(item.sellerName || '').toLowerCase();
          const matchesOwner =
            createdBy === String(scopeOwnerKey) ||
            sellerEmail === String(scopeOwnerKey).toLowerCase() ||
            (sellerName && String(scopeOwnerKey || '').toLowerCase() && sellerName === String(scopeOwnerKey).toLowerCase());
          if (!matchesOwner) return false;
        }
        if (item.appointmentDate) {
          try {
            if (!isSameMonth(parseISO(item.appointmentDate), monthFilter)) {
              return false;
            }
          } catch {
            // ignore
          }
        }
        return true;
      })
      .filter((item) => {
        const statusMatch = filters.status === 'all' ? true : getAppointmentStatusFilterValue(item) === filters.status;
        const plateMatch = filters.vehiclePlate
          ? String(item.vehiclePlate || '').toLowerCase().includes(filters.vehiclePlate.toLowerCase())
          : true;
        const sellerMatch = filters.sellerName
          ? String(item.sellerName || '').toLowerCase().includes(filters.sellerName.toLowerCase())
          : true;
        return statusMatch && plateMatch && sellerMatch;
      })
      .sort((a, b) => {
        const aDate = a.appointmentDate ? parseISO(a.appointmentDate).getTime() : 0;
        const bDate = b.appointmentDate ? parseISO(b.appointmentDate).getTime() : 0;
        const aTime = a.time || '00:00';
        const bTime = b.time || '00:00';
        if (aDate !== bDate) return bDate - aDate;
        return aTime.localeCompare(bTime);
      });
  }, [filters.sellerName, filters.status, filters.vehiclePlate, history, selectedMonth, selectedYear, isSellerRole, scopeOwnerKey]);

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((current) => ({
      ...current,
      [name]: value,
    }));
  }

  return (
    <div className="page-stack">
      <section className="info-panel">
        <span className="section-tag">Histórico completo</span>
        <h2>Todos os atendimentos realizados, cancelados e agendados.</h2>
        <p>Filtre por mês, ano, status, placa ou vendedor para encontrar o que precisa.</p>
      </section>

      {source === 'mock' && (
        <section className="info-panel compact">
          <span className="section-tag">Modo demo</span>
          <p>O histórico passará a refletir os registros reais assim que a conexão com o Supabase estiver ativa.</p>
        </section>
      )}

      {error && (
        <section className="info-panel compact error-panel">
          <span className="section-tag">Erro</span>
          <p>{error}</p>
        </section>
      )}

      <section className="info-panel compact">
        <span className="section-tag">Filtros</span>
        <div className="filters-grid">
          <label>
            Mês
            <select
              name="selectedMonth"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            Ano
            <select
              name="selectedYear"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y.value} value={y.value}>{y.label}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" value={filters.status} onChange={handleFilterChange}>
              <option value="all">Todos</option>
              <option value="scheduled">Ocupado</option>
              <option value="pending">Cancelamento pendente</option>
              <option value="completed">Finalizado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </label>

          <label>
            Placa
            <input name="vehiclePlate" value={filters.vehiclePlate} onChange={handleFilterChange} placeholder="ABC1D23" />
          </label>

          <label>
            Vendedor
            <input name="sellerName" value={filters.sellerName} onChange={handleFilterChange} placeholder="Marcus" />
          </label>
        </div>
      </section>

      {isLoading ? (
        <section className="info-panel compact">
          <span className="section-tag">Carregando</span>
          <p>Carregando histórico completo de atendimentos…</p>
        </section>
      ) : (
        <section className="history-list" aria-label="Histórico completo">
          {filteredHistory.length === 0 && (
            <section className="info-panel compact">
              <span className="section-tag">Sem resultados</span>
              <p>Nenhum registro foi encontrado com os filtros atuais.</p>
            </section>
          )}

          {filteredHistory.map((item) => {
            const dayLabel = item.appointmentDate
              ? format(parseISO(item.appointmentDate), 'EEE', { locale: ptBR })
              : '-';
            const dayFull = item.appointmentDate
              ? format(parseISO(item.appointmentDate), 'dd/MM')
              : '-';

            const statusLabel = getAppointmentStatusLabel(item);
            const statusClass = getAppointmentStatusFilterValue(item) === 'pending'
              ? 'pending'
              : item.status === 'scheduled'
                ? 'occupied'
                : item.status === 'completed'
                  ? 'finalized'
                  : 'muted';

            return (
              <article key={item.id} className="history-card">
                <div>
                  <span className={`slot-status ${statusClass}`}>{statusLabel}</span>
                  <h3>{item.vehicleModel || '(sem modelo)'}</h3>
                  <p>{item.customerName || '(sem cliente)'}</p>
                </div>
                <dl>
                  <div><dt>Data</dt><dd>{dayLabel} - {dayFull}</dd></div>
                  <div><dt>Horário</dt><dd>{item.time}</dd></div>
                  <div><dt>Vendedor</dt><dd>{item.sellerName || '-'}</dd></div>
                  <div><dt>Placa</dt><dd>{item.vehiclePlate || '-'}</dd></div>
                  {item.laudoResult && (
                    <div><dt>Resultado</dt><dd>{item.laudoResult === 'approved' ? '✅ Aprovado' : item.laudoResult === 'rejected' ? '❌ Reprovado' : '⏳ Pendente'}</dd></div>
                  )}
                </dl>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
