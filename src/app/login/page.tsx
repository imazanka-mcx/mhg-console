import { redirect } from 'next/navigation';

import { currentActor } from '../../auth/access.ts';
import { LoginForm } from './login-form.tsx';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentActor()) redirect('/portfolio');
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <LoginForm />
    </div>
  );
}
