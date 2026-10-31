import { toast } from 'sonner';
import { changePasswordSchema } from '@salon/shared';
import { Button, Card, CardHeader, Field, Input, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABELS } from '../lib/format.js';
import { useApiForm } from '../lib/useApiForm.js';

export default function AccountPage() {
  const { user, organization } = useAuth();
  const form = useApiForm({
    schema: changePasswordSchema,
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    onSubmit: async (payload) => {
      await api('/auth/change-password', { method: 'POST', body: payload });
      toast.success('Password changed. Other devices have been signed out.');
      form.reset();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <>
      <PageHeader title="Account" description="Your profile and password." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title="Profile" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            {[['Name', user.name], ['Username', user.username], ['Role', ROLE_LABELS[user.role]], ['Organisation', organization?.name]].map(([label, value]) => (
              <div key={label}>
                <dt className="text-slate-500">{label}</dt>
                <dd className="font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Change password" description="Changing your password signs you out on every other device." />
          <form onSubmit={form.submit} className="grid max-w-md gap-4 px-5 py-5" noValidate>
            <Field label="Current password" error={errors.currentPassword?.message} required>
              <Input type="password" autoComplete="current-password" invalid={!!errors.currentPassword} {...register('currentPassword')} />
            </Field>
            <Field label="New password" hint="At least 8 characters" error={errors.newPassword?.message} required>
              <Input type="password" autoComplete="new-password" invalid={!!errors.newPassword} {...register('newPassword')} />
            </Field>
            <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
              <Input
                type="password"
                autoComplete="new-password"
                invalid={!!errors.confirmPassword}
                {...register('confirmPassword', { validate: (value, all) => value === all.newPassword || 'Passwords do not match' })}
              />
            </Field>
            <div>
              <Button type="submit" loading={isSubmitting}>Update password</Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
