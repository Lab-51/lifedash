// === FILE PURPOSE ===
// Command palette overlay (Ctrl+K). Searches all app data and provides quick navigation + actions.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { Search, Folder, Mic, Lightbulb, MessageSquare, LayoutGrid, LayoutDashboard, Settings, Plus, Play, Keyboard, PlusCircle, Zap, FileSearch } from 'lucide-react';
import type { TranscriptSearchResult } from '../../shared/types';
import { useProjectStore } from '../stores/projectStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useIdeaStore } from '../stores/ideaStore';
import { useBrainstormStore } from '../stores/brainstormStore';
import { useBoardStore } from '../stores/boardStore';
import { toast } from '../hooks/useToast';

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: typeof Folder;
  category: string;
  action: () => void;
  timestamp?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  navigate: NavigateFunction;
  onShowShortcuts?: () => void;
}

const MAX_PER_CATEGORY = 5;

/** Strip HTML tags from TipTap-generated content for plain-text display */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/** Returns match priority: 0=exact, 1=title contains, 2=description contains, -1=no match */
function matchScore(query: string, title: string, description?: string | null): number {
  const q = query.toLowerCase(), t = title.toLowerCase();
  if (t === q) return 0;
  if (t.includes(q)) return 1;
  if (description && description.toLowerCase().includes(q)) return 2;
  return -1;
}

