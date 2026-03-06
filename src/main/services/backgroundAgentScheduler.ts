// === FILE PURPOSE ===
// Background scheduler for AI-powered project insights.
// Periodically analyzes projects for stale cards and other patterns.
// Follows the same init/stop pattern as notificationScheduler.ts.
//
// === DEPENDENCIES ===
// backgroundAgentService (preferences, budget, insights),
// ai-provider (resolveTaskModel, generate)
//
// === LIMITATIONS ===
// - Frequency-based check granularity (hourly/4h/daily)
// - Never throws — all errors caught and logged

import { BrowserWindow } from 'electron';
import { getDb } from '../db/connection';
import { projects } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { createLogger } from './logger';

import {
  getPreferences,
  isBudgetExhausted,
  analyzeStaleCardsConsolidated,
  cleanupOldInsights,
} from './backgroundAgentService';

const log = createLogger('BackgroundAgentScheduler');

const STARTUP_DELAY_MS = 60_000; // 60 seconds (lower priority than notifications)

const FREQUENCY_MS: Record<string, number> = {
  hourly: 3_600_000,
  every_4h: 14_400_000,
  daily: 86_400_000,
};

let intervalId: ReturnType<typeof setInterval> | null = null;
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let mainWindowRef: BrowserWindow | null = null;

/**
 * Initialize the background agent scheduler.
 * Starts a delayed first check, then repeats based on frequency preference.
 */
export function initBackgroundAgentScheduler(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;

  // Run first check after startup delay
  startupTimeoutId = setTimeout(() => {
    checkAndRunInsights().catch((err) => {
      log.error('Initial insight check failed:', err);
    });
  }, STARTUP_DELAY_MS);

  // Set interval based on frequency preference (async, fire-and-forget)
  getPreferences()
    .then((prefs) => {
      const intervalMs = FREQUENCY_MS[prefs.frequency] ?? FREQUENCY_MS.daily;
      intervalId = setInterval(() => {
        checkAndRunInsights().catch((err) => {
          log.error('Scheduled insight check failed:', err);
        });
      }, intervalMs);
      log.info(`Scheduler initialized (frequency: ${prefs.frequency}, interval: ${intervalMs}ms)`);
    })
    .catch((err) => {
      log.error('Failed to load preferences for scheduler interval:', err);
      // Fall back to daily
      intervalId = setInterval(() => {
        checkAndRunInsights().catch((err2) => {
          log.error('Scheduled insight check failed:', err2);
        });
      }, FREQUENCY_MS.daily);
    });
}

/**
 * Stop the background agent scheduler and release references.
 */
export function stopBackgroundAgentScheduler(): void {
  if (startupTimeoutId !== null) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  mainWindowRef = null;
  log.info('Scheduler stopped');
}

/**
 * Run all enabled insight analyses across all non-archived projects.
 * Never throws — all errors are caught and logged.
 */
export async function checkAndRunInsights(): Promise<void> {
  try {
    // 1. Check if background agent is enabled
    const prefs = await getPreferences();
    if (!prefs.enabled) {
      log.info('Background agent disabled — skipping');
      return;
    }

    // 2. Check daily token budget
    const budgetExhausted = await isBudgetExhausted();
    if (budgetExhausted) {
      log.info('Daily token budget exhausted — skipping');
      return;
    }

    // 4. Get projects to analyze (filtered by preference or all non-archived)
    const db = getDb();
    let projectsToAnalyze: { id: string; name: string }[];

    if (prefs.analyzedProjectIds.length > 0) {
      // Only analyze selected projects
      projectsToAnalyze = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(
          and(
            inArray(projects.id, prefs.analyzedProjectIds),
            eq(projects.archived, false),
          ),
        );
    } else {
      // Analyze all non-archived projects
      projectsToAnalyze = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.archived, false));
    }

    if (projectsToAnalyze.length === 0) {
      log.info('No projects to analyze — skipping');
      return;
    }

    // 5. Clean up old dismissed insights first (ensures stale duplicates are gone)
    try {
      await cleanupOldInsights();
    } catch (err) {
      log.error('Cleanup of old insights failed:', err);
    }

    // 6. Run enabled insight types (consolidated across all projects)
    let totalInsightsCreated = 0;

    for (const insightType of prefs.enabledInsightTypes) {
      try {
        // Re-check budget before each analysis (AI calls consume tokens)
        const stillHasBudget = !(await isBudgetExhausted());
        if (!stillHasBudget) {
          log.info('Budget exhausted mid-run — stopping');
          break;
        }

        if (insightType === 'stale_cards') {
          const insight = await analyzeStaleCardsConsolidated(projectsToAnalyze);
          if (insight) totalInsightsCreated++;
        }
        // Future insight types: risk_detection, relationship_suggestions, weekly_digest
      } catch (err) {
        log.error(`Insight ${insightType} failed:`, err);
      }
    }

    // 7. Notify renderer of new insights
    if (totalInsightsCreated > 0 && mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('background-agent:new-insights', {
        count: totalInsightsCreated,
      });
      log.info(`Created ${totalInsightsCreated} new insight(s) — renderer notified`);
    } else if (totalInsightsCreated > 0) {
      log.info(`Created ${totalInsightsCreated} new insight(s) — no window to notify`);
    } else {
      log.info('Insight check complete — no new insights');
    }
  } catch (err) {
    log.error('checkAndRunInsights failed:', err);
    // Never throw from background task
  }
}
