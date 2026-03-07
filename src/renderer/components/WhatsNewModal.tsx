// === FILE PURPOSE ===
// "What's New" modal shown after the app updates to a new version.
// Three visual tiers: patch (subtle), minor (feature-focused), major (celebratory).
// Shows current release prominently, then previous versions in a scrollable area.
// Links to full changelog on GitHub.

import { useEffect, useRef } from 'react';
import {
  X,
  Wrench,
  Sparkles,
  Rocket,
  ArrowRight,
  Check,
  ExternalLink,
} from 'lucide-react';
import type { ReleaseType, ReleaseNoteSection, ReleaseNotesData } from '../../shared/releaseNotes';

interface WhatsNewModalProps {
  version: string;
  releaseType: ReleaseType;
  sections: ReleaseNoteSection[];
  previousVersions?: ReleaseNotesData[];
  onDismiss: () => void;
}

const CHANGELOG_URL = 'https://github.com/Lab-51/lifedash/releases';

// ─────────────────────────────────────────────────────────────────────────────
// Per-tier visual config
// ─────────────────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<ReleaseType, {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  buttonLabel: string;
  buttonIcon: React.ReactNode;
  maxWidth: string;
  glowColor: string;
  accentClass: string;
}> = {
  patch: {
    icon: <Wrench size={28} />,
    title: 'Bug Fix Update',
    subtitle: 'Small improvements and fixes',
    buttonLabel: 'Got It',
    buttonIcon: <Check size={16} />,
    maxWidth: 'max-w-lg',
    glowColor: 'rgba(62,232,228,0.05)',
    accentClass: '',
  },
  minor: {
    icon: <Sparkles size={28} />,
    title: 'New Features',
    subtitle: 'Fresh capabilities just landed',
    buttonLabel: "Let's Go",
    buttonIcon: <ArrowRight size={16} />,
    maxWidth: 'max-w-lg',
    glowColor: 'rgba(62,232,228,0.08)',
    accentClass: '',
  },
  major: {
    icon: <Rocket size={28} />,
    title: 'Major Update',
    subtitle: 'A big leap forward',
    buttonLabel: "Let's Explore",
    buttonIcon: <Rocket size={16} />,
    maxWidth: 'max-w-xl',
    glowColor: 'rgba(62,232,228,0.12)',
    accentClass: 'ring-1 ring-[var(--color-accent-dim)]/30',
  },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  new: <Sparkles size={14} className="text-[var(--color-accent)] shrink-0 mt-0.5" />,
  fixes: <Wrench size={14} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />,
  internal: <Check size={14} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />,
};

function ReleaseSections({ sections }: { sections: ReleaseNoteSection[] }) {
  return (
    <div className="space-y-3">
      {sections.map(section => (
        <div key={section.category}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5">
            {section.label}
          </h3>
          <ul className="space-y-1.5">
            {section.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                {CATEGORY_ICONS[section.category] || CATEGORY_ICONS.internal}
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function WhatsNewModal({ version, releaseType, sections, previousVersions, onDismiss }: WhatsNewModalProps) {
  const tier = TIER_CONFIG[releaseType];
  const hasPrevious = previousVersions && previousVersions.length > 0;

  // Escape key dismisses
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onDismissRef.current(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onDismiss}
    >
      <div
        className={`w-full ${tier.maxWidth} mx-4 hud-panel-accent clip-corner-cut shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh] ${tier.accentClass}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Ambient glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] pointer-events-none"
          style={{ background: `radial-gradient(ellipse, ${tier.glowColor} 0%, transparent 70%)` }}
        />

        {/* Header bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-accent)] shrink-0 relative">
          <span className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)]">
            {releaseType === 'major' ? 'Major Release' : releaseType === 'minor' ? 'Feature Update' : 'Patch Notes'}
          </span>
          <button
            onClick={onDismiss}
            className="p-1 rounded-md hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 relative">
          <div className="px-6 py-5">
            {/* Icon + title */}
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-accent-dim)] flex items-center justify-center mb-4">
                <span className="text-[var(--color-accent)]">{tier.icon}</span>
              </div>

              <h2 className="font-hud text-lg tracking-tight text-[var(--color-text-primary)] mb-1">
                {tier.title}
              </h2>
              <p className="text-[var(--color-text-secondary)] text-sm mb-1">
                {tier.subtitle}
              </p>
              <span className="font-data text-xs text-[var(--color-accent-dim)]">
                v{version}
              </span>
            </div>

            {/* Current release notes */}
            <div className="mb-6">
              <ReleaseSections sections={sections} />
            </div>

            {/* Previous versions */}
            {hasPrevious && (
              <div className="border-t border-[var(--color-border)] pt-4 space-y-4">
                <span className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-text-muted)]">
                  Previous Updates
                </span>
                {previousVersions.map(release => (
                  <div key={release.version} className="pl-3 border-l-2 border-[var(--color-border)]">
                    <span className="font-data text-xs text-[var(--color-accent-dim)] mb-2 block">
                      v{release.version}
                    </span>
                    <ReleaseSections sections={release.sections} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer: button + changelog link */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] shrink-0 flex flex-col items-center gap-3 relative">
          <button
            onClick={onDismiss}
            className="flex items-center justify-center gap-2 px-6 py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium"
            autoFocus
          >
            {tier.buttonLabel}
            {tier.buttonIcon}
          </button>
          <a
            href={CHANGELOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <ExternalLink size={12} />
            Full changelog on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
