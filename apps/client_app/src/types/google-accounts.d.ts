/**
 * Minimal ambient types for Google Identity Services (GIS), loaded at runtime
 * from `https://accounts.google.com/gsi/client`. We only declare the subset the
 * signup page uses so no `@types` package is required.
 */
interface GoogleCredentialResponse {
  /** The ID token JWT to send to `POST /auth/google`. */
  credential: string;
  /** How the credential was selected, when reported. */
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  /** Optional: automatically prompt for a Google account on load. */
  auto_select?: boolean;
  context?: 'signin' | 'signup' | 'use';
}

interface GoogleId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'small' | 'medium' | 'large';
      text?: 'signin_with' | 'signup_with' | 'continue_with';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      width?: number;
    },
  ) => void;
  prompt: () => void;
  disableAutoSelect: () => void;
}

interface GoogleAccounts {
  id: GoogleId;
}

interface Window {
  google?: {
    accounts?: GoogleAccounts;
  };
}
