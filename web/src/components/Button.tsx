import React from 'react';
import './Button.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  /** 'small' for buttons that sit inside a chat card or a table row, where the
   *  default 38px min-height is taller than the line it belongs to. */
  size?: 'normal' | 'small';
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'normal', loading = false, children, className = '', disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'small' ? 'btn-small' : ''} ${loading ? 'loading' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="btn-spinner"></span>
      ) : (
        children
      )}
    </button>
  );
}
