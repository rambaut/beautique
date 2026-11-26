/**
 * Traits: a value for each taxon, read from the taxon labels or a metadata
 * table, and analysed with a trait model (discrete or continuous
 * phylogeography, for instance).
 */

import { sourceExists, valueReader, type DataSection, type Taxon, type ValueSource } from './data';

export type TraitType = 'discrete' | 'continuous';

export interface Trait {
  id: string;
  /** Used as the XML attribute name and id prefix, so it has no spaces and is unique. */
  name: string;
  type: TraitType;
  /** Where the values come from: one source for a discrete trait, one for each dimension of a continuous one. */
  sources: ValueSource[];
  /** Id of the model instance (slot `trait`) that analyses the trait. */
  model: string | null;
}

/** What a trait model is told about its trait. */
export interface TraitInfo {
  /** The name of the `<attr>` on each taxon that holds the value. */
  name: string;
  type: TraitType;
  /** Number of values per taxon: 1 for a discrete trait. */
  dimension: number;
  /** The states of a discrete trait, in the order of the data type. */
  states: string[];
  /** Number of taxa with no value. */
  missing: number;
}

export interface ResolvedTrait extends TraitInfo {
  id: string;
  /** The value written for each taxon key; taxa with no value are absent. */
  values: Map<string, string>;
  /** How many taxa have each state (discrete traits). */
  counts: Map<string, number>;
  /** The lowest and highest value of each dimension (continuous traits). */
  ranges: { min: number; max: number }[];
  /** Reasons the trait cannot be used. */
  problems: string[];
}

const MISSING = new Set(['', '?', 'NA', 'N/A', 'na', 'NaN', 'unknown', 'Unknown']);

/** Read a trait's values for the taxa and check them. */
export function resolveTrait(trait: Trait, data: DataSection, taxa: Taxon[]): ResolvedTrait {
  const problems: string[] = [];
  const values = new Map<string, string>();
  const counts = new Map<string, number>();
  const ranges: { min: number; max: number }[] = [];
  const read = valueReader(data);

  const sources = trait.sources;
  if (sources.length === 0) problems.push('needs to be told where its values come from');
  else if (sources.some((s) => !sourceExists(data, s))) problems.push('refers to a metadata column that no longer exists');
  else if (trait.type === 'discrete' && sources.length > 1) problems.push('is discrete, so takes its values from one place');

  let missing = 0;
  if (problems.length === 0) {
    const bad: string[] = [];
    for (const taxon of taxa) {
      const raw = sources.map((s) => read(taxon, s) ?? '');
      if (raw.some((v) => MISSING.has(v))) {
        missing++;
        continue;
      }
      if (trait.type === 'discrete') {
        const state = raw[0].replace(/\s+/g, '_');
        values.set(taxon.key, state);
        counts.set(state, (counts.get(state) ?? 0) + 1);
      } else {
        const numbers = raw.map(Number);
        if (numbers.some((n) => !Number.isFinite(n))) {
          bad.push(raw.join(' '));
          continue;
        }
        numbers.forEach((n, i) => {
          ranges[i] = ranges[i] ? { min: Math.min(ranges[i].min, n), max: Math.max(ranges[i].max, n) } : { min: n, max: n };
        });
        values.set(taxon.key, numbers.join(' '));
      }
    }
    if (bad.length > 0) {
      problems.push(
        `has ${bad.length} values that are not numbers (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', ...' : ''})`,
      );
    }
    if (taxa.length > 0 && values.size === 0 && bad.length === 0) problems.push('has no value for any taxon');
  }

  return {
    id: trait.id,
    name: trait.name,
    type: trait.type,
    dimension: trait.type === 'discrete' ? 1 : Math.max(1, sources.length),
    states: [...counts.keys()].sort(),
    missing,
    values,
    counts,
    ranges,
    problems,
  };
}

/** Guess whether the values from a source are numbers (a continuous trait) or categories. */
export function guessTraitType(source: ValueSource, data: DataSection, taxa: Taxon[]): TraitType {
  const read = valueReader(data);
  const present = taxa.map((t) => read(t, source) ?? '').filter((v) => !MISSING.has(v));
  return present.length > 0 && present.every((v) => Number.isFinite(Number(v))) ? 'continuous' : 'discrete';
}
