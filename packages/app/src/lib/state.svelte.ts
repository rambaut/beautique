import {
  alignmentFromText,
  assertDocument,
  attachAlignment,
  detachAlignment,
  detectDateSpec,
  generate,
  schemaRefs,
  type AlignmentData,
  type AnalysisDocument,
  type GenerateResult,
  type Issue,
  type OperatorOverride,
  type ParameterOverride,
  type SchemaRefs,
  type TaxonSet,
  type Timeline,
  type Slot,
} from '@beautique/core';
import { createRegistry, defaultTemplate } from '@beautique/modules';

export const registry = createRegistry();

export type StepId =
  | 'data'
  | 'dates'
  | 'taxonSets'
  | 'timelines'
  | 'partitions'
  | 'substitution'
  | 'clock'
  | 'tree'
  | 'priors'
  | 'operators'
  | 'mcmc'
  | 'generate';

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'data', label: 'Data' },
  { id: 'dates', label: 'Samples and dates' },
  { id: 'taxonSets', label: 'Taxon sets' },
  { id: 'timelines', label: 'Timelines' },
  { id: 'partitions', label: 'Partitions' },
  { id: 'substitution', label: 'Substitution' },
  { id: 'clock', label: 'Clock' },
  { id: 'tree', label: 'Tree prior' },
  { id: 'priors', label: 'Priors' },
  { id: 'operators', label: 'Operators' },
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

function download(content: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

class AppState {
  /** The analysis document. Sequence data is kept out of it (see `alignments`). */
  doc = $state<AnalysisDocument>(defaultTemplate());
  /** Sequence data, held outside deep reactive state so large alignments stay cheap. */
  alignments = $state.raw<AlignmentData[]>([]);
  step = $state<StepId>('data');
  importError = $state<string | null>(null);

  /** The complete document, including sequence data. */
  get document(): AnalysisDocument {
    const snapshot = $state.snapshot(this.doc) as AnalysisDocument;
    snapshot.data.alignments = this.alignments;
    return snapshot;
  }

  /** Live result of generating the current document, with sequences elided. */
  preview: GenerateResult = $derived.by(() => generate(this.document, registry, { elideSequences: true }));

  /** The taxon sets of the document (made on first use for documents saved without any). */
  get taxonSets(): TaxonSet[] {
    return (this.doc.taxonSets ??= []);
  }

  get timelines(): Timeline[] {
    return (this.doc.timelines ??= []);
  }

  /** What reference fields can point to. */
  get refs(): SchemaRefs {
    return schemaRefs(this.doc);
  }

  /** The date of the most recent sample in decimal years, when every tip is dated. */
  get mostRecent(): number | undefined {
    const taxa = this.preview.taxa;
    if (taxa.length === 0 || taxa.some((t) => t.date === undefined)) return undefined;
    return Math.max(...taxa.map((t) => t.date as number));
  }

  get labels(): string[] {
    return this.alignments.flatMap((a) => a.sequences.map((s) => s.label));
  }

  get fileStem(): string {
    return this.doc.name || 'analysis';
  }

  private newAlignmentId(): string {
    for (let n = 1; ; n++) {
      const id = `alignment-${n}`;
      if (!this.alignments.some((a) => a.id === id)) return id;
    }
  }

  /** Import FASTA or NEXUS alignments, or open a project or template (JSON). */
  async importFiles(files: Iterable<File>): Promise<void> {
    this.importError = null;
    try {
      for (const file of files) {
        const content = await file.text();
        if (/^\s*\{/.test(content)) {
          this.open(content);
          continue;
        }
        const name = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
        const alignment = alignmentFromText(content, this.newAlignmentId(), name);
        if (this.alignments.length === 0 && this.doc.name === 'analysis') this.doc.name = name;
        attachAlignment(this.doc, alignment);
        this.alignments = [...this.alignments, alignment];
        this.doc.kind = 'project';
        if (this.doc.data.dates.mode === 'auto') this.detectDates();
      }
    } catch (e) {
      this.importError = e instanceof Error ? e.message : String(e);
    }
  }

  removeAlignment(id: string): void {
    detachAlignment(this.doc, id);
    this.alignments = this.alignments.filter((a) => a.id !== id);
    if (this.alignments.length === 0) {
      this.doc.kind = 'template';
      this.doc.data.dates = { ...this.doc.data.dates, mode: 'auto' };
    }
  }

  updateAlignment(id: string, patch: Partial<AlignmentData>): void {
    this.alignments = this.alignments.map((a) => (a.id === id ? { ...a, ...patch } : a));
  }

  detectDates(): void {
    this.doc.data.dates = detectDateSpec(this.labels);
  }

  /** Replace the current analysis with a saved project or template. */
  open(json: string): void {
    const parsed: unknown = JSON.parse(json);
    assertDocument(parsed);
    this.alignments = parsed.data.alignments;
    this.doc = {
      ...parsed,
      taxonSets: parsed.taxonSets ?? [],
      timelines: parsed.timelines ?? [],
      data: { ...parsed.data, alignments: [] },
    };
    this.step = 'data';
  }

  /** Save the whole analysis, including the sequence data, as a project file. */
  saveProject(): void {
    download(JSON.stringify(this.document, null, 1), `${this.fileStem}.beautique.json`, 'application/json');
  }

  /** Generate the full XML (with sequences) and offer it as a download. */
  downloadXml(): void {
    const result = generate(this.document, registry);
    if (result.xml !== undefined) download(result.xml, `${this.fileStem}.xml`, 'application/xml');
  }

  /** Change a parameter's override; removes the entry when nothing is overridden. */
  overrideParameter(key: string, patch: ParameterOverride): void {
    const next = { ...this.doc.parameters[key], ...patch };
    if (next.value === undefined) delete next.value;
    if (next.prior === undefined) delete next.prior;
    if (Object.keys(next).length === 0) delete this.doc.parameters[key];
    else this.doc.parameters[key] = next;
  }

  overrideOperator(key: string, patch: OperatorOverride): void {
    const next = { ...this.doc.operators[key], ...patch };
    for (const k of Object.keys(next) as (keyof OperatorOverride)[]) {
      if (next[k] === undefined || next[k] === false) delete next[k];
    }
    if (Object.keys(next).length === 0) delete this.doc.operators[key];
    else this.doc.operators[key] = next;
  }

  /** The step an issue belongs to, for badges in the navigation. */
  stepOf(issue: Issue): StepId {
    const path = issue.path ?? '';
    if (path.startsWith('mcmc.') || path === 'name') return 'mcmc';
    if (path.startsWith('parameters.')) return 'priors';
    if (path.startsWith('operators.')) return 'operators';
    if (path === 'taxonSets' || path === 'timelines') return path;
    const m = /^models\.([^.]+)\./.exec(path);
    const instance = m && this.doc.components.find((c) => c.id === m[1]);
    if (instance) return SLOT_STEP[instance.slot];
    if (/date/i.test(issue.message)) return 'dates';
    if (/partition/i.test(issue.message)) return 'partitions';
    return 'data';
  }

  reset(): void {
    this.doc = defaultTemplate();
    this.alignments = [];
    this.step = 'data';
    this.importError = null;
  }
}

export const app = new AppState();
