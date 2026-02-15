// === FILE PURPOSE ===
// Home dashboard page — the default landing page showing a greeting, quick
// actions, active projects, recent meetings, and recent ideas at a glance.

// === DEPENDENCIES ===
// react (useMemo), react-router-dom (useNavigate),
// lucide-react icons, projectStore, meetingStore, ideaStore, boardStore

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic,
  Plus,
  Brain,
  Lightbulb,
  LayoutList,
  ArrowRight,
  FolderKanban,
  Clock,
  Calendar,
} from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useIdeaStore } from '../stores/ideaStore';
import { useBoardStore } from '../stores/boardStore';
import type { IdeaStatus } from '../../shared/types';

const STATUS_COLORS: Record<IdeaStatus, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  exploring: 'bg-amber-500/20 text-amber-400',
  active: 'bg-emerald-500/20 text-emerald-400',
  archived: 'bg-surface-600/50 text-surface-400',
};

/** Return a time-based greeting string. */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Format today's date as "Saturday, February 15". */
function formatToday(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Format a date string as "Jan 15, 2026". */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Format duration between two ISO timestamps as "1h 23m". */
function formatDuration(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms <= 0) return '0m';
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const QUICK_ACTIONS = [
  { label: 'New Recording', icon: Mic, path: '/meetings?action=record' },
  { label: 'New Project', icon: Plus, path: '/projects?action=create' },
  { label: 'New Brainstorm', icon: Brain, path: '/brainstorm?action=create' },
  { label: 'New Idea', icon: Lightbulb, path: '/ideas?action=create' },
] as const;

const MAX_PROJECTS = 6;
const MAX_RECENT = 5;

function DashboardPage() {
  const navigate = useNavigate();
  const projects = useProjectStore(s => s.projects);
  const meetings = useMeetingStore(s => s.meetings);
  const ideas = useIdeaStore(s => s.ideas);
  const allCards = useBoardStore(s => s.allCards);

  const activeProjects = useMemo(
    () => projects.filter(p => !p.archived).slice(0, MAX_PROJECTS),
    [projects],
  );

  const totalActiveProjects = useMemo(
    () => projects.filter(p => !p.archived).length,
    [projects],
  );

  const cardCountByProject = useMemo(() => {
    const map: Record<string, number> = {};
    for (const card of allCards) {
      map[card.projectId] = (map[card.projectId] || 0) + 1;
    }
    return map;
  }, [allCards]);

  const recentMeetings = useMemo(
    () =>
      [...meetings]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, MAX_RECENT),
    [meetings],
  );

  const recentIdeas = useMemo(
    () =>
      [...ideas]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, MAX_RECENT),
    [ideas],
  );

  return (
    <div className="p-6 space-y-8 overflow-y-auto">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{getGreeting()}</h1>
        <p className="mt-1 text-surface-400">{formatToday()}</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {QUICK_ACTIONS.map(({ label, icon: Icon, path }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className="flex flex-col items-center gap-2 bg-surface-800 border border-surface-700 rounded-xl p-4 hover:border-primary-500 transition-colors group"
          >
            <Icon size={22} className="text-surface-400 group-hover:text-primary-400 transition-colors" />
            <span className="text-sm text-surface-300 group-hover:text-surface-100 transition-colors">
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* Active Projects */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-surface-100">Active Projects</h2>
          {totalActiveProjects > MAX_PROJECTS && (
            <button
              onClick={() => navigate('/projects')}
              className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors"
            >
              View all {totalActiveProjects} projects
              <ArrowRight size={14} />
            </button>
          )}
        </div>

        {activeProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-surface-500">
            <FolderKanban size={32} className="mb-2 text-surface-600" />
            <p className="text-sm">No active projects yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeProjects.map(project => (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="bg-surface-800 border border-surface-700 rounded-xl p-4 hover:border-surface-600 transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || '#3b82f6' }}
                  />
                  <h3 className="font-medium text-surface-100 truncate">{project.name}</h3>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-surface-400">
                    <LayoutList size={12} />
                    {cardCountByProject[project.id] || 0} cards
                  </span>
                  <span className="text-xs text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    Open <ArrowRight size={12} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bottom row: Recent Meetings + Recent Ideas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Meetings */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-surface-100">Recent Meetings</h2>
            {meetings.length > MAX_RECENT && (
              <button
                onClick={() => navigate('/meetings')}
                className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors"
              >
                View all
                <ArrowRight size={14} />
              </button>
            )}
          </div>

          {recentMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-surface-500">
              <Mic size={32} className="mb-2 text-surface-600" />
              <p className="text-sm">No meetings yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentMeetings.map(meeting => (
                <button
                  key={meeting.id}
                  onClick={() => navigate(`/meetings?openMeeting=${meeting.id}`)}
                  className="w-full text-left bg-surface-800 border border-surface-700 rounded-xl p-3 hover:border-surface-600 transition-colors"
                >
                  <p className="text-sm font-medium text-surface-100 truncate">
                    {meeting.title}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-surface-400">
                    <span className="flex items-center gap-1">
                      <Calendar size={11} />
                      {formatDate(meeting.createdAt)}
                    </span>
                    {meeting.endedAt && (
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {formatDuration(meeting.startedAt, meeting.endedAt)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Recent Ideas */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-surface-100">Recent Ideas</h2>
            {ideas.length > MAX_RECENT && (
              <button
                onClick={() => navigate('/ideas')}
                className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors"
              >
                View all
                <ArrowRight size={14} />
              </button>
            )}
          </div>

          {recentIdeas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-surface-500">
              <Lightbulb size={32} className="mb-2 text-surface-600" />
              <p className="text-sm">No ideas yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentIdeas.map(idea => (
                <button
                  key={idea.id}
                  onClick={() => navigate(`/ideas?openIdea=${idea.id}`)}
                  className="w-full text-left bg-surface-800 border border-surface-700 rounded-xl p-3 hover:border-surface-600 transition-colors flex items-center justify-between gap-3"
                >
                  <p className="text-sm font-medium text-surface-100 truncate">
                    {idea.title}
                  </p>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[idea.status]}`}
                  >
                    {idea.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default DashboardPage;
