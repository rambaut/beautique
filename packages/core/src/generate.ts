/**
 * The generation pipeline: resolves a document against the module registry,
 * collects each module's parameters, operators and XML contributions, and
 * assembles the BEAST XML in canonical block order.
 */

import { deriveTaxa, taxonKey, type Taxon } from './data';
import { findInstance, mcmcSchema, type AnalysisDocument, type McmcSettings, type ModelInstance } from './document';
import {
  MODULE_API_VERSION,
  TOP_LEVEL_SECTIONS,
  type Contributions,
  type DataSummary,
  type Issue,
  type ModuleContext,
  type ModuleDefinition,
  type OperatorDecl,
  type ParameterDecl,
  type PriorSpec,
  type Section,
  type Slot,
} from './module-api';
import type { ModuleRegistry } from './registry';
import { resolveOptions, validateOptions, type OptionValues } from './schema';
import { comment, el, formatNumbers, ref, serialize, type XmlElement, type XmlNode } from './xml';

export const BEAUTIQUE_VERSION = '0.1.0';
/** The BEAST X version written to the `<beast version>` attribute. */
export const BEAST_XML_VERSION = '10.6.0';

export interface ResolvedParameter {
  id: string;
  /** Id of the model instance that declared it. */
  owner: string;
  decl: ParameterDecl;
  value?: number | number[];
  prior?: PriorSpec;
}

export interface ResolvedOperator {
  /** Instance prefix + local key; the key for user overrides. */
  key: string;
  owner: string;
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
  instance: ModelInstance;
  module: ModuleDefinition;
  prefix: string;
  options: OptionValues;
  ctx: ModuleContext;
  params: ResolvedParameter[];
  operators: ResolvedOperator[];
  contributions: Contributions;
}

/** Order in which instances contribute priors, operators and log entries. */
const ENTRY_ORDER: Slot[] = ['substitution', 'siteHeterogeneity', 'clock', 'tree', 'startingTree', 'treePrior'];

