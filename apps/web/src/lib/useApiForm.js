import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { fieldErrors } from '@salon/shared';
import { ApiError } from './api.js';

/**
 * react-hook-form wired to a shared Zod schema.
 * Name form fields like the API payload keys; `toPayload` converts values (e.g. rupees -> paise) so the
 * same schema validates on the client, and API field errors land on the matching inputs.
 */
export function useApiForm({ schema, defaultValues, toPayload = (values) => values, onSubmit }) {
  const form = useForm({ defaultValues });

  const submit = form.handleSubmit(async (values) => {
    const parsed = schema.safeParse(toPayload(values));
    if (!parsed.success) {
      applyErrors(form, fieldErrors(parsed.error));
      return;
    }
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      if (err instanceof ApiError && err.details) applyErrors(form, err.details);
      toast.error(err.message);
    }
  });

  return { ...form, submit };
}

function applyErrors(form, errors) {
  for (const [name, message] of Object.entries(errors)) {
    if (name === '_form') toast.error(message);
    else form.setError(name, { type: 'server', message });
  }
}
