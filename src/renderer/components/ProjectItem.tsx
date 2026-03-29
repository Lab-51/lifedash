// === FILE PURPOSE ===
// Draggable project items for grid and list views on the Projects page.
// Each item is a drag source + drop target using @atlaskit/pragmatic-drag-and-drop.

import { useRef, useState, useEffect, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, LayoutList, DollarSign, GripVertical } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Project } from '../../shared/types';

// Shared props passed from ProjectsModern
export interface ProjectItemProps {
  project: Project;
  index: number;
  projects: Project[];
  cardCount: number;
  editingProjectId: string | null;
  editName: string;
  setEditName: (name: string) => void;
  editingDescId: string | null;
  editDesc: string;
  setEditDesc: (desc: string) => void;
  onSaveRename: (id: string) => void;
  onSaveDescription: (id: string) => void;
  setEditingProjectId: (id: string | null) => void;
  setEditingDescId: (id: string | null) => void;
  onPinToggle: (id: string, pinned: boolean) => void;
  renderMoreButton: (project: Project) => React.ReactNode;
  renderDropdown: (project: Project) => React.ReactNode;
  formatDate: (dateStr: string) => string;
}

function DropIndicatorLine({ edge, orientation }: { edge: Edge | null; orientation: 'horizontal' | 'vertical' }) {
  if (!edge) return null;
  if (orientation === 'horizontal') {
    // For grid view: left/right indicators
    if (edge === 'left') {
      return <div className="absolute -left-1 top-0 bottom-0 w-0.5 bg-blue-500 rounded-full z-10" />;
    }
    if (edge === 'right') {
      return <div className="absolute -right-1 top-0 bottom-0 w-0.5 bg-blue-500 rounded-full z-10" />;
    }
  }
  // For list view: top/bottom indicators
  if (edge === 'top') {
    return <div className="absolute -top-[3px] left-2 right-2 h-0.5 bg-blue-500 rounded-full z-10" />;
  }
  if (edge === 'bottom') {
    return <div className="absolute -bottom-[3px] left-2 right-2 h-0.5 bg-blue-500 rounded-full z-10" />;
  }
  return null;
}

// ============================================================
// GRID ITEM
// ============================================================

export const ProjectGridItem = memo(function ProjectGridItem({
  project,
  index,
  projects,
  cardCount,
  editingProjectId,
  editName,
  setEditName,
  editingDescId,
  editDesc,
  setEditDesc,
  onSaveRename,
  onSaveDescription,
  setEditingProjectId,
  setEditingDescId,
  onPinToggle,
  renderMoreButton,
  renderDropdown,
  formatDate,
}: ProjectItemProps) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        getInitialData: () => ({
          type: 'project',
          projectId: project.id,
          index,
          pinned: project.pinned,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => {
          if (source.data.type !== 'project') return false;
          if (source.data.projectId === project.id) return false;
          // Only allow drops within same pinned/unpinned group
          const sourceProject = projects.find((p) => p.id === source.data.projectId);
          return sourceProject?.pinned === project.pinned;
        },
        getData: ({ input, element }) => {
          return attachClosestEdge(
            { type: 'project', projectId: project.id, index },
            { input, element, allowedEdges: ['left', 'right'] },
          );
        },
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    );
  }, [project.id, project.pinned, index, projects]);

  return (
    <div
      ref={ref}
      onClick={() => navigate(`/projects/${project.id}`)}
      className={`group relative flex flex-col hud-panel-accent clip-corner-cut-sm p-5 hover:shadow-[0_0_20px_var(--color-chrome-glow)] hover:border-[var(--color-accent-dim)] transition-all cursor-pointer ${
        project.archived ? 'opacity-60 grayscale' : ''
      } ${isDragging ? 'opacity-50 scale-95' : ''}`}
    >
      <DropIndicatorLine edge={closestEdge} orientation="horizontal" />

      {/* Drag handle — top-left, visible on hover */}
      <div className="absolute top-4 left-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical size={16} className="text-surface-400 cursor-grab active:cursor-grabbing" />
      </div>

      {/* More Menu (Absolute) */}
      <div className="absolute top-4 right-4 z-10">
        {renderMoreButton(project)}
        {renderDropdown(project)}
      </div>

      <div className="flex items-start justify-between mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold shadow-md"
          style={{ backgroundColor: project.color || '#3b82f6' }}
        >
          {project.name.charAt(0).toUpperCase()}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPinToggle(project.id, !project.pinned);
          }}
          className={`mr-10 ${project.pinned ? 'text-amber-400' : 'text-surface-300 dark:text-surface-500 hover:text-amber-400'} transition-colors`}
        >
          <Star size={18} fill={project.pinned ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="mb-4">
        {editingProjectId === project.id ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => onSaveRename(project.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveRename(project.id);
              if (e.key === 'Escape') setEditingProjectId(null);
            }}
            autoFocus
            className="w-full text-lg font-bold bg-surface-50 dark:bg-surface-800 border-none rounded px-2 -ml-2 outline-none focus:ring-1 focus:ring-primary-500"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100 truncate pr-8">{project.name}</h3>
        )}
        {editingDescId === project.id ? (
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={() => onSaveDescription(project.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSaveDescription(project.id);
              }
              if (e.key === 'Escape') setEditingDescId(null);
            }}
            autoFocus
            rows={2}
            placeholder="Add a description..."
            className="w-full text-sm mt-1 bg-surface-50 dark:bg-surface-800 border-none rounded px-2 py-1 -ml-2 outline-none focus:ring-1 focus:ring-primary-500 resize-none text-surface-700 dark:text-surface-300 placeholder-surface-400"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <p
            className="text-sm text-surface-500 mt-1 line-clamp-2 h-10 cursor-text hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setEditingDescId(project.id);
              setEditDesc(project.description || '');
            }}
          >
            {project.description || <span className="italic opacity-50">Add description...</span>}
          </p>
        )}
      </div>

      <div className="mt-auto pt-4 border-t border-[var(--color-border)] flex items-center justify-between text-xs font-data text-[var(--color-text-secondary)]">
        <div className="flex items-center gap-1.5 bg-[var(--color-accent-subtle)] px-2 py-1 rounded-md">
          <LayoutList size={14} />
          <span className="font-[var(--font-display)]">{cardCount}</span> Tasks
        </div>
        {project.hourlyRate != null && (
          <span className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-md text-xs font-medium">
            <DollarSign size={12} />
            {project.hourlyRate}/hr
          </span>
        )}
        <span>Updated {formatDate(project.updatedAt)}</span>
      </div>
    </div>
  );
});

