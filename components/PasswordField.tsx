'use client';

import { useState } from 'react';

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = true,
  minLength,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          style={{ paddingRight: 64, width: '100%' }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            color: 'var(--chalk-muted)',
            fontSize: 12,
            fontFamily: 'var(--font-mono), monospace',
            cursor: 'pointer',
            padding: '6px 8px',
          }}
        >
          {visible ? 'HIDE' : 'SHOW'}
        </button>
      </div>
    </div>
  );
}
