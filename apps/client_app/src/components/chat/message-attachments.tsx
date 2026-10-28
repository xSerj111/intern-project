'use client';

import type { IAttachment } from '@repo/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getAttachmentUrl } from '../../lib/api/chats';
import { getAccessToken } from '../../lib/auth/refresh';

import styles from './message-attachments.module.css';

/** `setTimeout` delays above 2^31 - 1 ms fire immediately. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Human-readable size, e.g. `1.4 MB`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

interface FreshUrl {
  /** The `attachment.url` this replacement was fetched for. */
  forUrl: string;
  url: string;
  expiresAt: string;
}

/**
 * The URL to show for one attachment. A fresh one is fetched when the issued
 * URL has passed `urlExpiresAt` or when the element reports an error, at most
 * once per distinct URL so a broken object can't cause a refresh loop.
 */
function useAttachmentUrl(
  chatId: string,
  messageId: string,
  attachment: IAttachment,
) {
  const [fresh, setFresh] = useState<FreshUrl | null>(null);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  // The issued URL for which an element error already triggered a refresh.
  const errorRefreshedFor = useRef<string | null>(null);

  const current =
    fresh && fresh.forUrl === attachment.url
      ? fresh
      : { url: attachment.url, expiresAt: attachment.urlExpiresAt };
  const isIssuedUrl = current.url === attachment.url;

  const refresh = useCallback(
    (staleUrl: string) => {
      if (attempted.current.has(staleUrl)) {
        return;
      }
      attempted.current.add(staleUrl);
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      getAttachmentUrl(chatId, messageId, attachment.id, {
        token: getAccessToken() ?? undefined,
        signal: abort.signal,
      })
        .then((result) => {
          setFresh({
            forUrl: attachment.url,
            url: result.url,
            expiresAt: result.expiresAt,
          });
          setFailed(false);
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) {
            setFailed(true);
          }
          return error;
        });
    },
    [attachment.id, attachment.url, chatId, messageId],
  );

  useEffect(() => () => controller.current?.abort(), []);

  const { url, expiresAt } = current;
  useEffect(() => {
    const remaining = Date.parse(expiresAt) - Date.now();
    if (Number.isNaN(remaining)) {
      return;
    }
    if (remaining <= 0) {
      // Only the server-issued URL is refreshed on expiry; a replacement that
      // is already expired is left to the element-error path.
      if (isIssuedUrl && !attempted.current.has(url)) {
        refresh(url);
      }
      return;
    }
    const timer = setTimeout(
      () => refresh(url),
      Math.min(remaining, MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, isIssuedUrl, refresh, url]);

  const onError = useCallback(() => {
    if (errorRefreshedFor.current === attachment.url) {
      // The refreshed URL failed too: give up instead of looping.
      setFailed(true);
      return;
    }
    errorRefreshedFor.current = attachment.url;
    refresh(url);
  }, [attachment.url, refresh, url]);

  return { url, failed, onError };
}

function AttachmentItem({
  chatId,
  messageId,
  attachment,
}: {
  chatId: string;
  messageId: string;
  attachment: IAttachment;
}) {
  const { url, failed, onError } = useAttachmentUrl(
    chatId,
    messageId,
    attachment,
  );

  if (failed) {
    return (
      <span className={styles.unavailable}>
        {attachment.originalName} is unavailable
      </span>
    );
  }

  if (attachment.kind === 'image') {
    return (
      <img
        className={styles.media}
        src={url}
        alt={attachment.originalName}
        loading="lazy"
        onError={onError}
      />
    );
  }

  if (attachment.kind === 'video') {
    return (
      <video
        className={styles.media}
        src={url}
        controls
        preload="metadata"
        aria-label={attachment.originalName}
        onError={onError}
      />
    );
  }

  return (
    <a
      className={styles.file}
      href={url}
      download={attachment.originalName}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className={styles.fileName}>{attachment.originalName}</span>
      <span className={styles.fileSize}>{formatFileSize(attachment.size)}</span>
    </a>
  );
}

interface MessageAttachmentsProps {
  chatId: string;
  messageId: string;
  attachments: readonly IAttachment[];
  /** Optimistic message: no stored URLs yet, so only the file names are listed. */
  pending?: boolean;
}

/** The attachments of one message, in display order. */
export function MessageAttachments({
  chatId,
  messageId,
  attachments,
  pending,
}: MessageAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }
  const ordered = [...attachments].sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );

  return (
    <div className={styles.list}>
      {ordered.map((attachment) =>
        pending ? (
          <span key={attachment.id} className={styles.file}>
            <span className={styles.fileName}>{attachment.originalName}</span>
            <span className={styles.fileSize}>
              {formatFileSize(attachment.size)}
            </span>
          </span>
        ) : (
          <AttachmentItem
            key={attachment.id}
            chatId={chatId}
            messageId={messageId}
            attachment={attachment}
          />
        ),
      )}
    </div>
  );
}
