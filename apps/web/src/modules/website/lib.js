import { toast } from 'sonner';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '@salon/shared/website';

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  } catch {
    toast.error('Could not copy. Select the text and copy it manually.');
  }
}

/** Why an image cannot be uploaded (wrong type or over 2 MB), or null when it is fine. */
export function imageProblem(file) {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name}: use a JPG, PNG or WebP image`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: images must be 2 MB or smaller`;
  return null;
}

/** Plain object -> FormData; null/undefined become '' and booleans/numbers strings. */
export function toFormData(values) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.append(key, value === null || value === undefined ? '' : String(value));
  return body;
}
