// === FILE PURPOSE ===
// Displays a list of AI-extracted action items for a meeting.
// Each item shows its status, description, and contextual action buttons
// (approve, dismiss, convert to card). Supports loading state and generate button.
// When a meeting is linked to a project, shows unified push-to-column controls
// with inline column picker — no wizard needed.
//
// === DEPENDENCIES ===
// react, lucide-react icons, ActionItem + ActionItemStatus + Column types

import { memo, useState, useMemo, useEffect, useRef } from 'react';
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
import type { ActionItem, ActionItemStatus, Column } from '../../shared/types';

interface ActionItemListProps {
  meetingId: string;
  actionItems: ActionItem[];
  isCompleted: boolean;
  generatingActions: boolean;
  onGenerate: () => void;
  onUpdateStatus: (id: string, status: ActionItemStatus) => void;
  /** Opens the ConvertActionModal wizard (only used when no linked project) */
  onConvert: (actionItem: ActionItem) => void;
  /** Linked project ID — enables inline push UI */
  meetingProjectId?: string;
  /** Linked project name — shown in push button */
  meetingProjectName?: string;
  /** Columns available for inline push (loaded by parent) */
  columns?: Column[];
  /** Currently selected column ID for inline push */
  selectedColumnId?: string;
  /** Called when user changes the column dropdown */
  onColumnChange?: (columnId: string) => void;
  /** Called with selected items + column ID for inline push */
  onPushToColumn?: (items: Array<{ id: string; text: string }>, columnId: string) => void;
  /** Whether a push is currently in progress */
  pushing?: boolean;
}

/** Status icon mapping — returns the icon component and its Tailwind color class. */
function statusIcon(status: ActionItemStatus) {
  switch (status) {
    case 'pending':
      return { Icon: Circle, className: 'text-surface-500' };
    case 'approved':
      return { Icon: CheckCircle2, className: 'text-[var(--color-accent)]' };
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
    <div className="hud-panel rounded-lg p-3 flex items-start gap-3">
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
          className={`text-sm ${isDismissed ? 'text-surface-500 line-through' : 'text-surface-800 dark:text-surface-200'}`}
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
              className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-emerald-400 hover:text-emerald-300"
              title="Approve"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => onUpdateStatus(item.id, 'dismissed')}
              className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-surface-500 hover:text-red-400"
              title="Dismiss"
            >
              <X size={14} />
            </button>
            {/* Per-item convert arrow — only when no linked project (no inline push) */}
            {!showCheckbox && (
              <button
                onClick={() => onConvert(item)}
                className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-primary-400 hover:text-primary-300"
                title="Convert to card"
              >
                <ArrowRight size={14} />
              </button>
            )}
          </>
        )}
        {item.status === 'approved' && !showCheckbox && (
          <button
            onClick={() => onConvert(item)}
            className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-primary-400 hover:text-primary-300"
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
  columns,
  selectedColumnId,
  onColumnChange,
  onPushToColumn,
  pushing,
}: ActionItemListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Track which items we've already auto-checked so we don't re-check after user unchecks
  const autoCheckedRef = useRef<Set<string>>(new Set());

  // Items eligible for push (pending or approved — not dismissed or converted)
  const pushableItems = useMemo(
    () => actionItems.filter((a) => a.status === 'pending' || a.status === 'approved'),
    [actionItems],
  );

  const showInlinePush = !!meetingProjectId && pushableItems.length > 0 && !!onPushToColumn;

  // Auto-check approved items when they become approved
  useEffect(() => {
    const newApproved = actionItems.filter(
      (a) => a.status === 'approved' && !autoCheckedRef.current.has(a.id),
    );
    if (newApproved.length === 0) return;

    // Mark these as auto-checked so we don't re-add them if user unchecks
    for (const item of newApproved) {
      autoCheckedRef.current.add(item.id);
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of newApproved) {
        next.add(item.id);
      }
      return next;
    });
  }, [actionItems]);

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
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pushableItems.map((a) => a.id)));
    }
  };

  const handlePush = () => {
    if (!onPushToColumn || !selectedColumnId) return;
    const items = pushableItems
      .filter((a) => selectedIds.has(a.id))
      .map((a) => ({ id: a.id, text: a.description }));
    if (items.length > 0) {
      onPushToColumn(items, selectedColumnId);
    }
  };

  // Count of actually selected items (intersect with current pushable items)
  const selectedCount = pushableItems.filter((a) => selectedIds.has(a.id)).length;
  const allSelected = pushableItems.length > 0 && selectedCount === pushableItems.length;

  // Resolve selected column name for the button label
  const selectedColumnName = columns?.find((c) => c.id === selectedColumnId)?.name;

  return (
    <div>
      {/* Header with optional count badge */}
      <div className="flex items-center mb-2">
        <h3 className="font-hud text-xs text-[var(--color-text-secondary)]">Action Items</h3>
        {actionItems.length > 0 && (
          <span className="bg-surface-700 text-surface-700 dark:text-surface-300 text-xs px-1.5 py-0.5 rounded-full ml-2">
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
              showCheckbox={showInlinePush && (item.status === 'pending' || item.status === 'approved')}
              checked={selectedIds.has(item.id)}
              onCheckChange={handleCheckChange}
            />
          ))}
        </div>
      )}

      {/* Unified push section — inline column picker + push button */}
      {showInlinePush && !generatingActions && (
        <div className="mt-3 pt-3 border-t border-surface-200 dark:border-surface-700">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleSelectAll}
              className="text-xs text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors shrink-0"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>

            <div className="flex items-center gap-2">
              {/* Inline column picker */}
              {columns && columns.length > 0 && (
                <select
                  value={selectedColumnId ?? ''}
                  onChange={(e) => onColumnChange?.(e.target.value)}
                  className="bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] px-2 py-1.5 focus:outline-none focus:border-[var(--color-accent-dim)] transition-colors"
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Push button */}
              <button
                onClick={handlePush}
                disabled={selectedCount === 0 || !selectedColumnId || pushing}
                className="flex items-center gap-1.5 text-sm bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                {pushing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Push {selectedCount} item{selectedCount !== 1 ? 's' : ''}
                {selectedColumnName ? ` to ${selectedColumnName}` : ''}
              </button>
            </div>
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