function safeId(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

function priorElement(prior: PriorSpec, parameter: XmlElement, treeModel: () => XmlElement): XmlElement {
  switch (prior.type) {
    case 'logNormal':
      return el('logNormalPrior', { mu: prior.mu, sigma: prior.sigma, offset: prior.offset ?? 0 }, [parameter]);
    case 'normal':
      return el('normalPrior', { mean: prior.mean, stdev: prior.stdev }, [parameter]);
    case 'gamma':
      return el('gammaPrior', { shape: prior.shape, scale: prior.scale, offset: prior.offset ?? 0 }, [parameter]);
    case 'exponential':
      return el('exponentialPrior', { mean: prior.mean, offset: prior.offset ?? 0 }, [parameter]);
    case 'uniform':
      return el('uniformPrior', { lower: prior.lower, upper: prior.upper }, [parameter]);
    case 'dirichlet':
      return el('dirichletPrior', { alpha: prior.alpha, sumsTo: prior.sumsTo }, [parameter]);
    case 'ctmcScale':
      return el('ctmcScalePrior', {}, [el('ctmcScale', {}, [parameter]), treeModel()]);
    case 'oneOnX':
      return el('oneOnXPrior', {}, [parameter]);
  }
}

export function generate(doc: AnalysisDocument, registry: ModuleRegistry, options: GenerateOptions = {}): GenerateResult {
  const issues: Issue[] = [];
  const error = (message: string, path?: string): void => {
    issues.push({ severity: 'error', message, path });
  };

  // ---- data -------------------------------------------------------------
  const derived = deriveTaxa(doc.data);
  issues.push(...derived.issues);
  const taxa = derived.taxa;
  const result: GenerateResult = { issues, taxa, parameters: [], operators: [] };

  if (doc.data.alignments.length === 0) error('No sequence data has been loaded');

  const dated = taxa.length > 0 && taxa.every((t) => t.date !== undefined);
  const data: DataSummary = { ntax: taxa.length, hasDates: dated };
  if (dated) {
    const dates = taxa.map((t) => t.date as number);
    data.dateRange = { min: Math.min(...dates), max: Math.max(...dates) };
  }

  const alignmentIds = new Map<string, string>();
  for (const alignment of doc.data.alignments) {
    alignmentIds.set(
      alignment.id,
      doc.data.alignments.length === 1 ? 'alignment' : `${safeId(alignment.name)}.alignment`,
    );
  }
  if (new Set(alignmentIds.values()).size !== alignmentIds.size) error('Alignment names must be unique');

  if (doc.partitions.length === 0) error('The analysis has no data partitions');
  for (const partition of doc.partitions) {
    if (partition.alignment === null || !alignmentIds.has(partition.alignment)) {
      error(`Partition "${partition.name}" is not linked to any sequence data`);
    }
  }
  const multiPartition = doc.partitions.length > 1;
  const patternsId = (name: string): string => (multiPartition ? `${safeId(name)}.patterns` : 'patterns');
  if (new Set(doc.partitions.map((p) => patternsId(p.name))).size !== doc.partitions.length) {
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
  wanted.sort((a, b) => ENTRY_ORDER.indexOf(a.slot) - ENTRY_ORDER.indexOf(b.slot));

  const published = new Map<string, { owner: string; element: XmlElement }[]>();
  const lookup = (name: string, owner?: string): XmlElement => {
    const providers = (published.get(name) ?? []).filter((p) => owner === undefined || p.owner === owner);
    if (providers.length === 0) throw new Error(`no model in the analysis provides "${name}"`);
    if (providers.length > 1) throw new Error(`more than one model provides "${name}"`);
    return providers[0].element;
  };

  const entries: Entry[] = [];
  for (const { id, slot } of wanted) {
    const instance = findInstance(doc, id);
    if (!instance) {
      error(`The analysis refers to a model "${id}" that is not defined`);
      continue;
    }
    const module = registry.get(instance.module);
    if (!module) {
      error(`Module "${instance.module}" (used by "${instance.name}") is not available`);
      continue;
    }
    if (module.slot !== slot) {
      error(`"${module.label}" cannot be used as a ${slot} model`);
      continue;
    }
    const inSlot = wanted.filter((w) => w.slot === slot).length;
    const prefix = inSlot > 1 ? `${safeId(instance.name)}.` : '';
    const resolved = resolveOptions(module.options ?? {}, instance.options);
    for (const issue of validateOptions(module.options ?? {}, resolved)) {
      error(`${instance.name}: ${issue.message}`, `models.${instance.id}.${issue.field}`);
    }

    const entry = { instance, module, prefix, options: resolved, params: [], operators: [], contributions: {} } as unknown as Entry;
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
      operatorStrategy: mcmc.operatorStrategy,
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
      ref: (name) => lookup(name),
      xml: { el, ref, comment },
    };
    entries.push(entry);
  }

  const prefixes = entries.filter((e) => e.prefix !== '').map((e) => `${e.module.slot}:${e.prefix}`);
  if (new Set(prefixes).size !== prefixes.length) error('Models of the same kind must have different names');

  /** Run one module hook, turning a thrown error into an issue. */
  const run = <T>(entry: Entry, what: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      error(`${entry.module.label} (${what}): ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  for (const entry of entries) {
    const decls = run(entry, 'parameters', () => entry.module.parameters?.(entry.ctx) ?? [], []);
    entry.params = decls.map((decl) => {
      const id = entry.prefix + decl.name;
      const override = doc.parameters[id] ?? {};
      return {
        id,
        owner: entry.instance.id,
        decl,
        value: override.value ?? decl.value,
        prior: override.prior ?? decl.prior,
      };
    });
  }
  for (const entry of entries) {
    const refs = run(entry, 'references', () => entry.module.refs?.(entry.ctx) ?? {}, {});
    for (const [name, element] of Object.entries(refs)) {
      const list = published.get(name) ?? [];
      list.push({ owner: entry.instance.id, element });
      published.set(name, list);
    }
  }
  for (const entry of entries) {
    issues.push(...run(entry, 'validation', () => entry.module.validate?.(entry.ctx) ?? [], []));
    entry.contributions = run(entry, 'XML', () => entry.module.generate(entry.ctx), {});
    const decls = run(entry, 'operators', () => entry.module.operators?.(entry.ctx) ?? [], []);
    entry.operators = decls.map((decl) => {
      const key = entry.prefix + decl.key;
      const override = doc.operators[key] ?? {};
      return {
        key,
        owner: entry.instance.id,
        decl,
        weight: override.weight ?? decl.weight,
        tuning: override.tuning ?? decl.tuning?.value,
        disabled: override.disabled ?? false,
      };
    });
  }
  result.parameters = entries.flatMap((e) => e.params);
  result.operators = entries.flatMap((e) => e.operators);

  const parameterIds = result.parameters.map((p) => p.id);
  for (const id of new Set(parameterIds.filter((p, i) => parameterIds.indexOf(p) !== i))) {
    error(`Parameter id "${id}" is declared by more than one model`);
  }

  // Each site model pairs one substitution model with one heterogeneity model.
  const entryOf = (id: string | null): Entry | undefined => entries.find((e) => e.instance.id === id);
  const siteModels: { substitution: string; heterogeneity: string | null; id: string }[] = [];
  for (const partition of doc.partitions) {
    const existing = siteModels.find((s) => s.substitution === partition.substitution);
    if (existing && existing.heterogeneity !== partition.siteHeterogeneity) {
      error('Partitions that share a substitution model must share the same among-site rate heterogeneity model');
    } else if (!existing) {
      const shared = siteModels.some(
        (s) => s.heterogeneity !== null && s.heterogeneity === partition.siteHeterogeneity,
      );
      if (shared) {
        error('An among-site rate heterogeneity model cannot be shared between different substitution models');
      }
      siteModels.push({
        substitution: partition.substitution,
        heterogeneity: partition.siteHeterogeneity,
        id: `${entryOf(partition.substitution)?.prefix ?? ''}siteModel`,
      });
    }
  }

  if (issues.some((i) => i.severity === 'error')) return result;

  // ---- assembly ---------------------------------------------------------
  const section = (name: Section, only?: Entry): XmlNode[] =>
    entries.filter((e) => !only || e === only).flatMap((e) => e.contributions[name] ?? []);

  const top: XmlNode[] = [];
  try {
    const treeModel = (): XmlElement => lookup('treeModel');

    top.push(
      comment(`The list of taxa to be analysed. ntax=${taxa.length}`),
      el(
        'taxa',
        { id: 'taxa' },
        taxa.map((t) =>
          el(
            'taxon',
            { id: t.id },
            t.date === undefined ? [] : [el('date', { value: t.date, direction: 'forwards', units: 'years' })],
          ),
        ),
      ),
    );

    for (const alignment of doc.data.alignments) {
      const nchar = alignment.sequences[0]?.sequence.length ?? 0;
      const byKey = new Map(alignment.sequences.map((s) => [taxonKey(s.label, alignment.labelRule), s.sequence]));
      top.push(
        comment(`Sequence alignment "${alignment.name}". ntax=${alignment.sequences.length} nchar=${nchar}`),
        el(
          'alignment',
          { id: alignmentIds.get(alignment.id), dataType: alignment.dataType },
          taxa.map((t) =>
            el('sequence', {}, [
              ref('taxon', t.id),
              options.elideSequences ? `[${nchar} sites]` : (byKey.get(t.key) ?? '?'.repeat(nchar)),
            ]),
          ),
        ),
      );
    }

    for (const partition of doc.partitions) {
      top.push(
        el('patterns', { id: patternsId(partition.name), from: 1, strip: false }, [
          ref('alignment', alignmentIds.get(partition.alignment as string) as string),
        ]),
      );
    }

    for (const name of TOP_LEVEL_SECTIONS) top.push(...section(name));

    for (const siteModel of siteModels) {
      const heterogeneity = entryOf(siteModel.heterogeneity);
      top.push(
        el('siteModel', { id: siteModel.id }, [
          el('substitutionModel', {}, [lookup('substitutionModel', siteModel.substitution)]),
          heterogeneity ? section('siteModel', heterogeneity) : [],
        ]),
      );
    }

    // One tree likelihood per clock model, with a <partition> for each data partition.
    const clocks = entries.filter((e) => e.module.slot === 'clock');
    const likelihoods: XmlElement[] = [];
    for (const clock of clocks) {
      const id = `${clock.prefix}treeLikelihood`;
      top.push(
        comment('Likelihood for tree given sequence data'),
        el('treeDataLikelihood', { id, useAmbiguities: false, usePreOrder: false }, [
          doc.partitions
            .filter((p) => p.clock === clock.instance.id)
            .map((p) =>
              el('partition', {}, [
                ref('patterns', patternsId(p.name)),
                ref('siteModel', siteModels.find((s) => s.substitution === p.substitution)!.id),
              ]),
            ),
          treeModel(),
          lookup('branchRates', clock.instance.id),
        ]),
      );
      likelihoods.push(ref('treeDataLikelihood', id));
    }

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
              .map((p) => priorElement(p.prior as PriorSpec, ref('parameter', p.id), treeModel)),
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

  result.xml =
    '<?xml version="1.0" standalone="yes"?>\n' +
    `<!-- Generated by BEAUtique v${BEAUTIQUE_VERSION} -->\n` +
    serialize(el('beast', { version: BEAST_XML_VERSION }, top), { spaceTopLevel: true }) +
    '\n';
  return result;
}
