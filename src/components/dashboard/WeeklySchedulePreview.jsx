function renderCell(appointment) {
  if (!appointment) {
    return (
      <>
        <span className="slot-status available">Disponível</span>
        <strong>Pronto para agendamento</strong>
        <small>Livre para nova reserva</small>
      </>
    );
  }

  const workflow = (() => {
    if (appointment.status === 'cancelled') return { key: 'expired', label: 'Cancelado', cls: 'expired' };
    if (appointment.status === 'completed') return { key: 'finalized', label: 'Finalizado', cls: 'finalized' };
    const isPending = Boolean(
      appointment.status === 'scheduled' && appointment.cancellationRequestedAt,
    );
    if (isPending) return { key: 'pending', label: 'Cancelamento pendente', cls: 'pending' };
    return {
      key: 'occupied',
      label: appointment.isEncaixe ? 'Encaixe' : 'Ocupado',
      cls: 'occupied',
    };
  })();

  if (appointment.isOccupancyOnly) {
    return (
      <>
        <span className={`slot-status ${workflow.cls}`}>{workflow.label}</span>
        <strong>Horário ocupado</strong>
        <small>Detalhes restritos ao responsável</small>
      </>
    );
  }

  return (
    <>
      <span className={`slot-status ${workflow.cls}`}>{workflow.label}</span>
      <strong>{appointment.vehicleModel}</strong>
      <small>{appointment.sellerName}</small>
      {appointment.vehiclePlate && (
        <small className="slot-vehicle-plate">Placa: {appointment.vehiclePlate}</small>
      )}
    </>
  );
}

export default function WeeklySchedulePreview({
  board,
  title = 'Agenda da semana',
  onSlotSelect,
  onEncaixeSelect,
  isManager = false,
}) {
  const canShowEncaixe = Boolean(isManager && onEncaixeSelect);
  const isOccupiedLike = (status) => ['occupied', 'pending', 'finalized'].includes(status);

  return (
    <section className="schedule-section">
      <div className="section-heading">
        <div>
          <span className="section-tag">Disponibilidade</span>
          <h3>{title}</h3>
          {canShowEncaixe && (
            <p className="helper-text-inline">
              💡 Como gerente, você pode clicar em <strong>ENCAIXAR</strong> em qualquer horário
              ocupado para inserir um carro extra no mesmo dia e horário.
            </p>
          )}
        </div>
        <div className="legend">
          <span><i className="dot available"></i>Disponível</span>
          <span><i className="dot expired"></i>Indisponível</span>
          <span><i className="dot occupied"></i>Ocupado</span>
          <span><i className="dot pending"></i>Cancelamento pendente</span>
          <span><i className="dot finalized"></i>Finalizado</span>
          <span><i className="dot encaixe"></i>Encaixe</span>
        </div>
      </div>

      <div className="schedule-board">
        {board.map((day) => (
          <article key={day.id} className="day-column">
            <header>
              <div className="day-column-title">
                <strong>{day.label}</strong>
                <span>{day.fullDate}</span>
              </div>
              <small>{day.slots.length} horário(s)</small>
            </header>
            <div className="slot-list">
              {day.slots.length === 0 ? (
                <div className="empty-day-state">
                  <strong>Nenhum horário visível</strong>
                  <small>Este dia não possui horários disponíveis com os filtros atuais.</small>
                </div>
              ) : (
                day.slots.map((slot) => {
                  const appointments = slot.appointments ?? (slot.appointment ? [slot.appointment] : []);
                  const hasMultiple = appointments.length > 1;
                  const wrapperClass = hasMultiple ? 'slot-card-wrapper multiple' : 'slot-card-wrapper';
                  const anyEncaixe = appointments.some(a => a.isEncaixe);

                  return (
                    <div
                      key={`${day.id}-${slot.time}`}
                      className={`${wrapperClass} ${anyEncaixe ? 'has-encaixe' : ''}`}
                    >
                      {appointments.length === 0 ? (
                        <button
                          type="button"
                          className={`slot-card ${slot.status}`}
                          disabled={slot.status === 'expired'}
                          onClick={slot.status !== 'expired' ? () => onSlotSelect?.({ day, slot }) : undefined}
                          title={slot.status === 'expired' ? 'Horário já passou e não pode mais ser agendado.' : 'Clique para reservar este horário'}
                        >
                          <span className="slot-time">{slot.time}</span>
                          <span className="slot-body">{renderCell(null)}</span>
                        </button>
                      ) : (
                        <div className="slot-group">
                          {appointments.map((appt) => {
                            const isEncaixe = Boolean(appt.isEncaixe);
                            const isOccupancyOnly = Boolean(appt.isOccupancyOnly);
                            const workflow = (() => {
                              if (appt.status === 'cancelled') return 'expired';
                              if (appt.status === 'completed') return 'finalized';
                              const pending = Boolean(
                                appt.status === 'scheduled' && appt.cancellationRequestedAt,
                              );
                              if (pending) return 'pending';
                              return 'occupied';
                            })();
                            return (
                              <button
                                key={appt.id}
                                type="button"
                                className={`slot-card ${workflow} ${isEncaixe ? 'is-encaixe' : ''} ${isOccupancyOnly ? 'is-occupancy-only' : ''}`}
                                aria-disabled={isOccupancyOnly}
                                title={
                                  isOccupancyOnly
                                    ? 'Horário ocupado — detalhes restritos ao responsável'
                                    : undefined
                                }
                                onClick={() => {
                                  if (isOccupancyOnly) {
                                    // Ainda notifica o pai para toast/UX, mas não deve abrir edição.
                                    onSlotSelect?.({
                                      day,
                                      slot: {
                                        ...slot,
                                        appointment: appt,
                                        status: workflow,
                                      },
                                    });
                                    return;
                                  }
                                  onSlotSelect?.({
                                    day,
                                    slot: {
                                      ...slot,
                                      appointment: appt,
                                      status: workflow,
                                    },
                                  });
                                }}
                              >
                                <span className="slot-time">{slot.time}</span>
                                <span className="slot-body">{renderCell(appt)}</span>
                                {hasMultiple && (
                                  <span className="slot-order-badge">
                                    {isEncaixe ? '🔀 Encaixe' : 'Agendado'}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {canShowEncaixe && isOccupiedLike(slot.status) && (
                        <button
                          type="button"
                          className="encaixe-button"
                          disabled={slot.status === 'expired'}
                          onClick={slot.status !== 'expired' ? () => onEncaixeSelect?.({ day, slot }) : undefined}
                          title={
                            slot.status === 'expired'
                              ? 'Horário já passou. Não pode receber encaixes.'
                              : 'Inserir encaixe neste horário (apenas gerente)'
                          }
                        >
                          ➕ Encaixar carro extra
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
