// === FILE PURPOSE ===
// Final review step of the Twin creation wizard (V3.3 Task 4). Shows exactly
// what will be written to the profile, section by section, reusing the same
// read-only field views the section cards use so the preview matches the saved
// result. Purely presentational — the parent owns the write and any error/busy
// state; this just renders "what the twin will know".
//
// === DEPENDENCIES ===
// react, lucide-react, TwinFieldEditors (ObjectFieldsView/ListFieldsView).

import { ObjectFieldsView, ListFieldsView } from './TwinFieldEditors';
import { WIZARD_STEPS, type WizardDrafts } from './twinSteps';

/** Drop rows the user never filled so the preview shows only real content. */
function nonEmptyRows(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.filter((row) => Object.values(row).some((v) => v?.trim()));
}

export default function TwinWizardReview({ drafts }: { drafts: WizardDrafts }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Here is what your twin will know. Go back to any step to change it, or save to finish.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {WIZARD_STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <section key={step.key} className="hud-panel clip-corner-cut-sm p-4 min-w-0">
              <div className="flex items-center gap-2 mb-3 min-w-0">
                <Icon size={16} className="text-[var(--color-accent-dim)] shrink-0" />
                <h3 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)] truncate">
                  {step.title}
                </h3>
              </div>
              {step.kind === 'object' ? (
                <ObjectFieldsView fields={step.fields} value={drafts[step.key] as Record<string, string>} />
              ) : (
                <ListFieldsView
                  fields={step.fields}
                  items={nonEmptyRows(drafts[step.key] as Record<string, string>[])}
                  emptyLabel={step.emptyLabel ?? 'Nothing added.'}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
