// === FILE PURPOSE ===
// Calendar integration section for the Settings page (General tab, Phase G).
// EMBEDDED-FIRST UX: the primary control per provider (Google, Microsoft) is a
// one-click Connect / Disconnect / Reconnect card driven by the OAuth engine.
// Bring-your-own OAuth client credentials are a demoted override, tucked into a
// collapsed "Advanced" block (see DECISIONS.md 2026-07-31). The client secret is
// never echoed back to the renderer — we only ever render a "configured" state.
//
// === DEPENDENCIES ===
// React, lucide-react icons, electronAPI (preload bridge), frozen calendar types.

import { useEffect, useState, useCallback } from 'react';
import {
  CalendarDays,
  Loader2,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
  ChevronDown,
  Link2,
  Unlink,
  AlertTriangle,
} from 'lucide-react';
import type {
  CalendarProvider,
  CalendarAccountStatus,
  CalendarClientConfig,
  CalendarInfo,
  CalendarListResult,
} from '../../../shared/types/calendar';
import {
  CALENDAR_SETTING_POLL_INTERVAL_MINUTES,
  CALENDAR_SETTING_EVENT_NOTIFICATIONS,
  CALENDAR_DEFAULT_POLL_INTERVAL_MINUTES,
  CALENDAR_DEFAULT_EVENT_NOTIFICATIONS,
} from '../../../shared/types/calendar';

/** Verbatim privacy contract copy — mirrored in SPEC.md. Do not paraphrase. */
const PRIVACY_COPY =
  'Read-only. Only event titles, times, and attendees are stored — locally. Event descriptions are never read into LifeDash. Nothing is sent anywhere except to your own calendar provider.';

/** Poll-interval options (minutes, stored as strings). */
const POLL_OPTIONS = [
  { value: '5', label: 'Every 5 minutes' },
  { value: '10', label: 'Every 10 minutes' },
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
];

const PROVIDERS: Array<{ provider: CalendarProvider; label: string; hasSecret: boolean }> = [
  { provider: 'google', label: 'Google Calendar', hasSecret: true },
  { provider: 'microsoft', label: 'Microsoft / Outlook', hasSecret: false },
];

/** Format an ISO timestamp for display. Pure given the string (no Date.now()). */
function formatSyncTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Status line under a provider name — priority: reauth > connected email > idle. */
function ProviderStatusLine({ status }: { status?: CalendarAccountStatus }) {
  if (status?.needsReauth) {
    return <p className="text-xs text-amber-400 mt-0.5">Authorization expired — reconnect to keep syncing.</p>;
  }
  if (status?.connected && status.accountEmail) {
    return (
      <p className="text-xs text-emerald-400 inline-flex items-center gap-1 mt-0.5">
        <Check size={12} />
        {status.accountEmail}
      </p>
    );
  }
  return <p className="text-xs text-surface-500 mt-0.5">Not connected</p>;
}

/**
 * Which boxes start checked (CAL-UX.1): the stored selection when there is one,
 * otherwise the provider's primary calendar — that mirrors what actually syncs
 * today when no selection has ever been saved.
 */
function initialSelection(result: CalendarListResult): string[] {
  if (result.selectedIds.length > 0) return result.selectedIds;
  return result.calendars.filter((c) => c.isPrimary).map((c) => c.id);
}

