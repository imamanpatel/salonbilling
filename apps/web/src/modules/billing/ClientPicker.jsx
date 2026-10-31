import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { clientSchema, GENDERS } from '@salon/shared';
import { Button, Field, Input, Select, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { GENDER_LABELS } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import { useApiForm } from '../../lib/useApiForm.js';

/** Type-ahead client search with an inline "new client" form. */
export default function ClientPicker({ client, onChange, disabled }) {
  const { branchId } = useAuth();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const q = useDebounced(search.trim());
  const results = useQuery({
    queryKey: [branchId, 'clients', 'picker', q],
    queryFn: () => api(`/clients?${new URLSearchParams({ q, pageSize: 8 })}`),
    enabled: q.length >= 2,
  });

  if (client) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="font-medium text-slate-900">{client.name}</p>
          <p className="text-sm text-slate-500 tabular-nums">{client.phone}</p>
        </div>
        {!disabled && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X className="size-3.5" /> Change
          </Button>
        )}
      </div>
    );
  }

  if (adding) {
    return (
      <NewClientForm
        initial={search.trim()}
        onCancel={() => setAdding(false)}
        onSaved={(saved) => {
          setAdding(false);
          setSearch('');
          onChange(saved);
        }}
      />
    );
  }

  const items = results.data?.items ?? [];
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            type="search"
            autoFocus
            placeholder="Search client by name or phone"
            aria-label="Search client"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <UserPlus className="size-4" /> New client
        </Button>
      </div>
      {q.length >= 2 && (
        <div className="mt-2 rounded-lg border border-slate-200">
          {results.isPending ? (
            <Spinner className="mx-auto my-4" />
          ) : items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              No match.{' '}
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setAdding(true)}>
                Add “{search.trim()}” as a new client
              </button>
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onChange({ id: c.id, name: c.name, phone: c.phone, email: c.email })}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <span className="text-slate-500 tabular-nums">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NewClientForm({ initial, onCancel, onSaved }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const looksLikePhone = /^[+\d\s-]{6,}$/.test(initial);
  const form = useApiForm({
    schema: clientSchema,
    defaultValues: { name: looksLikePhone ? '' : initial, phone: looksLikePhone ? initial : '', gender: 'FEMALE' },
    onSubmit: async (payload) => {
      const saved = await api('/clients', { method: 'POST', body: payload });
      toast.success(`${saved.name} added`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'clients'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'client-segments'] });
      onSaved({ id: saved.id, name: saved.name, phone: saved.phone, email: saved.email });
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <form onSubmit={form.submit} noValidate className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_8rem]">
      <Field label="Name" error={errors.name?.message} required>
        <Input autoFocus invalid={!!errors.name} {...register('name')} />
      </Field>
      <Field label="Phone" error={errors.phone?.message} required>
        <Input type="tel" inputMode="tel" invalid={!!errors.phone} {...register('phone')} />
      </Field>
      <Field label="Gender" error={errors.gender?.message} required>
        <Select {...register('gender')}>
          {GENDERS.map((g) => (
            <option key={g} value={g}>{GENDER_LABELS[g]}</option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" loading={isSubmitting}>Add client</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
