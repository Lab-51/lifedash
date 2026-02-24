// === FILE PURPOSE ===
// React error boundary — catches render errors in child components and
// displays a friendly fallback UI with a "Try Again" reset button.
// Must be a class component because React has no hooks-based error boundary API.

// === DEPENDENCIES ===
// react (Component, ErrorInfo, ReactNode), lucide-react (AlertTriangle)

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  /** Optional custom fallback UI to render instead of the default error card. */
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details for debugging. In a production app this could
    // be sent to an error reporting service.
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Allow a custom fallback to override the default error card
    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="flex-1 flex items-center justify-center bg-surface-950/50 p-6">
        <div className="max-w-md w-full hud-panel-accent clip-corner-cut p-8 text-center">
          <AlertTriangle size={40} className="mx-auto mb-4 text-[var(--color-warm)]" />

          <h2 className="font-hud text-lg tracking-widest uppercase text-[var(--color-warm)]">
            Something went wrong
          </h2>

          <p className="mt-2 text-sm text-[var(--color-text-secondary)] font-data">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>

          <button
            type="button"
            onClick={this.handleReset}
            className="mt-6 px-5 py-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] text-sm font-medium
                       hover:shadow-[0_0_12px_var(--color-chrome-glow)] transition-all focus:outline-none"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
