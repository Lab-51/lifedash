// === FILE PURPOSE ===
// Shared TypeScript types for the background agent system.
// Used by both the main process service and the renderer UI.

export type InsightType = 'stale_cards' | 'risk_detection' | 'relationship_suggestions' | 'weekly_digest';

export type InsightSeverity = 'info' | 'warning' | 'critical';

export type InsightStatus = 'new' | 'read' | 'dismissed' | 'acted_on';

export interface AgentInsight {
  id: string;
  projectId: string;
  type: InsightType;
  severity: InsightSeverity;
  status: InsightStatus;
  title: string;
  summary: string;
  details: Record<string, unknown> | null;
  relatedCardIds: string[];
  tokenCost: number;
  createdAt: Date;
  readAt: Date | null;
  dismissedAt: Date | null;
}

export interface BackgroundAgentPreferences {
  enabled: boolean;
  frequency: 'hourly' | 'every_4h' | 'daily';
  dailyTokenBudget: number;
  enabledInsightTypes: InsightType[];
  staleCardThresholdDays: number;
}
