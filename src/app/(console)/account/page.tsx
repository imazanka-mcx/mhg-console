import { currentActor } from '../../../auth/access.ts';
import { PasswordForm } from './password-form.tsx';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const actor = await currentActor();
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Account</h1>
      <p className="mt-1 text-sm text-slate-500">
        {actor?.name} · {actor?.email}
      </p>
      <PasswordForm />
    </div>
  );
}
