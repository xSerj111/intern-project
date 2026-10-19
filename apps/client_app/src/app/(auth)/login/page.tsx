'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Logo } from '../../../components/brand/logo';
import { useAuth } from '../../../lib/auth/auth-context';

import styles from './login.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormErrors {
  email?: string;
  password?: string;
  form?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: FormErrors = {};
    if (!EMAIL_PATTERN.test(email)) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (error) {
      setErrors({
        form:
          error instanceof Error
            ? error.message
            : 'Unable to sign in. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={`container ${styles.page}`}>
      <Logo />
      <h1 className={styles.title}>Sign in</h1>

      <form
        className={`card ${styles.form}`}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        noValidate
      >
        {errors.form && (
          <p className={styles.formError} role="alert">
            {errors.form}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email && <p className={styles.fieldError}>{errors.email}</p>}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
          />
          {errors.password && (
            <p className={styles.fieldError}>{errors.password}</p>
          )}
        </div>

        <button
          type="submit"
          className={`button ${styles.submit}`}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