// ============================================================
// LIST ITEM
// ============================================================

export const ProjectListItem = memo(function ProjectListItem({
  project,
  index,
  projects,
  cardCount,
  editingProjectId,
  editName,
  setEditName,
  editingDescId,
  editDesc,
  setEditDesc,
  onSaveRename,
  onSaveDescription,
  setEditingProjectId,
  setEditingDescId,
  onPinToggle,
  renderMoreButton,
  renderDropdown,
  formatDate,
}: ProjectItemProps) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        getInitialData: () => ({
          type: 'project',
          projectId: project.id,
          index,
          pinned: project.pinned,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => {
          if (source.data.type !== 'project') return false;
          if (source.data.projectId === project.id) return false;
          const sourceProject = projects.find((p) => p.id === source.data.projectId);
          return sourceProject?.pinned === project.pinned;
        },
        getData: ({ input, element }) => {
          return attachClosestEdge(
            { type: 'project', projectId: project.id, index },
            { input, element, allowedEdges: ['top', 'bottom'] },
          );
        },
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    );
  }, [project.id, project.pinned, index, projects]);

  return (
    <div
      ref={ref}
      onClick={() => navigate(`/projects/${project.id}`)}
      className={`group relative flex items-center gap-4 hud-panel-accent px-4 py-3 hover:shadow-[0_0_20px_var(--color-chrome-glow)] hover:border-[var(--color-accent-dim)] transition-all cursor-pointer ${
        project.archived ? 'opacity-60 grayscale' : ''
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <DropIndicatorLine edge={closestEdge} orientation="vertical" />

      {/* Drag handle */}
      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical size={16} className="text-surface-400 cursor-grab active:cursor-grabbing" />
      </div>

      {/* Color avatar */}
      <div
        className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-sm font-bold shadow-sm"
        style={{ backgroundColor: project.color || '#3b82f6' }}
      >
        {project.name.charAt(0).toUpperCase()}
      </div>

      {/* Name (inline editable) */}
      <div className="w-48 flex-shrink-0 min-w-0">
        {editingProjectId === project.id ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => onSaveRename(project.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveRename(project.id);
              if (e.key === 'Escape') setEditingProjectId(null);
            }}
            autoFocus
            className="w-full text-sm font-bold bg-surface-50 dark:bg-surface-800 border-none rounded px-2 -ml-2 outline-none focus:ring-1 focus:ring-primary-500"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-sm font-bold text-surface-900 dark:text-surface-100 truncate block">
            {project.name}
          </span>
        )}
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        {editingDescId === project.id ? (
          <input
            type="text"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={() => onSaveDescription(project.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveDescription(project.id);
              if (e.key === 'Escape') setEditingDescId(null);
            }}
            autoFocus
            placeholder="Add a description..."
            className="w-full text-sm bg-surface-50 dark:bg-surface-800 border-none rounded px-2 -ml-2 outline-none focus:ring-1 focus:ring-primary-500 text-surface-700 dark:text-surface-300 placeholder-surface-400"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-sm text-[var(--color-text-muted)] truncate block cursor-text hover:text-[var(--color-text-secondary)] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setEditingDescId(project.id);
              setEditDesc(project.description || '');
            }}
          >
            {project.description || <span className="italic opacity-50">No description</span>}
          </span>
        )}
      </div>

      {/* Task count badge */}
      <div className="flex items-center gap-1.5 bg-[var(--color-accent-subtle)] px-2 py-1 rounded-md text-xs font-data text-[var(--color-text-secondary)] flex-shrink-0">
        <LayoutList size={14} />
        <span>{cardCount}</span>
      </div>

      {/* Hourly rate */}
      {project.hourlyRate != null && (
        <span className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-md text-xs font-medium flex-shrink-0">
          <DollarSign size={12} />
          {project.hourlyRate}/hr
        </span>
      )}

      {/* Updated date */}
      <span className="text-xs font-data text-[var(--color-text-muted)] flex-shrink-0 w-24 text-right">
        {formatDate(project.updatedAt)}
      </span>

      {/* Pin star */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPinToggle(project.id, !project.pinned);
        }}
        className={`flex-shrink-0 ${project.pinned ? 'text-amber-400' : 'text-surface-300 dark:text-surface-500 hover:text-amber-400'} transition-colors`}
      >
        <Star size={16} fill={project.pinned ? 'currentColor' : 'none'} />
      </button>

      {/* More menu */}
      <div className="relative flex-shrink-0">
        {renderMoreButton(project)}
        {renderDropdown(project)}
      </div>
    </div>
  );
});
