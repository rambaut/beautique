/**
 * Taxon sets: named subsets of the taxa, shared by the models and statistics
 * that refer to clades (local clocks, monophyly constraints, tMRCAs).
 */

export interface TaxonSet {
  id: string;
  /** Used as the XML id of the set, so it has no spaces and is unique. */
  name: string;
  /** Taxon keys (see `Taxon.key`). */
  taxa: string[];
  /** Constrain the set to be a clade of the tree. */
  monophyletic?: boolean;
}

/** What a module is told about a taxon set. */
export interface TaxonSetInfo {
  id: string;
  /** The XML id of the set's `<taxa>` element. */
  name: string;
  /** Number of taxa in the set. */
  size: number;
  monophyletic: boolean;
  /** Id of the smallest monophyletic set that contains this monophyletic set, if any. */
  parent: string | null;
}

/** Returns a message when the name cannot be used for a taxon set or timeline, otherwise null. */
export function nameProblem(name: string, others: string[]): string | null {
  if (name.trim() === '') return 'needs a name';
  if (/[\s"'<>&]/.test(name)) return 'has a name with spaces or the characters " \' < > &';
  if (name === 'taxa') return 'cannot be called "taxa"';
  if (others.includes(name)) return 'has the same name as another';
  return null;
}

/** A new, empty taxon set with an unused id and name. */
export function newTaxonSet(existing: TaxonSet[]): TaxonSet {
  let n = 1;
  while (existing.some((s) => s.id === `taxonset-${n}` || s.name === `set${n}`)) n++;
  return { id: `taxonset-${n}`, name: `set${n}`, taxa: [] };
}

export interface Nesting {
  /** For each set: the id of the smallest other set that contains it, or null. */
  parent: Map<string, string | null>;
  /** Pairs of sets that overlap without one containing the other, or that are identical. */
  conflicts: [string, string][];
}

/**
 * Arrange sets that must each be a clade into a hierarchy. Two clades of one
 * tree are either nested or disjoint, so any other overlap is a conflict.
 */
export function nestTaxonSets(sets: { id: string; taxa: string[] }[]): Nesting {
  const members = sets.map((s) => new Set(s.taxa));
  const parent = new Map<string, string | null>();
  const conflicts: [string, string][] = [];
  sets.forEach((set, i) => {
    let best = -1;
    sets.forEach((other, j) => {
      if (i === j) return;
      let shared = 0;
      for (const taxon of members[i]) if (members[j].has(taxon)) shared++;
      if (shared === 0) return;
      const inside = shared === members[i].size;
      const contains = shared === members[j].size;
      if (inside && contains) {
        if (i < j) conflicts.push([set.id, other.id]);
      } else if (inside) {
        if (best === -1 || members[j].size < members[best].size) best = j;
      } else if (!contains && i < j) {
        conflicts.push([set.id, other.id]);
      }
    });
    parent.set(set.id, best === -1 ? null : sets[best].id);
  });
  return { parent, conflicts };
}
