/**
 * The generation pipeline: resolves a document against the module registry,
 * collects each module's parameters, operators and XML contributions, and
 * assembles the BEAST XML in canonical block order.
 */

import { countSites, deriveTaxa, taxonKey, type SiteRange, type Taxon } from './data';
import {
  findInstance,
  mcmcSchema,
  schemaRefs,
  type AnalysisDocument,
  type McmcSettings,
  type Partition,
} from './document';
import {
  LATE_SECTIONS,
  MODULE_API_VERSION,
  TOP_LEVEL_SECTIONS,
  type DataSummary,
  type FactValue,
  type Issue,
  type ModuleContext,
  type ModuleDefinition,
  type OperatorDecl,
  type ParameterDecl,
  type PriorSpec,
  type Section,
  type Slot,
} from './module-api';
import { priorElement, priorElementName, validatePrior } from './priors';
import type { ModuleRegistry } from './registry';
import { resolveOptions, validateOptions, type OptionValues } from './schema';
import { nameProblem, nestTaxonSets, type TaxonSetInfo } from './taxonsets';
import { resolveTimeline, type TimelineResolution } from './timeline';
import { resolveTrait, type ResolvedTrait } from './traits';
import { comment, el, formatNumbers, nodes, ref, serialize, type XmlElement, type XmlNode } from './xml';

export const BEAUTIQUE_VERSION = '0.5.0';
/** The BEAST X version written to the `<beast version>` attribute. */
export const BEAST_XML_VERSION = '10.6.0';

export interface ResolvedParameter {
  /** XML id. */
  id: string;
  /** Stable key for user overrides: `<owner>/<declared name>`. */
  key: string;
  /** Id of the model instance that declared it. */
  owner: string;
  /** Label of the model that declared it. */
  ownerLabel: string;
  decl: ParameterDecl;
  value?: number | number[];
  prior?: PriorSpec;
  /** Set when a module needs to refer to the prior, which is then written with this id before the operators. */
  priorId?: string;
}

export interface ResolvedOperator {
  /** Stable key for user overrides: `<owner>/<declared key>`. */
  key: string;
  owner: string;
  ownerLabel: string;
  /** What the operator is and what it acts on. */
  label: string;
  decl: OperatorDecl;
  weight: number;
  tuning?: number;
  disabled: boolean;
}

export interface GenerateOptions {
  /** Replace sequence data with a short marker (for on-screen previews). */
  elideSequences?: boolean;
}

export interface GenerateResult {
  /** The XML, present only when there are no errors. */
  xml?: string;
  issues: Issue[];
  taxa: Taxon[];
  parameters: ResolvedParameter[];
  operators: ResolvedOperator[];
}

interface Entry {
  /** Instance id, or a synthetic id for blocks the pipeline itself adds. */
  owner: string;
  label: string;
  slot: Slot | 'relativeRates' | 'taxonSets';
  prefix: string;
  module?: ModuleDefinition;
  ctx?: ModuleContext;
  params: ResolvedParameter[];
  operators: ResolvedOperator[];
  contributions: Partial<Record<Section, XmlNode[]>>;
  facts?: Record<string, FactValue>;
}

interface SiteModel {
  id: string;
  substitution: string;
  heterogeneity: string | null;
  /** Prefix of the substitution model, shared by the site model's own ids. */
  prefix: string;
  /** Number of alignment columns across the partitions that use it. */
  sites: number;
  clocks: Set<string>;
  /** Children the pipeline adds (the relative rate). */
  extra: XmlNode[];
}

/** Order in which instances contribute priors, operators and log entries. */
const ENTRY_ORDER: Entry['slot'][] = [
  'substitution',
  'siteHeterogeneity',
  'relativeRates',
  'clock',
  'tree',
  'taxonSets',
  'startingTree',
  'treePrior',
  'trait',
];

