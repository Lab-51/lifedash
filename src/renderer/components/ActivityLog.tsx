// === FILE PURPOSE ===
// Read-only activity log for card detail view.
// Displays a chronological timeline of all card events (create, update, move, etc.).

// === DEPENDENCIES ===
// react, lucide-react, boardStore (Zustand), shared types (CardActivityAction)

import {
  PlusCircle,
  Pencil,
  ArrowRight,
  MessageSquare,
  Archive,
  RotateCcw,
  Link,
  Unlink,
  Activity,
} from 'lucide-react';
import type { CardActivityAction } from '../../shared/types';
import { useBoardStore } from '../stores/boardStore';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Icon and color per activity action type */
const ACTION_CONFIG: Record<CardActivityAction, { icon: React.ElementType; colorClass: string }> = {
  created:              { icon: PlusCircle,    colorClass: 'text-emerald-400' },
  updated:              { icon: Pencil,        colorClass: 'text-blue-400' },
  moved:                { icon: ArrowRight,    colorClass: 'text-amber-400' },
  commented:            { icon: MessageSquare, colorClass: 'text-purple-400' },
  archived:             { icon: Archive,       colorClass: 'text-red-400' },
  restored:             { icon: RotateCcw,     colorClass: 'text-emerald-400' },
  relationship_added:   { icon: Link,          colorClass: 'text-blue-400' },
  relationship_removed: { icon: Unlink,        colorClass: 'text-red-400' },
};

/** Parse activity details JSON safely */
function parseDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Build human-readable description from action + details */
function describeActivity(action: CardActivityAction, details: string | null): string {
  const parsed = parseDetails(details);

  switch (action) {
    case 'created':
      return 'Card created';
    case 'updated': {
      if (parsed && Array.isArray(parsed.fields) && parsed.fields.length > 0) {
        return `Updated ${(parsed.fields as string[]).join(', ')}`;
      }
      return 'Card updated';
    }
    case 'moved':
      return 'Moved card';
    case 'commented':
      return 'Comment added';
    case 'archived':
      return 'Card archived';
    case 'restored':
      return 'Card restored';
    case 'relationship_added': {
      if (parsed && parsed.type) {
        return `Linked to card (${String(parsed.type)})`;
      }
      return 'Linked to card';
    }
    case 'relationship_removed':
      return 'Unlinked from card';
    default:
      return String(action);
  }
}

interface ActivityLogProps {
  cardId: string;
}

function ActivityLog({ cardId: _cardId }: ActivityLogProps) {
  const { selectedCardActivities, loadingCardDetails } = useBoardStore();

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-1.5 mb-3">
        <Activity size={14} className="text-surface-400" />
        <span className="text-sm text-surface-400">Activity</span>
      </div>

      {/* Loading state */}
      {loadingCardDetails && selectedCardActivities.length === 0 && (
        <p className="text-sm text-surface-500 italic">Loading activity...</p>
      )}

      {/* Empty state */}
      {!loadingCardDetails && selectedCardActivities.length === 0 && (
        <p className="text-sm text-surface-500 italic">No activity yet</p>
      )}

      {/* Activity timeline */}
      {selectedCardActivities.length > 0 && (
        <div className="relative pl-5">
          {/* Timeline connector line */}
          <div className="absolute left-[6px] top-1 bottom-1 border-l-2 border-surface-700" />

          <div className="space-y-3">
            {selectedCardActivities.map(activity => {
              const config = ACTION_CONFIG[activity.action] ?? {
                icon: Activity,
                colorClass: 'text-surface-400',
              };
              const Icon = config.icon;

              return (
                <div key={activity.id} className="relative flex items-start gap-2.5">
                  {/* Icon dot (positioned over timeline line) */}
                  <div
                    className={`absolute -left-5 top-0.5 flex items-center justify-center w-3 h-3 rounded-full bg-surface-900 ${config.colorClass}`}
                  >
                    <Icon size={10} />
                  </div>

                  {/* Description + timestamp */}
                  <span className="text-sm text-surface-300">
                    {describeActivity(activity.action, activity.details)}
                  </span>
                  <span className="text-xs text-surface-500 ml-auto whitespace-nowrap">
                    {timeAgo(activity.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ActivityLog;
