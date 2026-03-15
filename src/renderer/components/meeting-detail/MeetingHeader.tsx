// Meeting header — title (editable), close/export buttons, metadata row,
// template info, and project linking dropdown.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Clock, Download, ArrowRight, FolderOpen } from 'lucide-react';
import HudSelect from '../HudSelect';
import { MEETING_TEMPLATES, TRANSCRIPTION_LANGUAGES } from '../../../shared/types';
import type { MeetingWithTranscript } from '../../../shared/types';
import type { Project } from '../../../shared/types';
import { STATUS_STYLES, formatDuration, formatDate, formatTime } from './utils';

interface MeetingHeaderProps {
  meeting: MeetingWithTranscript;
  projects: Project[];
  onUpdateMeeting: (id: string, updates: { title?: string; projectId?: string | null }) => Promise<void>;
  onExport: () => void;
  onClose: () => void;
}

export default function MeetingHeader({ meeting, projects, onUpdateMeeting, onExport, onClose }: MeetingHeaderProps) {
  const navigate = useNavigate();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  const status = STATUS_STYLES[meeting.status] || STATUS_STYLES.completed;

  const startEditingTitle = () => {
    setEditTitle(meeting.title);
    setIsEditingTitle(true);
  };

  const saveTitleEdit = async () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== meeting.title) {
      await onUpdateMeeting(meeting.id, { title: trimmed });
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveTitleEdit();
    else if (e.key === 'Escape') {
      setEditTitle(meeting.title);
      setIsEditingTitle(false);
    }
  };

  return (
    <>
      {/* Header: Title + Close */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex-1 min-w-0">
          {isEditingTitle ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              onBlur={saveTitleEdit}
              autoFocus
              className="bg-white dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-2xl font-bold text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-dim)] focus:border-[var(--color-accent-dim)] w-full"
            />
          ) : (
            <h2
              className="font-hud text-xl text-[var(--color-accent)] text-glow cursor-text hover:opacity-80 transition-opacity"
              onClick={startEditingTitle}
            >
              {meeting.title}
            </h2>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 bg-surface-100/50 dark:bg-surface-800/50 p-1 rounded-lg">
          <button
            onClick={onExport}
            className="text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 p-1.5 rounded-md hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
            title="Export as Markdown"
          >
            <Download size={16} />
          </button>
          <div className="w-px h-4 bg-surface-200 dark:bg-surface-700 mx-0.5" />
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 p-1.5 rounded-md hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-3 mb-8 text-sm bg-surface-100/50 dark:bg-surface-950/50 p-3 rounded-xl border border-[var(--color-border)]">
        <span
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${status.className}`}
        >
          {status.label}
        </span>
        <div className="w-1 h-1 rounded-full bg-surface-300 dark:bg-surface-700" />
        <span className="flex items-center gap-1.5 font-data text-[var(--color-text-secondary)]">
          <Clock size={14} className="text-[var(--color-accent-dim)]" />
          {formatDuration(meeting.startedAt, meeting.endedAt)}
        </span>
        <span className="node-point-sm" />
        <span className="font-data text-[var(--color-text-secondary)]">
          {formatDate(meeting.startedAt)} at {formatTime(meeting.startedAt)}
        </span>
        {meeting.transcriptionLanguage && (
          <span className="text-surface-400">
            {TRANSCRIPTION_LANGUAGES.find((l) => l.code === meeting.transcriptionLanguage)?.label ??
              meeting.transcriptionLanguage}
          </span>
        )}
      </div>

      {/* Template info */}
      {meeting.template &&
        meeting.template !== 'none' &&
        (() => {
          const tmpl = MEETING_TEMPLATES.find((t) => t.type === meeting.template);
          return tmpl ? (
            <div className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300 mb-5">
              <span className="px-1.5 py-0.5 rounded bg-surface-700 text-xs font-medium">{tmpl.name}</span>
              {tmpl.agenda.length > 0 && (
                <div className="text-xs text-surface-400">
                  {tmpl.agenda.map((item, i) => (
                    <div key={i}>
                      {'\u2022'} {item}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null;
        })()}

      {/* Project linking */}
      <div className="flex items-center gap-3 mb-8">
        <span className="font-hud text-[0.625rem] text-[var(--color-accent-dim)] tracking-widest shrink-0">
          Linked Project
        </span>
        <div className="flex-1 min-w-[180px] max-w-[240px]">
          <HudSelect
            value={meeting.projectId || ''}
            onChange={(v) => onUpdateMeeting(meeting.id, { projectId: v || null })}
            icon={FolderOpen}
            placeholder="No project"
            options={[{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        {meeting.projectId && (
          <button
            onClick={() => {
              navigate(`/projects/${meeting.projectId}`);
              onClose();
            }}
            className="flex items-center gap-1.5 text-[0.625rem] font-hud tracking-wider border border-[var(--color-border)] hover:border-[var(--color-accent-dim)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] px-2.5 py-1.5 rounded-md transition-colors shrink-0"
            title="Go to project board"
          >
            Open Board
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    </>
  );
}
