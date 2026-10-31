import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CASH_METHODS, formatINR, paiseToRupees } from '@salon/shared';
import { expenseSchema } from '@salon/shared/hr';
import { Button, Card, cx, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, moneyInput, todayIso } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { METHOD_LABELS, monthBounds, thisMonth } from './labels.js';

export default function ExpensesPage() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState(() => monthBounds(thisMonth()));
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  const params = { ...range, category, page };
  const expenses = useQuery({
    queryKey: [branchId, 'expenses', params],
    queryFn: () => api(`/expenses?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
    enabled: Boolean(range.from && range.to),
  });
  const categories = useQuery({ queryKey: [branchId, 'expense-categories'], queryFn: () => api('/expenses/categories'), staleTime: 5 * 60_000 });

  const remove = useMutation({
    mutationFn: (id) => api(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: [branchId, 'expenses'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const setDate = (key, value) => {
    setRange((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const pickCategory = (value) => {
    setCategory(value);
    setPage(1);
  };

  const data = expenses.data;
  const columns = [
    { key: 'spentOn', header: 'Date', className: 'whitespace-nowrap', render: (e) => formatDate(e.spentOn) },
    { key: 'category', header: 'Category', render: (e) => <span className="font-medium text-slate-900">{e.category}</span> },
    {
      key: 'details',
      header: 'Paid to / details',
      render: (e) => (
        <div className="max-w-sm">
          <div>{e.paidTo || '—'}</div>
          {e.description && <div className="truncate text-xs text-slate-500">{e.description}</div>}
        </div>
      ),
    },
    { key: 'method', header: 'Method', render: (e) => METHOD_LABELS[e.method] ?? e.method },
    { key: 'amount', header: 'Amount', className: 'text-right whitespace-nowrap tabular-nums font-medium', render: (e) => formatINR(e.amountPaise) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (e) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${e.category} expense`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete the ${e.category} expense of ${formatINR(e.amountPaise)} on ${formatDate(e.spentOn)}?`)) remove.mutate(e.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Rent, bills, supplies and other money going out of this branch."
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus className="size-4" /> Add expense
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="From" className="w-44">
            <Input type="date" value={range.from} max={range.to} onChange={(e) => setDate('from', e.target.value)} />
          </Field>
          <Field label="To" className="w-44">
            <Input type="date" value={range.to} min={range.from} onChange={(e) => setDate('to', e.target.value)} />
          </Field>
          <Field label="Category" className="w-52">
            <Select value={category} onChange={(e) => pickCategory(e.target.value)}>
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          {data && (
            <div className="mb-1 ml-auto text-right">
              <div className="text-xs text-slate-500">{category ? `${category} total` : 'Total spent'}</div>
              <div className="text-lg font-semibold text-slate-900 tabular-nums">{formatINR(data.totalPaise)}</div>
            </div>
          )}
        </div>

        {data?.totalsByCategory.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3" aria-label="Totals by category">
            {data.totalsByCategory.map((t) => {
              const active = category.toLowerCase() === t.category.toLowerCase();
              return (
                <button
                  key={t.category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickCategory(active ? '' : t.category)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                    active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span className="font-medium">{t.category}</span>
                  <span className={cx('tabular-nums', active ? 'text-white/85' : 'text-slate-500')}>{formatINR(t.amountPaise)}</span>
                </button>
              );
            })}
          </div>
        )}

        <DataTable
          columns={columns}
          rows={data?.items}
          loading={expenses.isPending}
          error={expenses.error}
          empty={
            <EmptyState
              icon={IndianRupee}
              title={category ? `No ${category} expenses in this period` : 'No expenses in this period'}
              action={!category && <Button onClick={() => setEditing({})}>Add expense</Button>}
            />
          }
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Card>

      {editing && <ExpenseFormModal expense={editing} categories={categories.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function ExpenseFormModal({ expense, categories, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !expense.id;

  const form = useApiForm({
    schema: expenseSchema,
    defaultValues: {
      spentOn: expense.spentOn ?? todayIso(),
      category: expense.category ?? '',
      amountPaise: isNew ? '' : paiseToRupees(expense.amountPaise),
      method: expense.method ?? 'CASH',
      paidTo: expense.paidTo ?? '',
      description: expense.description ?? '',
    },
    toPayload: (values) => ({ ...values, amountPaise: moneyInput(values.amountPaise) }),
    onSubmit: async (payload) => {
      await api(isNew ? '/expenses' : `/expenses/${expense.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Expense added' : 'Expense updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'expenses'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'expense-categories'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add expense' : 'Edit expense'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="expense-form" loading={isSubmitting}>{isNew ? 'Add expense' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" error={errors.spentOn?.message} required>
          <Input type="date" invalid={!!errors.spentOn} {...register('spentOn')} />
        </Field>
        <Field label="Category" hint="Pick one or type your own" error={errors.category?.message} required>
          <Input list="expense-categories" autoComplete="off" maxLength={60} invalid={!!errors.category} {...register('category')} />
          <datalist id="expense-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Amount (₹)" error={errors.amountPaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.amountPaise} {...register('amountPaise')} />
        </Field>
        <Field label="Paid by" error={errors.method?.message} required>
          <Select invalid={!!errors.method} {...register('method')}>
            {CASH_METHODS.map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Paid to" error={errors.paidTo?.message} className="sm:col-span-2">
          <Input placeholder="e.g. Landlord, electricity board" invalid={!!errors.paidTo} {...register('paidTo')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea rows={2} invalid={!!errors.description} {...register('description')} />
        </Field>
      </form>
    </Modal>
  );
}
