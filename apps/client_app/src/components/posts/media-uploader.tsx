'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';

import type { MediaKind } from '@repo/contracts';

import { uploadAsset, validateUploadFile } from '../../lib/api/assets';
import { useAuth } from '../../lib/auth/auth-context';

import styles from './media-uploader.module.css';

export interface MediaItem {
  assetId: string;
  url: string;
  mediaType: MediaKind;
  name: string;
}

type Entry = {
  key: string;
  name: string;
  file?: File;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  item?: MediaItem;
  error?: string;
};

export interface MediaUploaderProps {
  initialItems?: MediaItem[];
  max?: number;
  /** Fires with the finished items in display order, and whether uploads are running. */
  onChange: (items: MediaItem[], busy: boolean) => void;
}

/**
 * Drop zone + file picker for images/videos with per-file progress, retry,
 * cancel/remove and left/right reordering (the order becomes `displayOrder`).
 */
export function MediaUploader({
  initialItems = [],
  max = 10,
  onChange,
}: MediaUploaderProps) {
  const { accessToken } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const counter = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [entries, setEntries] = useState<Entry[]>(() =>
    initialItems.map((item) => ({
      key: item.assetId,
      name: item.name,
      status: 'done',
      progress: 100,
      item,
    })),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const items = entries.flatMap((e) => (e.status === 'done' && e.item ? [e.item] : []));
    onChangeRef.current(items, entries.some((e) => e.status === 'uploading'));
  }, [entries]);

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  function update(key: string, patch: Partial<Entry>) {
    setEntries((current) =>
      current.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );
  }

  async function start(key: string, file: File) {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    update(key, { status: 'uploading', progress: 0, error: undefined });
    try {
      const asset = await uploadAsset(
        file,
        accessToken,
        (progress) => update(key, { progress }),
        controller.signal,
      );
      update(key, {
        status: 'done',
        progress: 100,
        item: {
          assetId: asset.id,
          url: asset.url,
          mediaType: asset.mimeType.startsWith('video/') ? 'video' : 'image',
          name: file.name,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      update(key, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed.',
      });
    } finally {
      controllers.current.delete(key);
    }
  }

  function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;

    const problems: string[] = [];
    let slots = max - entries.length;
    const accepted: Entry[] = [];
    for (const file of files) {
      const invalid = validateUploadFile(file);
      if (invalid) {
        problems.push(invalid);
      } else if (slots <= 0) {
        problems.push(`You can attach at most ${max} media items.`);
        break;
      } else {
        slots -= 1;
        accepted.push({
          key: `upload-${(counter.current += 1)}`,
          name: file.name,
          file,
          status: 'uploading',
          progress: 0,
        });
      }
    }

    setNotice(problems.length > 0 ? problems.join(' ') : null);
    if (accepted.length > 0) {
      setEntries((current) => [...current, ...accepted]);
      accepted.forEach((e) => void start(e.key, e.file as File));
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(key: string) {
    controllers.current.get(key)?.abort();
    setEntries((current) => current.filter((e) => e.key !== key));
  }

  function move(index: number, delta: -1 | 1) {
    setEntries((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>Media</span>
        <span className="muted">
          {entries.length}/{max}
        </span>
      </div>

      <div
        className={dragging ? styles.dropActive : styles.drop}
        data-testid="media-dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="muted">Drag images or videos here, or</p>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => inputRef.current?.click()}
          disabled={entries.length >= max}
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          aria-label="Upload media"
          onChange={(event) => addFiles(event.target.files)}
        />
      </div>

      {notice && (
        <p className={styles.error} role="alert">
          {notice}
        </p>
      )}

      {entries.length > 0 && (
        <ul className={styles.list}>
          {entries.map((entry, index) => (
            <li key={entry.key} className={styles.item}>
              {entry.item &&
                (entry.item.mediaType === 'video' ? (
                  <video
                    src={entry.item.url}
                    className={styles.thumb}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img src={entry.item.url} alt={entry.name} className={styles.thumb} />
                ))}
              <span className={styles.name}>{entry.name}</span>

              {entry.status === 'uploading' && (
                <progress
                  value={entry.progress}
                  max={100}
                  aria-label={`Uploading ${entry.name}`}
                />
              )}
              {entry.status === 'error' && (
                <span className={styles.error} role="alert">
                  {entry.error}
                </span>
              )}

              <span className={styles.controls}>
                {entry.status === 'error' && entry.file && (
                  <button
                    type="button"
                    onClick={() => void start(entry.key, entry.file as File)}
                    aria-label={`Retry ${entry.name}`}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${entry.name} left`}
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === entries.length - 1}
                  aria-label={`Move ${entry.name} right`}
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => remove(entry.key)}
                  aria-label={
                    entry.status === 'uploading'
                      ? `Cancel ${entry.name}`
                      : `Remove ${entry.name}`
                  }
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
