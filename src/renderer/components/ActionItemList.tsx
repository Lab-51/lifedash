// === FILE PURPOSE ===
// Displays a list of AI-extracted action items for a meeting.
// Each item shows its status, description, and contextual action buttons
// (approve, dismiss, convert to card). Supports loading state and generate button.
//
// === DEPENDENCIES ===
// react, lucide-react icons, ActionItem + ActionItemStatus types

import {
  Check,
  X,
  Loader2,
  ArrowRight,
  ListChecks,
  CheckCircle2,
  XCircle,
  ArrowRightCircle,
  Circle,
} from 'lucide-react';
import type { ActionItem, ActionItemStatus } from '../../shared/types';

interface ActionItemListProps {
  meetingId: string;
  actionItems: ActionItem[];
  isCompleted: boolean;
  generatingActions: boolean;
  onGenerate: () => void;
  onUpdateStatus: (id: string, status: ActionItemStatus) => void;
  onConvert: (actionItem: ActionItem) => void;
}

/** Status icon mapping — returns the icon component and its Tailwind color class. */
function statusIcon(status: ActionItemStatus) {
  switch (status) {
    case 'pending':
      return { Icon: Circle, className: 'text-surface-500' };
    case 'approved':
      return { Icon: CheckCircle2, className: 'text-emerald-400' };
    case 'dismissed':
      return { Icon: XCircle, className: 'text-surface-500 opacity-50' };
    case 'converted':
      return { Icon: ArrowRightCircle, className: 'text-primary-400' };
  }
}

function ActionItemRow({
  item,
  onUpdateStatus,
  onConvert,
}: {
  item: ActionItem;
  onUpdateStatus: (id: string, status: ActionItemStatus) => void;
  onConvert: (actionItem: ActionItem) => void;
}) {
  const { Icon, className: iconClass } = statusIcon(item.status);
  const isDismissed = item.status === 'dismissed';

  return (
    <div className="bg-surface-800/50 border border-surface-700 rounded-lg p-3 flex items-start gap-3">
      {/* Status indicator */}
      <Icon size={18} className={`shrink-0 mt-0.5 ${iconClass}`} />

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm ${isDismissed ? 'text-surface-500 line-through' : 'text-surface-200'}`}
        >
          {item.description}
        </p>
        {item.status === 'converted' && item.cardId && (
          <p className="text-xs text-primary-400 mt-0.5">Converted to card</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {item.status === 'pending' && (
          <>
            <button
              onClick={() => onUpdateStatus(item.id, 'approved')}
              className="p-1 rounded hover:bg-surface-700 transition-colors text-emerald-400 hover:text-emerald-300"
              title="Approve"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => onUpdateStatus(item.id, 'dismissed')}
              className="p-1 rounded hover:bg-surface-700 transition-colors text-surface-500 hover:text-red-400"
              title="Dismiss"
            >
              <X size={14} />
            </button>
            <button
              onClick={() => onConvert(item)}
              className="p-1 rounded hover:bg-surface-700 transition-colors text-primary-400 hover:text-primary-300"
              title="Convert to card"
            >
              <ArrowRight size={14} />
            </button>
          </>
        )}
        {item.status === 'approved' && (
          <button
            onClick={() => onConvert(item)}
            className="p-1 rounded hover:bg-surface-700 transition-colors text-primary-400 hover:text-primary-300"
            title="Convert to card"
          >
            <ArrowRight size={14} />
          </button>
        )}
        {/* dismissed and converted are final states — no buttons */}
      </div>
    </div>
  );
}

export default function ActionItemList({
  actionItems,
  isCompleted,
  generatingActions,
  onGenerate,
  onUpdateStatus,
  onConvert,
}: ActionItemListProps) {
  return (
    <div>
      {/* Header with optional count badge */}
      <div className="flex items-center mb-2">
        <h3 className="text-sm font-medium text-surface-300">Action Items</h3>
        {actionItems.length > 0 && (
          <span className="bg-surface-700 text-surface-300 text-xs px-1.5 py-0.5 rounded-full ml-2">
            {actionItems.length}
          </span>
        )}
      </div>

      {/* Loading state */}
      {generatingActions && (
        <div className="flex items-center gap-2 text-amber-400 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Extracting action items...
        </div>
      )}

      {/* Action items list */}
      {actionItems.length > 0 && !generatingActions && (
        <div className="space-y-2">
          {actionItems.map((item) => (
            <ActionItemRow
              key={item.id}
              item={item}
              onUpdateStatus={onUpdateStatus}
              onConvert={onConvert}
            />
          ))}
        </div>
      )}

      {/* Generate button for completed meetings with no items */}
      {actionItems.length === 0 && !generatingActions && isCompleted && (
        <button
          onClick={onGenerate}
          className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1.5"
        >
          <ListChecks size={14} />
          Generate Action Items
        </button>
      )}

      {/* Info text for non-completed meetings */}
      {actionItems.length === 0 && !generatingActions && !isCompleted && (
        <p className="text-sm text-surface-500">
          Complete the recording to extract action items
        </p>
      )}
    </div>
  );
}
