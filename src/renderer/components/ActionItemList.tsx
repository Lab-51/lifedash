// === FILE PURPOSE ===
// Displays a list of AI-extracted action items for a meeting.
// Each item shows its status, description, and contextual action buttons
// (approve, dismiss, convert to card). Supports loading state and generate button.
// When a meeting is linked to a project, shows batch "Push to Project" controls.
//
// === DEPENDENCIES ===
// react, lucide-react icons, ActionItem + ActionItemStatus types

import { memo, useState, useMemo } from 'react';
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
  Send,
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
  /** Linked project ID — enables batch push UI */
  meetingProjectId?: string;
  /** Linked project name — shown in batch push button */
  meetingProjectName?: string;
  /** Called with selected action items for batch conversion */
  onBatchConvert?: (items: Array<{ id: string; text: string }>) => void;
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

const ActionItemRow = memo(function ActionItemRow({
  item,
  onUpdateStatus,
  onConvert,
  showCheckbox,
  checked,
  onCheckChange,
}: {
  item: ActionItem;
  onUpdateStatus: (id: string, status: ActionItemStatus) => void;
  onConvert: (actionItem: ActionItem) => void;
  showCheckbox?: boolean;
  checked?: boolean;
  onCheckChange?: (id: string, checked: boolean) => void;
}) {
  const { Icon, className: iconClass } = statusIcon(item.status);
  const isDismissed = item.status === 'dismissed';

  return (
    <div className="bg-surface-800/50 border border-surface-700 rounded-lg p-3 flex items-start gap-3">
      {/* Batch selection checkbox */}
      {showCheckbox && (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckChange?.(item.id, e.target.checked)}
          className="mt-0.5 shrink-0 accent-primary-500 w-3.5 h-3.5 cursor-pointer"
        />
      )}

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
});

export default function ActionItemList({
  actionItems,
  isCompleted,
  generatingActions,
  onGenerate,
  onUpdateStatus,
  onConvert,
  meetingProjectId,
  meetingProjectName,
  onBatchConvert,
}: ActionItemListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Items eligible for batch push (pending or approved — not dismissed or converted)
  const pushableItems = useMemo(
    () => actionItems.filter((a) => a.status === 'pending' || a.status === 'approved'),
    [actionItems],
  );

  const showBatchPush = !!meetingProjectId && pushableItems.length > 0 && !!onBatchConvert;

  const handleCheckChange = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === pushableItems.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all pushable
      setSelectedIds(new Set(pushableItems.map((a) => a.id)));
    }
  };

  const handleBatchPush = () => {
    if (!onBatchConvert) return;
    const items = pushableItems
      .filter((a) => selectedIds.has(a.id))
      .map((a) => ({ id: a.id, text: a.description }));
    if (items.length > 0) {
      onBatchConvert(items);
    }
  };

  // Count of actually selected items (intersect with current pushable items)
  const selectedCount = pushableItems.filter((a) => selectedIds.has(a.id)).length;
  const allSelected = pushableItems.length > 0 && selectedCount === pushableItems.length;

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
              showCheckbox={showBatchPush && (item.status === 'pending' || item.status === 'approved')}
              checked={selectedIds.has(item.id)}
              onCheckChange={handleCheckChange}
            />
          ))}
        </div>
      )}

      {/* Batch push section */}
      {showBatchPush && !generatingActions && (
        <div className="mt-3 pt-3 border-t border-surface-700">
          <div className="flex items-center justify-between">
            <button
              onClick={handleSelectAll}
              className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <button
              onClick={handleBatchPush}
              disabled={selectedCount === 0}
              className="flex items-center gap-1.5 text-sm bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <Send size={14} />
              Push {selectedCount} item{selectedCount !== 1 ? 's' : ''} to {meetingProjectName || 'Project'}
            </button>
          </div>
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
