import { Camera, Heart, MessageCircle, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Logo } from '../../components/brand/logo';

import styles from './layout.module.css';

const FEATURES = [
  { icon: Camera, text: 'Share photos with the people you care about' },
  { icon: Heart, text: 'Like and comment on what your friends post' },
  { icon: MessageCircle, text: 'Chat one-to-one or in groups, in real time' },
] as const;

/** Sign-in / sign-up: brand panel beside the form, no app navigation. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.brandPanel}>
        <div className={styles.brandLogo}>
          <Logo />
        </div>

        <div className={styles.pitch}>
          <h2 className={styles.headline}>
            See everyday moments from the people you follow.
          </h2>
          <ul className={styles.features}>
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Icon size={18} />
                </span>
                {text}
              </li>
            ))}
          </ul>

          {/* Decorative mock of a live notification. */}
          <div className={styles.mock} aria-hidden="true">
            <span className={styles.mockAvatar}>
              <UserPlus size={16} />
            </span>
            <span className={styles.mockText}>
              <strong>alex</strong> started following you
            </span>
          </div>
        </div>

        <p className={styles.footnote}>© {new Date().getFullYear()} Innogram</p>
      </aside>

      <main className={styles.formPanel}>
        <div className={styles.mobileLogo}>
          <Logo />
        </div>
        {children}
      </main>
    </div>
  );
}
