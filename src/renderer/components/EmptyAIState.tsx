// === FILE PURPOSE ===
// Reusable empty state shown when no AI provider is configured.
// Guides the user to set up an AI provider to unlock the feature.
//
// === DEPENDENCIES ===
// react, lucide-react, react-router-dom

import { useNavigate } from 'react-router-dom';
import { Bot, Zap } from 'lucide-react';
import HelpTip from './HelpTip';

// === PROPS ===

interface EmptyAIStateProps {
  featureName: string;
  onSetup?: () => void;
}

export default function EmptyAIState({ featureName, onSetup }: EmptyAIStateProps) {
  const navigate = useNavigate();

  const handleSetup = () => {
    if (onSetup) {
      onSetup();
    } else {
      navigate('/settings');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
      {/* Icon */}
      <div className="w-16 h-16 rounded-full bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center justify-center mb-4">
        <Bot size={28} className="text-[var(--color-accent-dim)]" />
      </div>

      {/* Heading */}
      <h3 className="font-hud text-sm text-[var(--color-text-primary)] mb-1 flex items-center gap-1 justify-center">
        Connect an AI provider to unlock {featureName}
        <HelpTip text="An AI provider powers smart features like summaries, brainstorming, and insights. You can use a free local option (Ollama) or connect to cloud services like OpenAI." />
      </h3>

      {/* Subtext */}
      <p className="text-xs text-[var(--color-text-secondary)] max-w-xs mb-5">
        AI features require a configured provider. You can use Ollama for free local inference, or connect to OpenAI or
        Anthropic.
      </p>

      {/* Action button */}
      <button
        onClick={handleSetup}
        className="btn-primary clip-corner-cut-sm px-4 py-2 text-sm font-medium flex items-center gap-2 mb-3"
      >
        <Zap size={14} />
        Set up AI
      </button>

      {/* Recommendation hint */}
      <p className="text-[0.6875rem] text-[var(--color-text-muted)] flex items-center gap-1">
        <span className="node-point-sm" />
        Recommended: Ollama (free, local)
      </p>
    </div>
  );
}
