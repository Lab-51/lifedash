// === FILE PURPOSE ===
// 3-step wizard modal for converting action item(s) into board card(s).
// Step 1: Select project (skipped if preselectedProjectId provided),
// Step 2: Select board (auto-skipped if only 1),
// Step 3: Select column. Calls onConvert with actionItemId + columnId.
// Supports batch conversion via actionItems prop.
//
// === DEPENDENCIES ===
// react, lucide-react (X, Loader2, ChevronLeft), shared types,
// window.electronAPI (getProjects, getBoards, getColumns)

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, ChevronLeft } from 'lucide-react';
import type { Project, Board, Column, ActionItem } from '../../shared/types';

interface ConvertActionModalProps {
  /** Single action item for one-off conversion */
  actionItem?: ActionItem;
  /** Multiple action items for batch conversion */
  actionItems?: Array<{ id: string; text: string }>;
  /** Pre-select a project, skipping step 1 */
  preselectedProjectId?: string;
  /** Pre-selected project name (shown in header) */
  preselectedProjectName?: string;
  onConvert: (actionItemId: string, columnId: string) => Promise<string>;
  onClose: () => void;
}

export default function ConvertActionModal({
  actionItem,
  actionItems,
  preselectedProjectId,
  preselectedProjectName,
  onConvert,
  onClose,
}: ConvertActionModalProps) {
  // Determine initial step: skip step 1 when project is preselected
  const [step, setStep] = useState<1 | 2 | 3>(preselectedProjectId ? 2 : 1);
  const [projects, setProjects] = useState<Project[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    preselectedProjectId ?? null,
  );
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState(false);

  // Batch conversion progress state
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);

  // Whether the user explicitly changed from the preselected project
  const [projectOverridden, setProjectOverridden] = useState(false);

  const isBatch = actionItems && actionItems.length > 0;

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !converting) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, converting]);

  // Load projects on mount (only needed if step 1 may be shown)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electronAPI.getProjects().then((result) => {
      if (!cancelled) {
        setProjects(result.filter((p) => !p.archived));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Load boards when project selected
  useEffect(() => {
    if (!selectedProjectId) return;
    let cancelled = false;
    setLoading(true);
    window.electronAPI.getBoards(selectedProjectId).then((result) => {
      if (cancelled) return;
      setBoards(result);
      setLoading(false);
      // Auto-select and skip if exactly one board
      if (result.length === 1) {
        setSelectedBoardId(result[0].id);
        setStep(3);
      }
    });
    return () => { cancelled = true; };
  }, [selectedProjectId]);

  // Load columns when board selected
  useEffect(() => {
    if (!selectedBoardId) return;
    let cancelled = false;
    setLoading(true);
    window.electronAPI.getColumns(selectedBoardId).then((result) => {
      if (cancelled) return;
      setColumns(result);
      setLoading(false);
      // Auto-select first column if only one
      if (result.length === 1) {
        setSelectedColumnId(result[0].id);
      }
    });
    return () => { cancelled = true; };
  }, [selectedBoardId]);

  // Single-item conversion
  const handleConvertSingle = useCallback(async () => {
    if (!selectedColumnId || !actionItem) return;
    setConverting(true);
    try {
      await onConvert(actionItem.id, selectedColumnId);
      onClose();
    } catch {
      // Error handled by meetingStore
    } finally {
      setConverting(false);
    }
  }, [selectedColumnId, actionItem, onConvert, onClose]);

  // Batch conversion
  const handleConvertBatch = useCallback(async () => {
    if (!selectedColumnId || !actionItems || actionItems.length === 0) return;
    setConverting(true);
    setBatchTotal(actionItems.length);
    setBatchProgress(0);
    try {
      for (let i = 0; i < actionItems.length; i++) {
        setBatchProgress(i + 1);
        await onConvert(actionItems[i].id, selectedColumnId);
      }
      onClose();
    } catch {
      // Error handled by meetingStore — stop batch on first failure
    } finally {
      setConverting(false);
    }
  }, [selectedColumnId, actionItems, onConvert, onClose]);

  const handleConvert = isBatch ? handleConvertBatch : handleConvertSingle;

  const handleNext = () => {
    if (step === 1 && selectedProjectId) {
      setStep(2);
    } else if (step === 2 && selectedBoardId) {
      setStep(3);
    } else if (step === 3) {
      handleConvert();
    }
  };

  const handleBack = () => {
    if (step === 3) {
      // If board was auto-selected (only 1 board), go back to step 1
      if (boards.length === 1) {
        setSelectedProjectId(null);
        setSelectedBoardId(null);
        setSelectedColumnId(null);
        setBoards([]);
        setColumns([]);
        setProjectOverridden(true);
        setStep(1);
      } else {
        setSelectedBoardId(null);
        setSelectedColumnId(null);
        setColumns([]);
        setStep(2);
      }
    } else if (step === 2) {
      setSelectedProjectId(null);
      setSelectedBoardId(null);
      setBoards([]);
      setProjectOverridden(true);
      setStep(1);
    }
  };

  const handleChangeProject = () => {
    setSelectedProjectId(null);
    setSelectedBoardId(null);
    setSelectedColumnId(null);
    setBoards([]);
    setColumns([]);
    setProjectOverridden(true);
    setStep(1);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !converting) onClose();
  };

  const canAdvance =
    (step === 1 && selectedProjectId) ||
    (step === 2 && selectedBoardId) ||
    (step === 3 && selectedColumnId);

  // Step indicator dots
  const stepDots = [1, 2, 3].map((s) => {
    if (s < step) return 'bg-primary-500/50';
    if (s === step) return 'bg-primary-500';
    return 'bg-surface-700';
  });

  // Determine the project name for the header when preselected
  const resolvedProjectName =
    preselectedProjectName ||
    (preselectedProjectId
      ? projects.find((p) => p.id === preselectedProjectId)?.name
      : null);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
    >
      <div className="bg-surface-900 rounded-xl border border-surface-700 w-full max-w-md mx-4 p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-surface-100">
            {isBatch ? 'Convert to Cards' : 'Convert to Card'}
          </h3>
          <button
            onClick={onClose}
            disabled={converting}
            className="text-surface-500 hover:text-surface-300 p-1 transition-colors disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Description / batch summary */}
        {isBatch ? (
          <p className="text-sm text-surface-400 mb-2">
            Converting {actionItems.length} action item{actionItems.length !== 1 ? 's' : ''}
          </p>
        ) : actionItem ? (
          <p className="text-sm text-surface-400 line-clamp-2 mb-2">
            {actionItem.description}
          </p>
        ) : null}

        {/* Pre-selected project indicator */}
        {preselectedProjectId && !projectOverridden && resolvedProjectName && step !== 1 && (
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span className="text-surface-400">Project:</span>
            <span className="text-surface-200 font-medium">{resolvedProjectName}</span>
            <button
              onClick={handleChangeProject}
              className="text-primary-400 hover:text-primary-300 text-xs underline transition-colors"
            >
              Change project
            </button>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 my-4">
          {stepDots.map((cls, i) => (
            <div key={i} className={`w-2 h-2 rounded-full ${cls}`} />
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[120px]">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-surface-400" />
            </div>
          )}

          {/* Step 1: Select Project */}
          {step === 1 && !loading && (
            <div>
              <p className="text-sm text-surface-300 mb-2">Choose a project</p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProjectId(p.id)}
                    className={`rounded-lg p-2.5 cursor-pointer border transition ${
                      selectedProjectId === p.id
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-surface-700 hover:border-surface-600'
                    }`}
                  >
                    <span className="flex items-center text-sm text-surface-200">
                      <span
                        className="w-3 h-3 rounded-full inline-block mr-2 shrink-0"
                        style={{ backgroundColor: p.color || '#6b7280' }}
                      />
                      {p.name}
                    </span>
                  </div>
                ))}
                {projects.length === 0 && (
                  <p className="text-sm text-surface-500 text-center py-4">No projects found</p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Select Board */}
          {step === 2 && !loading && (
            <div>
              <p className="text-sm text-surface-300 mb-2">Choose a board</p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {boards.map((b) => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBoardId(b.id)}
                    className={`rounded-lg p-2.5 cursor-pointer border transition ${
                      selectedBoardId === b.id
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-surface-700 hover:border-surface-600'
                    }`}
                  >
                    <span className="text-sm text-surface-200">{b.name}</span>
                  </div>
                ))}
                {boards.length === 0 && (
                  <p className="text-sm text-surface-500 text-center py-4">No boards found</p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Select Column */}
          {step === 3 && !loading && (
            <div>
              <p className="text-sm text-surface-300 mb-2">Choose a column</p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {columns.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedColumnId(c.id)}
                    className={`rounded-lg p-2.5 cursor-pointer border transition ${
                      selectedColumnId === c.id
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-surface-700 hover:border-surface-600'
                    }`}
                  >
                    <span className="text-sm text-surface-200">{c.name}</span>
                  </div>
                ))}
                {columns.length === 0 && (
                  <p className="text-sm text-surface-500 text-center py-4">No columns found</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Batch progress indicator */}
        {converting && isBatch && batchTotal > 0 && (
          <div className="text-sm text-surface-400 text-center mt-2">
            Converting {batchProgress} of {batchTotal}...
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-surface-700">
          <div>
            {step > 1 && !converting && (
              <button
                onClick={handleBack}
                className="text-sm text-surface-400 hover:text-surface-200 flex items-center gap-1 transition-colors"
              >
                <ChevronLeft size={14} />
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={converting}
              className="text-sm text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            {step < 3 ? (
              <button
                onClick={handleNext}
                disabled={!canAdvance}
                className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleConvert}
                disabled={!selectedColumnId || converting}
                className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                {converting && <Loader2 size={14} className="animate-spin" />}
                {isBatch
                  ? `Convert ${actionItems.length} item${actionItems.length !== 1 ? 's' : ''}`
                  : 'Convert'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
