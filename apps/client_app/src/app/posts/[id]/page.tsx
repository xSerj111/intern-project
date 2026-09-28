import { PostDetail } from '../../../components/posts/post-detail';

import styles from './page.module.css';

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className={`container ${styles.page}`}>
      <PostDetail postId={id} />
    </main>
  );
}
