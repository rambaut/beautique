/**
 * Editing the partition structure of a document: attaching alignments,
 * splitting by codon position, and linking or unlinking models between
 * partitions. All functions change the document in place.
 */

import type { CharSet, SiteRange } from './data';
import type { AnalysisDocument, ModelInstance, Partition } from './document';
import type { Slot } from './module-api';

export type CodonScheme = 'none' | '12+3' | '1+2+3';

/** What these functions need to know about an alignment (not its sequences). */
export interface AlignmentInfo {
  id: string;
  name: string;
  charsets?: CharSet[];
}

const CODON_CLASSES: Record<Exclude<CodonScheme, 'none'>, { label: string; ranges: SiteRange[] }[]> = {
  '12+3': [
    { label: 'CP1+2', ranges: [{ from: 1, every: 3 }, { from: 2, every: 3 }] },
    { label: 'CP3', ranges: [{ from: 3, every: 3 }] },
  ],
  '1+2+3': [
    { label: 'CP1', ranges: [{ from: 1, every: 3 }] },
    { label: 'CP2', ranges: [{ from: 2, every: 3 }] },
    { label: 'CP3', ranges: [{ from: 3, every: 3 }] },
  ],
};

export function usedInstanceIds(doc: AnalysisDocument): Set<string> {
  const ids = new Set<string>([doc.tree.tree, doc.tree.startingTree, doc.tree.treePrior]);
  for (const p of doc.partitions) {
    ids.add(p.substitution);
    ids.add(p.clock);
    if (p.siteHeterogeneity !== null) ids.add(p.siteHeterogeneity);
  }
  return ids;
}

function pruneUnused(doc: AnalysisDocument): void {
  const used = usedInstanceIds(doc);
  for (let i = doc.components.length - 1; i >= 0; i--) {
    if (!used.has(doc.components[i].id)) doc.components.splice(i, 1);
  }
}

function newInstanceId(doc: AnalysisDocument, slot: Slot): string {
  for (let n = 2; ; n++) {
    const id = `${slot}-${n}`;
    if (!doc.components.some((c) => c.id === id)) return id;
  }
}

function cloneInstance(doc: AnalysisDocument, id: string): string {
  const source = doc.components.find((c) => c.id === id);
  if (!source) throw new Error(`Model "${id}" is not defined`);
  const copy: ModelInstance = { ...source, id: newInstanceId(doc, source.slot), options: { ...source.options } };
  doc.components.push(copy);
  return copy.id;
}

function uniquePartitionId(doc: AnalysisDocument, wanted: string): string {
  let id = wanted;
  for (let n = 2; doc.partitions.some((p) => p.id === id); n++) id = `${wanted}-${n}`;
  return id;
}

/**
 * Name each partition-level model after the partitions that use it. The name
 * becomes the XML id prefix when there is more than one model of a kind.
 */
function syncInstanceNames(doc: AnalysisDocument): void {
  for (const slot of ['substitution', 'siteHeterogeneity', 'clock'] as const) {
    for (const instance of doc.components.filter((c) => c.slot === slot)) {
      const names = doc.partitions.filter((p) => p[slot] === instance.id).map((p) => p.name);
      if (names.length === 0 || names.some((n) => n === '')) continue;
      instance.name = names.length <= 2 ? names.join('+') : `${names[0]}+${names.length - 1}`;
    }
  }
}

function finish(doc: AnalysisDocument): void {
  pruneUnused(doc);
  syncInstanceNames(doc);
}

/**
 * Add partitions for an alignment. An unbound partition (from a template) is
 * used if there is one; otherwise the new partitions share the models of the
 * first partition. An alignment with charsets gets one partition per charset.
 */
export function attachAlignment(doc: AnalysisDocument, alignment: AlignmentInfo): void {
  const unbound = doc.partitions.find((p) => p.alignment === null);
  const model = unbound ?? doc.partitions[0];
  if (!model) throw new Error('The document has no partition to take models from');
  const index = unbound ? doc.partitions.indexOf(unbound) : doc.partitions.length;
  if (unbound) doc.partitions.splice(index, 1);

  const links = { substitution: model.substitution, siteHeterogeneity: model.siteHeterogeneity, clock: model.clock };
  const added: Partition[] = [];
  if (alignment.charsets && alignment.charsets.length > 0) {
    for (const charset of alignment.charsets) {
      added.push({
        id: uniquePartitionId(doc, `${alignment.id}:${charset.name}`),
        name: charset.name,
        alignment: alignment.id,
        sites: charset.ranges.map((r) => ({ ...r })),
        ...links,
      });
    }
  } else {
    added.push({
      id: uniquePartitionId(doc, alignment.id),
      name: unbound && unbound.name !== '' ? unbound.name : alignment.name,
      alignment: alignment.id,
      ...(unbound?.sites ? { sites: unbound.sites } : {}),
      ...links,
    });
  }
  doc.partitions.splice(index, 0, ...added);
  finish(doc);
}

/** Remove an alignment's partitions. The last partition is kept, unbound, to hold the models. */
export function detachAlignment(doc: AnalysisDocument, alignmentId: string): void {
  const removed = doc.partitions.filter((p) => p.alignment === alignmentId);
  if (removed.length === 0) return;
  doc.partitions = doc.partitions.filter((p) => p.alignment !== alignmentId);
  if (doc.partitions.length === 0) {
    const { substitution, siteHeterogeneity, clock } = removed[0];
    doc.partitions.push({ id: 'partition', name: '', alignment: null, substitution, siteHeterogeneity, clock });
  }
  finish(doc);
}

