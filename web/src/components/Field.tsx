import React from 'react';
import './Field.css';

interface FieldProps {
  label: string;
  error?: string;
  helpText?: string;
  children: React.ReactNode;
}

export function Field({ label, error, helpText, children }: FieldProps) {
  return (
    <div className={`form-field ${error ? 'has-error' : ''}`}>
      <label className="field-label">{label}</label>
      <div className="field-control">
        {children}
      </div>
      {helpText && !error && <span className="field-help">{helpText}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
