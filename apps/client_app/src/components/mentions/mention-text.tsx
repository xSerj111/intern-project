'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { mentionedUsernames, splitMentions } from './mention-parser';
import styles from './mentions.module.css';
import { useMentionProfiles } from './use-mention-profiles';

/** Text with `@username` handles linked to profiles and `#tags` linked to tag pages; unresolved handles stay plain. */
export function MentionText({ text }: { text: string }) {
  const parts = useMemo(() => splitMentions(text), [text]);
  const usernames = useMemo(() => mentionedUsernames(parts), [parts]);
  const resolved = useMentionProfiles(usernames);

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') return part.value;
        if (part.type === 'hashtag') {
          return (
            <Link
              key={index}
              href={`/tags/${encodeURIComponent(part.tag)}`}
              className={styles.hashtag}
            >
              {part.value}
            </Link>
          );
        }
        const profile = resolved.get(part.username.toLowerCase());
        return profile ? (
          <Link
            key={index}
            href={`/profile/${profile.userId}`}
            className={styles.mention}
          >
            {part.value}
          </Link>
        ) : (
          part.value
        );
      })}
    </>
  );
}