function sameRanges(a: SiteRange[] | undefined, b: SiteRange[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

/** How an alignment is currently split by codon position ('custom' for any other split). */
export function codonSchemeOf(doc: AnalysisDocument, alignmentId: string): CodonScheme | 'custom' {
  const partitions = doc.partitions.filter((p) => p.alignment === alignmentId);
  if (partitions.length === 1 && !partitions[0].sites) return 'none';
  for (const [scheme, classes] of Object.entries(CODON_CLASSES)) {
    if (classes.length === partitions.length && classes.every((c, i) => sameRanges(partitions[i].sites, c.ranges))) {
      return scheme as CodonScheme;
    }
  }
  return 'custom';
}

/**
 * Split an alignment by codon position, or undo the split. Each codon class
 * gets its own copy of the substitution and rate heterogeneity models; they
 * keep sharing the clock.
 */
export function setCodonScheme(doc: AnalysisDocument, alignment: AlignmentInfo, scheme: CodonScheme): void {
  const existing = doc.partitions.filter((p) => p.alignment === alignment.id);
  if (existing.length === 0) return;
  const base = existing[0];
  const index = doc.partitions.indexOf(base);
  doc.partitions = doc.partitions.filter((p) => p.alignment !== alignment.id);
  const sole = doc.partitions.length === 0;

  const replacement: Partition[] = [];
  if (scheme === 'none') {
    replacement.push({
      id: uniquePartitionId(doc, alignment.id),
      name: alignment.name,
      alignment: alignment.id,
      substitution: base.substitution,
      siteHeterogeneity: base.siteHeterogeneity,
      clock: base.clock,
    });
  } else {
    CODON_CLASSES[scheme].forEach((codonClass, i) => {
      replacement.push({
        id: uniquePartitionId(doc, `${alignment.id}:${codonClass.label}`),
        name: sole ? codonClass.label : `${alignment.name}.${codonClass.label}`,
        alignment: alignment.id,
        sites: codonClass.ranges.map((r) => ({ ...r })),
        substitution: i === 0 ? base.substitution : cloneInstance(doc, base.substitution),
        siteHeterogeneity:
          i === 0 || base.siteHeterogeneity === null ? base.siteHeterogeneity : cloneInstance(doc, base.siteHeterogeneity),
        clock: base.clock,
      });
      doc.partitions.splice(index + i, 0, replacement[i]);
    });
  }
  if (scheme === 'none') doc.partitions.splice(index, 0, ...replacement);
  finish(doc);
}

/** Make a partition share another partition's substitution model (with its rate heterogeneity) or clock. */
export function linkPartition(
  doc: AnalysisDocument,
  partitionId: string,
  slot: 'substitution' | 'clock',
  instanceId: string,
): void {
  const partition = doc.partitions.find((p) => p.id === partitionId);
  if (!partition || partition[slot] === instanceId) return;
  const other = doc.partitions.find((p) => p !== partition && p[slot] === instanceId);
  if (!other) throw new Error(`No partition uses the model "${instanceId}"`);
  partition[slot] = instanceId;
  if (slot === 'substitution') partition.siteHeterogeneity = other.siteHeterogeneity;
  finish(doc);
}

/** Give a partition its own copy of a model it currently shares with other partitions. */
export function unlinkPartition(doc: AnalysisDocument, partitionId: string, slot: 'substitution' | 'clock'): void {
  const partition = doc.partitions.find((p) => p.id === partitionId);
  if (!partition || !doc.partitions.some((p) => p !== partition && p[slot] === partition[slot])) return;
  partition[slot] = cloneInstance(doc, partition[slot]);
  if (slot === 'substitution' && partition.siteHeterogeneity !== null) {
    partition.siteHeterogeneity = cloneInstance(doc, partition.siteHeterogeneity);
  }
  finish(doc);
}

/** Change the module of a model instance, resetting its options. */
export function setInstanceModule(doc: AnalysisDocument, instanceId: string, moduleId: string): void {
  const instance = doc.components.find((c) => c.id === instanceId);
  if (instance && instance.module !== moduleId) {
    instance.module = moduleId;
    instance.options = {};
  }
}

/** Choose (or, with null, remove) the rate heterogeneity model that goes with a substitution model. */
export function setSiteHeterogeneity(doc: AnalysisDocument, substitutionId: string, moduleId: string | null): void {
  const partitions = doc.partitions.filter((p) => p.substitution === substitutionId);
  if (partitions.length === 0) return;
  const current = partitions[0].siteHeterogeneity;
  if (moduleId === null) {
    for (const p of partitions) p.siteHeterogeneity = null;
  } else if (current !== null) {
    setInstanceModule(doc, current, moduleId);
  } else {
    const id = newInstanceId(doc, 'siteHeterogeneity');
    doc.components.push({ id, slot: 'siteHeterogeneity', module: moduleId, name: id, options: {} });
    for (const p of partitions) p.siteHeterogeneity = id;
  }
  finish(doc);
}
