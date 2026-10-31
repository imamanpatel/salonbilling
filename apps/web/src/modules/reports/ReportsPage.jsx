import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { fieldErrors, PAYMENT_METHODS } from '@salon/shared';
import { ITEM_KIND_LABELS, METHOD_LABELS, presetRange, RANGE_PRESETS, reportRangeSchema, REPORTS, SALES_KINDS } from '@salon/shared/reports';
import { Button, Card, cx, Field, Input, PageHeader, Select, Spinner, Tabs } from '../../components/ui.jsx';
import { api, downloadFile } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, todayIso } from '../../lib/format.js';
import { REPORT_VIEWS } from './views.jsx';

const DEFAULT_PRESET = 'this-month';

// Optional per-report filter kept in the URL next to the range.
const FILTERS = {
  'sales-by-item': { param: 'kind', label: 'Item type', all: 'All items', options: SALES_KINDS.map((k) => [k, ITEM_KIND_LABELS[k]]) },
  collections: { param: 'method', label: 'Method', all: 'All methods', options: PAYMENT_METHODS.map((m) => [m, METHOD_LABELS[m]]) },
};

export default function ReportsPage() {
  const { branchId } = useAuth();
  const [params, setParams] = useSearchParams();
  const [downloading, setDownloading] = useState(false);
  const today = todayIso();

  const report = REPORTS.find((r) => r.key === params.get('report')) ?? REPORTS[0];
  const preset = RANGE_PRESETS.some((p) => p.value === params.get('preset')) ? params.get('preset') : DEFAULT_PRESET;
  const fallback = presetRange(DEFAULT_PRESET, today);
  const range = preset === 'custom' ? { from: params.get('from') || fallback.from, to: params.get('to') || fallback.to } : presetRange(preset, today);
  const filter = FILTERS[report.key];
  const filterValue = filter ? (params.get(filter.param) ?? '') : '';

  const rangeCheck = reportRangeSchema.safeParse(range);
  const rangeErrors = rangeCheck.success ? {} : fieldErrors(rangeCheck.error);
  const ready = !report.ranged || rangeCheck.success;

  const query = new URLSearchParams(report.ranged ? range : {});
  if (filterValue) query.set(filter.param, filterValue);
  const qs = query.toString();

  const result = useQuery({
    queryKey: [branchId, 'reports', report.key, qs],
    queryFn: () => api(`/reports/${report.key}${qs ? `?${qs}` : ''}`),
    enabled: ready,
  });

  const update = (changes) =>
    setParams(
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

  const choosePreset = (value) =>
    update(value === 'custom' ? { preset: value, from: range.from, to: range.to } : { preset: value, from: '', to: '' });

  async function download() {
    setDownloading(true);
    try {
      const suffix = report.ranged ? `${range.from}-${range.to}` : today;
      await downloadFile(`/reports/${report.key}?${qs ? `${qs}&` : ''}format=xlsx`, `${report.key}-${suffix}.xlsx`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const View = REPORT_VIEWS[report.key];
  const period = report.ranged
    ? range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`
    : `As of ${formatDate(today)}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${report.label} · ${period}`}
        actions={
          <Button variant="secondary" onClick={download} loading={downloading} disabled={!ready}>
            <Download className="size-4" /> Download Excel
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Reports" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-current={r.key === report.key ? 'page' : undefined}
              onClick={() => update({ report: r.key, kind: '', method: '' })}
              className={cx(
                'shrink-0 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
                r.key === report.key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              {r.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {(report.ranged || filter) && (
            <Card className="flex flex-wrap items-end gap-4 p-4">
              {report.ranged && (
                <div className="overflow-x-auto">
                  <Tabs tabs={RANGE_PRESETS} value={preset} onChange={choosePreset} />
                </div>
              )}
              {report.ranged && preset === 'custom' && (
                <>
                  <Field label="From" error={rangeErrors.from} className="w-40">
                    <Input type="date" value={range.from} max={today} invalid={Boolean(rangeErrors.from)} onChange={(e) => update({ from: e.target.value })} />
                  </Field>
                  <Field label="To" error={rangeErrors.to} className="w-40">
                    <Input type="date" value={range.to} invalid={Boolean(rangeErrors.to)} onChange={(e) => update({ to: e.target.value })} />
                  </Field>
                </>
              )}
              {filter && (
                <Field label={filter.label} className="w-44">
                  <Select value={filterValue} onChange={(e) => update({ [filter.param]: e.target.value })}>
                    <option value="">{filter.all}</option>
                    {filter.options.map(([value, text]) => (
                      <option key={value} value={value}>{text}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </Card>
          )}

          {!ready ? null : result.isPending ? (
            <Spinner className="mx-auto mt-16 size-8" />
          ) : result.error ? (
            <Card className="px-5 py-10 text-center text-sm text-rose-600">{result.error.message}</Card>
          ) : (
            <View data={result.data} />
          )}
        </div>
      </div>
    </>
  );
}
