// Shared types and constants for the setup wizard steps.

import type { AIProviderName } from '../../../shared/types';

export type WizardStep = 'welcome' | 'have-key' | 'pick-provider' | 'tutorial' | 'configure' | 'test' | 'done';

export interface ProviderOption {
  value: AIProviderName;
  label: string;
  tagline: string;
  recommended?: boolean;
  icon: React.ReactNode;
}

export interface SetupWizardProps {
  onClose: () => void;
}

// Visible steps in the progress indicator (sub-steps collapse into 'have-key' position)
export const ORDERED_STEPS: WizardStep[] = ['have-key', 'configure', 'test', 'done'];

export const STEP_LABELS: Record<WizardStep, string> = {
  welcome: 'Welcome',
  'have-key': 'Provider',
  'pick-provider': 'Provider',
  tutorial: 'Provider',
  configure: 'Configure',
  test: 'Test',
  done: 'Done',
};
