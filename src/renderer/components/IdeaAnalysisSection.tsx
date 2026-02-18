// === FILE PURPOSE ===
// Extracted sub-component of IdeaDetailModal. Renders the AI Analysis section:
// "Analyze with AI" button, loading spinner, error display, and results panel
// with Apply/Dismiss controls for suggested effort and impact.
//
// === DEPENDENCIES ===
// react, lucide-react (Sparkles, Loader2, AlertCircle), shared types (IdeaAnalysis, EffortLevel, ImpactLevel)

import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import type { IdeaAnalysis, EffortLevel, ImpactLevel } from '../../shared/types';

// === PROPS ===

interface IdeaAnalysisSectionProps {
  analyzing: boolean;
  analysisError: string | null;
  analysis: IdeaAnalysis | null;
  onAnalyze: () => void;
  onClearAnalysis: () => void;
  onApplyEffort: (effort: EffortLevel) => void;
  onApplyImpact: (impact: ImpactLevel) => void;
}

export default function IdeaAnalysisSection({
  analyzing,
  analysisError,
  analysis,
  onAnalyze,
  onClearAnalysis,
  onApplyEffort,
  onApplyImpact,
}: IdeaAnalysisSectionProps) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-surface-700 dark:text-surface-300 flex items-center gap-1.5">
          <Sparkles size={14} className="text-purple-400" />
          AI Analysis
        </label>
        <button
          onClick={onAnalyze}
          disabled={analyzing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 text-purple-300 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {analyzing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {analyzing ? 'Analyzing...' : 'Analyze with AI'}
        </button>
      </div>

      {/* Analysis loading state */}
      {analyzing && (
        <div className="flex items-center gap-2 py-3 text-sm text-surface-400">
          <Loader2 size={16} className="animate-spin" />
          Analyzing idea...
        </div>
      )}

      {/* Analysis error state */}
      {analysisError && !analyzing && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
          <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400">{analysisError}</p>
            <p className="text-surface-500 text-xs mt-1">
              Make sure an AI provider is configured in Settings.
            </p>
          </div>
        </div>
      )}

      {/* Analysis results */}
      {analysis && !analyzing && (
        <div className="bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 rounded-lg p-4 space-y-3">
          {/* Suggested Effort */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-surface-400">Suggested Effort:</span>
              <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full">
                {analysis.suggestedEffort}
              </span>
            </div>
            <button
              onClick={() => onApplyEffort(analysis.suggestedEffort)}
              className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
            >
              Apply
            </button>
          </div>

          {/* Suggested Impact */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-surface-400">Suggested Impact:</span>
              <span className="bg-amber-500/20 text-amber-300 text-xs px-2 py-0.5 rounded-full">
                {analysis.suggestedImpact}
              </span>
            </div>
            <button
              onClick={() => onApplyImpact(analysis.suggestedImpact)}
              className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
            >
              Apply
            </button>
          </div>

          {/* Feasibility notes */}
          <div>
            <span className="text-xs text-surface-400 block mb-1">Feasibility:</span>
            <p className="text-sm text-surface-700 dark:text-surface-300">{analysis.feasibilityNotes}</p>
          </div>

          {/* Rationale */}
          <div>
            <span className="text-xs text-surface-400 block mb-1">Rationale:</span>
            <p className="text-sm text-surface-700 dark:text-surface-300">{analysis.rationale}</p>
          </div>

          {/* Dismiss button */}
          <div className="flex justify-end">
            <button
              onClick={onClearAnalysis}
              className="text-xs text-surface-500 hover:text-surface-700 dark:text-surface-300 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
