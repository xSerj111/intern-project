import { randomBytes } from 'node:crypto';

export interface E2eUser {
  username: string;
  email: string;
  password: string;
}

// Meets auth's 8-character minimum with mixed classes.
export const E2E_PASSWORD = 'E2e-Passw0rd!';

// Core derives the profile username from the email local part (== username).
// The `user_profiles.username` column is varchar(50) and the user-created
// handle DTO caps at 30, so `e2e_` + label + `_` + 10 hex chars must stay
// within 30: label is at most 15 characters.
const MAX_LABEL_LENGTH = 15;
const LABEL_PATTERN = /^[a-z0-9-]+$/i;

/**
 * A fresh user on every call. Never call at module scope: workers reuse
 * modules across `--repeat-each` iterations, so ids must be computed inside
 * each test or fixture.
 */
export function uniqueUser(label: string): E2eUser {
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    throw new Error(
      `uniqueUser label must be 1-${MAX_LABEL_LENGTH} characters, got "${label}"`,
    );
  }
  if (!LABEL_PATTERN.test(label)) {
    throw new Error(`uniqueUser label must match ${LABEL_PATTERN}: "${label}"`);
  }
  const username = `e2e_${label}_${randomBytes(5).toString('hex')}`;
  return {
    username,
    email: `${username}@innogram.dev`,
    password: E2E_PASSWORD,
  };
}
