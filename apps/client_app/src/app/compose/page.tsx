'use client';

import { PostForm } from '../../components/posts/post-form';

import styles from './page.module.css';

export default function ComposePage() {
  return (
    <main className={`container ${styles.page}`}>
      <h1 className={styles.title}>Create a post</h1>
      <section className="card" aria-label="Compose post">
        <PostForm />
      </section>
    </main>
  );
}
