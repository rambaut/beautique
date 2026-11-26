/**
 * Settings addressed by path, as used by templates ("ask" lists), the CLI
 * (`--set path=value`) and the app's template mode.
 *
 * Paths: `name`, `mcmc.<setting>`, `models.<instanceId>.<option>`, and
 * `models.<instanceId>.module` to choose which module an instance uses.
 * Options that refer to taxon sets or timelines take their names.
 */

import { mcmcSchema, schemaRefs, type AnalysisDocument } from './document';
import { SLOT_LABELS, type Slot } from './module-api';
import { setInstanceModule, usedInstanceIds } from './partitions';
import type { ModuleRegistry } from './registry';
import { coerceValue, isVisible, resolveOptions, validateField, type FieldSchema } from './schema';

export interface SettingInfo {
  path: string;
  /** Heading the setting belongs under, e.g. "MCMC" or "Molecular clock: Strict clock". */
  group: string;
  field: FieldSchema;
  /** Current value, with defaults filled in. */
  value: unknown;
  /** True when the document sets the value explicitly (otherwise it is the default). */
  explicit: boolean;
  /** True when a template marks this setting to be asked for. */
  ask: boolean;
}

const nameField: FieldSchema = {
  type: 'text',
  label: 'Analysis name',
  help: 'Used as the stem of the output file names.',
  required: true,
  pattern: '[^\\s/\\\\]+',
};

function moduleField(registry: ModuleRegistry, slot: Slot): FieldSchema {
  return {
    type: 'choice',
    label: SLOT_LABELS[slot],
    choices: registry.bySlot(slot).map((m) => ({ value: m.id, label: m.label })),
  };
}

/** All settings of a document that are currently applicable. */
export function listSettings(doc: AnalysisDocument, registry: ModuleRegistry): SettingInfo[] {
  const ask = new Set(doc.template?.ask ?? []);
  const settings: SettingInfo[] = [
    { path: 'name', group: 'Analysis', field: nameField, value: doc.name, explicit: true, ask: ask.has('name') },
  ];

  const used = new Set<string | null>([
    ...doc.partitions.flatMap((p) => [p.substitution, p.siteHeterogeneity, p.clock]),
    doc.tree.tree,
    doc.tree.startingTree,
    doc.tree.treePrior,
    ...(doc.traits ?? []).map((t) => t.model),
  ]);
  for (const instance of doc.components) {
    if (!used.has(instance.id)) continue;
    const module = registry.get(instance.module);
    const modulePath = `models.${instance.id}.module`;
    settings.push({
      path: modulePath,
      group: `${SLOT_LABELS[instance.slot]}: ${module?.label ?? instance.module}`,
      field: moduleField(registry, instance.slot),
      value: instance.module,
      explicit: true,
      ask: ask.has(modulePath),
    });
    if (!module?.options) continue;
    const resolved = resolveOptions(module.options, instance.options);
    for (const [key, field] of Object.entries(module.options)) {
      if (!isVisible(field, resolved)) continue;
      const path = `models.${instance.id}.${key}`;
      settings.push({
        path,
        group: `${SLOT_LABELS[module.slot]}: ${module.label}`,
        field,
        value: resolved[key],
        explicit: instance.options[key] !== undefined,
        ask: ask.has(path),
      });
    }
  }

  const mcmc = resolveOptions(mcmcSchema, doc.mcmc);
  for (const [key, field] of Object.entries(mcmcSchema)) {
    const path = `mcmc.${key}`;
    settings.push({
      path,
      group: 'MCMC',
      field,
      value: mcmc[key],
      explicit: (doc.mcmc as Record<string, unknown>)[key] !== undefined,
      ask: ask.has(path),
    });
  }
  return settings;
}

/** The settings a template asks for. */
export function openSettings(doc: AnalysisDocument, registry: ModuleRegistry): SettingInfo[] {
  return listSettings(doc, registry).filter((s) => s.ask);
}

/** The field that describes a setting, or undefined when the path is not one of the document's settings. */
export function settingField(doc: AnalysisDocument, registry: ModuleRegistry, path: string): FieldSchema | undefined {
  const [head, ...rest] = path.split('.');
  if (path === 'name') return nameField;
  if (head === 'mcmc' && rest.length === 1) return mcmcSchema[rest[0]];
  if (head !== 'models' || rest.length !== 2) return undefined;
  const instance = doc.components.find((c) => c.id === rest[0]);
  if (!instance) return undefined;
  return rest[1] === 'module' ? moduleField(registry, instance.slot) : registry.get(instance.module)?.options?.[rest[1]];
}

/**
 * Give a setting a value without checking it (the app does this as the user
 * types, and shows what is wrong). `undefined` puts back the default. Unknown
 * paths are ignored.
 */
