import { loginSchema } from '@salon/shared';
import { Button, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useApiForm } from '../lib/useApiForm.js';

export default function LoginPage() {
  const { login } = useAuth();
  const form = useApiForm({ schema: loginSchema, defaultValues: { username: '', password: '' }, onSubmit: login });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid size-9 place-items-center rounded-lg bg-white/15 font-bold">S</span>
          Sabilling
        </div>
        <div>
          <h1 className="max-w-md text-4xl leading-tight font-semibold">Run every chair, booking and bill from one place.</h1>
          <p className="mt-4 max-w-md text-brand-100">Appointments, billing, clients, staff and stock for salons and spas, across all your branches.</p>
        </div>
        <p className="text-sm text-brand-100">© {new Date().getFullYear()} Sabilling</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={form.submit} className="w-full max-w-sm space-y-5" noValidate>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Use the username and password your administrator gave you.</p>
          </div>
          <Field label="Username" error={errors.username?.message}>
            <Input autoComplete="username" autoFocus invalid={!!errors.username} {...register('username')} />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <Input type="password" autoComplete="current-password" invalid={!!errors.password} {...register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>Sign in</Button>
        </form>
      </div>
    </div>
  );
}
