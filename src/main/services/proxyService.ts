// === FILE PURPOSE ===
// Proxy detection and application for enterprise networks.
// Uses undici ProxyAgent + setGlobalDispatcher to intercept all
// Node.js fetch calls in the main process (Electron 40 / Node 22).

// === DEPENDENCIES ===
// undici (npm package), drizzle-orm, ./logger

import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLogger } from './logger';

const log = createLogger('Proxy');

export interface ProxyConfig {
  url: string;       // e.g. http://proxy.corp.com:8080
  noProxy: string;   // comma-separated domains to bypass
}

/** Read proxy config from environment variables. */
function getEnvProxy(): ProxyConfig | null {
  const url =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy;
  if (!url) return null;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  return { url, noProxy };
}

/** Read proxy config from the settings DB. Returns null if not configured. */
async function getDbProxy(): Promise<ProxyConfig | null> {
  try {
    const db = getDb();
    const [urlRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'proxy:url'));
    if (!urlRow?.value) return null;
    const [noProxyRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'proxy:noProxy'));
    return {
      url: urlRow.value,
      noProxy: noProxyRow?.value ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * Get the current proxy config.
 * Priority: environment variables > DB settings.
 */
export async function getProxyConfig(): Promise<ProxyConfig | null> {
  return getEnvProxy() ?? (await getDbProxy());
}

/**
 * Apply proxy globally. Call early in app startup and after proxy settings change.
 * Sets undici's global dispatcher so all Node.js fetch calls go through the proxy.
 */
export async function applyGlobalProxy(): Promise<void> {
  const config = await getProxyConfig();
  if (!config) {
    log.info('No proxy configured');
    return;
  }
  try {
    const agent = new ProxyAgent({ uri: config.url });
    setGlobalDispatcher(agent);
    log.info(`Proxy applied: ${config.url}`);
  } catch (error) {
    log.error('Failed to apply proxy:', error);
  }
}
