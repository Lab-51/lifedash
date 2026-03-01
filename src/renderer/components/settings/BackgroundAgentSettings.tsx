// === FILE PURPOSE ===
// Background Agent settings section for the Settings page (AI & Models tab).
// Provides master toggle, frequency, daily token budget, insight type toggles,
// stale card threshold, daily usage display, and a Run Now button.
// Wraps everything in a ProGate for the backgroundAgent feature.

import { useEffect, useState } from 'react';
import { Bot, Loader2, RefreshCw } from 'lucide-react';
import { useBackgroundAgentStore } from '../../stores/backgroundAgentStore';
import ProGate from '../ProGate';
import HudSelect from '../HudSelect';
import type { InsightType } from '../../../shared/types/background-agent';
import { toast } from '../../hooks/useToast';

const FREQUENCY_OPTIONS = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'every_4h', label: 'Every 4 hours' },
  { value: 'daily', label: 'Daily' },
];

const BUDGET_PRESETS = [10_000, 50_000, 100_000];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export default function BackgroundAgentSettings() {
  const preferences = useBackgroundAgentStore(s => s.preferences);
  const dailyUsage = useBackgroundAgentStore(s => s.dailyUsage);
  const loadPreferences = useBackgroundAgentStore(s => s.loadPreferences);
  const loadDailyUsage = useBackgroundAgentStore(s => s.loadDailyUsage);
  const updatePreferences = useBackgroundAgentStore(s => s.updatePreferences);
  const runNow = useBackgroundAgentStore(s => s.runNow);

  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [running, setRunning] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoadingPrefs(true);
      await Promise.all([loadPreferences(), loadDailyUsage()]);
      setLoadingPrefs(false);
    };
    load();
  }, [loadPreferences, loadDailyUsage]);

  // Sync budget input when preferences load
  useEffect(() => {
    if (preferences) {
      setBudgetInput(String(preferences.dailyTokenBudget));
    }
  }, [preferences]);

  const handleToggleEnable = async (enabled: boolean) => {
    await updatePreferences({ enabled });
  };

  const handleFrequencyChange = async (freq: string) => {
    await updatePreferences({ frequency: freq as 'hourly' | 'every_4h' | 'daily' });
  };

  const handleBudgetBlur = async () => {
    const parsed = parseInt(budgetInput, 10);
    if (!isNaN(parsed) && parsed > 0) {
      await updatePreferences({ dailyTokenBudget: parsed });
    } else {
      // Revert invalid input
      setBudgetInput(String(preferences?.dailyTokenBudget ?? 50000));
    }
  };

  const handleInsightTypeToggle = async (type: InsightType, checked: boolean) => {
    if (!preferences) return;
    const current = preferences.enabledInsightTypes;
    const updated = checked
      ? [...current, type]
      : current.filter(t => t !== type);
    await updatePreferences({ enabledInsightTypes: updated });
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const result = await runNow();
      if (result.ran) {
        toast('Background agent ran successfully', 'success');
        await loadDailyUsage();
      } else {
        toast(result.reason || 'Agent did not run', 'error');
      }
    } finally {
      setRunning(false);
    }
  };

  const usagePct = dailyUsage && preferences
    ? Math.min(100, (dailyUsage.tokensUsed / preferences.dailyTokenBudget) * 100)
    : 0;

  return (
    <section className="hud-panel-accent clip-corner-cut-sm p-6">
      {/* Section header */}
      <div className="mb-6 pb-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3 mb-1">
          <Bot size={16} className="text-[var(--color-accent)]" />
          <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">
            Background Agents
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Autonomous AI agents that analyze your projects in the background.
        </p>
      </div>

      <ProGate feature="backgroundAgent">
        {loadingPrefs || preferences === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Master toggle */}
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">Enable Background Agents</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Periodically analyze projects for stale cards, risks, and suggestions.
                </p>
              </div>
              <div className="relative shrink-0">
                <input
                  type="checkbox"
                  checked={preferences.enabled}
                  onChange={e => handleToggleEnable(e.target.checked)}
                  className="sr-only peer"
                />
                <div
                  onClick={() => handleToggleEnable(!preferences.enabled)}
                  className={`w-10 h-6 rounded-full cursor-pointer transition-colors ${
                    preferences.enabled
                      ? 'bg-[var(--color-accent)]'
                      : 'bg-[var(--color-border)]'
                  }`}
                >
                  <div
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      preferences.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
            </label>

            {preferences.enabled && (
              <div className="space-y-5 pl-0">
                <div className="ruled-line-accent" />

                {/* Frequency */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)]">Run Frequency</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">How often the agent scans your projects</p>
                  </div>
                  <div className="w-44 shrink-0">
                    <HudSelect
                      value={preferences.frequency}
                      onChange={handleFrequencyChange}
                      options={FREQUENCY_OPTIONS}
                    />
                  </div>
                </div>

                {/* Daily token budget */}
                <div>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">Daily Token Budget</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={budgetInput}
                      onChange={e => setBudgetInput(e.target.value)}
                      onBlur={handleBudgetBlur}
                      min={1000}
                      step={1000}
                      className="w-32 px-3 py-2 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-primary)] rounded-lg focus:outline-none focus:border-[var(--color-accent)]"
                    />
                    <div className="flex items-center gap-1.5">
                      {BUDGET_PRESETS.map(preset => (
                        <button
                          key={preset}
                          onClick={() => {
                            setBudgetInput(String(preset));
                            updatePreferences({ dailyTokenBudget: preset });
                          }}
                          className={`text-xs px-2.5 py-1.5 border transition-all ${
                            preferences.dailyTokenBudget === preset
                              ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {formatTokens(preset)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Insight types */}
                <div>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-3">Insight Types</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preferences.enabledInsightTypes.includes('stale_cards')}
                        onChange={e => handleInsightTypeToggle('stale_cards', e.target.checked)}
                        className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
                      />
                      <div>
                        <span className="text-sm text-[var(--color-text-secondary)]">Stale Card Detection</span>
                        <p className="text-xs text-[var(--color-text-muted)]">Flag cards with no activity past a threshold</p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Stale card threshold */}
                {preferences.enabledInsightTypes.includes('stale_cards') && (
                  <div className="flex items-center gap-4">
                    <p className="text-sm text-[var(--color-text-secondary)]">Stale threshold</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={preferences.staleCardThresholdDays}
                        onChange={e => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val > 0) {
                            updatePreferences({ staleCardThresholdDays: val });
                          }
                        }}
                        min={1}
                        max={365}
                        className="w-20 px-3 py-2 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-primary)] rounded-lg focus:outline-none focus:border-[var(--color-accent)]"
                      />
                      <span className="text-sm text-[var(--color-text-muted)]">days</span>
                    </div>
                  </div>
                )}

                <div className="ruled-line-accent" />

                {/* Daily usage */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-[var(--color-text-secondary)]">Today's Usage</p>
                    <span className="font-data text-xs text-[var(--color-text-muted)]">
                      {dailyUsage ? formatTokens(dailyUsage.tokensUsed) : '0'} / {formatTokens(preferences.dailyTokenBudget)} tokens
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usagePct > 90 ? 'bg-red-400' : usagePct > 70 ? 'bg-amber-400' : 'bg-[var(--color-accent)]'
                      }`}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                </div>

                {/* Run Now */}
                <div className="pt-2">
                  <button
                    onClick={handleRunNow}
                    disabled={running}
                    className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] px-4 py-2 text-sm font-medium transition-all clip-corner-cut-sm disabled:opacity-50 disabled:cursor-wait"
                  >
                    {running ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    {running ? 'Running...' : 'Run Now'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </ProGate>
    </section>
  );
}
