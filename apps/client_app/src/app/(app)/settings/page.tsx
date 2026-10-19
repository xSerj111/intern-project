import { redirect } from 'next/navigation';

/** Settings hub entry point; notification settings is the only section so far. */
export default function SettingsPage() {
  redirect('/settings/notifications');
}
