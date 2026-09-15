const items = [
  { key: 'available', label: 'Horários livres', tone: 'success' },
  { key: 'expired', label: 'Horários expirados', tone: 'muted' },
  { key: 'occupied', label: 'Horários ocupados', tone: 'danger' },
  { key: 'pending', label: 'Cancelamentos pendentes', tone: 'info' },
  { key: 'finalized', label: 'Laudos finalizados', tone: 'warning' },
  { key: 'cancelled', label: 'Cancelados', tone: 'muted' },
];

export default function WeekSummary({ summary }) {
  return (
    <section className="summary-grid" aria-label="Resumo da semana">
      {items.map((item) => (
        <article key={item.key} className={`summary-card ${item.tone}`}>
          <span>{item.label}</span>
          <strong>{summary[item.key]}</strong>
        </article>
      ))}
    </section>
  );
}
