'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { FormAlert } from '../../../components/auth/form-alert';
import { GoogleAuthButton } from '../../../components/auth/google-auth-button';
import { PasswordInput } from '../../../components/auth/password-input';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { register } from '../../../lib/auth/register';

import styles from '../../../components/auth/auth-form.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormErrors {
  email?: string;
  password?: string;
  form?: string;
}

export default function SignupPage() {
  const router = useRouter();

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
      await register(email, password);
      router.push('/login');
    } catch (error) {
      setErrors({
        form:
          error instanceof Error
            ? error.message
            : 'Unable to create your account. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>
          Join Innogram to share moments and chat with friends.
        </p>
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
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint="Use at least 8 characters."
          error={errors.password}
        />

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Sign up'}
        </Button>
      </form>

      <div className={styles.divider} aria-hidden="true">
        or
      </div>

      <GoogleAuthButton mode="signup" />

      <p className={styles.switch}>
        Already have an account?{' '}
        <Link href="/login" className={styles.switchLink}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
