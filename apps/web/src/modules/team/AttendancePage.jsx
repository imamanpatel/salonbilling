import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, LogIn, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { STAFF_KINDS } from '@salon/shared';
import { ATTENDANCE_STATUSES } from '@salon/shared/hr';
import { Button, Card, cx, DataTable, EmptyState, Field, Input, PageHeader, Spinner, Tabs } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, todayIso } from '../../lib/format.js';
import { ATTENDANCE_LABELS, ATTENDANCE_SHORT, ATTENDANCE_TONES, formatMonth, thisMonth } from './labels.js';

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
];

export default function AttendancePage() {
  const [view, setView] = useState('day');
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Mark who is in today, or review the month at a glance."
        actions={<Tabs tabs={VIEWS} value={view} onChange={setView} />}
      />
      {view === 'day' ? <DayView /> : <MonthView />}
    </>
  );
}

const kindLabel = (staff) => (staff.kind === STAFF_KINDS.SERVICE_PROVIDER ? staff.designation || 'Service provider' : staff.department || 'Staff');

function DayView() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const isToday = date === todayIso();

  const day = useQuery({ queryKey: [branchId, 'attendance', 'day', date], queryFn: () => api(`/attendance?date=${date}`), enabled: Boolean(date) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [branchId, 'attendance'] });

  const save = useMutation({
    mutationFn: (body) => api('/attendance', { method: 'PUT', body }),
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(err.details ? Object.values(err.details)[0] : err.message);
      invalidate();
    },
  });
  const clock = useMutation({
    mutationFn: ({ action, staffId }) => api(`/attendance/${action}`, { method: 'POST', body: { staffId } }),
    onSuccess: (record, { action, name }) => {
      toast.success(action === 'check-in' ? `${name} checked in at ${record.checkIn}` : `${name} checked out at ${record.checkOut}`);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const mark = (row, changes) => {
    const current = row.record ?? {};
    const next = { status: current.status ?? 'PRESENT', checkIn: current.checkIn ?? null, checkOut: current.checkOut ?? null, ...changes };
    // Nobody clocks in on a day off.
    if (next.status === 'ABSENT' || next.status === 'LEAVE') Object.assign(next, { checkIn: null, checkOut: null });
    save.mutate({ staffId: row.id, date, note: current.note ?? null, ...next });
  };

  const rows = day.data?.map((r) => ({ ...r, id: r.staff.id }));
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, rows?.filter((r) => r.record?.status === s).length ?? 0]));
  const unmarked = rows?.filter((r) => !r.record).length ?? 0;
  const busy = (row) => (save.isPending && save.variables?.staffId === row.id) || (clock.isPending && clock.variables?.staffId === row.id);

  const columns = [
    {
      key: 'name',
      header: 'Staff',
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.staff.name}</div>
          <div className="text-xs text-slate-500">{kindLabel(r.staff)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPicker name={r.staff.name} value={r.record?.status} disabled={busy(r)} onChange={(status) => mark(r, { status })} />,
    },
    {
      key: 'checkIn',
      header: 'Check in',
      render: (r) => (
        <TimeInput key={r.record?.checkIn ?? ''} label={`Check-in time for ${r.staff.name}`} value={r.record?.checkIn} disabled={busy(r)} onCommit={(checkIn) => mark(r, { checkIn })} />
      ),
    },
    {
      key: 'checkOut',
      header: 'Check out',
      render: (r) => (
        <TimeInput key={r.record?.checkOut ?? ''} label={`Check-out time for ${r.staff.name}`} value={r.record?.checkOut} disabled={busy(r)} onCommit={(checkOut) => mark(r, { checkOut })} />
      ),
    },
    isToday && {
      key: 'actions',
      header: <span className="sr-only">Quick actions</span>,
      className: 'text-right',
      render: (r) => {
        const action = !r.record?.checkIn ? 'check-in' : !r.record.checkOut ? 'check-out' : null;
        if (!action) return null;
        return (
          <Button
            variant="secondary"
            size="sm"
            loading={clock.isPending && clock.variables?.staffId === r.id}
            disabled={busy(r)}
            onClick={() => clock.mutate({ action, staffId: r.id, name: r.staff.name })}
          >
            {action === 'check-in' ? <LogIn className="size-3.5" /> : <LogOut className="size-3.5" />}
            {action === 'check-in' ? 'Check in now' : 'Check out now'}
          </Button>
        );
      },
    },
  ].filter(Boolean);

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-4 border-b border-slate-100 p-4">
        <Field label="Date" className="w-44">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {!isToday && (
          <Button variant="ghost" size="sm" className="mb-1" onClick={() => setDate(todayIso())}>Back to today</Button>
        )}
        {rows && (
          <p className="mb-2 ml-auto text-sm text-slate-600">
            {ATTENDANCE_STATUSES.map((s) => `${counts[s]} ${ATTENDANCE_LABELS[s].toLowerCase()}`).join(' · ')}
            {unmarked > 0 && <span className="text-slate-400"> · {unmarked} not marked</span>}
          </p>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        loading={day.isPending}
        error={day.error}
        empty={<EmptyState icon={CalendarCheck} title="No active staff" description="Add staff on the Staff page to start marking attendance." />}
      />
      {rows?.length > 0 && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Showing {formatDate(date)}. Changes save as you go.</p>}
    </Card>
  );
}

