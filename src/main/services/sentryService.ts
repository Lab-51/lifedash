// === FILE PURPOSE ===
// Opt-in Sentry crash reporting service.
// Reads the user's preference from the DB settings table.
// Gracefully no-ops when SENTRY_DSN is not set (OSS default).

import { app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';

const log = createLogger('Sentry');

const SETTING_KEY = 'diagnostics.sendCrashReports';

let initialized = false;
let enabled = false;

function getDsn(): string {
  return (process.env.SENTRY_DSN as string) || '';
}

function stripPii(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  const userData = app.getPath('userData');
  const home = app.getPath('home');

  const sanitize = (str: string | undefined): string | undefined => {
    if (!str) return str;
    let result = str;
    if (userData) result = result.replaceAll(userData, '[USER_DATA]');
    if (home) result = result.replaceAll(home, '[HOME]');
    return result;
  };

  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      ex.value = sanitize(ex.value);
      if (ex.stacktrace?.frames) {
        for (const frame of ex.stacktrace.frames) {
          frame.filename = sanitize(frame.filename);
          frame.abs_path = sanitize(frame.abs_path);
        }
      }
    }
  }

  if (event.request) {
    delete event.request.data;
  }

  return event;
}

function filterBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  const sensitive = ['apiKey', 'Bearer', 'sk-', 'key_'];
  const message = breadcrumb.message || '';
  const category = breadcrumb.category || '';
  const data = JSON.stringify(breadcrumb.data || {});

  for (const token of sensitive) {
    if (message.includes(token) || category.includes(token) || data.includes(token)) {
      return null;
    }
  }
  return breadcrumb;
}

async function readSetting(): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, SETTING_KEY));
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

async function writeSetting(value: string): Promise<void> {
  try {
    const db = getDb();
    await db
      .insert(settings)
      .values({ key: SETTING_KEY, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  } catch (err) {
    log.error('Failed to write setting:', err);
  }
}

export async function initSentry(): Promise<void> {
  const dsn = getDsn();
  if (!dsn) {
    log.info('No SENTRY_DSN configured — crash reporting disabled');
    return;
  }

  const settingValue = await readSetting();
  if (settingValue !== 'true') {
    log.info('Crash reporting not opted in — skipping Sentry init');
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: app.isPackaged ? 'production' : 'development',
      release: app.getVersion(),
      beforeSend: stripPii,
      beforeBreadcrumb: filterBreadcrumb,
    });
    initialized = true;
    enabled = true;
    log.info('Sentry initialized');
  } catch (err) {
    log.error('Sentry init failed:', err);
  }
}

export async function enableSentry(): Promise<void> {
  await writeSetting('true');
  if (!initialized) {
    const dsn = getDsn();
    if (!dsn) {
      log.info('No SENTRY_DSN — toggle saved but Sentry cannot start');
      return;
    }
    try {
      Sentry.init({
        dsn,
        environment: app.isPackaged ? 'production' : 'development',
        release: app.getVersion(),
        beforeSend: stripPii,
        beforeBreadcrumb: filterBreadcrumb,
      });
      initialized = true;
      enabled = true;
      log.info('Sentry enabled');
    } catch (err) {
      log.error('Sentry enable failed:', err);
    }
  } else {
    enabled = true;
  }
}

export async function disableSentry(): Promise<void> {
  await writeSetting('false');
  if (initialized) {
    try {
      await Sentry.close(2000);
    } catch {
      // ignore close errors
    }
    initialized = false;
    enabled = false;
    log.info('Sentry disabled');
  }
}

export function isSentryEnabled(): boolean {
  return enabled;
}