/** Order-insensitive id-set equality (drives the "unchanged ⇒ Save disabled" gate). */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Checkbox list of a provider's calendars. Names are user data — never clipped away. */
function CalendarCheckboxList({
  calendars,
  checked,
  onToggle,
}: {
  calendars: CalendarInfo[];
  checked: string[];
  onToggle: (id: string) => void;
}) {
  if (calendars.length === 0) {
    return <p className="text-[0.6875rem] text-surface-500">No calendars found for this account.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {calendars.map((cal) => (
        <li key={cal.id}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={checked.includes(cal.id)}
              onChange={() => onToggle(cal.id)}
              className="mt-0.5 w-3.5 h-3.5 shrink-0"
            />
            <span className="text-xs text-[var(--color-text-primary)] min-w-0 overflow-hidden break-words">
              {cal.name}
              {cal.isPrimary && <span className="text-surface-500"> (primary)</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * Per-provider "Choose calendars" collapsible (CAL-UX.1). Loads lazily on first
 * expand. Google accounts connected before the calendar-list scope existed come
 * back with needsReconnect — that degrades to a reconnect prompt, never an error.
 * An empty selection is forbidden by the API, so Save stays disabled at zero boxes.
 */
function CalendarPicker({
  provider,
  label,
  onReconnect,
}: {
  provider: CalendarProvider;
  label: string;
  onReconnect: (provider: CalendarProvider) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CalendarListResult | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listed = await window.electronAPI.listProviderCalendars(provider);
      const initial = initialSelection(listed);
      setResult(listed);
      setChecked(initial);
      setBaseline(initial);
    } catch (err) {
      console.error(`Failed to list ${provider} calendars:`, err);
      setError('Could not load your calendars. Check the connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [provider]);

  const handleToggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !result) void load();
  };

  const handleToggleCalendar = (id: string) => {
    setSaved(false);
    setChecked((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.electronAPI.setSelectedCalendars(provider, checked);
      await load();
      setSaved(true);
    } catch (err) {
      console.error(`Failed to save ${provider} calendar selection:`, err);
      setError('Could not save your calendar selection.');
    } finally {
      setSaving(false);
    }
  };

  const handleReconnect = async () => {
    await onReconnect(provider);
    await load();
  };

  const canSave = checked.length > 0 && !sameIds(checked, baseline);

  return (
    <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
      <button
        type="button"
        onClick={handleToggleExpanded}
        aria-expanded={expanded}
        aria-label={`Choose calendars for ${label}`}
        className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        Choose calendars
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {loading && (
            <p className="inline-flex items-center gap-1.5 text-[0.6875rem] text-surface-500">
              <Loader2 size={12} className="animate-spin" />
              Loading calendars...
            </p>
          )}
          {error && (
            <p className="text-[0.6875rem] text-red-400" role="alert">
              {error}
            </p>
          )}
          {!loading &&
            result &&
            (result.needsReconnect ? (
              <div className="space-y-1.5">
                <p className="text-[0.6875rem] text-amber-400/90">Reconnect to choose which calendars sync</p>
                <button
                  type="button"
                  onClick={() => void handleReconnect()}
                  aria-label={`Reconnect ${label} to choose calendars`}
                  className="flex items-center gap-1 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] px-2.5 py-1 rounded-lg text-xs transition-colors"
                >
                  <Link2 size={12} />
                  Reconnect
                </button>
              </div>
            ) : (
              <>
                <CalendarCheckboxList calendars={result.calendars} checked={checked} onToggle={handleToggleCalendar} />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!canSave || saving}
                    aria-label={`Save calendar selection for ${label}`}
                    className="flex items-center gap-1 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg text-xs transition-colors"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" />}
                    Save
                  </button>
                  {saved && (
                    <span className="inline-flex items-center gap-1 text-[0.625rem] text-emerald-400 font-medium">
                      <Check size={11} />
                      Selection saved
                    </span>
                  )}
                </div>
              </>
            ))}
        </div>
      )}
    </div>
  );
}

/** The card's single primary action: Disconnect when healthy, else Connect/Reconnect. */
function ProviderActionButton({
  provider,
  label,
  isConnected,
  needsReauth,
  connecting,
  onConnect,
  onDisconnect,
}: {
  provider: CalendarProvider;
  label: string;
  isConnected: boolean;
  needsReauth: boolean;
  connecting: boolean;
  onConnect: (provider: CalendarProvider) => Promise<void>;
  onDisconnect: (provider: CalendarProvider) => void;
}) {
  if (isConnected) {
    return (
      <button
        onClick={() => onDisconnect(provider)}
        aria-label={`Disconnect ${label}`}
        className="flex items-center gap-1.5 border border-red-500/30 hover:border-red-500/50 bg-red-500/10 hover:bg-red-500/20 text-red-400 px-2.5 py-1.5 rounded-lg text-xs transition-colors shrink-0"
      >
        <Unlink size={13} />
        Disconnect
      </button>
    );
  }
  return (
    <button
      onClick={() => onConnect(provider)}
      disabled={connecting}
      aria-label={`${needsReauth ? 'Reconnect' : 'Connect'} ${label}`}
      className="flex items-center gap-1.5 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg text-xs transition-colors shrink-0"
    >
      {connecting ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
      {needsReauth ? 'Reconnect' : 'Connect'}
    </button>
  );
}

/** Primary embedded connect/disconnect/reconnect card for one provider. */
function ProviderCard({
  provider,
  label,
  status,
  connecting,
  connectError,
  onConnect,
  onDisconnect,
}: {
  provider: CalendarProvider;
  label: string;
  status?: CalendarAccountStatus;
  connecting: boolean;
  connectError?: string;
  onConnect: (provider: CalendarProvider) => Promise<void>;
  onDisconnect: (provider: CalendarProvider) => void;
}) {
  const needsReauth = status?.needsReauth === true;
  const connected = status?.connected === true;
  const isConnected = connected && !needsReauth;

  return (
    <div className="p-3 rounded-lg border border-[var(--color-border)] bg-surface-50 dark:bg-surface-950">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
          <ProviderStatusLine status={status} />
        </div>

        <ProviderActionButton
          provider={provider}
          label={label}
          isConnected={isConnected}
          needsReauth={needsReauth}
          connecting={connecting}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      </div>

      {isConnected && status?.lastSyncAt && (
        <p className="text-[0.6875rem] text-surface-500 mt-2">Last synced {formatSyncTime(status.lastSyncAt)}</p>
      )}
      {status?.lastError && !connectError && (
        <p className="text-[0.6875rem] text-amber-400/80 mt-2" role="alert">
          {status.lastError}
        </p>
      )}
      {connectError && (
        <p className="text-[0.6875rem] text-red-400 mt-2" role="alert">
          {connectError}
        </p>
      )}

      {/* CAL-UX.1: pick which of this account's calendars actually sync. Only for a
          healthy connection — a reauth-needed account must be fixed above first. */}
      {isConnected && <CalendarPicker provider={provider} label={label} onReconnect={onConnect} />}
    </div>
  );
}

/** Verbatim guided app-registration steps (mirrors the Phase G plan header). */
function RegistrationSteps({ provider }: { provider: CalendarProvider }) {
  if (provider === 'google') {
    return (
      <ol className="list-decimal ml-4 space-y-0.5 text-[0.6875rem] text-surface-500">
        <li>Enable the Google Calendar API.</li>
        <li>Configure the OAuth consent screen (User type: External) and publish it to production.</li>
        <li>Create an OAuth client ID of type Desktop app.</li>
        <li>Copy the client ID and client secret into the fields above.</li>
      </ol>
    );
  }
  return (
    <ol className="list-decimal ml-4 space-y-0.5 text-[0.6875rem] text-surface-500">
      <li>Create an App registration (accounts in any organizational directory and personal accounts).</li>
      <li>Add a Mobile and desktop applications platform with an http://localhost redirect URI.</li>
      <li>Set Allow public client flows to Yes.</li>
      <li>Copy the Application (client) ID into the field above.</li>
    </ol>
  );
}

/** BYO credential fields + guided steps for one provider (Advanced block). */
function ByoConfigRow({
  provider,
  label,
  hasSecret,
  configured,
  clientId,
  onClientIdChange,
  secret,
  onSecretChange,
  showSecret,
  onToggleShowSecret,
  showSteps,
  onToggleSteps,
  saving,
  onSave,
}: {
  provider: CalendarProvider;
  label: string;
  hasSecret: boolean;
  configured: boolean;
  clientId: string;
  onClientIdChange: (value: string) => void;
  secret: string;
  onSecretChange: (value: string) => void;
  showSecret: boolean;
  onToggleShowSecret: () => void;
  showSteps: boolean;
  onToggleSteps: () => void;
  saving: boolean;
  onSave: (provider: CalendarProvider) => void;
}) {
  const canSave = clientId.trim().length > 0 && (!hasSecret || secret.trim().length > 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-[var(--color-text-primary)]">{label}</p>
        {configured && (
          <span className="inline-flex items-center gap-1 text-[0.625rem] text-emerald-400 font-medium">
            <Check size={11} />
            Credentials saved
          </span>
        )}
      </div>

      <input
        type="text"
        value={clientId}
        onChange={(e) => onClientIdChange(e.target.value)}
        aria-label={`${label} client ID`}
        placeholder="Client ID"
        className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
      />
      {hasSecret && (
        <div className="relative">
          <input
            type={showSecret ? 'text' : 'password'}
            value={secret}
            onChange={(e) => onSecretChange(e.target.value)}
            aria-label={`${label} client secret`}
            placeholder="Client secret"
            className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 pr-10 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
          />
          <button
            type="button"
            onClick={onToggleShowSecret}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-800 dark:text-surface-200 transition-colors"
            title={showSecret ? 'Hide secret' : 'Show secret'}
          >
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(provider)}
          disabled={saving || !canSave}
          aria-label={`Save ${label} credentials`}
          className="flex items-center gap-1 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg text-xs transition-colors"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save credentials
        </button>
        <button
          type="button"
          onClick={onToggleSteps}
          className="text-[0.6875rem] text-[var(--color-accent-dim)] hover:text-[var(--color-accent)] transition-colors"
        >
          {showSteps ? 'Hide' : 'Create your free'} {provider === 'google' ? 'Google' : 'Microsoft'} app
        </button>
      </div>

      {showSteps && <RegistrationSteps provider={provider} />}
    </div>
  );
}

export default function CalendarSection() {
  const [statuses, setStatuses] = useState<CalendarAccountStatus[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Global calendar settings.
  const [pollInterval, setPollInterval] = useState<string>(CALENDAR_DEFAULT_POLL_INTERVAL_MINUTES);
  const [eventNotifications, setEventNotifications] = useState<boolean>(
    CALENDAR_DEFAULT_EVENT_NOTIFICATIONS === 'true',
  );

  // Per-provider transient UI state.
  const [connecting, setConnecting] = useState<CalendarProvider | null>(null);
  const [connectError, setConnectError] = useState<Partial<Record<CalendarProvider, string>>>({});

  // Advanced (BYO credentials) block.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [microsoftClientId, setMicrosoftClientId] = useState('');
  const [savingConfig, setSavingConfig] = useState<CalendarProvider | null>(null);
  // Session-scoped: true once BYO credentials are saved this session. There is no
  // getter for stored client config (and we never echo the secret), so we only
  // reflect a "configured" state after a successful save.
  const [byoConfigured, setByoConfigured] = useState<Partial<Record<CalendarProvider, boolean>>>({});
  const [showGoogleSteps, setShowGoogleSteps] = useState(false);
  const [showMicrosoftSteps, setShowMicrosoftSteps] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.getCalendarStatus();
      setStatuses(result);
    } catch (err) {
      console.error('Failed to load calendar status:', err);
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Load global calendar settings on mount (documented defaults when unset).
  useEffect(() => {
    void (async () => {
      try {
        const [rawPoll, rawNotify] = await Promise.all([
          window.electronAPI.getSetting(CALENDAR_SETTING_POLL_INTERVAL_MINUTES),
          window.electronAPI.getSetting(CALENDAR_SETTING_EVENT_NOTIFICATIONS),
        ]);
        setPollInterval(rawPoll ?? CALENDAR_DEFAULT_POLL_INTERVAL_MINUTES);
        setEventNotifications((rawNotify ?? CALENDAR_DEFAULT_EVENT_NOTIFICATIONS) !== 'false');
      } catch (err) {
        console.error('Failed to load calendar settings:', err);
      }
    })();
  }, []);

  const statusFor = (provider: CalendarProvider): CalendarAccountStatus | undefined =>
    statuses?.find((s) => s.provider === provider);

  const handleConnect = async (provider: CalendarProvider) => {
    setConnecting(provider);
    setConnectError((prev) => ({ ...prev, [provider]: undefined }));
    try {
      await window.electronAPI.connectCalendar(provider);
      await loadStatus();
    } catch (err) {
      console.error(`Failed to connect ${provider} calendar:`, err);
      // Most likely cause when no embedded creds ship AND no BYO override exists:
      // the engine has no client config. Point the user at Advanced rather than
      // adding a field to the frozen status contract.
      setConnectError((prev) => ({
        ...prev,
        [provider]:
          'Could not start the connection. If this build ships without calendar credentials, add your own under "Advanced — use your own credentials" below, then try again.',
      }));
      setShowAdvanced(true);
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: CalendarProvider) => {
    try {
      await window.electronAPI.disconnectCalendar(provider);
      await loadStatus();
    } catch (err) {
      console.error(`Failed to disconnect ${provider} calendar:`, err);
    }
  };

  const handlePollChange = async (value: string) => {
    setPollInterval(value);
    try {
      await window.electronAPI.setSetting(CALENDAR_SETTING_POLL_INTERVAL_MINUTES, value);
    } catch (err) {
      console.error('Failed to save calendar poll interval:', err);
    }
  };

  const handleNotificationsToggle = async (checked: boolean) => {
    setEventNotifications(checked);
    try {
      await window.electronAPI.setSetting(CALENDAR_SETTING_EVENT_NOTIFICATIONS, checked ? 'true' : 'false');
    } catch (err) {
      console.error('Failed to save calendar notifications setting:', err);
      setEventNotifications(!checked);
    }
  };

  const handleSaveConfig = async (provider: CalendarProvider) => {
    const clientId = (provider === 'google' ? googleClientId : microsoftClientId).trim();
    if (!clientId) return;
    let config: CalendarClientConfig;
    if (provider === 'google') {
      const secret = googleClientSecret.trim();
      if (!secret) return;
      config = { provider: 'google', clientId, clientSecret: secret };
    } else {
      config = { provider: 'microsoft', clientId };
    }
    setSavingConfig(provider);
    try {
      await window.electronAPI.setCalendarClientConfig(config);
      setByoConfigured((prev) => ({ ...prev, [provider]: true }));
      setConnectError((prev) => ({ ...prev, [provider]: undefined }));
      // Clear inputs — never keep the secret in renderer state longer than needed.
      if (provider === 'google') {
        setGoogleClientId('');
        setGoogleClientSecret('');
        setShowGoogleSecret(false);
      } else {
        setMicrosoftClientId('');
      }
    } catch (err) {
      console.error(`Failed to save ${provider} calendar credentials:`, err);
    } finally {
      setSavingConfig(null);
    }
  };

  if (loading) {
    return (
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Calendar</h2>
        </div>
        <div className="flex items-center justify-center py-6 text-surface-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-[var(--color-accent-dim)]" />
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Calendar</h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Connect a calendar so upcoming meetings can drive one-click recording.
        </p>
      </div>

      <div className="p-4 hud-panel clip-corner-cut-sm space-y-4">
        {/* Privacy copy */}
        <div className="flex items-start gap-2 pb-3 border-b border-[var(--color-border)]">
          <ShieldCheck size={14} className="text-[var(--color-accent-dim)] shrink-0 mt-0.5" />
          <p className="text-xs text-surface-500">{PRIVACY_COPY}</p>
        </div>

        {/* Per-provider connect cards (primary UX) */}
        <div className="space-y-2">
          {PROVIDERS.map(({ provider, label }) => (
            <ProviderCard
              key={provider}
              provider={provider}
              label={label}
              status={statusFor(provider)}
              connecting={connecting === provider}
              connectError={connectError[provider]}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>

        {/* Global calendar settings */}
        <div className="pt-3 border-t border-[var(--color-border)] space-y-3">
          <div>
            <label
              htmlFor="calendar-poll-interval"
              className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
            >
              Check for new events
            </label>
            <select
              id="calendar-poll-interval"
              value={pollInterval}
              onChange={(e) => handlePollChange(e.target.value)}
              aria-label="Calendar poll interval"
              className="w-full max-w-xs text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)]"
            >
              {POLL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={eventNotifications}
              onChange={(e) => handleNotificationsToggle(e.target.checked)}
              aria-label="Event start notifications"
              className="mt-0.5 w-4 h-4 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">Event start notifications</span>
              <p className="text-xs text-surface-500 mt-0.5">
                Show a desktop notification when a calendar event is about to start. Recording is never started
                automatically.
              </p>
            </div>
          </label>
        </div>

        {/* Advanced — BYO credentials (collapsed by default) */}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced — use your own credentials
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4">
              <div className="flex items-start gap-2 text-[0.6875rem] text-surface-500">
                <AlertTriangle size={13} className="text-amber-400/80 shrink-0 mt-0.5" />
                <p>
                  Optional. Register your own free OAuth app to connect a calendar. Credentials are stored encrypted on
                  this device and are never echoed back.
                </p>
              </div>
              {PROVIDERS.map(({ provider, label, hasSecret }) => (
                <ByoConfigRow
                  key={provider}
                  provider={provider}
                  label={label}
                  hasSecret={hasSecret}
                  configured={byoConfigured[provider] === true}
                  clientId={provider === 'google' ? googleClientId : microsoftClientId}
                  onClientIdChange={provider === 'google' ? setGoogleClientId : setMicrosoftClientId}
                  secret={googleClientSecret}
                  onSecretChange={setGoogleClientSecret}
                  showSecret={showGoogleSecret}
                  onToggleShowSecret={() => setShowGoogleSecret((v) => !v)}
                  showSteps={provider === 'google' ? showGoogleSteps : showMicrosoftSteps}
                  onToggleSteps={
                    provider === 'google' ? () => setShowGoogleSteps((v) => !v) : () => setShowMicrosoftSteps((v) => !v)
                  }
                  saving={savingConfig === provider}
                  onSave={handleSaveConfig}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
