import React from 'react';
import './Toggle.css';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  helpText?: string;
}

export function Toggle({ checked, onChange, label, helpText }: ToggleProps) {
  return (
    <div className="toggle-wrapper" onClick={() => onChange(!checked)}>
      <div className={`toggle-switch ${checked ? 'checked' : ''}`}>
        <div className="toggle-handle"></div>
      </div>
      {(label || helpText) && (
        <div className="toggle-info">
          {label && <div className="toggle-label">{label}</div>}
          {helpText && <div className="toggle-help">{helpText}</div>}
        </div>
      )}
    </div>
  );
}
