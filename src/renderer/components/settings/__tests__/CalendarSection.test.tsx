// @vitest-environment jsdom
// Phase G Task 6: CalendarSection drives the embedded-first Connect/Disconnect/
// Reconnect lifecycle, the global poll-interval + notification settings, and the
// collapsed BYO-credentials override — which must render a "configured" state
// after saving WITHOUT ever echoing the client secret back.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CalendarAccountStatus } from '../../../../shared/types/calendar';

const getCalendarStatus = vi.fn();
const connectCalendar = vi.fn();
const disconnectCalendar = vi.fn();
const setCalendarClientConfig = vi.fn();
const getSetting = vi.fn();
const setSetting = vi.fn();

vi.stubGlobal('electronAPI', {
  getCalendarStatus,
  connectCalendar,
  disconnectCalendar,
  setCalendarClientConfig,
  getSetting,
  setSetting,
});

const { default: CalendarSection } = await import('../CalendarSection');

const notConnected = (provider: 'google' | 'microsoft'): CalendarAccountStatus => ({
  provider,
  connected: false,
  needsReauth: false,
});

const connected = (provider: 'google' | 'microsoft', email: string): CalendarAccountStatus => ({
  provider,
  connected: true,
  needsReauth: false,
  accountEmail: email,
});

describe('CalendarSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCalendarStatus.mockResolvedValue([notConnected('google'), notConnected('microsoft')]);
    connectCalendar.mockResolvedValue(null);
    disconnectCalendar.mockResolvedValue(undefined);
    setCalendarClientConfig.mockResolvedValue(undefined);
    getSetting.mockResolvedValue(null);
    setSetting.mockResolvedValue(undefined);
  });

  it('shows Connect for an unconnected provider and runs the OAuth flow on click', async () => {
    render(<CalendarSection />);

    const connectBtn = await screen.findByLabelText('Connect Google Calendar');
    fireEvent.click(connectBtn);

    await waitFor(() => expect(connectCalendar).toHaveBeenCalledWith('google'));
    // status is re-read after a successful connect (mount load + post-connect)
    await waitFor(() => expect(getCalendarStatus).toHaveBeenCalledTimes(2));
  });

  it('shows the account email + Disconnect when connected, and disconnects on click', async () => {
    getCalendarStatus.mockResolvedValue([connected('google', 'me@example.com'), notConnected('microsoft')]);
    render(<CalendarSection />);

    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    const disconnectBtn = screen.getByLabelText('Disconnect Google Calendar');
    fireEvent.click(disconnectBtn);

    await waitFor(() => expect(disconnectCalendar).toHaveBeenCalledWith('google'));
  });

  it('shows a Reconnect affordance with an expiry note when needsReauth', async () => {
    getCalendarStatus.mockResolvedValue([
      { provider: 'google', connected: true, needsReauth: true, accountEmail: 'me@example.com' },
      notConnected('microsoft'),
    ]);
    render(<CalendarSection />);

    expect(await screen.findByLabelText('Reconnect Google Calendar')).toBeInTheDocument();
    expect(screen.getByText(/Authorization expired/i)).toBeInTheDocument();
  });

  it('surfaces a message pointing to Advanced when connect fails (nothing configured)', async () => {
    connectCalendar.mockRejectedValue(new Error('no client config'));
    render(<CalendarSection />);

    const connectBtn = await screen.findByLabelText('Connect Microsoft / Outlook');
    fireEvent.click(connectBtn);

    await waitFor(() => expect(screen.getByText(/Advanced — use your own credentials/i)).toBeInTheDocument());
    // The Advanced BYO block auto-expands so the fields are reachable.
    expect(await screen.findByLabelText('Microsoft / Outlook client ID')).toBeInTheDocument();
  });

  it('persists the poll interval to the documented settings key', async () => {
    render(<CalendarSection />);

    const select = await screen.findByLabelText('Calendar poll interval');
    fireEvent.change(select, { target: { value: '30' } });

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('calendar:pollIntervalMinutes', '30'));
  });

  it('persists the event-notification toggle to the documented settings key', async () => {
    render(<CalendarSection />);

    const toggle = await screen.findByLabelText('Event start notifications');
    fireEvent.click(toggle); // default true -> false

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('calendar:eventNotifications', 'false'));
  });

  it('saves BYO credentials and renders a configured state WITHOUT echoing the secret', async () => {
    render(<CalendarSection />);

    // Open Advanced.
    fireEvent.click(await screen.findByText('Advanced — use your own credentials'));

    const clientId = await screen.findByLabelText('Google Calendar client ID');
    const secret = screen.getByLabelText('Google Calendar client secret');
    fireEvent.change(clientId, { target: { value: 'gid-123.apps.googleusercontent.com' } });
    fireEvent.change(secret, { target: { value: 'super-secret-value' } });

    fireEvent.click(screen.getByLabelText('Save Google Calendar credentials'));

    await waitFor(() =>
      expect(setCalendarClientConfig).toHaveBeenCalledWith({
        provider: 'google',
        clientId: 'gid-123.apps.googleusercontent.com',
        clientSecret: 'super-secret-value',
      }),
    );

    // Configured badge appears...
    expect(await screen.findByText('Credentials saved')).toBeInTheDocument();
    // ...and the secret is never rendered back anywhere in the DOM.
    expect(screen.queryByDisplayValue('super-secret-value')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('super-secret-value');
  });

  it('reads global settings with documented defaults on mount', async () => {
    render(<CalendarSection />);

    await waitFor(() => expect(getSetting).toHaveBeenCalledWith('calendar:pollIntervalMinutes'));
    expect(getSetting).toHaveBeenCalledWith('calendar:eventNotifications');
    // Default poll interval is 5 minutes when unset.
    const select = (await screen.findByLabelText('Calendar poll interval')) as HTMLSelectElement;
    expect(select.value).toBe('5');
  });
});
