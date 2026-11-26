/**
 * The module API. A module is a plain object (see `defineModule`) that
 * describes one model or feature: its options, the parameters it introduces
 * with their default priors, the operators on them, and the XML it contributes.
 *
 * A module receives everything it needs through its context, so a module built
 * outside this repository needs no imports and can be loaded at runtime.
 */

import type { OptionsSchema, OptionValues } from './schema';
import type { TaxonSetInfo } from './taxonsets';
import type { ResolvedTimeline } from './timeline';
import type { TraitInfo, TraitType } from './traits';
import type { AttrValue, XmlChild, XmlComment, XmlElement, XmlNode } from './xml';

export const MODULE_API_VERSION = 1;

/** Where a module plugs in. Each slot has a scope: partition, tree or global. */
export const SLOTS = [
  'substitution',
  'siteHeterogeneity',
  'clock',
  'tree',
  'startingTree',
  'treePrior',
  'trait',
] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABELS: Record<Slot, string> = {
  substitution: 'Substitution model',
  siteHeterogeneity: 'Among-site rate heterogeneity',
  clock: 'Molecular clock',
  tree: 'Tree',
  startingTree: 'Starting tree',
  treePrior: 'Tree prior',
  trait: 'Trait model',
};

/**
 * Named places in the XML that modules contribute to. The first group are
 * top-level blocks, listed in output order; the second group are nested inside
 * blocks that the pipeline builds.
 */
export const TOP_LEVEL_SECTIONS = [
  /** Data types and patterns for trait data. */
  'dataType',
  'treePriorModel',
  'startingTree',
  'treeModel',
  'treeStatistics',
  'treePrior',
  'clock',
  'substitutionModel',
] as const;

/** Top-level blocks written after the tree likelihoods of the sequence data (trait models and their likelihoods). */
export const LATE_SECTIONS = ['traitModel'] as const;

export const NESTED_SECTIONS = [
  /** Children of the `<siteModel>` this module belongs to (site heterogeneity modules). */
  'siteModel',
  /** Extra entries in `<prior>`, after the parameter priors (e.g. a coalescent likelihood). */
  'prior',
  /** Extra entries in `<likelihood>`. */
  'likelihood',
  /** `<column>` elements for the screen log. */
  'screenLog',
  /** Entries in the file log, written after this module's parameters. */
  'fileLog',
  /** Likelihood entries written at the end of the file log. */
  'fileLogLikelihoods',
  /** Entries in the tree log. */
  'treeLog',
] as const;

export type Section =
  | (typeof TOP_LEVEL_SECTIONS)[number]
  | (typeof LATE_SECTIONS)[number]
  | (typeof NESTED_SECTIONS)[number];
/** What `generate` returns: for each section, the nodes to add. Nested arrays are flattened and falsy values dropped. */
export type Contributions = Partial<Record<Section, XmlChild[]>>;

export type PriorSpec =
  | { type: 'logNormal'; mu: number; sigma: number; offset?: number }
  | { type: 'normal'; mean: number; stdev: number }
  | { type: 'gamma'; shape: number; scale: number; offset?: number }
  | { type: 'exponential'; mean: number; offset?: number }
  | { type: 'laplace'; mean: number; scale: number }
  | { type: 'uniform'; lower: number; upper: number }
  | { type: 'dirichlet'; alpha: number; sumsTo: number }
  /** The CTMC rate reference prior (Ferreira & Suchard 2008), conditioned on the tree. */
  | { type: 'ctmcScale' }
  | { type: 'oneOnX' };

export interface ParameterDecl {
  /** Local name; the pipeline adds the instance prefix to form the XML id. */
  name: string;
  description?: string;
  /** Initial value. Omit for parameters whose values come from elsewhere (e.g. node heights). */
  value?: number | number[];
  dimension?: number;
  lower?: number;
  upper?: number;
  /** Default prior. Omit for parameters that have none (fixed values, tree heights). */
  prior?: PriorSpec;
  /** Write to the file log (default true). */
  log?: boolean;
  /** Show as a column in the screen log (default false). */
  screen?: boolean;
}

export interface OperatorDecl {
  /** Local key, unique within the module; used for user overrides of weight and tuning. */
  key: string;
  label?: string;
  /** XML element name of the operator. */
  element: string;
  weight: number;
  /** The auto-optimised tuning attribute, if the operator has one. */
  tuning?: { name: string; value: number };
  attrs?: Record<string, AttrValue>;
  /** The operator's child elements. Nested arrays are flattened and falsy values dropped. */
  children: XmlChild[];
}

