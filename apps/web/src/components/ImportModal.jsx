import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile } from '../lib/api.js';
import { Button, Modal } from './ui.jsx';

/**
 * Excel import: download template -> fill -> upload. The API answers `{ created, updated, errors: [{ row, message }] }`.
 * `invalidate` lists query keys to refresh after a successful import.
 */
export default function ImportModal({ title, description, columns, hint, templatePath, templateName, uploadPath, invalidate, onClose }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('file', file);
      return api(uploadPath, { method: 'POST', body });
    },
    onSuccess: (result) => {
      invalidate.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      toast.success(`Import finished: ${result.created} added, ${result.updated} updated`);
    },
    onError: (err) => toast.error(err.message),
  });
  const result = upload.data;

  async function downloadTemplate() {
    try {
      await downloadFile(templatePath, templateName);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
          <Button onClick={() => upload.mutate()} disabled={!file} loading={upload.isPending}>
            <Upload className="size-4" /> Import
          </Button>
        </>
      }
    >
      <ol className="space-y-5 text-sm text-slate-700">
        <li>
          <p className="font-medium text-slate-900">1. Download the template</p>
          <p className="mb-2 text-slate-500">Columns: {columns}.</p>
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            <Download className="size-3.5" /> {templateName}
          </Button>
        </li>
        <li>
          <p className="font-medium text-slate-900">2. Fill it in</p>
          <p className="text-slate-500">{hint}</p>
        </li>
        <li>
          <p className="font-medium text-slate-900">3. Upload the file</p>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              upload.reset();
            }}
            className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
        </li>
      </ol>

      {result && (
        <div className="mt-5 rounded-lg border border-slate-200 p-4 text-sm">
          <p className="font-medium text-slate-900">
            {result.created} added · {result.updated} updated · {result.errors.length} skipped
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-rose-700">
              {result.errors.map((error) => (
                <li key={`${error.row}-${error.message}`}>Row {error.row}: {error.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
