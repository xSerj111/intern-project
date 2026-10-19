'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { FormAlert } from '../../../components/auth/form-alert';
import { GoogleAuthButton } from '../../../components/auth/google-auth-button';
import { PasswordInput } from '../../../components/auth/password-input';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useAuth } from '../../../lib/auth/auth-context';

import styles from '../../../components/auth/auth-form.module.css';

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
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>Sign in to see what you missed.</p>
      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        noValidate
      >
        {errors.form && <FormAlert message={errors.form} />}

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
        />

        <PasswordInput
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
        />

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className={styles.divider} aria-hidden="true">
        or
      </div>

      <GoogleAuthButton mode="signin" />

      <p className={styles.switch}>
        New to Innogram?{' '}
        <Link href="/signup" className={styles.switchLink}>
          Create an account
        </Link>
      </p>
    </div>
  );
}
