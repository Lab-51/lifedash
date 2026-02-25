// === FILE PURPOSE ===
// Projects page — Modern Design
// Displays the project list with CRUD operations, using the new enterprise design system.

import { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FolderKanban, Plus, Archive, Sparkles, Pencil, Trash2, LayoutList, Copy, Star, MoreVertical, Search, Filter, DollarSign } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useBoardStore } from '../stores/boardStore';
import LoadingSpinner from '../components/LoadingSpinner';
const ProjectPlanningModal = lazy(() => import('../components/ProjectPlanningModal'));
import type { CreateProjectInput } from '../../shared/types';
import { toast } from '../hooks/useToast';

const PRESET_COLORS = [
    '#6366f1', // Indigo
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#3b82f6', // Blue
];

export default function ProjectsModern() {
    const navigate = useNavigate();
    const projects = useProjectStore(s => s.projects);
    const loading = useProjectStore(s => s.loading);
    const error = useProjectStore(s => s.error);
    const loadProjects = useProjectStore(s => s.loadProjects);
    const createProject = useProjectStore(s => s.createProject);
    const updateProject = useProjectStore(s => s.updateProject);
    const deleteProject = useProjectStore(s => s.deleteProject);
    const removeProjectFromUI = useProjectStore(s => s.removeProjectFromUI);
    const restoreProjectToUI = useProjectStore(s => s.restoreProjectToUI);
    const duplicateProject = useProjectStore(s => s.duplicateProject);
    const allCards = useBoardStore(s => s.allCards);
    const loadAllCards = useBoardStore(s => s.loadAllCards);

    const [showArchived, setShowArchived] = useState(false);
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editingDescId, setEditingDescId] = useState<string | null>(null);
    const [editDesc, setEditDesc] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [planningProjectId, setPlanningProjectId] = useState<string | null>(null);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

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
        // Close menu when clicking outside
        const handleClickOutside = () => setActiveMenuId(null);
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [loadProjects]);

    const filteredProjects = useMemo(() => {
        let result = showArchived ? projects : projects.filter(p => !p.archived);

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(p =>
                p.name.toLowerCase().includes(q) ||
                (p.description && p.description.toLowerCase().includes(q))
            );
        }

        // Sort pinned first
        return result.sort((a, b) => {
            if (a.pinned === b.pinned) return 0;
            return a.pinned ? -1 : 1;
        });
    }, [projects, showArchived, searchQuery]);

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
            hourlyRate: formData.hourlyRate ?? undefined,
        });
        setFormData({ name: '', description: '', color: PRESET_COLORS[0] });
        setShowCreateForm(false);
        toast('Project created');
        navigate(`/projects/${project.id}`);
    };

    const handleArchive = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await updateProject(id, { archived: true });
        toast('Project archived');
    };

    const handleUnarchive = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await updateProject(id, { archived: false });
    };

    const handleStartRename = (e: React.MouseEvent, project: { id: string; name: string }) => {
        e.stopPropagation();
        setEditingProjectId(project.id);
        setEditName(project.name);
        setActiveMenuId(null);
    };

    const handleSaveRename = async (id: string) => {
        const trimmed = editName.trim();
        if (trimmed && trimmed !== projects.find(p => p.id === id)?.name) {
            await updateProject(id, { name: trimmed });
        }
        setEditingProjectId(null);
    };

    const handleSaveDescription = async (id: string) => {
        const trimmed = editDesc.trim();
        const current = projects.find(p => p.id === id)?.description || '';
        if (trimmed !== current) {
            await updateProject(id, { description: trimmed || null });
        }
        setEditingDescId(null);
    };

    const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
        e.stopPropagation();
        setActiveMenuId(null);
        const snapshot = projects.find(p => p.id === id);
        if (!snapshot) return;

        removeProjectFromUI(id);

        let cancelled = false;
        const timer = setTimeout(() => {
            if (!cancelled) deleteProject(id);
        }, 5000);

        toast(`Deleted "${name}"`, 'info', {
            label: 'Undo',
            onClick: () => {
                cancelled = true;
                clearTimeout(timer);
                restoreProjectToUI(snapshot);
            },
        }, 5000);
    };

    const handleDuplicate = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setActiveMenuId(null);
        const newProject = await duplicateProject(id);
        await loadAllCards();
        toast(`Duplicated as "${newProject.name}"`);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    if (loading && projects.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <LoadingSpinner />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950">
            {/* Modern Header */}
            <div className="p-8 pb-4 shrink-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div>
                        <div className="flex items-center gap-4 mb-1">
                            <div className="h-px w-16 bg-gradient-to-r from-transparent to-[var(--color-accent)] opacity-40" />
                            <span className="font-data text-[11px] tracking-[0.3em] text-[var(--color-accent)] text-glow">SYS.PROJECTS</span>
                            <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
                        </div>
                        <h1 className="font-hud text-2xl tracking-widest text-surface-900 dark:text-[var(--color-accent)]">Projects</h1>
                        <p className="text-[var(--color-text-secondary)] mt-1 font-data">Manage and track your work.</p>
                    </div>
                    <button
                        onClick={() => setShowCreateForm(true)}
                        className="btn-primary clip-corner-cut-sm flex items-center gap-2 px-5 py-2.5 text-sm font-medium"
                    >
                        <Plus size={18} />
                        New Project
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                        <input
                            type="text"
                            placeholder="Search projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] transition-all font-data"
                        />
                    </div>

                    <div className="flex items-center gap-2 border-l border-surface-200 dark:border-surface-800 pl-3 ml-1">
                        <button
                            onClick={() => setShowArchived(!showArchived)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${showArchived ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400' : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
                        >
                            <Archive size={16} />
                            <span className="hidden sm:inline">Archived</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto px-8 pb-8">

                {error && (
                    <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {showCreateForm && (
                    <div className="mb-8 hud-panel-accent clip-corner-cut-sm p-6 shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
                        <h3 className="font-hud text-sm tracking-widest uppercase text-[var(--color-accent)] mb-4">Create New Project</h3>
                        <form onSubmit={handleCreate}>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1.5">Project Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Website Redesign"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full text-base bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-3 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition-all"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1.5">Description</label>
                                    <textarea
                                        placeholder="Briefly describe the project goals..."
                                        value={formData.description || ''}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                        rows={2}
                                        className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-3 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 resize-none transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-2">Color Label</label>
                                    <div className="flex items-center gap-3">
                                        {PRESET_COLORS.map(color => (
                                            <button
                                                key={color}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, color })}
                                                className={`w-8 h-8 rounded-full transition-all flex items-center justify-center ${formData.color === color
                                                        ? 'ring-2 ring-offset-2 ring-primary-500 ring-offset-white dark:ring-offset-surface-900 scale-110'
                                                        : 'hover:scale-110 opacity-70 hover:opacity-100'
                                                    }`}
                                                style={{ backgroundColor: color }}
                                            >
                                                {formData.color === color && <div className="w-2 h-2 bg-white rounded-full shadow-sm" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1.5">Hourly Rate <span className="normal-case font-normal">(optional — for billable time tracking)</span></label>
                                    <div className="flex items-center gap-2">
                                        <div className="relative w-40">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">$</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                placeholder="0.00"
                                                value={formData.hourlyRate ?? ''}
                                                onChange={e => setFormData({ ...formData, hourlyRate: e.target.value ? parseFloat(e.target.value) : undefined })}
                                                className="w-full pl-7 pr-10 py-3 text-sm bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-700 rounded-xl text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">/hr</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 pt-2">
                                    <button
                                        type="submit"
                                        className="bg-primary-600 hover:bg-primary-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm"
                                    >
                                        Create Project
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowCreateForm(false);
                                            setFormData({ name: '', description: '', color: PRESET_COLORS[0] });
                                        }}
                                        className="text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                )}

                {filteredProjects.length === 0 ? (
                    <div className="mt-20 flex flex-col items-center justify-center text-center">
                        <div className="w-20 h-20 bg-surface-100 dark:bg-surface-900 rounded-full flex items-center justify-center mb-6">
                            <FolderKanban size={32} className="text-surface-400" />
                        </div>
                        <h3 className="text-xl font-medium text-surface-900 dark:text-surface-100 mb-2">
                            {searchQuery ? 'No matching projects' : 'No projects yet'}
                        </h3>
                        <p className="text-surface-500 max-w-xs mx-auto mb-8">
                            {searchQuery ? 'Try adjusting your search terms.' : 'Create your first project to start organizing tasks and ideas.'}
                        </p>
                        {!searchQuery && (
                            <button
                                onClick={() => setShowCreateForm(true)}
                                className="flex items-center gap-2 text-primary-600 hover:text-primary-500 font-medium"
                            >
                                <Plus size={18} />
                                Create a project
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredProjects.map(project => (
                            <div
                                key={project.id}
                                onClick={() => navigate(`/projects/${project.id}`)}
                                className={`group relative flex flex-col hud-panel-accent clip-corner-cut-sm corner-brackets p-5 hover:shadow-[0_0_20px_var(--color-chrome-glow)] hover:border-[var(--color-accent-dim)] transition-all cursor-pointer ${project.archived ? 'opacity-60 grayscale' : ''}`}
                            >
                                {/* More Menu (Absolute) */}
                                <div className="absolute top-4 right-4 z-10">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveMenuId(activeMenuId === project.id ? null : project.id);
                                        }}
                                        className="p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
                                    >
                                        <MoreVertical size={18} />
                                    </button>
                                    {/* Dropdown */}
                                    {activeMenuId === project.id && (
                                        <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-800 rounded-xl shadow-xl py-1 z-20 animate-in fade-in zoom-in-95 duration-100">
                                            <button onClick={(e) => handleStartRename(e, project)} className="w-full text-left px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 flex items-center gap-2">
                                                <Pencil size={14} /> Rename
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); setPlanningProjectId(project.id); setActiveMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 flex items-center gap-2">
                                                <Sparkles size={14} /> Plan with AI
                                            </button>
                                            <button onClick={(e) => handleDuplicate(e, project.id)} className="w-full text-left px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 flex items-center gap-2">
                                                <Copy size={14} /> Duplicate
                                            </button>
                                            <div className="h-px bg-surface-100 dark:bg-surface-700 my-1" />
                                            <button
                                                onClick={(e) => project.archived ? handleUnarchive(e, project.id) : handleArchive(e, project.id)}
                                                className="w-full text-left px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 flex items-center gap-2"
                                            >
                                                <Archive size={14} /> {project.archived ? 'Unarchive' : 'Archive'}
                                            </button>
                                            <button onClick={(e) => handleDelete(e, project.id, project.name)} className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2">
                                                <Trash2 size={14} /> Delete
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-start justify-between mb-4">
                                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold shadow-md" style={{ backgroundColor: project.color || '#3b82f6' }}>
                                        {project.name.charAt(0).toUpperCase()}
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); updateProject(project.id, { pinned: !project.pinned }); }}
                                        className={`mr-10 ${project.pinned ? 'text-amber-400' : 'text-surface-300 dark:text-surface-500 hover:text-amber-400'} transition-colors`}
                                    >
                                        <Star size={18} fill={project.pinned ? "currentColor" : "none"} />
                                    </button>
                                </div>

                                <div className="mb-4">
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
                                            onBlur={() => handleSaveDescription(project.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveDescription(project.id); }
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
                                            onClick={(e) => { e.stopPropagation(); setEditingDescId(project.id); setEditDesc(project.description || ''); }}
                                        >
                                            {project.description || <span className="italic opacity-50">Add description...</span>}
                                        </p>
                                    )}
                                </div>

                                <div className="mt-auto pt-4 border-t border-[var(--color-border)] flex items-center justify-between text-xs font-data text-[var(--color-text-secondary)]">
                                    <div className="flex items-center gap-1.5 bg-[var(--color-accent-subtle)] px-2 py-1 rounded-md">
                                        <LayoutList size={14} />
                                        <span className="font-[var(--font-display)]">{cardCountByProject[project.id] || 0}</span> Tasks
                                    </div>
                                    {project.hourlyRate != null && (
                                        <span className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-md text-xs font-medium">
                                            <DollarSign size={12} />{project.hourlyRate}/hr
                                        </span>
                                    )}
                                    <span>
                                        Updated {formatDate(project.updatedAt)}
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
        </div>
    );
}
