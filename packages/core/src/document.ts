/**
 * The analysis document: one versioned JSON format for projects and templates.
 * A template is a document without data, plus a list of the settings that
 * should be asked for when it is applied.
 */

import { detectDateSpec, type AlignmentData, type DataSection } from './data';
import type { PriorSpec, Slot } from './module-api';
import type { OptionsSchema, OptionValues } from './schema';

export const DOCUMENT_FORMAT = 'beautique';
export const DOCUMENT_FORMAT_VERSION = 1;

/** A configured use of a module. Partitions and the tree refer to instances by id. */
export interface ModelInstance {
  id: string;
  slot: Slot;
  /** Module id. */
  module: string;
  /** Display name; also the XML id prefix when several instances share a slot. */
  name: string;
  /** Explicitly set options. Options not present take the module's default. */
  options: OptionValues;
}

export interface Partition {
  id: string;
  name: string;
  /** Id of the alignment, or null in a template that is not yet bound to data. */
  alignment: string | null;
  substitution: string;
  /** Optional: null means no among-site rate heterogeneity. */
  siteHeterogeneity: string | null;
  clock: string;
}

export interface TreeSpec {
  tree: string;
  startingTree: string;
  treePrior: string;
}

export interface ParameterOverride {
  value?: number | number[];
  prior?: PriorSpec;
}

export interface OperatorOverride {
  weight?: number;
  tuning?: number;
  disabled?: boolean;
}

export interface McmcSettings {
  chainLength: number;
  logEvery: number;
  screenLogEvery: number;
  operatorStrategy: 'standard' | 'hmc';
}

export interface TemplateInfo {
  description?: string;
  /**
   * Paths of the settings to ask for when the template is applied. Settings
   * with a value in the document and not listed here are fixed; settings with
   * no value take the module default.
   */
  ask: string[];
}

export interface AnalysisDocument {
  format: typeof DOCUMENT_FORMAT;
  formatVersion: number;
  kind: 'project' | 'template';
  /** Analysis name; used as the stem of output file names. */
  name: string;
  data: DataSection;
  partitions: Partition[];
  tree: TreeSpec;
  components: ModelInstance[];
  /** Overrides keyed by XML parameter id. */
  parameters: Record<string, ParameterOverride>;
  /** Overrides keyed by operator key (instance prefix + local key). */
  operators: Record<string, OperatorOverride>;
  mcmc: Partial<McmcSettings>;
  template?: TemplateInfo;
}

export const mcmcSchema: OptionsSchema = {
  chainLength: {
    type: 'integer',
    label: 'Chain length',
    help: 'Number of MCMC states to run.',
    default: 10_000_000,
    min: 1,
    units: 'states',
  },
  logEvery: {
    type: 'integer',
    label: 'Log parameters and trees every',
    default: 1000,
    min: 1,
    units: 'states',
  },
  screenLogEvery: {
    type: 'integer',
    label: 'Echo to screen every',
    default: 1000,
    min: 1,
    units: 'states',
  },
  operatorStrategy: {
    type: 'choice',
    label: 'Operators',
    help: 'Gradient-based (HMC) operators are used only by models that provide them.',
    default: 'standard',
    choices: [
      { value: 'standard', label: 'Standard' },
      { value: 'hmc', label: 'HMC where available' },
    ],
  },
};

export function findInstance(doc: AnalysisDocument, id: string | null): ModelInstance | undefined {
  return id === null ? undefined : doc.components.find((c) => c.id === id);
}

/** Check that a parsed JSON value looks like a document this version can read. */
export function assertDocument(value: unknown): asserts value is AnalysisDocument {
  const doc = value as Partial<AnalysisDocument> | null;
  if (!doc || typeof doc !== 'object' || doc.format !== DOCUMENT_FORMAT) {
    throw new Error('Not a BEAUtique document');
  }
  if (typeof doc.formatVersion !== 'number' || doc.formatVersion > DOCUMENT_FORMAT_VERSION) {
    throw new Error(
      `Document format version ${doc.formatVersion} is newer than this version of BEAUtique supports (${DOCUMENT_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(doc.partitions) || !Array.isArray(doc.components) || !doc.tree || !doc.data) {
    throw new Error('BEAUtique document is missing required sections');
  }
}

/**
 * Attach alignments to a document. Unbound partitions are bound to the
 * alignments in order. A single unbound partition is repeated for every
 * alignment, so the alignments share its models. Dates set to `auto` are
 * detected from the taxon labels. Returns a new document.
 */
export function bindData(doc: AnalysisDocument, alignments: AlignmentData[]): AnalysisDocument {
  const bound: AnalysisDocument = structuredClone({ ...doc, data: { ...doc.data, alignments: [] } });
  bound.data.alignments = alignments;
  bound.kind = 'project';

  const unbound = bound.partitions.filter((p) => p.alignment === null);
  if (unbound.length === 1 && alignments.length > 1) {
    const prototype = unbound[0];
    const index = bound.partitions.indexOf(prototype);
    const copies = alignments.map((a, i) => ({
      ...prototype,
      id: `${prototype.id}-${i + 1}`,
      name: a.name,
      alignment: a.id,
    }));
    bound.partitions.splice(index, 1, ...copies);
  } else if (unbound.length === alignments.length) {
    unbound.forEach((p, i) => {
      p.alignment = alignments[i].id;
    });
  } else {
    throw new Error(
      `The template expects ${unbound.length} alignment(s) but ${alignments.length} were provided`,
    );
  }

  if (bound.data.dates.mode === 'auto') {
    bound.data.dates = detectDateSpec(alignments.flatMap((a) => a.sequences.map((s) => s.label)));
  }
  return bound;
}
