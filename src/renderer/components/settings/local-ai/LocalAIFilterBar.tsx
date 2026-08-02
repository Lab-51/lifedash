// === FILE PURPOSE ===
// Origin + license filters for the Settings → Local AI catalog, plus the pure
// helpers that derive the option lists and apply the filter. Origin/licence
// filtering is a product requirement, not decoration: an organisation's policy
// may exclude models from a given country or under a given licence.
//
// === DEPENDENCIES ===
// React, HudSelect (the app's dropdown), ./format (region labels).

import type { CatalogModel } from '../../../../shared/types/localModels';
import HudSelect from '../../HudSelect';
import { regionLabel } from './format';

/** Sentinel for "no filter" — an empty string, so it can never collide with a code. */
export const ANY = '';

export interface CatalogFilters {
  origin: string;
  license: string;
}

/** Unique, sorted origin codes and licence names present in the catalog. */
export function filterOptions(models: CatalogModel[]): { origins: string[]; licenses: string[] } {
  const origins = new Set<string>();
  const licenses = new Set<string>();
  for (const m of models) {
    origins.add(m.originCountry);
    licenses.add(m.license);
  }
  return {
    origins: [...origins].sort((a, b) => a.localeCompare(b)),
    licenses: [...licenses].sort((a, b) => a.localeCompare(b)),
  };
}

/** Client-side filter — a `.filter()`, deliberately not a state library. */
export function applyFilters(models: CatalogModel[], filters: CatalogFilters): CatalogModel[] {
  return models.filter(
    (m) =>
      (filters.origin === ANY || m.originCountry === filters.origin) &&
      (filters.license === ANY || m.license === filters.license),
  );
}

interface LocalAIFilterBarProps {
  models: CatalogModel[];
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
  shownCount: number;
}

export default function LocalAIFilterBar({ models, filters, onChange, shownCount }: LocalAIFilterBarProps) {
  const { origins, licenses } = filterOptions(models);
  const filtered = filters.origin !== ANY || filters.license !== ANY;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span id="local-ai-origin-label" className="text-xs text-[var(--color-text-secondary)] font-data">
          Origin
        </span>
        <div className="w-40">
          <HudSelect
            value={filters.origin}
            onChange={(origin) => onChange({ ...filters, origin })}
            ariaLabel="Filter models by country of origin"
            compact
            options={[
              { value: ANY, label: 'Any country' },
              ...origins.map((code) => ({ value: code, label: regionLabel(code) })),
            ]}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-secondary)] font-data">License</span>
        <div className="w-48">
          <HudSelect
            value={filters.license}
            onChange={(license) => onChange({ ...filters, license })}
            ariaLabel="Filter models by license"
            compact
            options={[{ value: ANY, label: 'Any license' }, ...licenses.map((l) => ({ value: l, label: l }))]}
          />
        </div>
      </div>

      <span className="text-xs text-[var(--color-text-muted)] font-data" aria-live="polite">
        {shownCount} of {models.length} models
      </span>

      {filtered && (
        <button
          onClick={() => onChange({ origin: ANY, license: ANY })}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
