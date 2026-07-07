// === FILE PURPOSE ===
// Twin page (V3.3 Task 3) — the Twin nav destination. Shows the Digital Twin
// profile as editable, section-level cards (Profile tab) plus a placeholder
// Memory tab ("the twin starts learning in V3.4"). When no profile has ever
// been authored, shows a "Create your twin" empty state instead of the section
// cards. Reads/writes via twinProfileService's section-level patch API, exposed
// over IPC as twinGetProfile / twinUpdateProfileSection (see src/main/ipc/twin.ts,
// src/preload/domains/twin.ts — modeled on brain.ts).
//
// === TASK 4 SEAM ===
// `showWizard` + `setShowWizard` is the mount point for the Task 4 creation
// wizard (TwinWizard): both the empty-state CTA and the "Refine profile"
// affordance flip it to true. The block below marked
// `{/* Task 4: TwinWizard mounts here */}` is an honest stub (not a fake
// wizard) — Task 4 replaces it with the real <TwinWizard /> component, wired
// to update `profile` via setProfile (same onSaved contract every section
// card already uses) and to close via the same setShowWizard(false).
//
// === DEPENDENCIES ===
// react, react-router (none directly), lucide-react, EmptyFeatureState,
// HudBackground, LoadingSpinner, twin/TwinSectionCard, twin/TwinFieldEditors

