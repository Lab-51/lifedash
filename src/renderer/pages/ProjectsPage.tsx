// === FILE PURPOSE ===
// Projects page — displays the project list with CRUD operations.
// Default route (/). Shows a grid of project cards, a create form,
// and handles navigation to individual board views.

// === DEPENDENCIES ===
// react (useEffect, useState), react-router-dom (useNavigate),
// lucide-react (FolderKanban, Plus, Archive, Sparkles, Pencil, Trash2), projectStore, LoadingSpinner,
// ProjectPlanningModal, shared types (CreateProjectInput)

import { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FolderKanban, Plus, Archive, Sparkles, Pencil, Trash2, LayoutList } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useBoardStore } from '../stores/boardStore';
import LoadingSpinner from '../components/LoadingSpinner';
const ProjectPlanningModal = lazy(() => import('../components/ProjectPlanningModal'));
import type { CreateProjectInput } from '../../shared/types';

const PRESET_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
];

function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useProjectStore(s => s.projects);
  const loading = useProjectStore(s => s.loading);
  const error = useProjectStore(s => s.error);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const createProject = useProjectStore(s => s.createProject);
  const updateProject = useProjectStore(s => s.updateProject);
  const deleteProject = useProjectStore(s => s.deleteProject);
  const allCards = useBoardStore(s => s.allCards);
  const [showArchived, setShowArchived] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [planningProjectId, setPlanningProjectId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateProjectInput>({
    name: '',
    description: '',
    color: PRESET_COLORS[0],
  });
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?action=create — auto-open the create form
  useEffect(() => {
    if (searchParams.get('action') === 'create') {
      setShowCreateForm(true);
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const filteredProjects = showArchived ? projects : projects.filter(p => !p.archived);
  const hasArchivedProjects = projects.some(p => p.archived);

  const cardCountByProject = useMemo(() => {
    const map: Record<string, number> = {};
    for (const card of allCards) {
      map[card.projectId] = (map[card.projectId] || 0) + 1;
    }
    return map;
  }, [allCards]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    const project = await createProject({
      name: formData.name.trim(),
      description: formData.description?.trim() || undefined,
      color: formData.color,
    });
    setFormData({ name: '', description: '', color: PRESET_COLORS[0] });
    setShowCreateForm(false);
    navigate(`/projects/${project.id}`);
  };

  const handleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Don't navigate when clicking archive
    await updateProject(id, { archived: true });
  };

  const handleUnarchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await updateProject(id, { archived: false });
  };

  const handleStartRename = (e: React.MouseEvent, project: { id: string; name: string }) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditName(project.name);
  };

  const handleSaveRename = async (id: string) => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== projects.find(p => p.id === id)?.name) {
      await updateProject(id, { name: trimmed });
    }
    setEditingProjectId(null);
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (window.confirm(`Delete project "${name}"? This will permanently remove the project and all its boards, columns, and cards. This cannot be undone.`)) {
      await deleteProject(id);
    }
  };

  /** Format date as "Jan 15, 2026" */
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Full-page loading state when no projects have been loaded yet
  if (loading && projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Projects</h1>
          <p className="mt-1 text-surface-400">
            Manage your project boards and tasks.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {hasArchivedProjects && (
            <label className="flex items-center gap-2 text-xs text-surface-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-surface-600"
              />
              Show archived
            </label>
          )}
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 bg-surface-800 border border-surface-700 rounded-lg"
        >
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Project name"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full text-sm bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500"
              autoFocus
            />
            <textarea
              placeholder="Description (optional)"
              value={formData.description || ''}
              onChange={e =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={2}
              className="w-full text-sm bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500 resize-none"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-surface-500">Color:</span>
              {PRESET_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-6 h-6 rounded-full transition-all ${
                    formData.color === color
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-800'
                      : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setFormData({
                    name: '',
                    description: '',
                    color: PRESET_COLORS[0],
                  });
                }}
                className="text-surface-400 hover:text-surface-200 px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Project grid or empty state */}
      {filteredProjects.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
          <FolderKanban size={48} className="mb-4 text-surface-600" />
          <p className="text-lg">No projects yet</p>
          <p className="text-sm text-surface-500 mt-1">
            Create your first project to get started
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map(project => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className={`text-left p-4 bg-surface-800 border border-surface-700 rounded-lg hover:border-surface-600 transition-colors group cursor-pointer${project.archived ? ' opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || '#3b82f6' }}
                  />
                  {editingProjectId === project.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleSaveRename(project.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(project.id);
                        if (e.key === 'Escape') setEditingProjectId(null);
                      }}
                      autoFocus
                      className="font-semibold text-surface-100 bg-surface-700 rounded px-1 -mx-1 w-full outline-none focus:ring-1 focus:ring-primary-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <h3 className="font-semibold text-surface-100 truncate">
                      {project.name}
                    </h3>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={e => handleStartRename(e, project)}
                    className="text-surface-500 hover:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Rename project"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setPlanningProjectId(project.id); }}
                    className="text-surface-500 hover:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Plan with AI"
                  >
                    <Sparkles size={16} />
                  </button>
                  {project.archived ? (
                    <button
                      onClick={e => handleUnarchive(e, project.id)}
                      className="text-surface-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="Unarchive project"
                    >
                      <Archive size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={e => handleArchive(e, project.id)}
                      className="text-surface-500 hover:text-surface-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="Archive project"
                    >
                      <Archive size={16} />
                    </button>
                  )}
                  <button
                    onClick={e => handleDelete(e, project.id, project.name)}
                    className="text-surface-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Delete project"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {project.description && (
                <p className="mt-2 text-sm text-surface-400 line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between text-xs text-surface-500">
                <span>Created {formatDate(project.createdAt)}</span>
                <span className="flex items-center gap-1 text-surface-400">
                  <LayoutList size={12} />
                  {cardCountByProject[project.id] || 0} cards
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* AI Planning Modal */}
      <Suspense fallback={null}>
        {planningProjectId && (
          <ProjectPlanningModal
            projectId={planningProjectId}
            projectName={projects.find(p => p.id === planningProjectId)?.name || ''}
            onClose={() => setPlanningProjectId(null)}
            onApplied={(pid) => {
              setPlanningProjectId(null);
              navigate(`/projects/${pid}`);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

export default ProjectsPage;
