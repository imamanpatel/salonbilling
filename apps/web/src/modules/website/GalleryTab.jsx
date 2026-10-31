import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Images, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_GALLERY_UPLOAD } from '@salon/shared/website';
import { Button, Card, CardHeader, EmptyState, Field, Input, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { imageProblem } from './lib.js';

export default function GalleryTab() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const key = [branchId, 'website', 'gallery'];
  const photos = useQuery({ queryKey: key, queryFn: () => api('/website/gallery') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const remove = useMutation({
    mutationFn: (photo) => api(`/website/gallery/${photo.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Photo deleted');
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-5">
      {canManage && <UploadCard onUploaded={refresh} />}

      {photos.isPending ? (
        <Spinner className="mx-auto my-12" />
      ) : photos.error ? (
        <p className="text-sm text-rose-600">{photos.error.message}</p>
      ) : !photos.data.length ? (
        <Card>
          <EmptyState icon={Images} title="No photos yet" description="Show off your salon, your team and your best work." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {photos.data.map((photo) => (
            <PhotoCard key={photo.id} photo={photo} canManage={canManage} onSaved={refresh} onDelete={() => remove.mutate(photo)} deleting={remove.isPending} />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadCard({ onUploaded }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [caption, setCaption] = useState('');

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      files.forEach((file) => body.append('images', file));
      body.append('caption', caption);
      return api('/website/gallery', { method: 'POST', body });
    },
    onSuccess: (created) => {
      toast.success(`${created.length} ${created.length === 1 ? 'photo' : 'photos'} added`);
      setFiles([]);
      setCaption('');
      if (inputRef.current) inputRef.current.value = '';
      onUploaded();
    },
    onError: (err) => toast.error(err.message),
  });

  function pick(e) {
    const picked = [...(e.target.files ?? [])];
    const problem = picked.length > MAX_GALLERY_UPLOAD ? `Upload up to ${MAX_GALLERY_UPLOAD} photos at a time` : picked.map(imageProblem).find(Boolean);
    if (problem) {
      toast.error(problem);
      e.target.value = '';
      setFiles([]);
      return;
    }
    setFiles(picked);
  }

  return (
    <Card>
      <CardHeader title="Add photos" description={`Up to ${MAX_GALLERY_UPLOAD} JPG, PNG or WebP images at a time, 2 MB each.`} />
      <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
        <Field label="Photos" className="min-w-56 flex-1">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={pick}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
        </Field>
        <Field label="Caption (optional)" className="min-w-56 flex-1">
          <Input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Our bridal studio" />
        </Field>
        <Button onClick={() => upload.mutate()} disabled={!files.length} loading={upload.isPending}>
          <Upload className="size-4" /> Upload {files.length > 0 && `(${files.length})`}
        </Button>
      </div>
    </Card>
  );
}

function PhotoCard({ photo, canManage, onSaved, onDelete, deleting }) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [sortOrder, setSortOrder] = useState(String(photo.sortOrder));
  const dirty = caption !== (photo.caption ?? '') || sortOrder !== String(photo.sortOrder);

  const save = useMutation({
    mutationFn: () => api(`/website/gallery/${photo.id}`, { method: 'PATCH', body: { caption, sortOrder } }),
    onSuccess: () => {
      toast.success('Photo updated');
      onSaved();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card className="overflow-hidden">
      <img src={photo.imageUrl} alt={photo.caption ?? ''} className="aspect-square w-full object-cover" loading="lazy" />
      {canManage ? (
        <form
          className="space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input aria-label="Caption" placeholder="Caption" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} className="text-xs" />
          <div className="flex items-center gap-2">
            <Input aria-label="Display order" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="w-20 text-xs" title="Display order (lower first)" />
            {dirty && <Button type="submit" size="sm" loading={save.isPending}>Save</Button>}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label="Delete photo"
              disabled={deleting}
              onClick={() => window.confirm('Delete this photo?') && onDelete()}
            >
              <Trash2 className="size-4 text-rose-600" />
            </Button>
          </div>
        </form>
      ) : (
        photo.caption && <p className="p-3 text-xs text-slate-600">{photo.caption}</p>
      )}
    </Card>
  );
}
