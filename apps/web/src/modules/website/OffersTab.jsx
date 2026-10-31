import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { offerSchema } from '@salon/shared/website';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, Spinner, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, todayIso } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { imageProblem, toFormData } from './lib.js';

const offerFields = (offer) => ({
  title: offer.title,
  description: offer.description,
  validTo: offer.validTo,
  sortOrder: offer.sortOrder,
  isActive: offer.isActive,
});

export default function OffersTab() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const key = [branchId, 'website', 'offers'];
  const offers = useQuery({ queryKey: key, queryFn: () => api('/website/offers') });

  const save = useMutation({
    mutationFn: ({ offer, changes }) => api(`/website/offers/${offer.id}`, { method: 'PUT', body: { ...offerFields(offer), ...changes } }),
    onSuccess: (offer) => {
      toast.success(offer.isActive ? `${offer.title} is live` : `${offer.title} hidden from the website`);
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: (offer) => api(`/website/offers/${offer.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Offer deleted');
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(err.message),
  });

  const today = todayIso();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Active offers that have not expired appear on your website and booking API.</p>
        {canManage && (
          <Button onClick={() => setEditing({})}>
            <Plus className="size-4" /> Add offer
          </Button>
        )}
      </div>

      {offers.isPending ? (
        <Spinner className="mx-auto my-12" />
      ) : offers.error ? (
        <p className="text-sm text-rose-600">{offers.error.message}</p>
      ) : !offers.data.length ? (
        <Card>
          <EmptyState
            icon={Tag}
            title="No offers yet"
            description="Promote festive deals, combos or first-visit discounts with a picture."
            action={canManage && <Button onClick={() => setEditing({})}>Add offer</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {offers.data.map((offer) => {
            const expired = offer.validTo && offer.validTo < today;
            return (
              <Card key={offer.id} className="flex flex-col overflow-hidden">
                {offer.imageUrl ? (
                  <img src={offer.imageUrl} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid aspect-video place-items-center bg-brand-50 text-brand-300">
                    <ImageIcon className="size-10" aria-hidden />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-slate-900">{offer.title}</h3>
                    {expired ? <Badge tone="amber">Expired</Badge> : <Badge tone={offer.isActive ? 'green' : 'slate'}>{offer.isActive ? 'Live' : 'Hidden'}</Badge>}
                  </div>
                  {offer.description && <p className="mt-1 line-clamp-3 text-sm text-slate-600">{offer.description}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    {offer.validTo ? `Valid till ${formatDate(offer.validTo)}` : 'No end date'} · Order {offer.sortOrder}
                  </p>
                  {canManage && (
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                      <Checkbox
                        label="Show on website"
                        checked={offer.isActive}
                        disabled={save.isPending}
                        onChange={(e) => save.mutate({ offer, changes: { isActive: e.target.checked } })}
                      />
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(offer)}>
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${offer.title}`}
                          disabled={remove.isPending}
                          onClick={() => window.confirm(`Delete the offer "${offer.title}"?`) && remove.mutate(offer)}
                        >
                          <Trash2 className="size-3.5 text-rose-600" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && <OfferFormModal offer={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function OfferFormModal({ offer, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !offer.id;
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(offer.imageUrl ?? null);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const form = useApiForm({
    schema: offerSchema,
    defaultValues: {
      title: offer.title ?? '',
      description: offer.description ?? '',
      validTo: offer.validTo ?? '',
      sortOrder: offer.sortOrder ?? 0,
      isActive: offer.isActive ?? true,
    },
    toPayload: (values) => ({ ...values, removeImage: removeImage && !file }),
    onSubmit: async (payload) => {
      const body = toFormData(payload);
      if (file) body.append('image', file);
      await api(isNew ? '/website/offers' : `/website/offers/${offer.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast.success(isNew ? 'Offer added' : 'Offer updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'website', 'offers'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  function pickFile(e) {
    const picked = e.target.files?.[0] ?? null;
    const problem = picked && imageProblem(picked);
    if (problem) {
      toast.error(problem);
      e.target.value = '';
      return;
    }
    setFile(picked);
    setRemoveImage(false);
  }

  return (
    <Modal
      title={isNew ? 'Add offer' : 'Edit offer'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="offer-form" loading={isSubmitting}>{isNew ? 'Add offer' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="offer-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" error={errors.title?.message} required className="sm:col-span-2">
          <Input placeholder="e.g. Diwali glow facial – 20% off" invalid={!!errors.title} {...register('title')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea rows={3} invalid={!!errors.description} {...register('description')} />
        </Field>
        <Field label="Valid till" hint="Leave blank for no end date" error={errors.validTo?.message}>
          <Input type="date" invalid={!!errors.validTo} {...register('validTo')} />
        </Field>
        <Field label="Display order" hint="Lower numbers show first" error={errors.sortOrder?.message}>
          <Input type="number" min={0} invalid={!!errors.sortOrder} {...register('sortOrder')} />
        </Field>
        <Field as="div" label="Picture" hint="JPG, PNG or WebP up to 2 MB. Wide (16:9) pictures look best." className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-4">
            {preview && !removeImage ? (
              <img src={preview} alt="" className="aspect-video w-40 rounded-lg border border-slate-200 object-cover" />
            ) : (
              <div className="grid aspect-video w-40 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-400">
                <ImageIcon className="size-6" aria-hidden />
              </div>
            )}
            <div className="space-y-2">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Offer picture"
                onChange={pickFile}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
              />
              {!isNew && offer.imageUrl && !file && (
                <Checkbox label="Remove the current picture" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} />
              )}
            </div>
          </div>
        </Field>
        <Checkbox className="sm:col-span-2" label="Show on website" {...register('isActive')} />
      </form>
    </Modal>
  );
}
