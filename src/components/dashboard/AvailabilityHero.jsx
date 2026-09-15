export default function AvailabilityHero({ available, occupied, finalized }) {
  return (
    <section className="availability-hero">
      <div>
        <span className="section-tag">Visão rápida</span>
        <h2>Veja em segundos quais horários ainda estão livres na semana.</h2>
        <p>Este painel ajuda a equipe a decidir rápido, reduzir conflitos e manter a agenda organizada.</p>
      </div>

      <div className="hero-metrics">
        <article className="hero-metric hero-metric-primary"><strong>{available}</strong><span>Livres na semana</span></article>
        <article className="hero-metric"><strong>{occupied}</strong><span>Ocupados</span></article>
        <article className="hero-metric"><strong>{finalized}</strong><span>Finalizados</span></article>
      </div>
    </section>
  );
}
