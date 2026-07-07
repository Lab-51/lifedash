// === FILE PURPOSE ===
// SessionSearch -- full-text search box mounted on SessionsHome (V3.1 Task 6).
// Debounced (300ms, mirrors CommandPalette's transcript-search debounce) query
// against the main-process searchService via IPC; renders grouped, ranked
// results (Sessions / Cards / Projects) with keyboard navigation, mirroring
// CommandPalette's listbox/option pattern. Selecting a result navigates to its
// open target: session -> /session/:id, card -> its board route with
// ?openCard= (the same deep link CommandPalette already uses to auto-open
// CardDetailModal), project -> its board route.
//
// Snippets arrive with control-character highlight markers (SNIPPET_HIGHLIGHT_START/END)
// instead of raw HTML, so they render as plain <mark> spans below -- no
// dangerouslySetInnerHTML anywhere in this component.

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Mic, LayoutGrid, Folder } from 'lucide-react';
import { SNIPPET_HIGHLIGHT_START, SNIPPET_HIGHLIGHT_END } from '../../shared/types';
import type { SearchResultItem, SearchResults } from '../../shared/types';
import { useMeetingStore } from '../stores/meetingStore';
import { projectSessionLink } from '../lib/sessionResolver';

const EMPTY_RESULTS: SearchResults = { sessions: [], cards: [], projects: [] };

const GROUPS: { key: keyof SearchResults; label: string; icon: typeof Mic }[] = [
  { key: 'sessions', label: 'Sessions', icon: Mic },
  { key: 'cards', label: 'Cards', icon: LayoutGrid },
  { key: 'projects', label: 'Projects', icon: Folder },
];

/** Renders a ts_headline snippet using the SNIPPET_HIGHLIGHT_START/END markers as highlight
 * boundaries -- plain text splitting, never HTML parsing. */
function Snippet({ text }: { text: string }) {
  const segments = text.split(SNIPPET_HIGHLIGHT_START);
  return (
    <>
      {segments.map((segment, i) => {
        if (i === 0) return segment;
        const [highlighted, ...rest] = segment.split(SNIPPET_HIGHLIGHT_END);
        return (
          <span key={i}>
            <mark className="bg-[var(--color-accent-subtle)] text-[var(--color-accent)] rounded px-0.5">
              {highlighted}
            </mark>
            {rest.join(SNIPPET_HIGHLIGHT_END)}
          </span>
        );
      })}
    </>
  );
}

export default function SessionSearch() {
  const navigate = useNavigate();
  const meetings = useMeetingStore((s) => s.meetings);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const flatResults = useMemo(() => GROUPS.flatMap((g) => results[g.key]), [results]);

  const runSearch = useCallback(async (value: string) => {
    if (!value.trim()) {
      setResults(EMPTY_RESULTS);
      return;
    }
    try {
      const found = await window.electronAPI.search(value.trim());
      setResults(found);
    } catch {
      setResults(EMPTY_RESULTS);
    }
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      setOpen(true);
      setSelectedIndex(0);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch(value);
      }, 300);
    },
    [runSearch],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults(EMPTY_RESULTS);
    setOpen(false);
  }, []);

  const goToResult = useCallback(
    (item: SearchResultItem) => {
      // Cards/projects have no standalone destination anymore — open them inside the
      // relevant session's Board tab (card => +openCard), or land on home when the
      // project has no session (projectSessionLink). Sessions navigate directly.
      if (item.type === 'session') void navigate(`/session/${item.id}`);
      else if (item.type === 'card')
        void navigate(item.projectId ? projectSessionLink(item.projectId, meetings, item.id) : '/');
      else void navigate(projectSessionLink(item.id, meetings));
      clearSearch();
    },
    [navigate, clearSearch, meetings],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open || flatResults.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatResults[selectedIndex]) goToResult(flatResults[selectedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [open, flatResults, selectedIndex, goToResult],
  );

  const showDropdown = open && query.trim().length > 0;
  let flatIdx = 0;

  return (
    <div ref={containerRef} className="relative flex-1">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
      <input
        type="text"
        aria-label="Search sessions, cards, and projects"
        placeholder="Search sessions, cards, projects..."
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full pl-8 pr-8 py-1.5 text-sm bg-transparent border-none focus:ring-0 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]"
      />
      {query && (
        <button
          onClick={clearSearch}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
        >
          <X size={12} />
        </button>
      )}

      {showDropdown && (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute top-full left-0 right-0 mt-2 z-40 max-h-96 overflow-y-auto bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded-xl shadow-xl py-2"
        >
          {flatResults.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">No results found</div>
          ) : (
            GROUPS.map((group) => {
              const items = results[group.key];
              if (items.length === 0) return null;
              const Icon = group.icon;
              return (
                <div key={group.key}>
                  <div className="px-4 py-1.5 text-[0.625rem] font-semibold tracking-widest uppercase text-[var(--color-text-muted)]">
                    {group.label}
                  </div>
                  {items.map((item) => {
                    const idx = flatIdx++;
                    const selected = idx === selectedIndex;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        role="option"
                        aria-selected={selected}
                        onClick={() => goToResult(item)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-start gap-3 px-4 py-2 text-left transition-colors ${
                          selected
                            ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'
                        }`}
                      >
                        <Icon size={14} className="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{item.title}</div>
                          {item.snippet && (
                            <div className="text-xs text-[var(--color-text-muted)] truncate">
                              <Snippet text={item.snippet} />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