export function assignSetting(doc: AnalysisDocument, path: string, value: unknown): void {
  const [head, ...rest] = path.split('.');
  if (path === 'name') doc.name = String(value ?? '');
  else if (head === 'mcmc' && rest.length === 1) {
    if (value === undefined) delete (doc.mcmc as Record<string, unknown>)[rest[0]];
    else (doc.mcmc as Record<string, unknown>)[rest[0]] = value;
  } else if (head === 'models' && rest.length === 2 && rest[1] === 'module') {
    if (typeof value === 'string') setInstanceModule(doc, rest[0], value);
  } else if (head === 'models' && rest.length === 2) {
    const instance = doc.components.find((c) => c.id === rest[0]);
    if (!instance) return;
    if (value === undefined) delete instance.options[rest[1]];
    else instance.options[rest[1]] = value;
  }
}

/**
 * Set a setting by path, in place. String values are converted to the
 * setting's type. Throws if the path is unknown or the value is invalid.
 */
export function setSetting(doc: AnalysisDocument, registry: ModuleRegistry, path: string, value: unknown): void {
  const field = settingField(doc, registry, path);
  if (!field) throw new Error(`Unknown setting "${path}"`);
  const refs = schemaRefs(doc);
  const typed = typeof value === 'string' ? coerceValue(field, value, refs) : value;
  const message = validateField(field, typed, refs);
  if (message) throw new Error(`${path}: ${field.label} ${message}`);
  assignSetting(doc, path, typed);
}

export interface TemplateOptions {
  description?: string;
  /** Paths of the settings to ask for when the template is applied. */
  ask?: string[];
}

/**
 * Make a template from a project: the models, settings, timelines and traits
 * without the data. The partitions of the first alignment are kept, unbound,
 * so a codon-position split carries over; taxon sets keep their names and
 * constraints but lose their taxa, which belong to the data, as does the
 * analysis name. Returns a new document.
 */
export function makeTemplate(doc: AnalysisDocument, options: TemplateOptions = {}): AnalysisDocument {
  const template: AnalysisDocument = structuredClone({
    ...doc,
    data: { ...doc.data, alignments: [], tables: [] },
  });
  template.kind = 'template';
  // the name usually came from the data; an analysis made with the template takes the name of its own
  template.name = 'analysis';
  const first = doc.partitions[0]?.alignment ?? null;
  template.partitions = template.partitions.filter((p) => p.alignment === first).map((p) => ({ ...p, alignment: null }));
  if (template.partitions.length === 1) {
    template.partitions[0].id = 'partition';
    template.partitions[0].name = '';
  }
  const used = usedInstanceIds(template);
  template.components = template.components.filter((c) => used.has(c.id));
  template.taxonSets = (template.taxonSets ?? []).map((set) => ({ ...set, taxa: [] }));
  const keep = (key: string): boolean => used.has(key.split('/')[0]) || key.startsWith('relativeRates:');
  template.parameters = Object.fromEntries(Object.entries(template.parameters).filter(([key]) => keep(key)));
  template.operators = Object.fromEntries(Object.entries(template.operators).filter(([key]) => keep(key)));
  template.template = {
    description: options.description ?? doc.template?.description ?? '',
    ask: options.ask ?? doc.template?.ask ?? ['name', 'mcmc.chainLength'],
  };
  return template;
}

/**
 * What a template expects of the data it is applied to, in words: where the
 * dates and trait values are read from, and the taxon sets to fill in.
 */
export function templateRequirements(doc: AnalysisDocument): string[] {
  const needs: string[] = [];
  const dates = doc.data.dates;
  const position = (field: number): string => (field < 0 ? (field === -1 ? 'the last field' : `field ${-field} from the end`) : `field ${field + 1}`);
  const table = (id: string): string => {
    const n = /^table-(\d+)$/.exec(id);
    return n ? (n[1] === '1' ? 'the first metadata table' : `metadata table ${n[1]}`) : 'a metadata table';
  };
  if (dates.mode === 'labelField') {
    needs.push(`Sampling dates in ${position(dates.field)} of the taxon labels, split on "${dates.delimiter}"`);
  } else if (dates.mode === 'column') {
    needs.push(`Sampling dates in the column "${dates.column}" of ${table(dates.table ?? '')}`);
  } else if (dates.mode === 'none') {
    needs.push('No sampling dates are used');
  }
  for (const trait of doc.traits ?? []) {
    const sources = trait.sources.map((s) =>
      s.kind === 'column'
        ? `the column "${s.column}" of ${table(s.table)}`
        : `${position(s.field)} of the taxon labels, split on "${s.delimiter}"`,
    );
    needs.push(`Trait "${trait.name}" (${trait.type}) from ${sources.join(' and ') || 'a source to be chosen'}`);
  }
  for (const set of doc.taxonSets ?? []) {
    if (set.taxa.length === 0) needs.push(`Taxa for the taxon set "${set.name}"`);
  }
  if (doc.partitions.length > 1 && doc.partitions.every((p) => p.alignment === null)) {
    needs.push(`A protein-coding alignment in frame, split into ${doc.partitions.map((p) => p.name).join(', ')}`);
  }
  return needs;
}
