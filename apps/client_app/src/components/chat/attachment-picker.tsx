'use client';

import {
  ATTACHMENT_MAX_BYTES,
  MESSAGE_MAX_ATTACHMENTS,
  type IUploadedAttachment,
} from '@repo/contracts';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Paperclip,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api/client';
import { getAccessToken } from '../../lib/auth/refresh';
import { uploadFile } from '../../lib/api/uploads';
import { IconButton } from '../ui/button';

import styles from './attachment-picker.module.css';
import { formatFileSize } from './message-attachments';

export interface AttachmentUpload {
  key: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  /** Upload progress, 0..1. */
  progress: number;
  uploaded?: IUploadedAttachment;
  error?: string;
}

/**
 * Uploads attachments as soon as they are picked, keeping them in the chosen
 * order. In-flight uploads are aborted on removal, chat change and unmount.
 */
export function useAttachmentUploads(chatId: string) {
  const [items, setItems] = useState<AttachmentUpload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback(
    (key: string, change: Partial<AttachmentUpload>) => {
      setItems((current) =>
        current.map((item) =>
          item.key === key ? { ...item, ...change } : item,
        ),
      );
    },
    [],
  );

  const clear = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    setItems([]);
  }, []);

  // Attachments belong to one chat: drop them when it changes or on unmount.
  useEffect(() => {
    const active = controllers.current;
    return () => {
      active.forEach((controller) => controller.abort());
      active.clear();
      setItems([]);
    };
  }, [chatId]);

  const startUpload = useCallback(
    (key: string, file: File) => {
      const controller = new AbortController();
      controllers.current.set(key, controller);
      uploadFile(file, 'chat-attachment', {
        token: getAccessToken() ?? undefined,
        signal: controller.signal,
        onProgress: (progress) => patch(key, { progress }),
      })
        .then((uploaded) =>
          patch(key, { status: 'done', progress: 1, uploaded }),
        )
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          patch(key, {
            status: 'error',
            error:
              error instanceof ApiError || error instanceof Error
                ? error.message
                : 'Upload failed',
          });
        })
        .finally(() => controllers.current.delete(key));
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const room = Math.max(
        0,
        MESSAGE_MAX_ATTACHMENTS -
          items.filter((item) => item.status !== 'error').length,
      );
      const additions: AttachmentUpload[] = [];
      let accepted = 0;
      for (const file of files) {
        const key = crypto.randomUUID();
        if (file.size > ATTACHMENT_MAX_BYTES) {
          additions.push({
            key,
            file,
            status: 'error',
            progress: 0,
            error: `Larger than ${formatFileSize(ATTACHMENT_MAX_BYTES)}`,
          });
        } else if (accepted >= room) {
          additions.push({
            key,
            file,
            status: 'error',
            progress: 0,
            error: `At most ${MESSAGE_MAX_ATTACHMENTS} files per message`,
          });
        } else {
          accepted += 1;
          additions.push({ key, file, status: 'uploading', progress: 0 });
        }
      }
      setItems((current) => [...current, ...additions]);
      additions
        .filter((item) => item.status === 'uploading')
        .forEach((item) => startUpload(item.key, item.file));
    },
    [items, startUpload],
  );

  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const move = useCallback((key: string, offset: -1 | 1) => {
    setItems((current) => {
      const from = current.findIndex((item) => item.key === key);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) {
        return current;
      }
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  const uploaded = items.flatMap((item) =>
    item.status === 'done' && item.uploaded ? [item.uploaded] : [],
  );

  return {
    items,
    addFiles,
    remove,
    move,
    clear,
    /** Finished uploads, in the chosen order. */
    uploaded,
    uploading: items.some((item) => item.status === 'uploading'),
    hasErrors: items.some((item) => item.status === 'error'),
  };
}

/** True when no more files fit into the message. */
export function attachmentsFull(items: readonly AttachmentUpload[]): boolean {
  return (
    items.filter((item) => item.status !== 'error').length >=
    MESSAGE_MAX_ATTACHMENTS
  );
}

interface AttachButtonProps {
  onAddFiles: (files: File[]) => void;
  disabled?: boolean;
  /** The message already holds the maximum number of files. */
  full?: boolean;
}

/** Paperclip button that opens the file picker (multi-select). */
export function AttachButton({ onAddFiles, disabled, full }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        data-testid="attachment-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) {
            onAddFiles(files);
          }
        }}
      />
      <IconButton
        label="Attach files"
        title={
          full
            ? `At most ${MESSAGE_MAX_ATTACHMENTS} files per message`
            : 'Attach files'
        }
        disabled={disabled || full}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip size={20} />
      </IconButton>
    </>
  );
}

interface AttachmentChipsProps {
  items: readonly AttachmentUpload[];
  onRemove: (key: string) => void;
  onMove: (key: string, offset: -1 | 1) => void;
}

/** Chips of the picked files (reorder, remove, progress, errors). */
export function AttachmentChips({
  items,
  onRemove,
  onMove,
}: AttachmentChipsProps) {
  const [announce, setAnnounce] = useState('');

  return (
    <>
      {items.length > 0 && (
        <ul className={styles.chips} aria-label="Attachments">
          {items.map((item, index) => (
            <li
              key={item.key}
              className={
                item.status === 'error'
                  ? `${styles.chip} ${styles.chipError}`
                  : styles.chip
              }
            >
              <FileText size={16} aria-hidden="true" className={styles.fileIcon} />
              <span className={styles.name} title={item.file.name}>
                {item.file.name}
              </span>
              <span className={styles.status}>
                {item.status === 'uploading' ? (
                  <progress
                    className={styles.progress}
                    max={1}
                    value={item.progress}
                    aria-label={`Uploading ${item.file.name}`}
                  />
                ) : item.status === 'error' ? (
                  <span role="alert">{item.error}</span>
                ) : (
                  formatFileSize(item.file.size)
                )}
              </span>
              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${item.file.name} earlier`}
                    disabled={index === 0}
                    onClick={() => {
                      onMove(item.key, -1);
                      setAnnounce(`${item.file.name} moved earlier`);
                    }}
                  >
                    <ChevronLeft size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Move ${item.file.name} later`}
                    disabled={index === items.length - 1}
                    onClick={() => {
                      onMove(item.key, 1);
                      setAnnounce(`${item.file.name} moved later`);
                    }}
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Remove ${item.file.name}`}
                onClick={() => onRemove(item.key)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="visually-hidden" aria-live="polite">
        {announce}
      </span>
    </>
  );
}
