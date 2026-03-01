// === FILE PURPOSE ===
// Single source of truth for pro vs free feature gating.
// Used by licensingService.isFeatureEnabled() and renderer UI guards.

export const PRO_FEATURES = {
  cardAgent: { key: 'cardAgent', label: 'Card AI Agent', description: 'AI assistant with tool-calling per card' },
  meetingToCard: { key: 'meetingToCard', label: 'AI Meeting → Cards', description: 'Auto-convert action items to project cards' },
  billableExport: { key: 'billableExport', label: 'Billable Time Export', description: 'Export focus sessions as billable CSV' },
  backupRestore: { key: 'backupRestore', label: 'Backup & Restore', description: 'Full database backup and restore' },
  dataExport: { key: 'dataExport', label: 'Data Export', description: 'Export all data as JSON/CSV' },
  projectAgent: { key: 'projectAgent', label: 'Project AI Agent', description: 'AI assistant with cross-board intelligence per project' },
  backgroundAgent: { key: 'backgroundAgent', label: 'Background AI Agents', description: 'Autonomous AI agents that analyze your projects in the background' },
} as const;

export type ProFeatureKey = keyof typeof PRO_FEATURES;
