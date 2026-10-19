'use client';

import { ImagePlus } from 'lucide-react';

import { Dialog } from '../ui/dialog';
import { EmptyState } from '../ui/empty-state';

export interface CreatePostDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Post composer opened from the shell's "Create" button.
 * Placeholder until the composer (upload, caption, publish) lands.
 */
export function CreatePostDialog({ open, onClose }: CreatePostDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Create new post">
      <EmptyState
        icon={ImagePlus}
        title="Coming soon"
        description="Sharing photos and posts is on its way."
      />
    </Dialog>
  );
}