function StatusPicker({ name, value, disabled, onChange }) {
  return (
    <div role="group" aria-label={`Attendance for ${name}`} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {ATTENDANCE_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          aria-pressed={value === status}
          disabled={disabled}
          onClick={() => value !== status && onChange(status)}
          className={cx(
            'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            value === status ? ATTENDANCE_TONES[status] : 'text-slate-600 hover:bg-white hover:text-slate-900',
          )}
        >
          {ATTENDANCE_LABELS[status]}
        </button>
      ))}
    </div>
  );
}

/** Saves on blur, only when the value changed. Remount (via key) to pick up a new server value. */
function TimeInput({ label, value, disabled, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <Input
      type="time"
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value ?? '') && onCommit(draft || null)}
      className="w-32"
    />
  );
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MonthView() {
  const { branchId } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const grid = useQuery({ queryKey: [branchId, 'attendance', 'month', month], queryFn: () => api(`/attendance/monthly?month=${month}`), enabled: Boolean(month) });

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-4 border-b border-slate-100 p-4">
        <Field label="Month" className="w-48">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <ul className="mb-2 ml-auto flex flex-wrap gap-3 text-xs text-slate-600" aria-label="Legend">
          {ATTENDANCE_STATUSES.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cx('grid size-5 place-items-center rounded text-[10px] font-semibold', ATTENDANCE_TONES[s])}>{ATTENDANCE_SHORT[s]}</span>
              {ATTENDANCE_LABELS[s]}
            </li>
          ))}
        </ul>
      </div>

      {grid.isPending ? (
        <div className="py-12">
          <Spinner className="mx-auto" />
        </div>
      ) : grid.error ? (
        <p className="px-4 py-12 text-center text-sm text-rose-600">{grid.error.message}</p>
      ) : !grid.data.staff.length ? (
        <EmptyState icon={CalendarCheck} title={`No attendance for ${formatMonth(month)}`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">Staff</th>
                {grid.data.days.map((d) => {
                  const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
                  return (
                    <th key={d} scope="col" className={cx('px-0.5 py-2 text-center text-[11px] font-medium text-slate-500', weekday === 0 && 'bg-slate-100')}>
                      <span className="block">{WEEKDAYS[weekday]}</span>
                      <span className="block font-semibold text-slate-700 tabular-nums">{Number(d.slice(8))}</span>
                    </th>
                  );
                })}
                {['P', 'H', 'A', 'L'].map((h) => (
                  <th key={h} scope="col" className="border-l border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.data.staff.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <th scope="row" className="sticky left-0 z-10 border-t border-slate-100 bg-white px-4 py-2 text-left font-medium whitespace-nowrap text-slate-900">
                    {s.name}
                  </th>
                  {grid.data.days.map((d) => {
                    const record = s.records[d];
                    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
                    return (
                      <td key={d} className={cx('border-t border-slate-100 px-0.5 py-1.5 text-center', weekday === 0 && 'bg-slate-50')}>
                        {record ? (
                          <span
                            title={`${formatDate(d)}: ${ATTENDANCE_LABELS[record.status]}${record.checkIn ? ` · ${record.checkIn}–${record.checkOut ?? '…'}` : ''}`}
                            className={cx('mx-auto grid size-6 place-items-center rounded text-[11px] font-semibold', ATTENDANCE_TONES[record.status])}
                          >
                            {ATTENDANCE_SHORT[record.status]}
                          </span>
                        ) : (
                          <span className="text-slate-300" aria-label="Not marked">·</span>
                        )}
                      </td>
                    );
                  })}
                  {[s.summary.present, s.summary.halfDay, s.summary.absent, s.summary.leave].map((n, i) => (
                    <td key={i} className="border-t border-l border-slate-100 border-l-slate-200 px-2 py-1.5 text-center font-medium tabular-nums text-slate-700">{n}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
