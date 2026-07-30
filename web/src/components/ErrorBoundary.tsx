import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          width: '100vw',
          backgroundColor: 'var(--surface-0)',
          color: 'var(--text)',
          fontFamily: 'var(--font-main)',
          padding: '24px',
          textAlign: 'center'
        }}>
          <h1 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--t-2xl)', color: 'var(--err)', marginBottom: '16px' }}>
            Hermes UI Mengalami Crash
          </h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 'var(--t-base)', marginBottom: '24px', maxWidth: '500px' }}>
            Terjadi kesalahan yang tidak terduga saat me-render halaman. Silakan muat ulang halaman.
          </p>
          {this.state.error && (
            <pre style={{
              backgroundColor: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '16px',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-xs)',
              color: 'var(--err)',
              maxWidth: '600px',
              overflow: 'auto',
              marginBottom: '24px',
              textAlign: 'left'
            }}>
              {this.state.error.toString()}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            style={{
              padding: '10px 24px',
              backgroundColor: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--r-md)',
              color: 'var(--text)',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: 'var(--t-sm)'
            }}
          >
            Muat Ulang Halaman
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
