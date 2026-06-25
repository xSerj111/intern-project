import { UserProfile } from '../../domain/entities/user-profile.entity';

/**
 * Test factory for UserProfile. Builds a fully-populated entity with sensible
 * defaults; pass `overrides` to vary the fields a given test cares about.
 */
export function fakeUserProfile(
  overrides: Partial<UserProfile> = {},
): UserProfile {
  const profile = new UserProfile();
  Object.assign(profile, {
    id: '00000000-0000-0000-0000-000000000001',
    authUserId: '11111111-1111-1111-1111-111111111111',
    username: 'john_doe',
    displayName: 'John Doe',
    bio: undefined,
    avatarUrl: undefined,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
  return profile;
}
