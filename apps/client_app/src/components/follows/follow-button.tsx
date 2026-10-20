'use client';

import { Button, type ButtonSize } from '../ui/button';

import { useFollow } from './use-follow';

interface FollowButtonProps {
  /** Auth user id of the person to follow. */
  userId: string;
  isFollowing: boolean;
  size?: ButtonSize;
  /** Label for following back someone who follows the viewer. */
  followLabel?: string;
  fullWidth?: boolean;
}

/**
 * Follow / Following toggle. Renders nothing for the viewer's own id or when
 * signed out.
 */
export function FollowButton({
  userId,
  isFollowing,
  size = 'md',
  followLabel = 'Follow',
  fullWidth,
}: FollowButtonProps) {
  const { following, isPending, toggle, canFollow } = useFollow(
    userId,
    isFollowing,
  );

  if (!canFollow) return null;

  return (
    <Button
      variant={following ? 'secondary' : 'primary'}
      size={size}
      fullWidth={fullWidth}
      aria-pressed={following}
      disabled={isPending}
      onClick={toggle}
    >
      {following ? 'Following' : followLabel}
    </Button>
  );
}