import { useEffect, useState } from 'react';
import {
  Brain,
  UserRound,
  Building2,
  FolderKanban,
  Users,
  BookOpen,
  Target,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react';
import EmptyFeatureState from './EmptyFeatureState';
import HudBackground from './HudBackground';
import LoadingSpinner from './LoadingSpinner';
import TwinSectionCard from './twin/TwinSectionCard';
import TwinWizard from './TwinWizard';
import {
  fieldsToDraft,
  pruneObject,
  pruneRows,
  ObjectFieldsView,
  ObjectFieldsEditor,
  ListFieldsView,
  ListFieldsEditor,
} from './twin/TwinFieldEditors';
import {
  IDENTITY_FIELDS,
  DOMAIN_FIELDS,
  PREFERENCES_FIELDS,
  PROJECT_FIELDS,
  PERSON_FIELDS,
  VOCAB_FIELDS,
  GOAL_FIELDS,
} from './twin/twinFields';
import type {
  TwinProfile,
  TwinIdentity,
  TwinDomain,
  TwinPreferences,
  TwinProject,
  TwinPerson,
  TwinVocabularyTerm,
} from '../../shared/types/twin';

type TwinTab = 'profile' | 'memory';

/** Two-tab strip (Profile | Memory) — minimal local tablist, same aria pattern
 *  as LiveCanvasTabs/BrainTabPanel elsewhere in the app. */
function TwinTabs({ active, onSelect }: { active: TwinTab; onSelect: (tab: TwinTab) => void }) {
  const tabs: { id: TwinTab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'memory', label: 'Memory' },
  ];
  return (
    <div role="tablist" aria-label="Twin" className="flex items-center gap-1 border-b border-[var(--color-border)]">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={`px-4 py-2.5 text-sm font-hud tracking-wide transition-colors -mb-px border-b-2 ${
              isActive
                ? 'text-[var(--color-accent)] border-[var(--color-accent)] text-glow'
                : 'text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The seven profile section cards. Split out of TwinPage so `profile` is a
 * plain (non-null, non-undefined) prop here — TwinPage owns the loading/empty
 * narrowing, this component just renders a known-good profile.
 *
 * Every section's stored value is a plain object/array of string|undefined
 * leaves, so it's widened ONCE per section to the field-editor's generic
 * Record shape (safe by construction — FieldDef.key is always drawn from that
 * section's own known keys); the concrete TwinProfileSections type is
 * re-imposed only at the save boundary (the `as TwinIdentity` / `as unknown as
 * TwinProject[]` casts below), matching TwinFieldEditors.tsx's design.
 */
function TwinProfileGrid({ profile, onSaved }: { profile: TwinProfile; onSaved: (p: TwinProfile) => void }) {
  const identityValue = profile.identity as unknown as Record<string, string | undefined>;
  const domainValue = profile.domain as unknown as Record<string, string | undefined>;
  const preferencesValue = profile.preferences as unknown as Record<string, string | undefined>;
  const projectItems = profile.projects as unknown as Record<string, string | undefined>[];
  const peopleItems = profile.people as unknown as Record<string, string | undefined>[];
  const vocabularyItems = profile.vocabulary as unknown as Record<string, string | undefined>[];
  const goalItems = profile.goals.map((g) => ({ value: g }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <TwinSectionCard<Record<string, string>>
        title="Identity"
        icon={UserRound}
        initialDraft={() => fieldsToDraft(IDENTITY_FIELDS, identityValue)}
        renderView={() => <ObjectFieldsView fields={IDENTITY_FIELDS} value={identityValue} />}
        renderEditor={(draft, setDraft) => (
          <ObjectFieldsEditor fields={IDENTITY_FIELDS} value={draft} onChange={setDraft} />
        )}
        onSave={(draft) =>
          window.electronAPI.twinUpdateProfileSection('identity', pruneObject(IDENTITY_FIELDS, draft) as TwinIdentity)
        }
        onSaved={onSaved}
      />

      <TwinSectionCard<Record<string, string>>
        title="Domain"
        icon={Building2}
        initialDraft={() => fieldsToDraft(DOMAIN_FIELDS, domainValue)}
        renderView={() => <ObjectFieldsView fields={DOMAIN_FIELDS} value={domainValue} />}
        renderEditor={(draft, setDraft) => (
          <ObjectFieldsEditor fields={DOMAIN_FIELDS} value={draft} onChange={setDraft} />
        )}
        onSave={(draft) =>
          window.electronAPI.twinUpdateProfileSection('domain', pruneObject(DOMAIN_FIELDS, draft) as TwinDomain)
        }
        onSaved={onSaved}
      />

      <TwinSectionCard<Record<string, string>[]>
        title="Projects"
        icon={FolderKanban}
        initialDraft={() => projectItems.map((p) => fieldsToDraft(PROJECT_FIELDS, p))}
        renderView={() => (
          <ListFieldsView fields={PROJECT_FIELDS} items={projectItems} emptyLabel="No projects added yet." />
        )}
        renderEditor={(draft, setDraft) => (
          <ListFieldsEditor fields={PROJECT_FIELDS} rows={draft} onChange={setDraft} addLabel="Add project" />
        )}
        onSave={(draft) => {
          const { rows, error } = pruneRows(PROJECT_FIELDS, draft);
          if (error) return Promise.reject(new Error(error));
          return window.electronAPI.twinUpdateProfileSection('projects', rows as unknown as TwinProject[]);
        }}
        onSaved={onSaved}
      />

      <TwinSectionCard<Record<string, string>[]>
        title="People"
        icon={Users}
        initialDraft={() => peopleItems.map((p) => fieldsToDraft(PERSON_FIELDS, p))}
        renderView={() => (
          <ListFieldsView fields={PERSON_FIELDS} items={peopleItems} emptyLabel="No people added yet." />
        )}
        renderEditor={(draft, setDraft) => (
          <ListFieldsEditor fields={PERSON_FIELDS} rows={draft} onChange={setDraft} addLabel="Add person" />
        )}
        onSave={(draft) => {
          const { rows, error } = pruneRows(PERSON_FIELDS, draft);
          if (error) return Promise.reject(new Error(error));
          return window.electronAPI.twinUpdateProfileSection('people', rows as unknown as TwinPerson[]);
        }}
        onSaved={onSaved}
      />

      <TwinSectionCard<Record<string, string>[]>
        title="Vocabulary"
        icon={BookOpen}
        initialDraft={() => vocabularyItems.map((v) => fieldsToDraft(VOCAB_FIELDS, v))}
        renderView={() => (
          <ListFieldsView fields={VOCAB_FIELDS} items={vocabularyItems} emptyLabel="No terms added yet." />
        )}
        renderEditor={(draft, setDraft) => (
          <ListFieldsEditor fields={VOCAB_FIELDS} rows={draft} onChange={setDraft} addLabel="Add term" />
        )}
        onSave={(draft) => {
          const { rows, error } = pruneRows(VOCAB_FIELDS, draft);
          if (error) return Promise.reject(new Error(error));
          return window.electronAPI.twinUpdateProfileSection('vocabulary', rows as unknown as TwinVocabularyTerm[]);
        }}
        onSaved={onSaved}
      />

      <TwinSectionCard<Record<string, string>[]>
        title="Goals"
        icon={Target}
        initialDraft={() => goalItems}
        renderView={() => <ListFieldsView fields={GOAL_FIELDS} items={goalItems} emptyLabel="No goals added yet." />}
        renderEditor={(draft, setDraft) => (
          <ListFieldsEditor fields={GOAL_FIELDS} rows={draft} onChange={setDraft} addLabel="Add goal" />
        )}
        onSave={(draft) => {
          const { rows, error } = pruneRows(GOAL_FIELDS, draft);
          if (error) return Promise.reject(new Error(error));
          return window.electronAPI.twinUpdateProfileSection(
            'goals',
            rows.map((r) => r.value),
          );
        }}
        onSaved={onSaved}
      />

      <TwinSectionCard<Record<string, string>>
        title="Preferences"
        icon={SlidersHorizontal}
        initialDraft={() => fieldsToDraft(PREFERENCES_FIELDS, preferencesValue)}
        renderView={() => <ObjectFieldsView fields={PREFERENCES_FIELDS} value={preferencesValue} />}
        renderEditor={(draft, setDraft) => (
          <ObjectFieldsEditor fields={PREFERENCES_FIELDS} value={draft} onChange={setDraft} />
        )}
        onSave={(draft) =>
          window.electronAPI.twinUpdateProfileSection(
            'preferences',
            pruneObject(PREFERENCES_FIELDS, draft) as TwinPreferences,
          )
        }
        onSaved={onSaved}
      />
    </div>
  );
}

export default function TwinPage() {
  const [profile, setProfile] = useState<TwinProfile | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TwinTab>('profile');
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    window.electronAPI
      .twinGetProfile()
      .then(setProfile)
      .catch(() => setLoadError('Failed to load your twin profile.'));
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950 relative overflow-y-auto">
      <HudBackground />

      <div className="p-8 pb-4 shrink-0">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-4 mb-1">
              <span
                className="font-data text-[0.6875rem] tracking-[0.3em] text-[var(--color-accent)] text-glow"
                aria-hidden="true"
              >
                SYS.TWIN
              </span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
            </div>
            <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">Twin</h1>
            <p className="text-[var(--color-text-secondary)] text-sm mt-1 break-words">
              {profile
                ? `Mirrors ${profile.identity.name?.trim() || 'you'}${profile.identity.role?.trim() ? ` — ${profile.identity.role.trim()}` : ''}`
                : 'A profile of the professional the assistant works for — used to personalize briefs, chat, and triage.'}
            </p>
          </div>

          {profile && !showWizard && (
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all"
            >
              <Wand2 size={16} />
              Refine profile
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="px-8 mb-4">
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {loadError}
          </div>
        </div>
      )}

      {profile === undefined ? (
        !loadError && (
          <div className="flex-1 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        )
      ) : (
        <div className="px-8 pb-8 flex-1 flex flex-col min-h-0">
          <TwinTabs active={activeTab} onSelect={setActiveTab} />

          <div
            role="tabpanel"
            id="panel-profile"
            aria-labelledby="tab-profile"
            hidden={activeTab !== 'profile'}
            className="pt-6"
          >
            {/* Task 4: the creation/refinement wizard. It loads the profile
                itself to pre-fill on re-run, and writes via the same section-
                patch API the cards use, returning the updated profile. */}
            {showWizard ? (
              <TwinWizard
                onClose={() => setShowWizard(false)}
                onComplete={(p) => {
                  setProfile(p);
                  setShowWizard(false);
                }}
              />
            ) : profile === null ? (
              <EmptyFeatureState
                icon={Brain}
                title="Create your twin"
                description="Tell the assistant who you are, what you work on, and how you like to communicate — it personalizes meeting briefs, live chat, and triage."
                benefits={[
                  'Briefs and chat speak your vocabulary and priorities',
                  'Stays 100% local — the profile never leaves your machine',
                  'Edit any section any time, no all-or-nothing setup',
                ]}
                ctaLabel="Create your twin"
                ctaAction={() => setShowWizard(true)}
              />
            ) : (
              <TwinProfileGrid profile={profile} onSaved={setProfile} />
            )}
          </div>

          <div
            role="tabpanel"
            id="panel-memory"
            aria-labelledby="tab-memory"
            hidden={activeTab !== 'memory'}
            className="pt-6"
          >
            <div className="flex flex-col items-center justify-center text-center py-16 px-6 hud-panel clip-corner-cut-sm">
              <Brain size={28} className="text-[var(--color-accent-dim)] mb-3" />
              <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Memory</h3>
              <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">The twin starts learning in V3.4.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