function safeId(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

function describeOperator(decl: OperatorDecl, owner: Entry): string {
  if (decl.label) return decl.label;
  const target = decl.key.replace(/\.[^.]+$/, '');
  return `${decl.element.replace(/Operator$/, '')}(${owner.prefix}${target})`;
}

function patternsElement(id: string | undefined, range: SiteRange, alignment: string): XmlElement {
  return el('patterns', { id, from: range.from ?? 1, to: range.to, every: range.every, strip: false }, [
    ref('alignment', alignment),
  ]);
}

export function generate(doc: AnalysisDocument, registry: ModuleRegistry, options: GenerateOptions = {}): GenerateResult {
  const result = assemble(doc, registry, options);
  // The same problem can be found from two sides (two things with one name); report it once.
  const seen = new Set<string>();
  result.issues = result.issues.filter((issue) => {
    const key = `${issue.severity}|${issue.path ?? ''}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return result;
}

function assemble(doc: AnalysisDocument, registry: ModuleRegistry, options: GenerateOptions): GenerateResult {
  const issues: Issue[] = [];
  const error = (message: string, path?: string): void => {
    issues.push({ severity: 'error', message, path });
  };

  // ---- data -------------------------------------------------------------
  const derived = deriveTaxa(doc.data);
  issues.push(...derived.issues);
  const taxa = derived.taxa;
  const result: GenerateResult = { issues, taxa, parameters: [], operators: [] };

  const hasData = doc.data.alignments.length > 0;
  if (!hasData) error('No sequence data has been loaded');

  const dated = taxa.length > 0 && taxa.every((t) => t.date !== undefined);
  const data: DataSummary = { ntax: taxa.length, hasDates: dated };
  if (dated) {
    const dates = taxa.map((t) => t.date as number);
    data.dateRange = { min: Math.min(...dates), max: Math.max(...dates) };
  }

  // ---- taxon sets and timelines ---------------------------------------------
  const taxaByKey = new Map(taxa.map((t) => [t.key, t]));
  const taxonSets = doc.taxonSets ?? [];
  const setMembers = new Map<string, Taxon[]>();
  for (const set of taxonSets) {
    const problem = nameProblem(set.name, taxonSets.filter((s) => s !== set).map((s) => s.name));
    if (problem) error(`Taxon set "${set.name}" ${problem}`, 'taxonSets');
    if (!hasData) continue;
    const members = [...new Set(set.taxa)].flatMap((key) => taxaByKey.get(key) ?? []);
    setMembers.set(set.id, members);
    const unknown = new Set(set.taxa).size - members.length;
    if (unknown > 0) {
      issues.push({
        severity: 'warning',
        message: `Taxon set "${set.name}" lists ${unknown} taxa that are not in the data; they are left out`,
        path: 'taxonSets',
      });
    }
    if (members.length === 0) error(`Taxon set "${set.name}" is empty`, 'taxonSets');
    else if (set.monophyletic && members.length < 2) {
      error(`Taxon set "${set.name}" needs at least two taxa to be constrained as a clade`, 'taxonSets');
    }
  }
  const clades = taxonSets.filter((s) => s.monophyletic && (setMembers.get(s.id)?.length ?? 0) >= 2);
  const nesting = nestTaxonSets(clades.map((s) => ({ id: s.id, taxa: (setMembers.get(s.id) ?? []).map((t) => t.key) })));
  for (const [a, b] of nesting.conflicts) {
    const name = (id: string): string => taxonSets.find((s) => s.id === id)?.name ?? id;
    error(
      `Taxon sets "${name(a)}" and "${name(b)}" cannot both be clades: they overlap without one containing the other`,
      'taxonSets',
    );
  }
  const taxonSetInfo: TaxonSetInfo[] = taxonSets.map((set) => ({
    id: set.id,
    name: set.name,
    size: setMembers.get(set.id)?.length ?? 0,
    monophyletic: set.monophyletic === true,
    parent: nesting.parent.get(set.id) ?? null,
  }));

  // ---- traits ---------------------------------------------------------------
  const traits = doc.traits ?? [];
  const resolvedTraits = new Map<string, ResolvedTrait>();
  for (const trait of traits) {
    const others = [...traits.filter((t) => t !== trait).map((t) => t.name), ...taxonSets.map((s) => s.name)];
    const problem = nameProblem(trait.name, others);
    if (problem) error(`Trait "${trait.name}" ${problem}`, 'traits');
    if (!hasData) continue;
    const resolved = resolveTrait(trait, doc.data, taxa);
    resolvedTraits.set(trait.id, resolved);
    for (const text of resolved.problems) error(`Trait "${trait.name}" ${text}`, 'traits');
    if (resolved.problems.length === 0 && resolved.missing > 0) {
      issues.push({
        severity: 'warning',
        message: `Trait "${trait.name}" has no value for ${resolved.missing} of ${taxa.length} taxa; they are treated as unknown`,
        path: 'traits',
      });
    }
  }

  const timelineCache = new Map<string, TimelineResolution>();
  const timelineOf = (id: unknown): TimelineResolution => {
    const timeline = (doc.timelines ?? []).find((t) => t.id === id);
    if (!timeline) return { problems: ['choose a timeline'] };
    let resolution = timelineCache.get(timeline.id);
    if (!resolution) {
      resolution = resolveTimeline(timeline, data.dateRange?.max);
      timelineCache.set(timeline.id, resolution);
    }
    return resolution;
  };
  for (const timeline of doc.timelines ?? []) {
    const others = (doc.timelines ?? []).filter((t) => t !== timeline).map((t) => t.name);
    const problem = nameProblem(timeline.name, others);
    if (problem) error(`Timeline "${timeline.name}" ${problem}`, 'timelines');
  }
  const refs = schemaRefs(doc);

  const alignmentIds = new Map<string, string>();
  const nchar = new Map<string, number>();
  for (const alignment of doc.data.alignments) {
    alignmentIds.set(
      alignment.id,
      doc.data.alignments.length === 1 ? 'alignment' : `${safeId(alignment.name)}.alignment`,
    );
    nchar.set(alignment.id, alignment.sequences[0]?.sequence.length ?? 0);
  }
  if (new Set(alignmentIds.values()).size !== alignmentIds.size) error('Alignment names must be unique');

  if (doc.partitions.length === 0) error('The analysis has no data partitions');
  const siteCount = (partition: Partition): number =>
    countSites(partition.sites, nchar.get(partition.alignment ?? '') ?? 0);
  for (const partition of doc.partitions) {
    if (!hasData) break;
    const length = nchar.get(partition.alignment ?? '');
    if (length === undefined) {
      error(`Partition "${partition.name}" is not linked to any sequence data`);
      continue;
    }
    for (const range of partition.sites ?? []) {
      const from = range.from ?? 1;
      const to = range.to ?? length;
      const every = range.every ?? 1;
      if (![from, to, every].every(Number.isInteger) || from < 1 || every < 1 || to < from || to > length) {
        error(`Partition "${partition.name}" has a site range outside its alignment (1 to ${length})`);
      }
    }
    if (siteCount(partition) === 0) error(`Partition "${partition.name}" contains no sites`);
  }
  const multiPartition = doc.partitions.length > 1;
  const patternsId = (partition: Partition): string =>
    multiPartition ? `${safeId(partition.name)}.patterns` : 'patterns';
  if (new Set(doc.partitions.map(patternsId)).size !== doc.partitions.length) {
    error('Partition names must be unique');
  }

  // ---- settings ---------------------------------------------------------
  const mcmc = resolveOptions(mcmcSchema, doc.mcmc) as unknown as McmcSettings;
  for (const issue of validateOptions(mcmcSchema, mcmc as unknown as OptionValues)) {
    error(issue.message, `mcmc.${issue.field}`);
  }
  const stem = safeId(doc.name) || 'analysis';

  // ---- model instances in use --------------------------------------------
  const wanted: { id: string; slot: Slot }[] = [];
  const want = (id: string | null, slot: Slot): void => {
    if (id !== null && !wanted.some((w) => w.id === id)) wanted.push({ id, slot });
  };
  for (const partition of doc.partitions) {
    want(partition.substitution, 'substitution');
    want(partition.siteHeterogeneity, 'siteHeterogeneity');
    want(partition.clock, 'clock');
  }
  want(doc.tree.tree, 'tree');
  want(doc.tree.startingTree, 'startingTree');
  want(doc.tree.treePrior, 'treePrior');
  for (const trait of traits) {
    if (trait.model === null) error(`Trait "${trait.name}" has no model`, 'traits');
    else if (wanted.some((w) => w.id === trait.model)) error(`Trait "${trait.name}" shares its model with something else`, 'traits');
    else want(trait.model, 'trait');
  }

  const published = new Map<string, { owner: string; element: XmlElement }[]>();
  const lookup = (name: string, owner?: string): XmlElement => {
    const providers = (published.get(name) ?? []).filter((p) => owner === undefined || p.owner === owner);
    if (providers.length === 0) throw new Error(`no model in the analysis provides "${name}"`);
    if (providers.length > 1) throw new Error(`more than one model provides "${name}"`);
    return providers[0].element;
  };

  const facts = new Map<string, FactValue>();

  /** Apply user overrides to declared parameters and operators, and check the results. */
  const resolveParams = (entry: Entry, decls: ParameterDecl[]): void => {
    entry.params = decls.map((decl) => {
      const key = `${entry.owner}/${decl.name}`;
      const override = doc.parameters[key] ?? {};
      const parameter: ResolvedParameter = {
        id: entry.prefix + decl.name,
        key,
        owner: entry.owner,
        ownerLabel: entry.label,
        decl,
        value: override.value ?? decl.value,
        prior: decl.prior ? (override.prior ?? decl.prior) : undefined,
      };
      const path = `parameters.${key}`;
      const message = parameter.prior ? validatePrior(parameter.prior) : null;
      if (message) error(`${parameter.id}: ${message}`, path);
      for (const v of [parameter.value ?? []].flat()) {
        if (!Number.isFinite(v)) error(`${parameter.id}: the initial value must be a number`, path);
        else if ((decl.lower !== undefined && v < decl.lower) || (decl.upper !== undefined && v > decl.upper)) {
          error(
            `${parameter.id}: the initial value ${v} is outside its bounds (${decl.lower ?? '-∞'} to ${decl.upper ?? '∞'})`,
            path,
          );
        }
      }
      return parameter;
    });
  };
  const resolveOperators = (entry: Entry, decls: OperatorDecl[]): void => {
    entry.operators = decls.map((decl) => {
      const key = `${entry.owner}/${decl.key}`;
      const override = doc.operators[key] ?? {};
      const operator: ResolvedOperator = {
        key,
        owner: entry.owner,
        ownerLabel: entry.label,
        label: describeOperator(decl, entry),
        decl,
        weight: override.weight ?? decl.weight,
        tuning: decl.tuning ? (override.tuning ?? decl.tuning.value) : undefined,
        disabled: override.disabled ?? false,
      };
      const path = `operators.${key}`;
      if (!Number.isFinite(operator.weight) || operator.weight <= 0) {
        error(`${operator.label}: the weight must be greater than 0`, path);
      }
      if (operator.tuning !== undefined && !Number.isFinite(operator.tuning)) {
        error(`${operator.label}: the ${decl.tuning?.name} must be a number`, path);
      }
      return operator;
    });
  };

  const entries: Entry[] = [];
  for (const { id, slot } of wanted) {
    // A trait that could not be read has been reported; its model has nothing to work on.
    if (slot === 'trait' && hasData) {
      const owner = traits.find((t) => t.model === id);
      if (owner && (resolvedTraits.get(owner.id)?.problems.length ?? 1) > 0) continue;
    }
    const instance = findInstance(doc, id);
    if (!instance) {
      error(`The analysis refers to a model "${id}" that is not defined`);
      continue;
    }
    const module = registry.get(instance.module);
    if (!module) {
      error(`The ${slot} module "${instance.module}" is not available`);
      continue;
    }
    if (module.slot !== slot) {
      error(`"${module.label}" cannot be used as a ${slot} model`);
      continue;
    }
    // A trait model's ids always start with the name of its trait.
    const trait = slot === 'trait' ? traits.find((t) => t.model === id) : undefined;
    const traitInfo = trait && resolvedTraits.get(trait.id);
    if (trait && module.traitType !== undefined && module.traitType !== trait.type) {
      error(`"${module.label}" cannot be used for the ${trait.type} trait "${trait.name}"`, 'traits');
      continue;
    }
    const inSlot = wanted.filter((w) => w.slot === slot).length;
    const prefix = trait ? `${trait.name}.` : inSlot > 1 ? `${safeId(instance.name)}.` : '';
    const label = trait ? `${module.label} (${trait.name})` : inSlot > 1 ? `${module.label} (${instance.name})` : module.label;
    const resolved = resolveOptions(module.options ?? {}, instance.options);
    for (const issue of validateOptions(module.options ?? {}, resolved, refs)) {
      error(`${label}: ${issue.message}`, `models.${instance.id}.${issue.field}`);
    }

    const entry: Entry = { owner: instance.id, label, slot, prefix, module, params: [], operators: [], contributions: {} };
    const findParam = (name: string): ResolvedParameter => {
      const parameter = entry.params.find((p) => p.decl.name === name);
      if (!parameter) throw new Error(`parameter "${name}" is not declared by this module`);
      return parameter;
    };
    entry.ctx = {
      apiVersion: MODULE_API_VERSION,
      options: resolved,
      instanceName: instance.name,
      prefix,
      data,
      trait: traitInfo,
      taxonSets: taxonSetInfo,
      taxonSet: (setId) => {
        const set = taxonSetInfo.find((s) => s.id === setId);
        if (!set) throw new Error('choose a taxon set');
        return set;
      },
      timeline: (timelineId) => {
        const resolution = timelineOf(timelineId);
        if (!resolution.timeline) {
          const name = (doc.timelines ?? []).find((t) => t.id === timelineId)?.name;
          throw new Error(name === undefined ? resolution.problems[0] : `timeline "${name}": ${resolution.problems.join('; ')}`);
        }
        return resolution.timeline;
      },
      operatorStrategy: mcmc.operatorStrategy,
      optionPath: (name) => `models.${instance.id}.${name}`,
      id: (local) => prefix + local,
      param: (name) => {
        const p = findParam(name);
        return el('parameter', {
          id: p.id,
          dimension: p.decl.dimension,
          value: p.value === undefined ? undefined : formatNumbers(p.value),
          lower: p.decl.lower,
          upper: p.decl.upper,
        });
      },
      paramRef: (name) => ref('parameter', findParam(name).id),
      priorRef: (name) => {
        const p = findParam(name);
        if (!p.prior) throw new Error(`parameter "${name}" has no prior`);
        p.priorId = `${p.id}.prior`;
        return ref(priorElementName(p.prior), p.priorId);
      },
      ref: (name) => lookup(name),
      fact: (name) => facts.get(name),
      xml: { el, ref, comment },
    };
    entries.push(entry);
  }

  const prefixes = entries.filter((e) => e.prefix !== '').map((e) => `${e.slot}:${e.prefix}`);
  if (new Set(prefixes).size !== prefixes.length) error('Models of the same kind must have different names');

  /** Run one module hook, turning a thrown error into an issue. */
  const run = <T>(entry: Entry, what: string, fn: (module: ModuleDefinition, ctx: ModuleContext) => T, fallback: T): T => {
    try {
      return fn(entry.module as ModuleDefinition, entry.ctx as ModuleContext);
    } catch (e) {
      error(`${entry.label} (${what}): ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  for (const entry of entries) {
    entry.facts = run(entry, 'facts', (m, ctx) => m.facts?.(ctx) ?? {}, {});
    for (const [name, value] of Object.entries(entry.facts)) if (!facts.has(name)) facts.set(name, value);
  }
  for (const entry of entries) {
    resolveParams(entry, run(entry, 'parameters', (m, ctx) => m.parameters?.(ctx) ?? [], []));
  }
  for (const entry of entries) {
    const refs = run(entry, 'references', (m, ctx) => m.refs?.(ctx) ?? {}, {});
    for (const [name, element] of Object.entries(refs)) {
      const list = published.get(name) ?? [];
      list.push({ owner: entry.owner, element });
      published.set(name, list);
    }
  }
  for (const entry of entries) {
    issues.push(...run(entry, 'validation', (m, ctx) => m.validate?.(ctx) ?? [], []));
    const generated = run(entry, 'XML', (m, ctx) => m.generate(ctx), {});
    for (const [name, children] of Object.entries(generated)) entry.contributions[name as Section] = nodes(children);
    resolveOperators(entry, run(entry, 'operators', (m, ctx) => m.operators?.(ctx) ?? [], []));
  }

  // ---- taxon set statistics ---------------------------------------------------
  // Each set gets the time of its most recent common ancestor; clades are enforced in the prior.
  if (taxonSetInfo.some((s) => s.size > 0)) {
    try {
      const tree = lookup('treeModel');
      const contributions: Record<'treeStatistics' | 'prior' | 'fileLog', XmlNode[]> = {
        treeStatistics: [],
        prior: [],
        fileLog: [],
      };
      for (const set of taxonSetInfo.filter((s) => s.size > 0)) {
        const mrca = (): XmlElement => el('mrca', {}, [ref('taxa', set.name)]);
        contributions.treeStatistics.push(el('tmrcaStatistic', { id: `tmrca(${set.name})` }, [mrca(), tree]));
        contributions.fileLog.push(ref('tmrcaStatistic', `tmrca(${set.name})`));
        if (dated) {
          contributions.treeStatistics.push(
            el('tmrcaStatistic', { id: `age(${set.name})`, absolute: true }, [mrca(), tree]),
          );
          contributions.fileLog.push(ref('tmrcaStatistic', `age(${set.name})`));
        }
        if (set.monophyletic) {
          contributions.treeStatistics.push(el('monophylyStatistic', { id: `monophyly(${set.name})` }, [mrca(), tree]));
          contributions.prior.push(
            el('booleanLikelihood', {}, [ref('monophylyStatistic', `monophyly(${set.name})`)]),
          );
        }
      }
      entries.push({
        owner: 'taxonSets',
        label: 'Taxon sets',
        slot: 'taxonSets',
        prefix: '',
        params: [],
        operators: [],
        contributions,
      });
    } catch {
      // No tree model: already reported as a missing model.
    }
  }

  // ---- site models and relative rates --------------------------------------
  // Each site model pairs one substitution model with one heterogeneity model.
  const entryOf = (id: string | null): Entry | undefined => entries.find((e) => e.owner === id);
  const siteModels: SiteModel[] = [];
  for (const partition of doc.partitions) {
    let siteModel = siteModels.find((s) => s.substitution === partition.substitution);
    if (siteModel && siteModel.heterogeneity !== partition.siteHeterogeneity) {
      error('Partitions that share a substitution model must share the same among-site rate heterogeneity model');
      continue;
    }
    if (!siteModel) {
      if (siteModels.some((s) => s.heterogeneity !== null && s.heterogeneity === partition.siteHeterogeneity)) {
        error('An among-site rate heterogeneity model cannot be shared between different substitution models');
      }
      const prefix = entryOf(partition.substitution)?.prefix ?? '';
      siteModel = {
        id: `${prefix}siteModel`,
        substitution: partition.substitution,
        heterogeneity: partition.siteHeterogeneity,
        prefix,
        sites: 0,
        clocks: new Set(),
        extra: [],
      };
      siteModels.push(siteModel);
    }
    siteModel.sites += siteCount(partition);
    siteModel.clocks.add(partition.clock);
  }

  // Site models under the same clock get relative rates whose weighted mean is one.
  const afterSiteModels: XmlNode[] = [];
  for (const clock of entries.filter((e) => e.slot === 'clock')) {
    const group = siteModels.filter((s) => s.clocks.has(clock.owner));
    if (group.length < 2) continue;
    if (group.some((s) => s.clocks.size > 1)) {
      error('Partitions that share a substitution model must also share a clock model');
      continue;
    }
    const total = group.reduce((sum, s) => sum + s.sites, 0);
    const allNus = `${clock.prefix}allNus`;
    for (const siteModel of group) {
      siteModel.extra.push(
        el('relativeRate', { weight: total / siteModel.sites }, [
          el('parameter', { id: `${siteModel.prefix}nu`, value: 1 / group.length, lower: 0, upper: 1 }),
        ]),
      );
      afterSiteModels.push(
        el('statistic', { id: `${siteModel.prefix}mu`, name: 'mu' }, [ref('siteModel', siteModel.id)]),
      );
    }
    afterSiteModels.push(
      comment('Collecting together relative rates for partitions'),
      el('compoundParameter', { id: allNus }, group.map((s) => ref('parameter', `${s.prefix}nu`))),
    );
    const entry: Entry = {
      owner: `relativeRates:${clock.owner}`,
      label: 'Relative rates of partitions',
      slot: 'relativeRates',
      prefix: clock.prefix,
      params: [],
      operators: [],
      contributions: { fileLog: group.map((s) => ref('statistic', `${s.prefix}mu`)) },
    };
    resolveParams(entry, [
      {
        name: 'allNus',
        description: 'Relative rates of the partitions (as shares of the total)',
        prior: { type: 'dirichlet', alpha: 1, sumsTo: 1 },
      },
    ]);
    resolveOperators(entry, [
      {
        key: 'allNus.deltaExchange',
        element: 'deltaExchange',
        tuning: { name: 'delta', value: 0.01 },
        weight: 3,
        children: [ref('parameter', allNus)],
      },
    ]);
    entries.push(entry);
  }

  entries.sort((a, b) => ENTRY_ORDER.indexOf(a.slot) - ENTRY_ORDER.indexOf(b.slot));
  result.parameters = entries.flatMap((e) => e.params);
  result.operators = entries.flatMap((e) => e.operators);

  const parameterIds = result.parameters.map((p) => p.id);
  for (const id of new Set(parameterIds.filter((p, i) => parameterIds.indexOf(p) !== i))) {
    error(`Parameter id "${id}" is declared by more than one model`);
  }

  if (issues.some((i) => i.severity === 'error')) return result;

  // ---- assembly ---------------------------------------------------------
  const section = (name: Section, only?: Entry): XmlNode[] =>
    entries.filter((e) => !only || e === only).flatMap((e) => e.contributions[name] ?? []);

  const top: XmlNode[] = [];
  try {
    const treeModel = (): XmlElement => lookup('treeModel');

    const writtenTraits = traits.flatMap((t) => resolvedTraits.get(t.id) ?? []);
    top.push(
      comment(`The list of taxa to be analysed. ntax=${taxa.length}`),
      el(
        'taxa',
        { id: 'taxa' },
        taxa.map((t) =>
          el(
            'taxon',
            { id: t.id },
            [
              t.date === undefined ? [] : el('date', { value: t.date, direction: 'forwards', units: 'years' }),
              writtenTraits.map((trait) => el('attr', { name: trait.name }, [
                  trait.values.get(t.key) ??
                    (trait.type === 'continuous' ? new Array(trait.dimension).fill('NA').join(' ') : '?'),
                ]),
              ),
            ],
          ),
        ),
      ),
    );

    for (const set of taxonSets) {
      top.push(el('taxa', { id: set.name }, (setMembers.get(set.id) ?? []).map((t) => ref('taxon', t.id))));
    }

    for (const alignment of doc.data.alignments) {
      const length = nchar.get(alignment.id) as number;
      const byKey = new Map(alignment.sequences.map((s) => [taxonKey(s.label, alignment.labelRule), s.sequence]));
      top.push(
        comment(`Sequence alignment "${alignment.name}". ntax=${alignment.sequences.length} nchar=${length}`),
        el(
          'alignment',
          { id: alignmentIds.get(alignment.id), dataType: alignment.dataType },
          taxa.map((t) =>
            el('sequence', {}, [
              ref('taxon', t.id),
              options.elideSequences ? `[${length} sites]` : (byKey.get(t.key) ?? '?'.repeat(length)),
            ]),
          ),
        ),
      );
    }

    // A partition's patterns: one <patterns>, or <mergePatterns> over several site ranges.
    const patternsRef = new Map<string, XmlElement>();
    for (const partition of doc.partitions) {
      const id = patternsId(partition);
      const alignment = alignmentIds.get(partition.alignment as string) as string;
      const ranges = partition.sites && partition.sites.length > 0 ? partition.sites : [{}];
      if (ranges.length === 1) {
        top.push(patternsElement(id, ranges[0], alignment));
        patternsRef.set(partition.id, ref('patterns', id));
      } else {
        top.push(el('mergePatterns', { id }, ranges.map((r) => patternsElement(undefined, r, alignment))));
        patternsRef.set(partition.id, ref('mergePatterns', id));
      }
    }

    for (const name of TOP_LEVEL_SECTIONS) top.push(...section(name));

    for (const siteModel of siteModels) {
      const heterogeneity = entryOf(siteModel.heterogeneity);
      top.push(
        el('siteModel', { id: siteModel.id }, [
          el('substitutionModel', {}, [lookup('substitutionModel', siteModel.substitution)]),
          siteModel.extra,
          heterogeneity ? section('siteModel', heterogeneity) : [],
        ]),
      );
    }
    top.push(...afterSiteModels);

    // One tree likelihood per clock model, with a <partition> for each data partition.
    const likelihoods: XmlElement[] = [];
    for (const clock of entries.filter((e) => e.slot === 'clock')) {
      const id = `${clock.prefix}treeLikelihood`;
      top.push(
        comment('Likelihood for tree given sequence data'),
        el('treeDataLikelihood', { id, useAmbiguities: false, usePreOrder: clock.facts?.usePreOrder === true }, [
          doc.partitions
            .filter((p) => p.clock === clock.owner)
            .map((p) =>
              el('partition', {}, [
                patternsRef.get(p.id),
                ref('siteModel', siteModels.find((s) => s.substitution === p.substitution)!.id),
              ]),
            ),
          treeModel(),
          lookup('branchRates', clock.owner),
        ]),
      );
      likelihoods.push(ref('treeDataLikelihood', id));
    }

    for (const name of LATE_SECTIONS) top.push(...section(name));

    // Priors that gradient-based operators refer to are defined here, and referred to in the prior.
    const writePrior = (p: ResolvedParameter): XmlElement => {
      const prior = priorElement(p.prior as PriorSpec, ref('parameter', p.id), treeModel);
      return p.priorId === undefined ? prior : el(prior.name, { id: p.priorId, ...prior.attrs }, prior.children);
    };
    const namedPriors = result.parameters.filter((p) => p.prior && p.priorId !== undefined);
    if (namedPriors.length > 0) top.push(comment('Priors referred to by gradient-based operators'), ...namedPriors.map(writePrior));

    top.push(
      comment('Define operators'),
      el(
        'operators',
        { id: 'operators', optimizationSchedule: 'log' },
        result.operators
          .filter((o) => !o.disabled)
          .map((o) =>
            el(
              o.decl.element,
              {
                ...(o.decl.tuning ? { [o.decl.tuning.name]: o.tuning } : {}),
                ...o.decl.attrs,
                weight: o.weight,
              },
              o.decl.children,
            ),
          ),
      ),
    );

    const logged = (entry: Entry): XmlNode[] =>
      entry.params.filter((p) => p.decl.log !== false).map((p) => ref('parameter', p.id));

    top.push(
      comment('Define MCMC'),
      el('mcmc', { id: 'mcmc', chainLength: mcmc.chainLength, autoOptimize: true, operatorAnalysis: `${stem}.ops` }, [
        el('joint', { id: 'joint' }, [
          el('prior', { id: 'prior' }, [
            result.parameters
              .filter((p) => p.prior)
              .map((p) => (p.priorId === undefined ? writePrior(p) : ref(priorElementName(p.prior as PriorSpec), p.priorId))),
            section('prior'),
          ]),
          el('likelihood', { id: 'likelihood' }, [likelihoods, section('likelihood')]),
        ]),
        ref('operators', 'operators'),
        comment('write log to screen'),
        el('log', { id: 'screenLog', logEvery: mcmc.screenLogEvery }, [
          el('column', { label: 'Joint', dp: 4, width: 12 }, [ref('joint', 'joint')]),
          el('column', { label: 'Prior', dp: 4, width: 12 }, [ref('prior', 'prior')]),
          el('column', { label: 'Likelihood', dp: 4, width: 12 }, [ref('likelihood', 'likelihood')]),
          result.parameters
            .filter((p) => p.decl.screen)
            .map((p) => el('column', { label: p.id, sf: 6, width: 12 }, [ref('parameter', p.id)])),
          section('screenLog'),
        ]),
        comment('write log to file'),
        el('log', { id: 'fileLog', logEvery: mcmc.logEvery, fileName: `${stem}.log`, overwrite: false }, [
          ref('joint', 'joint'),
          ref('prior', 'prior'),
          ref('likelihood', 'likelihood'),
          entries.map((e) => [logged(e), section('fileLog', e)]),
          likelihoods,
          section('fileLogLikelihoods'),
        ]),
        comment('write tree log to file'),
        el(
          'logTree',
          {
            id: 'treeFileLog',
            logEvery: mcmc.logEvery,
            nexusFormat: true,
            fileName: `${stem}.trees`,
            sortTranslationTable: true,
          },
          [treeModel(), section('treeLog'), ref('joint', 'joint')],
        ),
        comment('write state of Markov chain to checkpoint file'),
        el('logCheckpoint', {
          id: 'checkpointFileLog',
          checkpointEvery: Math.max(1, Math.round(mcmc.chainLength / 10)),
          checkpointFinal: mcmc.chainLength,
          fileName: `${stem}.chkpt`,
          overwrite: false,
        }),
      ]),
      el('report', {}, [el('property', { name: 'timer' }, [ref('mcmc', 'mcmc')])]),
    );
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return result;
  }

  // Every id in the XML must be unique (taxon ids are checked with the data).
  const seenIds = new Set<string>();
  const duplicates = new Set<string>();
  const checkIds = (node: XmlNode): void => {
    if (node.kind !== 'element' || node.name === 'taxon') return;
    const id = node.attrs.id;
    if (typeof id === 'string') {
      if (seenIds.has(id)) duplicates.add(id);
      seenIds.add(id);
    }
    node.children.forEach(checkIds);
  };
  top.forEach(checkIds);
  for (const id of duplicates) error(`The id "${id}" is used by more than one element of the analysis; rename one of them`);
  if (duplicates.size > 0) return result;

  result.xml =
    '<?xml version="1.0" standalone="yes"?>\n' +
    `<!-- Generated by BEAUtique v${BEAUTIQUE_VERSION} -->\n` +
    serialize(el('beast', { version: BEAST_XML_VERSION }, top), { spaceTopLevel: true }) +
    '\n';
  return result;
}
