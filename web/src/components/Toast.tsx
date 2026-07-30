import React, { createContext, useContext, useState, useCallback } from 'react';
import './Toast.css';

export type ToastType = 'ok' | 'warn' | 'err';

interface ToastMessage {
  id: string;
  text: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (text: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((text: string, type: ToastType = 'ok') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, text, type }]);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item ${t.type}`}>
            <span className="toast-icon">
              {t.type === 'ok' && '✓'}
              {t.type === 'warn' && '⚠'}
              {t.type === 'err' && '✗'}
            </span>
            <span className="toast-text">{t.text}</span>
            <button className="toast-close" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