export interface Issue {
  severity: 'error' | 'warning';
  message: string;
  /** Setting path the issue relates to, when there is one. */
  path?: string;
}

export interface DataSummary {
  /** Number of taxa. */
  ntax: number;
  /** True when every tip has a sampling date. */
  hasDates: boolean;
  /** Range of tip dates in decimal years, when dated. */
  dateRange?: { min: number; max: number };
}

export interface ModuleContext {
  apiVersion: number;
  /** This module's options with defaults filled in. */
  options: OptionValues;
  /** Display name of this instance. */
  instanceName: string;
  /** Id prefix for this instance: empty when it is the only one in its slot. */
  prefix: string;
  data: DataSummary;
  /**
   * For a module in the `trait` slot: the trait it analyses. Each taxon carries
   * the value as `<attr name=trait.name>`, and `prefix` is the trait's name and a dot.
   */
  trait?: TraitInfo;
  /** The taxon sets of the analysis. Each is written as `<taxa id=name>` before any module's XML. */
  taxonSets: TaxonSetInfo[];
  /** The taxon set an option of type `taxonSetRef` refers to. Throws if there is none with that id. */
  taxonSet(id: unknown): TaxonSetInfo;
  /**
   * The timeline an option of type `timelineRef` refers to, with its transition
   * times worked out. Throws if there is none with that id or it is not valid.
   */
  timeline(id: unknown): ResolvedTimeline;
  operatorStrategy: 'standard' | 'hmc';
  /** The setting path of one of this module's options, for use in `Issue.path`. */
  optionPath(name: string): string;
  /** Prefix a local name to form an XML id. */
  id(local: string): string;
  /** The defining `<parameter id=...>` element of a declared parameter. Use once. */
  param(name: string): XmlElement;
  /** A `<parameter idref=...>` reference to a declared parameter. */
  paramRef(name: string): XmlElement;
  /**
   * A reference to the prior of a declared parameter, for gradients. The prior
   * is then written with the id `<parameter id>.prior` before the operators.
   */
  priorRef(name: string): XmlElement;
  /**
   * A reference element published by another module (see `ModuleDefinition.refs`),
   * e.g. `ctx.ref('treeModel')`. Throws if no module in use provides it.
   */
  ref(name: string): XmlElement;
  /**
   * A value published by another module (see `ModuleDefinition.facts`), or
   * undefined when no module in use provides it. Not available inside `facts`.
   */
  fact(name: string): FactValue | undefined;
  /** XML builders, so runtime-loaded modules need no imports. */
  xml: {
    el(name: string, attrs?: Record<string, AttrValue>, children?: XmlChild[]): XmlElement;
    ref(name: string, id: string): XmlElement;
    comment(text: string): XmlComment;
  };
}

export type FactValue = number | string | boolean;

export interface ModuleDefinition {
  apiVersion: number;
  /** Unique id, conventionally `<slot>.<name>`. */
  id: string;
  slot: Slot;
  label: string;
  description?: string;
  citation?: string;
  /** Earliest BEAST X version that can run this module's XML. */
  minBeast?: string;
  /** For a module in the `trait` slot: the type of trait it analyses. */
  traitType?: TraitType;
  /** True when the module provides gradient-based operators for the `hmc` strategy. */
  supportsHmc?: boolean;
  options?: OptionsSchema;
  parameters?(ctx: ModuleContext): ParameterDecl[];
  operators?(ctx: ModuleContext): OperatorDecl[];
  /**
   * Reference elements other modules may need, by well-known name. Names in use:
   * `treeModel`, `allInternalNodeHeights`, `startingTree`, `branchRates`, `substitutionModel`.
   */
  refs?(ctx: ModuleContext): Record<string, XmlElement>;
  /**
   * Plain values other modules may need, by well-known name. Names in use:
   * `startingRootHeight`: the height the root of the starting tree should have,
   * in years. Tree priors with a time of origin publish it so that the tree
   * starts below the origin; starting tree modules should honour it.
   * `usePreOrder`: published as true by a clock model whose operators need
   * gradients of the sequence likelihood; it applies to that clock's own tree
   * likelihood, whose id is `ctx.id('treeLikelihood')`.
   */
  facts?(ctx: ModuleContext): Record<string, FactValue>;
  generate(ctx: ModuleContext): Contributions;
  /** Checks beyond what the options schema expresses. */
  validate?(ctx: ModuleContext): Issue[];
}

/** Identity helper that gives module authors type checking and completion. */
export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}
