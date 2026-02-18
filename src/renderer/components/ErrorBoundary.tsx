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
      <div className="flex-1 flex items-center justify-center bg-surface-50/50 dark:bg-surface-900/50 p-6">
        <div className="max-w-md w-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl p-8 text-center">
          <AlertTriangle size={40} className="mx-auto mb-4 text-warning" />

          <h2 className="text-xl font-semibold text-surface-900 dark:text-surface-100">
            Something went wrong
          </h2>

          <p className="mt-2 text-sm text-surface-400">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>

          <button
            type="button"
            onClick={this.handleReset}
            className="mt-6 px-5 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium
                       hover:bg-primary-500 transition-colors focus:outline-none focus:ring-2
                       focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-surface-900"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
