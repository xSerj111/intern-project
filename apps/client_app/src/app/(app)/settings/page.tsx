'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const DESKTOP = '(min-width: 768px)';

/**
 * Settings hub. On phones the layout's section list is the page; on wider
 * screens there's nothing to pick from, so jump to the first section.
 */
export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const redirectIfDesktop = () => {
      if (query.matches) router.replace('/settings/profile');
    };
    redirectIfDesktop();
    query.addEventListener('change', redirectIfDesktop);
    return () => query.removeEventListener('change', redirectIfDesktop);
  }, [router]);

  return <h1 className="visually-hidden">Settings</h1>;
}
