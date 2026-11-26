import {
  alignmentFromText,
  assertDocument,
  attachAlignment,
  detachAlignment,
  detectDateSpec,
  generate,
  looksLikeTable,
  makeTemplate,
  ModuleRegistry,
  modulesFromExports,
  parseTable,
  schemaRefs,
  settingField,
  type AlignmentData,
  type MetadataTable,
  type AnalysisDocument,
  type GenerateResult,
  type Issue,
  type OperatorOverride,
  type ParameterOverride,
  type SchemaRefs,
  type TaxonSet,
  type Timeline,
  type Trait,
  type ModuleDefinition,
  type Slot,
} from '@beautique/core';
import { builtinModules, defaultTemplate } from '@beautique/modules';

/** A registry that the interface follows: what is drawn from it is redrawn when a module is added. */
class ReactiveRegistry extends ModuleRegistry {
  private version = $state(0);

  override register(module: ModuleDefinition): void {
    super.register(module);
    this.version++;
  }

  override get(id: string): ModuleDefinition | undefined {
    void this.version;
    return super.get(id);
  }

  override all(): ModuleDefinition[] {
    void this.version;
    return super.all();
  }
}

export const registry: ModuleRegistry = new ReactiveRegistry();
for (const module of builtinModules) registry.register(module);

export type StepId =
  | 'start'
  | 'data'
  | 'settings'
  | 'dates'
  | 'taxonSets'
  | 'timelines'
  | 'traits'
  | 'partitions'
  | 'substitution'
  | 'clock'
  | 'tree'
  | 'priors'
  | 'operators'
  | 'mcmc'
  | 'generate'
  | 'saveTemplate';

/**
 * The steps, in order. With a template in use only the `guided` ones are
 * shown, and `settings` (what the template asks for) stands in for the rest.
 */
export const STEPS: { id: StepId; label: string; guided?: 'also' | 'only' }[] = [
  { id: 'start', label: 'Template', guided: 'also' },
  { id: 'data', label: 'Data', guided: 'also' },
  { id: 'settings', label: 'Settings', guided: 'only' },
  { id: 'dates', label: 'Samples and dates' },
  { id: 'taxonSets', label: 'Taxon sets' },
  { id: 'timelines', label: 'Timelines' },
  { id: 'traits', label: 'Traits' },
  { id: 'partitions', label: 'Partitions' },
  { id: 'substitution', label: 'Substitution' },
  { id: 'clock', label: 'Clock' },
  { id: 'tree', label: 'Tree prior' },
  { id: 'priors', label: 'Priors' },
  { id: 'operators', label: 'Operators' },
  { id: 'mcmc', label: 'MCMC' },
  { id: 'generate', label: 'Generate', guided: 'also' },
  { id: 'saveTemplate', label: 'Save as template' },
];

/** A module file the user has loaded. */
export interface LoadedModuleFile {
  file: string;
  modules: { id: string; label: string; slot: Slot }[];
}

function emptyLists(doc: AnalysisDocument): AnalysisDocument {
  return {
    ...doc,
    taxonSets: doc.taxonSets ?? [],
    timelines: doc.timelines ?? [],
    traits: doc.traits ?? [],
    template: { description: doc.template?.description ?? '', ask: doc.template?.ask ?? [] },
    data: { ...doc.data, alignments: [], tables: [] },
  };
}

