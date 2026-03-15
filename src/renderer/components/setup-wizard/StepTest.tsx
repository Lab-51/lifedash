// Connection test step — shows test progress and result.

import { CheckCircle, XCircle, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';

export interface StepTestProps {
  status: 'running' | 'success' | 'failure';
  error: string | null;
  latencyMs?: number;
  onNext: () => void;
  onBack: () => void;
}

export default function StepTest({ status, error, latencyMs, onNext, onBack }: StepTestProps) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)]">Testing connection</h2>

      <div className="w-20 h-20 rounded-full border-2 flex items-center justify-center transition-all duration-500">
        {status === 'running' && (
          <div className="w-20 h-20 rounded-full border-2 border-[var(--color-accent-dim)] flex items-center justify-center">
            <Loader2 size={36} className="animate-spin text-[var(--color-accent)]" />
          </div>
        )}
        {status === 'success' && (
          <div className="w-20 h-20 rounded-full border-2 border-emerald-500/50 bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle size={40} className="text-emerald-500" />
          </div>
        )}
        {status === 'failure' && (
          <div className="w-20 h-20 rounded-full border-2 border-red-500/50 bg-red-500/10 flex items-center justify-center">
            <XCircle size={40} className="text-red-400" />
          </div>
        )}
      </div>

      {status === 'running' && (
        <p className="text-sm text-[var(--color-text-secondary)]">Connecting to your AI provider...</p>
      )}

      {status === 'success' && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-emerald-500">Connection successful!</p>
          {latencyMs != null && <p className="text-xs text-[var(--color-text-muted)]">Response time: {latencyMs}ms</p>}
        </div>
      )}

      {status === 'failure' && (
        <div className="space-y-2 max-w-xs">
          <p className="text-sm font-medium text-red-400">Connection failed</p>
          {error && (
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed break-words line-clamp-3">{error}</p>
          )}
        </div>
      )}

      <div className="flex gap-2 w-full pt-2">
        {status === 'failure' && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ArrowLeft size={14} />
            Fix configuration
          </button>
        )}
        {status === 'success' && (
          <button
            onClick={onNext}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium"
          >
            Continue
            <ArrowRight size={16} />
          </button>
        )}
        {status === 'failure' && (
          <button
            onClick={onNext}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Skip and finish anyway
          </button>
        )}
      </div>
    </div>
  );
}
