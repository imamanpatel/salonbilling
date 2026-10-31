import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ACTIVE_APPOINTMENT_STATUSES } from '@salon/shared/appointments';
import { Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, todayIso } from '../../lib/format.js';
import { AppointmentStatusBadge, serviceSummary } from './lib.jsx';

const PAGE_SIZE = 20;

function AppointmentRows({ appointments }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {appointments.map((a) => (
        <li key={a.id}>
          <Link
            to={`/appointments?date=${a.date}&view=${a.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-slate-50"
          >
            <span className="w-28 text-slate-700">{formatDate(a.date)}</span>
            <span className="w-24 text-slate-500 tabular-nums">{a.startTime}–{a.endTime}</span>
            <span className="min-w-40 flex-1 text-slate-800">{serviceSummary(a)}</span>
            <AppointmentStatusBadge status={a.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Client profile section: upcoming and recent appointments at the current branch. */
export default function ClientAppointments({ client }) {
  const { branchId } = useAuth();
  const params = { clientId: client.id, pageSize: PAGE_SIZE };
  const list = useQuery({
    queryKey: [branchId, 'appointments', params],
    queryFn: () => api(`/appointments?${new URLSearchParams(params)}`),
  });

  const today = todayIso();
  const items = list.data?.items ?? [];
  const isUpcoming = (a) => a.date >= today && ACTIVE_APPOINTMENT_STATUSES.includes(a.status);
  // The API lists newest first; show upcoming ones soonest first.
  const upcoming = items.filter(isUpcoming).reverse();
  const recent = items.filter((a) => !isUpcoming(a));

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Appointments</h3>
      {list.isPending ? (
        <Spinner className="mx-auto my-4" />
      ) : list.error ? (
        <p className="text-sm text-rose-600">{list.error.message}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No appointments at this branch yet.</p>
      ) : (
        <div className="space-y-3">
          {upcoming.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Upcoming</p>
              <AppointmentRows appointments={upcoming} />
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Recent</p>
              <AppointmentRows appointments={recent} />
            </div>
          )}
          {list.data.total > PAGE_SIZE && (
            <p className="text-xs text-slate-500">Showing the latest {PAGE_SIZE} of {list.data.total} appointments.</p>
          )}
        </div>
      )}
    </section>
  );
}
