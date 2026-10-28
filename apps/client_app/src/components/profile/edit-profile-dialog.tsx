'use client';

import type { IProfileResponse } from '@repo/contracts';

import { Dialog } from '../ui/dialog';

import { EditProfileForm } from './edit-profile-form';

interface EditProfileDialogProps {
  open: boolean;
  onClose: () => void;
  profile: IProfileResponse;
}

/** Modal editor for the signed-in user's own profile. */
export function EditProfileDialog({
  open,
  onClose,
  profile,
}: EditProfileDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit profile" size="md">
      <EditProfileForm profile={profile} onSaved={onClose} onCancel={onClose} />
    </Dialog>
  );
}