function CommandPalette({ isOpen, onClose, navigate, onShowShortcuts }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [transcriptResults, setTranscriptResults] = useState<TranscriptSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const projects = useProjectStore(s => s.projects);
  const meetings = useMeetingStore(s => s.meetings);
  const ideas = useIdeaStore(s => s.ideas);
  const sessions = useBrainstormStore(s => s.sessions);
  const allCards = useBoardStore(s => s.allCards);
  const loadAllCards = useBoardStore(s => s.loadAllCards);
  const storeCreateIdea = useIdeaStore(s => s.createIdea);

  const createIdea = useCallback(async (title: string) => {
    try {
      await storeCreateIdea({ title });
      toast(`Idea created: "${title}"`, 'success');
    } catch {
      toast('Failed to create idea', 'error');
    }
  }, [storeCreateIdea]);

  const createCardInFirstColumn = useCallback(async (projectId: string, title: string) => {
    try {
      const boards = await window.electronAPI.getBoards(projectId);
      if (boards.length === 0) {
        toast('No board found for this project', 'error');
        return;
      }
      const boardColumns = await window.electronAPI.getColumns(boards[0].id);
      if (boardColumns.length === 0) {
        toast('No columns in this board', 'error');
        return;
      }
      await window.electronAPI.createCard({
        columnId: boardColumns[0].id,
        title,
        priority: 'medium',
      });
      loadAllCards();
      toast(`Card created in ${boardColumns[0].name}`, 'success');
    } catch {
      toast('Failed to create card', 'error');
    }
  }, [loadAllCards]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTranscriptResults([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setTranscriptResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchTranscripts(trimmed, 5);
        setTranscriptResults(results);
      } catch {
        setTranscriptResults([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const go = useCallback((path: string) => { navigate(path); onClose(); }, [navigate, onClose]);

  const pageItems: CommandItem[] = useMemo(() => [
    { id: 'p-home', label: 'Home', icon: LayoutDashboard, category: 'Pages', action: () => go('/') },
    { id: 'p-proj', label: 'Projects', icon: Folder, category: 'Pages', action: () => go('/projects') },
    { id: 'p-meet', label: 'Meetings', icon: Mic, category: 'Pages', action: () => go('/meetings') },
    { id: 'p-idea', label: 'Ideas', icon: Lightbulb, category: 'Pages', action: () => go('/ideas') },
    { id: 'p-brain', label: 'Brainstorm', icon: MessageSquare, category: 'Pages', action: () => go('/brainstorm') },
    { id: 'p-set', label: 'Settings', icon: Settings, category: 'Pages', action: () => go('/settings') },
  ], [go]);

  const actionItems: CommandItem[] = useMemo(() => [
    { id: 'a-idea', label: 'New Idea...', icon: Plus, category: 'Actions', action: () => go('/ideas?action=create') },
    { id: 'a-proj', label: 'New Project...', icon: Plus, category: 'Actions', action: () => go('/projects?action=create') },
    { id: 'a-rec', label: 'Start Recording', icon: Play, category: 'Actions', action: () => go('/meetings?action=record') },
    { id: 'a-set', label: 'Open Settings', icon: Settings, category: 'Actions', action: () => go('/settings') },
    ...(onShowShortcuts ? [{ id: 'a-keys', label: 'Keyboard Shortcuts', icon: Keyboard, category: 'Actions', action: () => onShowShortcuts() }] : []),
  ], [go, onShowShortcuts]);

  const dataItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];
    for (const p of projects)
      items.push({ id: `proj-${p.id}`, label: p.name, sublabel: p.description ? stripHtml(p.description) : undefined, icon: Folder, category: 'Projects', action: () => go(`/projects/${p.id}`), timestamp: p.updatedAt });
    for (const m of meetings)
      items.push({ id: `meet-${m.id}`, label: m.title, sublabel: `${m.status}`, icon: Mic, category: 'Meetings', action: () => go('/meetings'), timestamp: m.createdAt });
    for (const i of ideas)
      items.push({ id: `idea-${i.id}`, label: i.title, sublabel: i.description ? stripHtml(i.description) : undefined, icon: Lightbulb, category: 'Ideas', action: () => go('/ideas'), timestamp: i.updatedAt });
    for (const s of sessions)
      items.push({ id: `bs-${s.id}`, label: s.title, sublabel: s.status, icon: MessageSquare, category: 'Brainstorm', action: () => go('/brainstorm'), timestamp: s.updatedAt });
    for (const c of allCards)
      items.push({ id: `card-${c.id}`, label: c.title, sublabel: c.description ? stripHtml(c.description) : undefined, icon: LayoutGrid, category: 'Cards', action: () => go(`/projects/${c.projectId}?openCard=${c.id}`), timestamp: c.updatedAt });
    return items;
  }, [projects, meetings, ideas, sessions, allCards, go]);

  const results: CommandItem[] = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      const recents = [...dataItems]
        .filter(i => i.timestamp)
        .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
        .slice(0, 5);
      return [...pageItems, ...actionItems, ...recents];
    }
    const matchedPages = pageItems.filter(p => matchScore(trimmed, p.label) >= 0);
    const matchedActions = actionItems.filter(a => matchScore(trimmed, a.label) >= 0);
    const scored = dataItems
      .map(item => ({ item, score: matchScore(trimmed, item.label, item.sublabel) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => a.score - b.score);
    const counts: Record<string, number> = {};
    const matchedData: CommandItem[] = [];
    for (const { item } of scored) {
      const c = counts[item.category] ?? 0;
      if (c < MAX_PER_CATEGORY) { matchedData.push(item); counts[item.category] = c + 1; }
    }
    const captureItems: CommandItem[] = [];
    if (trimmed.length >= 2 && matchedData.length < 3) {
      const displayText = trimmed.length > 40 ? trimmed.slice(0, 40) + '...' : trimmed;
      const activeProject = projects.find(p => !p.archived);

      captureItems.push({
        id: 'capture-idea',
        label: `Create idea: "${displayText}"`,
        icon: Zap,
        category: 'Quick Capture',
        action: () => {
          createIdea(trimmed);
          onClose();
        },
      });

      if (activeProject) {
        captureItems.push({
          id: 'capture-card',
          label: `Create card in ${activeProject.name}: "${displayText}"`,
          icon: PlusCircle,
          category: 'Quick Capture',
          action: () => {
            createCardInFirstColumn(activeProject.id, trimmed);
            onClose();
          },
        });
      }

      captureItems.push({
        id: 'capture-brainstorm',
        label: `Start brainstorm: "${displayText}"`,
        icon: MessageSquare,
        category: 'Quick Capture',
        action: () => {
          go('/brainstorm');
          onClose();
        },
      });
    }

    const transcriptItems: CommandItem[] = transcriptResults.map(r => ({
      id: `ts-${r.segmentId}`,
      label: r.content.length > 80 ? r.content.slice(0, 80) + '...' : r.content,
      sublabel: r.meetingTitle,
      icon: FileSearch,
      category: 'Transcripts',
      action: () => go(`/meetings?openMeeting=${r.meetingId}&transcriptSearch=${encodeURIComponent(trimmed)}`),
    }));

    return [...matchedPages, ...matchedActions, ...matchedData, ...transcriptItems, ...captureItems];
  }, [query, pageItems, actionItems, dataItems, projects, transcriptResults, createIdea, createCardInFirstColumn, go, onClose]);

  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    const el = listRef.current?.querySelectorAll('[data-cmd-item]')[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setSelectedIndex(p => Math.min(p + 1, results.length - 1)); break;
      case 'ArrowUp': e.preventDefault(); setSelectedIndex(p => Math.max(p - 1, 0)); break;
      case 'Enter': e.preventDefault(); results[selectedIndex]?.action(); break;
      case 'Escape': e.preventDefault(); onClose(); break;
    }
  }, [results, selectedIndex, onClose]);

  if (!isOpen) return null;

  // Group results by category
  const grouped: { category: string; items: CommandItem[] }[] = [];
  let lastCat = '';
  for (const item of results) {
    if (item.category !== lastCat) { grouped.push({ category: item.category, items: [] }); lastCat = item.category; }
    grouped[grouped.length - 1].items.push(item);
  }
  let flatIdx = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="w-full max-w-lg bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-700">
          <Search className="w-5 h-5 text-surface-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Search or jump to..."
            className="flex-1 bg-transparent text-surface-100 placeholder-surface-500 outline-none text-sm"
          />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] text-surface-500 bg-surface-800 rounded border border-surface-600">ESC</kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && <div className="px-4 py-8 text-center text-surface-500 text-sm">No results found</div>}
          {grouped.map(group => (
            <div key={group.category}>
              <div className="px-4 py-1.5 text-[11px] font-medium text-surface-500 uppercase tracking-wider">{group.category}</div>
              {group.items.map(item => {
                const idx = flatIdx++;
                const sel = idx === selectedIndex;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    data-cmd-item
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${sel ? 'bg-primary-600/20 text-surface-100' : 'text-surface-300 hover:bg-surface-800'}`}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <Icon className="w-4 h-4 shrink-0 text-surface-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{item.label}</div>
                      {item.sublabel && <div className="text-xs text-surface-500 truncate">{item.sublabel}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-surface-700 text-[11px] text-surface-500">
          <span><kbd className="px-1 py-0.5 bg-surface-800 rounded border border-surface-600">Enter</kbd> select</span>
          <span><kbd className="px-1 py-0.5 bg-surface-800 rounded border border-surface-600">&uarr;&darr;</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 bg-surface-800 rounded border border-surface-600">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
