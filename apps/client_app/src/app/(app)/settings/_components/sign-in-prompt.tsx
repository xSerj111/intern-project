import { LogIn } from 'lucide-react';
import Link from 'next/link';

import { buttonClassName } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';

/** Shown in place of a settings section while signed out. */
export function SignInPrompt({ what }: { what: string }) {
  return (
    <EmptyState
      icon={LogIn}
      title="Log in to continue"
      description={`Sign in to ${what}.`}
      action={
        <Link href="/login" className={buttonClassName()}>
          Log in
        </Link>
      }
    />
  );
}
