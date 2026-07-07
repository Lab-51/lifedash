// === FILE PURPOSE ===
// Compact, reverse-chron list of assistant/triage activity (V3.1 Task 5). Pure
// presentational component — the caller supplies `entries` (either live, read
// from activityFeedStore, or a post-hoc reconstruction from persisted data) and
// an `onSelectTab` handler for the "click an entry to switch canvas tab"
// affordance (an explicit user action — never an auto-flip). Rendered in TWO
// places: LiveModeOverlay's right column (below the proposals feed, collapsible
// so it doesn't crowd the chat) and SessionWorkspace's right rail ("Session
// activity", post-hoc).
//
// === DEPENDENCIES ===
// lucide-react, utils/date-utils (formatRelativeTime), activityFeedStore
// (ActivityFeedEntry/ActivityFeedIcon types), LiveCanvasTabs (CanvasTabId type)

import { useState } from 'react';
import { Activity, CheckCircle2, XCircle, Check, FolderPlus, ChevronDown, ChevronUp } from 'lucide-react';
import { formatRelativeTime } from '../utils/date-utils';
import type { ActivityFeedEntry, ActivityFeedIcon } from '../stores/activityFeedStore';
import type { CanvasTabId } from './LiveCanvasTabs';

const ICONS: Record<ActivityFeedIcon, typeof CheckCircle2> = {
  'tool-ok': CheckCircle2,
  'tool-error': XCircle,
  accepted: Check,
  dismissed: XCircle,
  project: FolderPlus,
};

const ICON_CLASS: Record<ActivityFeedIcon, string> = {
  'tool-ok': 'text-emerald-500',
  'tool-error': 'text-red-500',
  accepted: 'text-emerald-500',
  dismissed: 'text-[var(--color-text-muted)]',
  project: 'text-[var(--color-accent)]',
};

interface ActivityFeedProps {
  entries: ActivityFeedEntry[];
  /** Explicit user action — clicking an entry switches the canvas to its targetTab. */
  onSelectTab: (tab: CanvasTabId) => void;
  title?: string;
  /** Live Mode's right column folds this to avoid crowding the chat below it. */
  collapsible?: boolean;
  emptyText?: string;
  maxHeightClassName?: string;
}

export default function ActivityFeed({
  entries,
  onSelectTab,
  title = 'Activity',
  collapsible = false,
  emptyText = 'No activity yet.',
  maxHeightClassName = 'max-h-48',
}: ActivityFeedProps) {
  const [collapsed, setCollapsed] = useState(false);
  const expanded = !collapsible || !collapsed;

  return (
    <div data-testid="activity-feed">
      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="font-hud text-xs text-[var(--color-text-secondary)] flex items-center gap-1.5">
          <Activity size={12} />
          {title}
        </h3>
        {collapsible && (
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {expanded &&
        (entries.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-[var(--color-text-muted)]">{emptyText}</p>
        ) : (
          <ul className={`flex flex-col gap-1 px-2 pb-2 overflow-y-auto ${maxHeightClassName}`}>
            {entries.map((entry) => {
              const Icon = ICONS[entry.icon];
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onSelectTab(entry.targetTab)}
                    aria-label={`${entry.label} — go to ${entry.targetTab}`}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--color-accent-subtle)] transition-colors"
                  >
                    <Icon size={12} className={`shrink-0 ${ICON_CLASS[entry.icon]}`} />
                    <span className="flex-1 min-w-0 text-xs text-[var(--color-text-primary)] truncate">
                      {entry.label}
                    </span>
                    <time
                      dateTime={entry.timestamp}
                      className="shrink-0 text-[0.625rem] font-data text-[var(--color-text-muted)]"
                    >
                      {formatRelativeTime(entry.timestamp)}
                    </time>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
