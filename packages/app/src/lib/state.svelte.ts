import {
  alignmentFromFasta,
  bindData,
  detectDateSpec,
  generate,
  type AlignmentData,
  type AnalysisDocument,
  type GenerateResult,
  type Issue,
  type Slot,
} from '@beautique/core';
import { createRegistry, defaultTemplate } from '@beautique/modules';

export const registry = createRegistry();

export type StepId = 'data' | 'dates' | 'substitution' | 'clock' | 'tree' | 'mcmc' | 'generate';

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'data', label: 'Data' },
  { id: 'dates', label: 'Samples and dates' },
  { id: 'substitution', label: 'Substitution' },
  { id: 'clock', label: 'Clock' },
  { id: 'tree', label: 'Tree prior' },
  { id: 'mcmc', label: 'MCMC' },
  { id: 'generate', label: 'Generate' },
];

const SLOT_STEP: Record<Slot, StepId> = {
  substitution: 'substitution',
  siteHeterogeneity: 'substitution',
  clock: 'clock',
  tree: 'tree',
  startingTree: 'tree',
  treePrior: 'tree',
};

class AppState {
  /** The analysis document. Sequence data is kept out of it (see `alignments`). */
  doc = $state<AnalysisDocument>(defaultTemplate());
  /** Sequence data, held outside deep reactive state so large alignments stay cheap. */
  alignments = $state.raw<AlignmentData[]>([]);
  step = $state<StepId>('data');
  importError = $state<string | null>(null);
  private nextAlignment = 1;

  /** The complete document, including sequence data. */
  get document(): AnalysisDocument {
    const snapshot = $state.snapshot(this.doc) as AnalysisDocument;
    snapshot.data.alignments = this.alignments;
    return snapshot;
  }

  /** Live result of generating the current document, with sequences elided. */
  preview: GenerateResult = $derived.by(() => generate(this.document, registry, { elideSequences: true }));

  get labels(): string[] {
    return this.alignments.flatMap((a) => a.sequences.map((s) => s.label));
  }

  async importFiles(files: Iterable<File>): Promise<void> {
    this.importError = null;
    const added: AlignmentData[] = [];
    try {
      for (const file of files) {
        const name = file.name.replace(/\.[^.]+$/, '');
        added.push(alignmentFromFasta(await file.text(), `alignment-${this.nextAlignment++}`, name));
      }
    } catch (e) {
      this.importError = e instanceof Error ? e.message : String(e);
      return;
    }
    if (added.length === 0) return;
    if (this.alignments.length === 0 && this.doc.name === 'analysis') this.doc.name = added[0].name.replace(/\s+/g, '_');
    this.rebind([...this.alignments, ...added]);
  }

  removeAlignment(id: string): void {
    this.rebind(this.alignments.filter((a) => a.id !== id));
  }

  updateAlignment(id: string, patch: Partial<AlignmentData>): void {
    this.alignments = this.alignments.map((a) => (a.id === id ? { ...a, ...patch } : a));
  }

  detectDates(): void {
    this.doc.data.dates = detectDateSpec(this.labels);
  }

  /** Re-attach the alignments: one partition per alignment, all sharing the models. */
  private rebind(alignments: AlignmentData[]): void {
    const doc = $state.snapshot(this.doc) as AnalysisDocument;
    doc.partitions = [{ ...doc.partitions[0], id: 'partition', name: 'partition', alignment: null }];
    if (alignments.length === 0) {
      doc.kind = 'template';
      doc.data.dates = { ...doc.data.dates, mode: 'auto' };
      this.doc = doc;
    } else {
      const bound = bindData(doc, alignments);
      bound.data.alignments = [];
      this.doc = bound;
    }
    this.alignments = alignments;
  }

  /** Ids of the model instances in use for a slot (null for an empty optional slot). */
  instancesFor(slot: Slot): (string | null)[] {
    const ids: (string | null)[] =
      slot === 'substitution' || slot === 'siteHeterogeneity' || slot === 'clock'
        ? this.doc.partitions.map((p) => p[slot])
        : [this.doc.tree[slot]];
    return [...new Set(ids)];
  }

  /** Choose the module for an instance. A null module empties an optional slot. */
  setModule(slot: Slot, instanceId: string | null, moduleId: string | null): void {
    if (instanceId !== null && moduleId !== null) {
      const instance = this.doc.components.find((c) => c.id === instanceId);
      if (instance && instance.module !== moduleId) {
        instance.module = moduleId;
        instance.options = {};
      }
      return;
    }
    if (slot !== 'siteHeterogeneity') return;
    if (moduleId === null) {
      for (const p of this.doc.partitions) if (p.siteHeterogeneity === instanceId) p.siteHeterogeneity = null;
      return;
    }
    let id: string = slot;
    for (let n = 2; this.doc.components.some((c) => c.id === id); n++) id = `${slot}${n}`;
    this.doc.components.push({ id, slot, module: moduleId, name: id, options: {} });
    for (const p of this.doc.partitions) if (p.siteHeterogeneity === null) p.siteHeterogeneity = id;
  }

  /** The step an issue belongs to, for badges in the navigation. */
  stepOf(issue: Issue): StepId {
    if (issue.path?.startsWith('mcmc.') || issue.path === 'name') return 'mcmc';
    const m = /^models\.([^.]+)\./.exec(issue.path ?? '');
    const instance = m && this.doc.components.find((c) => c.id === m[1]);
    if (instance) return SLOT_STEP[instance.slot];
    if (/date/i.test(issue.message)) return 'dates';
    return 'data';
  }

  /** Generate the full XML (with sequences) and offer it as a download. */
  download(): void {
    const result = generate(this.document, registry);
    if (result.xml === undefined) return;
    const url = URL.createObjectURL(new Blob([result.xml], { type: 'application/xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.doc.name || 'analysis'}.xml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  reset(): void {
    this.doc = defaultTemplate();
    this.alignments = [];
    this.step = 'data';
    this.importError = null;
  }
}

export const app = new AppState();
