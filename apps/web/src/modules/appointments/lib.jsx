import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';

export const STATUS_LABELS = {
  REQUESTED: 'Requested',
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  BILLED: 'Billed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};
export const STATUS_TONES = { REQUESTED: 'amber', BOOKED: 'brand', CHECKED_IN: 'blue', BILLED: 'green', CANCELLED: 'slate', NO_SHOW: 'slate' };

/** Calendar block colours per status (border accent + fill + text). */
export const BLOCK_CLASSES = {
  REQUESTED: 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100',
  BOOKED: 'border-brand-500 bg-brand-50 text-brand-900 hover:bg-brand-100',
  CHECKED_IN: 'border-sky-500 bg-sky-50 text-sky-900 hover:bg-sky-100',
  BILLED: 'border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-100',
  CANCELLED: 'border-slate-300 bg-slate-100 text-slate-500 line-through hover:bg-slate-200',
  NO_SHOW: 'border-slate-300 bg-slate-100 text-slate-500 line-through hover:bg-slate-200',
};

export const SOURCE_LABELS = { WALK_IN: 'Walk-in', PHONE: 'Phone', WEBSITE: 'Website', APP: 'App', OTHER: 'Other' };
export const METHOD_LABELS = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', OTHER: 'Other' };

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isClosedStatus = (status) => status === 'CANCELLED' || status === 'NO_SHOW';

/** "2026-10-31" + 1 -> "2026-11-01" */
export const shiftDate = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const weekdayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' });

/** "2026-10-31" -> "Saturday, 31 Oct 2026" */
export const formatLongDate = (iso) => `${weekdayFormat.format(new Date(`${iso}T00:00:00Z`))}, ${formatDate(iso)}`;

export const serviceSummary = (appointment) => appointment.items.map((item) => item.service.name).join(', ');

export function AppointmentStatusBadge({ status }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

/** Day view: providers, holiday and every appointment on `date` (null disables the query). */
export function useAppointmentDay(date) {
  const { branchId } = useAuth();
  return useQuery({
    queryKey: [branchId, 'appointments', { date }],
    queryFn: () => api(`/appointments?date=${date}`),
    enabled: Boolean(date && ISO_DATE.test(date)),
  });
}

export function useInvalidateAppointments() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [branchId, 'appointments'] });
}
