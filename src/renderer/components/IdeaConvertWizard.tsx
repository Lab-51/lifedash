// === FILE PURPOSE ===
// Extracted sub-component of IdeaDetailModal. Renders the multi-step
// convert-to-card wizard: project selection (step 1), board selection (step 2,
// auto-skipped for single board), column selection (step 3). Manages its own
// internal state and calls ideaStore.convertToCard on completion.
//
// === DEPENDENCIES ===
// react, lucide-react (Loader2, ChevronLeft), ideaStore, shared types (Project, Board, Column)

import { useState, useEffect } from 'react';
import { Loader2, ChevronLeft } from 'lucide-react';
import { useIdeaStore } from '../stores/ideaStore';
import type { Project, Board, Column } from '../../shared/types';

// === PROPS ===

interface IdeaConvertWizardProps {
  ideaId: string;
  onComplete: () => void;
  onCancel: () => void;
}

export default function IdeaConvertWizard({ ideaId, onComplete, onCancel }: IdeaConvertWizardProps) {
  const convertToCard = useIdeaStore((s) => s.convertToCard);

  // Wizard internal state
  const [convertStep, setConvertStep] = useState<1 | 2 | 3>(1);
  const [projects, setProjects] = useState<Project[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  // Load projects on mount
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getProjects().then((result) => {
      if (!cancelled) setProjects(result.filter((p) => !p.archived));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load boards when project selected
  useEffect(() => {
    if (!selectedProjectId) return;
    let cancelled = false;
    window.electronAPI.getBoards(selectedProjectId).then((result) => {
      if (!cancelled) {
        setBoards(result);
        if (result.length === 1) {
          setSelectedBoardId(result[0].id);
          setConvertStep(3);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  // Load columns when board selected
  useEffect(() => {
    if (!selectedBoardId) return;
    let cancelled = false;
    window.electronAPI.getColumns(selectedBoardId).then((result) => {
      if (!cancelled) {
        setColumns(result);
        if (result.length === 1) setSelectedColumnId(result[0].id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedBoardId]);

  // === HANDLERS ===

  const handleConvertToCard = async () => {
    if (!selectedColumnId || converting) return;
    setConverting(true);
    try {
      await convertToCard(ideaId, selectedColumnId);
      onComplete();
    } finally {
      setConverting(false);
    }
  };

  const handleWizardNext = () => {
    if (convertStep === 1 && selectedProjectId) {
      setConvertStep(2);
    } else if (convertStep === 2 && selectedBoardId) {
      setConvertStep(3);
    } else if (convertStep === 3) {
      handleConvertToCard();
    }
  };

  const handleWizardBack = () => {
    if (convertStep === 3) {
      if (boards.length === 1) {
        setSelectedProjectId(null);
        setSelectedBoardId(null);
        setSelectedColumnId(null);
        setBoards([]);
        setColumns([]);
        setConvertStep(1);
      } else {
        setSelectedBoardId(null);
        setSelectedColumnId(null);
        setColumns([]);
        setConvertStep(2);
      }
    } else if (convertStep === 2) {
      setSelectedProjectId(null);
      setSelectedBoardId(null);
      setBoards([]);
      setConvertStep(1);
    }
  };

  const canAdvanceWizard =
    (convertStep === 1 && selectedProjectId) ||
    (convertStep === 2 && selectedBoardId) ||
    (convertStep === 3 && selectedColumnId);

  // Step indicator dots
  const stepDots = [1, 2, 3].map((s) => {
    if (s < convertStep) return 'bg-primary-500/50';
    if (s === convertStep) return 'bg-primary-500';
    return 'bg-surface-700';
  });

  return (
    <div>
      {/* Step indicator dots */}
      <div className="flex items-center justify-center gap-2 my-3">
        {stepDots.map((cls, i) => (
          <div key={i} className={`w-2 h-2 rounded-full ${cls}`} />
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[100px]">
        {/* Step 1: Select Project */}
        {convertStep === 1 && (
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
              {projects.length === 0 && <p className="text-sm text-surface-500 text-center py-4">No projects found</p>}
            </div>
          </div>
        )}

        {/* Step 2: Select Board */}
        {convertStep === 2 && (
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
              {boards.length === 0 && <p className="text-sm text-surface-500 text-center py-4">No boards found</p>}
            </div>
          </div>
        )}

        {/* Step 3: Select Column */}
        {convertStep === 3 && (
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
              {columns.length === 0 && <p className="text-sm text-surface-500 text-center py-4">No columns found</p>}
            </div>
          </div>
        )}
      </div>

      {/* Wizard footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-700">
        <div>
          {convertStep > 1 && (
            <button
              onClick={handleWizardBack}
              className="text-sm text-surface-400 hover:text-surface-200 flex items-center gap-1 transition-colors"
            >
              <ChevronLeft size={14} />
              Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-sm text-surface-400 hover:text-surface-200 transition-colors">
            Cancel
          </button>
          {convertStep < 3 ? (
            <button
              onClick={handleWizardNext}
              disabled={!canAdvanceWizard}
              className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleConvertToCard}
              disabled={!selectedColumnId || converting}
              className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {converting && <Loader2 size={14} className="animate-spin" />}
              Convert
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
