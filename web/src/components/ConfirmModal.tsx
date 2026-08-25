import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Konfirmasi Tindakan',
  message,
  confirmText = 'Lanjutkan',
  cancelText = 'Batal',
  variant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div
            style={{
              padding: '8px',
              borderRadius: '50%',
              backgroundColor: variant === 'danger' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
              color: variant === 'danger' ? 'var(--err)' : 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {variant === 'danger' ? <AlertTriangle size={18} /> : <Info size={18} />}
          </div>
          <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text)', paddingTop: '2px' }}>
            {message}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={variant}
            type="button"
            loading={loading}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
