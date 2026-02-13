// === FILE PURPOSE ===
// Export database data as JSON or CSV for external use.
// Queries all tables via Drizzle ORM, serializes, and writes to file.
//
// === DEPENDENCIES ===
// - Database connection (getDb from connection.ts)
//
// === LIMITATIONS ===
// - API keys (aiProviders.apiKeyEncrypted) excluded from exports
// - Audio files not included
// - CSV: one file per table (relational data doesn't flatten well)

import * as fs from 'node:fs';
import { PgTable } from 'drizzle-orm/pg-core';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';

// Tables to export (map of tableName -> drizzle table reference)
const EXPORT_TABLES: Record<string, PgTable> = {
  projects: schema.projects,
  boards: schema.boards,
  columns: schema.columns,
  cards: schema.cards,
  labels: schema.labels,
  cardLabels: schema.cardLabels,
  cardComments: schema.cardComments,
  cardRelationships: schema.cardRelationships,
  cardActivities: schema.cardActivities,
  meetings: schema.meetings,
  transcripts: schema.transcripts,
  meetingBriefs: schema.meetingBriefs,
  actionItems: schema.actionItems,
  ideas: schema.ideas,
  ideaTags: schema.ideaTags,
  brainstormSessions: schema.brainstormSessions,
  brainstormMessages: schema.brainstormMessages,
  settings: schema.settings,
  aiProviders: schema.aiProviders,
  aiUsage: schema.aiUsage,
};

// Columns to strip from exports (sensitive data)
const SENSITIVE_COLUMNS: Record<string, string[]> = {
  aiProviders: ['apiKeyEncrypted'],
};

export async function exportAllData(
  tables?: string[],
): Promise<Record<string, Record<string, unknown>[]>> {
  const db = getDb();
  const result: Record<string, Record<string, unknown>[]> = {};
  const tableNames = tables || Object.keys(EXPORT_TABLES);

  for (const name of tableNames) {
    const table = EXPORT_TABLES[name];
    if (!table) continue;

    const rows = await db.select().from(table);

    // Strip sensitive columns
    const sensitiveKeys = SENSITIVE_COLUMNS[name];
    if (sensitiveKeys) {
      result[name] = rows.map((row: Record<string, unknown>) => {
        const cleaned = { ...row };
        for (const key of sensitiveKeys) {
          delete cleaned[key];
        }
        return cleaned;
      });
    } else {
      result[name] = rows;
    }
  }

  return result;
}

export async function writeJSON(
  data: Record<string, Record<string, unknown>[]>,
  filePath: string,
): Promise<number> {
  const json = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(filePath, json, 'utf-8');
  return Buffer.byteLength(json, 'utf-8');
}

// --- CSV helpers ---

function toCsvRow(values: unknown[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return '';
      const str = String(v);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(',');
}

export function tableToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [toCsvRow(headers)];
  for (const row of rows) {
    lines.push(toCsvRow(headers.map((h) => row[h])));
  }
  return lines.join('\n');
}
