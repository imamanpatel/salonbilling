import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarClock, CalendarOff, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { formatINR } from '@salon/shared';
import { APPOINTMENT_STATUSES, minutesToTime, timeToMinutes } from '@salon/shared/appointments';
import { Button, Card, Checkbox, cx, EmptyState, Input, PageHeader, Spinner, Tabs } from '../../components/ui.jsx';
import { todayIso } from '../../lib/format.js';
import AppointmentDetailsModal from './AppointmentDetailsModal.jsx';
import AppointmentFormModal from './AppointmentFormModal.jsx';
import {
  AppointmentStatusBadge, BLOCK_CLASSES, formatLongDate, isClosedStatus, ISO_DATE, shiftDate, STATUS_LABELS,
  useAppointmentDay,
} from './lib.jsx';

const SLOT_MIN = 15;
const SLOT_PX = 22;
const UNASSIGNED = '';

const LEGEND_SWATCHES = {
  REQUESTED: 'bg-amber-400',
  BOOKED: 'bg-brand-500',
  CHECKED_IN: 'bg-sky-500',
  BILLED: 'bg-emerald-500',
  CANCELLED: 'bg-slate-300',
  NO_SHOW: 'bg-slate-300',
};

const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

function useNowMinutes() {
  const [minutes, setMinutes] = useState(nowMinutes);
  useEffect(() => {
    const timer = setInterval(() => setMinutes(nowMinutes()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return minutes;
}

/** Side-by-side lanes for overlapping blocks within one column (each overlap cluster is split evenly). */
function withLanes(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    const placed = cluster.map((block) => {
      let lane = laneEnds.findIndex((end) => end <= block.start);
      if (lane === -1) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = block.end;
      return { ...block, lane };
    });
    out.push(...placed.map((block) => ({ ...block, lanes: laneEnds.length })));
    cluster = [];
    clusterEnd = -1;
  };
  for (const block of sorted) {
    if (cluster.length && block.start >= clusterEnd) flush();
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (cluster.length) flush();
  return out;
}

function DayGrid({ day, appointments, isToday, onSlot, onOpen }) {
  const now = useNowMinutes();

  const { gridStart, slots, columns } = useMemo(() => {
    const blocks = appointments.flatMap((appointment) =>
      appointment.items.map((item) => ({
        key: item.id,
        appointment,
        item,
        column: item.staffId ?? UNASSIGNED,
        start: timeToMinutes(item.startTime),
        end: timeToMinutes(item.endTime),
      })),
    );
    // Whole hours covering opening hours plus anything booked outside them.
    let first = timeToMinutes(day.openTime);
    let last = timeToMinutes(day.closeTime);
    for (const b of blocks) {
      first = Math.min(first, b.start);
      last = Math.max(last, b.end);
    }
    first = Math.floor(first / 60) * 60;
    last = Math.max(first + 60, Math.ceil(last / 60) * 60);

    const cols = [
      ...day.providers.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: p.isActive === false ? 'No longer active' : p.designation,
        shiftStart: p.shiftStart ? timeToMinutes(p.shiftStart) : null,
        shiftEnd: p.shiftEnd ? timeToMinutes(p.shiftEnd) : null,
      })),
      { id: UNASSIGNED, title: 'Unassigned', subtitle: 'Any provider', shiftStart: null, shiftEnd: null },
    ].map((col) => ({ ...col, blocks: withLanes(blocks.filter((b) => b.column === col.id)) }));

    return {
      gridStart: first,
      slots: Array.from({ length: (last - first) / SLOT_MIN }, (_, i) => first + i * SLOT_MIN),
      columns: cols,
    };
  }, [day, appointments]);

  const height = slots.length * SLOT_PX;
  const gridEnd = gridStart + slots.length * SLOT_MIN;
  const template = { gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(9.5rem, 1fr))` };
  const offShift = (col, minute) =>
    (col.shiftStart !== null && minute < col.shiftStart) || (col.shiftEnd !== null && minute >= col.shiftEnd);

  return (
    <div className="max-h-[70vh] overflow-auto">
      <div className="min-w-max">
        <div className="sticky top-0 z-20 grid border-b border-slate-200 bg-white" style={template}>
          <div className="sticky left-0 z-10 bg-white" />
          {columns.map((col) => (
            <div key={col.id || 'unassigned'} className="border-l border-slate-200 px-2 py-2">
              <p className="truncate text-sm font-medium text-slate-900">{col.title}</p>
              <p className="truncate text-xs text-slate-500">{col.subtitle || ' '}</p>
            </div>
          ))}
        </div>

        <div className="relative grid" style={template}>
          <div className="sticky left-0 z-10 bg-white" style={{ height }}>
            {slots.map((minute, i) =>
              minute % 60 === 0 ? (
                <span key={minute} className="absolute right-2 -translate-y-1/2 text-xs text-slate-400 tabular-nums" style={{ top: i * SLOT_PX || 8 }}>
                  {minutesToTime(minute)}
                </span>
              ) : null,
            )}
          </div>

          {columns.map((col) => (
            <div key={col.id || 'unassigned'} className="relative border-l border-slate-200" style={{ height }}>
              {slots.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  tabIndex={-1}
                  disabled={day.isHoliday}
                  aria-label={`Book ${col.title} at ${minutesToTime(minute)}`}
                  onClick={() => onSlot(col.id, minutesToTime(minute))}
                  className={cx(
                    'block w-full border-t transition-colors enabled:hover:bg-brand-50/70 disabled:cursor-not-allowed',
                    minute % 60 === 0 ? 'border-slate-200' : 'border-dashed border-slate-100',
                    (offShift(col, minute) || day.isHoliday) && 'bg-slate-50',
                  )}
                  style={{ height: SLOT_PX }}
                />
              ))}
              {col.blocks.map(({ key, appointment, item, start, end, lane, lanes }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onOpen(appointment.id)}
                  title={`${appointment.client.name} · ${item.service.name} · ${item.startTime}–${item.endTime} · ${STATUS_LABELS[appointment.status]}`}
                  className={cx(
                    'absolute z-[1] overflow-hidden rounded-md border border-l-4 px-1.5 py-0.5 text-left text-xs leading-tight shadow-xs',
                    'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                    BLOCK_CLASSES[appointment.status],
                  )}
                  style={{
                    top: ((start - gridStart) / SLOT_MIN) * SLOT_PX + 1,
                    height: Math.max(SLOT_PX, ((end - start) / SLOT_MIN) * SLOT_PX) - 2,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  }}
                >
                  <span className="block truncate font-semibold">{appointment.client.name}</span>
                  <span className="block truncate">{item.service.name}</span>
                  <span className="block truncate opacity-75 tabular-nums">{item.startTime}–{item.endTime}</span>
                </button>
              ))}
            </div>
          ))}

          {isToday && now >= gridStart && now < gridEnd && (
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 left-14 z-[2] border-t-2 border-rose-500"
              style={{ top: ((now - gridStart) / SLOT_MIN) * SLOT_PX }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Agenda({ appointments, onOpen, onNew, isHoliday }) {
  if (!appointments.length) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No appointments"
        description={isHoliday ? 'The salon is closed on this day.' : 'Nothing booked for this day yet.'}
        action={!isHoliday && <Button onClick={onNew}>New appointment</Button>}
      />
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {appointments.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => onOpen(a.id)} className="flex w-full flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-slate-50">
            <span className={cx('w-24 shrink-0 text-sm font-medium tabular-nums', isClosedStatus(a.status) ? 'text-slate-400 line-through' : 'text-slate-900')}>
              {a.startTime}–{a.endTime}
            </span>
            <span className="min-w-48 flex-1">
              <span className="block text-sm font-medium text-slate-900">{a.client.name}</span>
              <span className="block text-sm text-slate-500">
                {a.items.map((item) => `${item.service.name}${item.staff ? ` (${item.staff.name})` : ''}`).join(', ')}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {a.advancePaise > 0 && <span className="text-xs text-slate-500">Advance {formatINR(a.advancePaise)}</span>}
              <AppointmentStatusBadge status={a.status} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const initialView = () => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches ? 'agenda' : 'grid');

export default function AppointmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState(initialView);
  const [showClosed, setShowClosed] = useState(false);
  const [dialog, setDialog] = useState(null); // { kind: 'form', appointment?, initial? }

  const today = todayIso();
  const paramDate = searchParams.get('date');
  const date = paramDate && ISO_DATE.test(paramDate) ? paramDate : today;
  // The open appointment lives in the URL (?view=<id>) so other screens can link to it.
  const viewingId = searchParams.get('view');

  const updateParams = (changes) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const setDate = (next) => {
    if (ISO_DATE.test(next)) updateParams({ date: next });
  };

  const day = useAppointmentDay(date);
  const all = day.data?.appointments ?? [];
  const appointments = showClosed ? all : all.filter((a) => !isClosedStatus(a.status));
  const closedCount = all.length - appointments.length;
  const liveCount = all.filter((a) => !isClosedStatus(a.status)).length;

  const openNew = (initial = {}) => setDialog({ kind: 'form', initial: { date, ...initial } });

  return (
    <>
      <PageHeader
        title="Appointments"
        description={`${formatLongDate(date)}${day.data ? ` · ${liveCount} booked` : ''}`}
        actions={
          <Button onClick={() => openNew()}>
            <Plus className="size-4" /> New appointment
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="secondary" onClick={() => setDate(today)} disabled={date === today}>Today</Button>
            <Button variant="secondary" size="icon" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          <Tabs
            tabs={[
              { value: 'grid', label: 'Calendar' },
              { value: 'agenda', label: 'Agenda' },
            ]}
            value={view}
            onChange={setView}
          />
          <Checkbox
            className="ml-auto"
            label={`Show cancelled & no-shows${closedCount && !showClosed ? ` (${closedCount})` : ''}`}
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-xs text-slate-600">
          {APPOINTMENT_STATUSES.map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className={cx('size-2.5 rounded-full', LEGEND_SWATCHES[status])} aria-hidden />
              {STATUS_LABELS[status]}
            </span>
          ))}
        </div>

        {day.data?.isHoliday && (
          <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <CalendarOff className="size-4 shrink-0" aria-hidden />
            Salon closed: {day.data.holiday.description}. New bookings can’t be made for this day.
          </div>
        )}

        {day.isPending ? (
          <Spinner className="mx-auto my-16" />
        ) : day.error ? (
          <p className="px-4 py-12 text-center text-sm text-rose-600">{day.error.message}</p>
        ) : view === 'grid' ? (
          <DayGrid
            day={day.data}
            appointments={appointments}
            isToday={date === today}
            onSlot={(staffId, startTime) => openNew({ staffId, startTime })}
            onOpen={(id) => updateParams({ view: id })}
          />
        ) : (
          <Agenda appointments={appointments} isHoliday={day.data.isHoliday} onOpen={(id) => updateParams({ view: id })} onNew={() => openNew()} />
        )}
      </Card>

      {dialog?.kind === 'form' && (
        <AppointmentFormModal
          appointment={dialog.appointment}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            if (saved.date !== date) setDate(saved.date);
          }}
        />
      )}
      {viewingId && !dialog && (
        <AppointmentDetailsModal
          appointmentId={viewingId}
          onClose={() => updateParams({ view: null })}
          onEdit={(appointment) => setDialog({ kind: 'form', appointment })}
        />
      )}
    </>
  );
}
