'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { Input, type InputProps } from '../ui/input';
import { IconButton } from '../ui/button';

type PasswordInputProps = Omit<InputProps, 'type' | 'trailing'>;

/** Password field with a show / hide toggle in the trailing slot. */
export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <IconButton
          label={visible ? 'Hide password' : 'Show password'}
          size="sm"
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </IconButton>
      }
    />
  );
}
