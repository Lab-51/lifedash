// === Intel Feed types ===

export type IntelSourceType = 'rss' | 'manual';
export type IntelBriefType = 'daily' | 'weekly';

export interface IntelFeed {
  id: string;
  name: string;
  emoji: string | null;
  position: number;
  sourceCount: number;
  createdAt: string;
}

export interface CreateIntelFeedInput {
  name: string;
  emoji?: string;
}

export interface UpdateIntelFeedInput {
  name?: string;
  emoji?: string;
  position?: number;
}

export interface IntelFeedSourceAssignment {
  feedId: string;
  sourceId: string;
}

export interface IntelBrief {
  id: string;
  type: IntelBriefType;
  date: string;
  feedId?: string | null;
  content: string;
  articleCount: number;
  generatedAt: string;
  isPinned: boolean;
  createdAt: string;
}

export const INTEL_CATEGORIES = [
  'Model Releases',
  'Research & Papers',
  'Developer Tools',
  'Policy & Regulation',
  'Industry News',
  'Startups & Funding',
  'Open Source',
  'Tutorials & Guides',
  'Other',
] as const;

export type IntelCategory = (typeof INTEL_CATEGORIES)[number];

export interface IntelSource {
  id: string;
  name: string;
  url: string;
  type: IntelSourceType;
  enabled: boolean;
  iconUrl: string | null;
  lastFetchedAt: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntelItem {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceIconUrl: string | null;
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  author: string | null;
  publishedAt: string;
  fetchedAt: string;
  isRead: boolean;
  isBookmarked: boolean;
  category: string | null;
  summary: string | null;
  relevanceScore: number | null;
  fullContent: string | null;
  alternateUrls: string[] | null;
  createdAt: string;
}

export interface ArticleContent {
  title: string;
  content: string; // cleaned HTML from Readability
  textContent: string; // plain text version
  excerpt: string; // first ~200 chars
  byline: string | null;
  siteName: string | null;
  length: number; // word count
}

export interface CreateIntelSourceInput {
  name: string;
  url: string;
  type?: IntelSourceType;
}

export interface UpdateIntelSourceInput {
  name?: string;
  enabled?: boolean;
}

export interface AddManualItemInput {
  url: string;
  title?: string;
  description?: string;
}

export type IntelDateFilter = 'today' | 'week' | 'all';

export interface IntelChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
