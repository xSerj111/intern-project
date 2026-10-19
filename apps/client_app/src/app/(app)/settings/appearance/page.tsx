'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { cx } from '../../../../lib/cx';
import {
  useTheme,
  type ThemePreference,
} from '../../../../lib/theme/theme-provider';
import { SettingsHeader } from '../_components/settings-header';

import styles from './page.module.css';

const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: 'system',
    label: 'System',
    description: 'Match your device setting.',
    icon: Monitor,
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Bright surfaces, easy in daylight.',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Dim surfaces, easier on the eyes at night.',
    icon: Moon,
  },
];

export default function AppearanceSettingsPage() {
  const { preference, setPreference } = useTheme();

  return (
    <div className={styles.page}>
      <SettingsHeader
        title="Appearance"
        description="Choose how Innogram looks on this device."
      />
      <fieldset className={styles.group}>
        <legend className="visually-hidden">Theme</legend>
        {OPTIONS.map(({ value, label, description, icon: Icon }) => {
          const checked = preference === value;
          return (
            <label
              key={value}
              className={cx(styles.option, checked && styles.selected)}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                className={styles.radio}
                checked={checked}
                onChange={() => setPreference(value)}
              />
              <span className={styles.icon}>
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>{label}</span>
                <span className={styles.description}>{description}</span>
              </span>
              <span className={styles.indicator} aria-hidden="true" />
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
