// === Preload bridge: Calendar (Phase G) — status, BYO client config, connect/
// disconnect, cached upcoming events, force-poll, and the suggest-project stub. ===
import { ipcRenderer } from 'electron';
import type {
  CalendarProvider,
  CalendarClientConfig,
  CalendarAccountStatus,
  CalendarEvent,
  CalendarEventContext,
  CalendarListResult,
  CalendarProjectSuggestion,
} from '../../shared/types/calendar';

export const calendarBridge = {
  getCalendarStatus: (): Promise<CalendarAccountStatus[]> => ipcRenderer.invoke('calendar:get-status'),
  setCalendarClientConfig: (config: CalendarClientConfig): Promise<void> =>
    ipcRenderer.invoke('calendar:set-client-config', config),
  connectCalendar: (provider: CalendarProvider): Promise<CalendarAccountStatus | null> =>
    ipcRenderer.invoke('calendar:connect', provider),
  disconnectCalendar: (provider: CalendarProvider): Promise<void> =>
    ipcRenderer.invoke('calendar:disconnect', provider),
  getUpcomingCalendarEvents: (withinHours: number): Promise<CalendarEvent[]> =>
    ipcRenderer.invoke('calendar:get-upcoming', withinHours),
  pollCalendarNow: (): Promise<void> => ipcRenderer.invoke('calendar:poll-now'),
  listProviderCalendars: (provider: CalendarProvider): Promise<CalendarListResult> =>
    ipcRenderer.invoke('calendar:list-calendars', provider),
  setSelectedCalendars: (provider: CalendarProvider, calendarIds: string[]): Promise<void> =>
    ipcRenderer.invoke('calendar:set-selected-calendars', { provider, calendarIds }),
  suggestCalendarProject: (input: { seriesId?: string; eventId?: string }): Promise<CalendarProjectSuggestion | null> =>
    ipcRenderer.invoke('calendar:suggest-project', input),
  // CAL-UX.2 — instant deterministic context (no model), and the opt-in prep note.
  getCalendarEventContext: (eventId: string): Promise<CalendarEventContext> =>
    ipcRenderer.invoke('calendar:get-event-context', { eventId }),
  generateCalendarPrepNote: (eventId: string): Promise<{ note: string }> =>
    ipcRenderer.invoke('calendar:generate-prep-note', { eventId }),

  // Poller push: main emits after each poll cycle refreshes the event cache so the
  // renderer ribbon/banners can re-read it. Returns an unsubscribe fn.
  onCalendarEventsUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('calendar:events-updated', handler);
    return () => {
      ipcRenderer.removeListener('calendar:events-updated', handler);
    };
  },
};