const SLOT_STEP: Record<Slot, StepId> = {
  substitution: 'substitution',
  siteHeterogeneity: 'substitution',
  clock: 'clock',
  tree: 'tree',
  startingTree: 'tree',
  treePrior: 'tree',
  trait: 'traits',
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
  /** Metadata tables, held outside deep reactive state like the sequence data. */
  tables = $state.raw<MetadataTable[]>([]);
  private current = $state<StepId>('start');
  /** True while a template is in use and only the settings it asks for are shown. */
  guided = $state(false);
  /** The title of the built-in template in use, if the analysis started from one. */
  templateTitle = $state<string | null>(null);
  importError = $state<string | null>(null);
  moduleFiles = $state<LoadedModuleFile[]>([]);
  moduleError = $state<string | null>(null);

  get step(): StepId {
    return this.current;
  }

  /** Going to a step that the guided view leaves out shows all the steps. */
  set step(step: StepId) {
    const info = STEPS.find((s) => s.id === step);
    if (this.guided ? !info?.guided : info?.guided === 'only') this.guided = !this.guided;
    this.current = step;
  }

  /** Leave the guided view: show every step, with the settings the template fixed. */
  showAllSteps(): void {
    this.guided = false;
    if (this.current === 'settings') this.current = 'data';
  }

  /** The steps in the navigation. */
  get steps(): typeof STEPS {
    return STEPS.filter((s) => (this.guided ? s.guided : s.guided !== 'only'));
  }

  /** What the document's template says of itself (every document in the app has this). */
  get template(): { description?: string; ask: string[] } {
    return this.doc.template ?? { ask: [] };
  }

  /** The complete document, including sequence data. */
  get document(): AnalysisDocument {
    const snapshot = $state.snapshot(this.doc) as AnalysisDocument;
    snapshot.data.alignments = this.alignments;
    snapshot.data.tables = this.tables;
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

  get traits(): Trait[] {
    return (this.doc.traits ??= []);
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

  /** Import FASTA or NEXUS alignments or metadata tables (CSV, TSV), or open a project or template (JSON). */
  async importFiles(files: Iterable<File>): Promise<void> {
    this.importError = null;
    // Copied first: a file input's list is emptied when the input is reset, before the files are read.
    const list = [...files];
    try {
      for (const file of list) {
        if (/\.m?js$/i.test(file.name)) throw new Error(`${file.name} looks like a module: load modules in the Template step`);
        const content = await file.text();
        if (/^\s*\{/.test(content)) {
          this.open(content);
          continue;
        }
        const name = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
        if (/\.(csv|tsv|tab)$/i.test(file.name) || looksLikeTable(content)) {
          let n = 1;
          while (this.tables.some((t) => t.id === `table-${n}`)) n++;
          this.tables = [...this.tables, parseTable(content, `table-${n}`, name)];
          continue;
        }
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

  removeTable(id: string): void {
    this.tables = this.tables.filter((t) => t.id !== id);
    if (this.doc.data.dates.mode === 'column' && this.doc.data.dates.table === id) this.detectDates();
  }

  updateTable(id: string, patch: Partial<MetadataTable>): void {
    this.tables = this.tables.map((t) => (t.id === id ? { ...t, ...patch } : t));
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
    if (parsed.kind === 'template' && parsed.data.alignments.length === 0) {
      this.useTemplate(parsed, null);
      return;
    }
    this.alignments = parsed.data.alignments;
    this.tables = parsed.data.tables ?? [];
    this.doc = emptyLists(parsed);
    this.templateTitle = null;
    this.guided = false;
    this.step = 'data';
  }

  /**
   * Start again from a template, keeping the data that is loaded. With
   * `guided`, only the settings the template asks for are shown.
   */
  useTemplate(template: AnalysisDocument, title: string | null, guided = true): void {
    const doc = emptyLists(structuredClone(template));
    for (const alignment of this.alignments) attachAlignment(doc, alignment);
    if (this.alignments.length > 0) {
      doc.kind = 'project';
      if (doc.name === 'analysis') doc.name = this.doc.name;
    }
    this.doc = doc;
    if (this.alignments.length > 0 && doc.data.dates.mode === 'auto') this.detectDates();
    this.templateTitle = title;
    this.guided = guided;
    this.current = 'data';
  }

  /** Save the design without the data, as a template that asks for the settings listed in it. */
  saveTemplate(): void {
    const doc = $state.snapshot(this.doc) as AnalysisDocument;
    // settings that were ticked and have since gone (their model was changed) are not asked for
    const ask = this.template.ask.filter((path) => settingField(doc, registry, path) !== undefined);
    const template = makeTemplate(doc, { ask });
    download(`${JSON.stringify(template, null, 1)}\n`, `${this.fileStem}.template.json`, 'application/json');
  }

  /**
   * Load module files (JavaScript ES modules) and add their modules to the
   * registry. This runs the code in the files, so it is only done when the
   * user picks them for that purpose.
   */
  async loadModules(files: Iterable<File>): Promise<void> {
    this.moduleError = null;
    for (const file of [...files]) {
      const url = URL.createObjectURL(new Blob([await file.text()], { type: 'text/javascript' }));
      try {
        const modules = modulesFromExports(await import(/* @vite-ignore */ url));
        for (const module of modules) registry.register(module);
        this.moduleFiles.push({ file: file.name, modules: modules.map(({ id, label, slot }) => ({ id, label, slot })) });
      } catch (e) {
        this.moduleError = `${file.name}: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
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
    if (this.guided && this.template.ask.includes(path)) return 'settings';
    if (path.startsWith('mcmc.') || path === 'name') return 'mcmc';
    if (path.startsWith('parameters.')) return 'priors';
    if (path.startsWith('operators.')) return 'operators';
    if (path === 'taxonSets' || path === 'timelines' || path === 'traits') return path;
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
    this.tables = [];
    this.templateTitle = null;
    this.guided = false;
    this.current = 'start';
    this.importError = null;
  }
}

export const app = new AppState();
