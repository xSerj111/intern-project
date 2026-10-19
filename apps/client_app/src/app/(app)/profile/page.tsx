import { ProfileCard } from '../../../components/profile/profile-card';

import styles from './page.module.css';

export default function ProfilePage() {
  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Profile</h1>

      <section aria-label="Your profile">
        <ProfileCard />
      </section>
    </div>
  );
}
