// === FILE PURPOSE ===
// Manages card file attachments — copies files into app data directory,
// stores metadata in DB, handles file deletion and opening.
//
// === DEPENDENCIES ===
// electron (app, dialog, shell), fs, path, drizzle
//
// === LIMITATIONS ===
// - Files are copied (not moved) — original stays in place
// - No file size limit enforced (user responsibility)
// - No duplicate detection (same file can be attached multiple times)
// - openAttachment validates paths are within userData/attachments/ (path traversal prevention)

import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/connection';
import { cardAttachments } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import type { CardAttachment } from '../../shared/types';

// Common MIME type lookup by extension
const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.html': 'text/html',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

function getAttachmentsDir(cardId: string): string {
  const dir = path.join(app.getPath('userData'), 'attachments', cardId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toAttachment(row: typeof cardAttachments.$inferSelect): CardAttachment {
  return {
    id: row.id,
    cardId: row.cardId,
    fileName: row.fileName,
    filePath: row.filePath,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getAttachments(cardId: string): Promise<CardAttachment[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cardAttachments)
    .where(eq(cardAttachments.cardId, cardId))
    .orderBy(desc(cardAttachments.createdAt));
  return rows.map(toAttachment);
}

export async function addAttachment(cardId: string): Promise<CardAttachment | null> {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  const originalName = path.basename(sourcePath);
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  const stats = fs.statSync(sourcePath);
  const mimeType = MIME_MAP[ext.toLowerCase()] ?? 'application/octet-stream';

  const destDir = getAttachmentsDir(cardId);

  // Handle filename collision — append -1, -2, etc.
  let destName = originalName;
  let counter = 0;
  while (fs.existsSync(path.join(destDir, destName))) {
    counter++;
    destName = `${baseName}-${counter}${ext}`;
  }
  const destPath = path.join(destDir, destName);

  fs.copyFileSync(sourcePath, destPath);

  const db = getDb();
  const [row] = await db
    .insert(cardAttachments)
    .values({
      cardId,
      fileName: destName,
      filePath: destPath,
      fileSize: stats.size,
      mimeType,
    })
    .returning();

  return toAttachment(row);
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = getDb();
  const [att] = await db
    .select()
    .from(cardAttachments)
    .where(eq(cardAttachments.id, id));

  if (att) {
    // Delete file from disk (ignore errors if file already missing)
    try {
      fs.unlinkSync(att.filePath);
    } catch {
      // File may already be deleted — that's OK
    }
    await db.delete(cardAttachments).where(eq(cardAttachments.id, id));
  }
}

export async function openAttachment(filePath: string): Promise<void> {
  // Validate that the path is within the attachments directory
  const attachmentsRoot = path.join(app.getPath('userData'), 'attachments');
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(attachmentsRoot)) {
    throw new Error('Access denied: file path is outside the attachments directory');
  }

  // Verify the file exists before attempting to open
  if (!fs.existsSync(resolved)) {
    throw new Error('File not found: the attachment file no longer exists on disk');
  }

  await shell.openPath(resolved);
}
