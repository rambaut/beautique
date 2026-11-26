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
import { setInstanceModule } from './partitions';
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

/**
 * Set a setting by path, in place. String values are converted to the
 * setting's type. Throws if the path is unknown or the value is invalid.
 */
export function setSetting(doc: AnalysisDocument, registry: ModuleRegistry, path: string, value: unknown): void {
  const [head, ...rest] = path.split('.');
  let field: FieldSchema | undefined;
  let assign: ((v: unknown) => void) | undefined;

  if (path === 'name') {
    field = nameField;
    assign = (v) => {
      doc.name = v as string;
    };
  } else if (head === 'mcmc' && rest.length === 1) {
    field = mcmcSchema[rest[0]];
    assign = (v) => {
      (doc.mcmc as Record<string, unknown>)[rest[0]] = v;
    };
  } else if (head === 'models' && rest.length === 2 && rest[1] === 'module') {
    const instance = doc.components.find((c) => c.id === rest[0]);
    field = instance && moduleField(registry, instance.slot);
    assign = (v) => setInstanceModule(doc, rest[0], v as string);
  } else if (head === 'models' && rest.length === 2) {
    const instance = doc.components.find((c) => c.id === rest[0]);
    field = instance && registry.get(instance.module)?.options?.[rest[1]];
    assign = (v) => {
      instance!.options[rest[1]] = v;
    };
  }
  if (!field || !assign) throw new Error(`Unknown setting "${path}"`);

  const refs = schemaRefs(doc);
  const typed = typeof value === 'string' ? coerceValue(field, value, refs) : value;
  const message = validateField(field, typed, refs);
  if (message) throw new Error(`${path}: ${field.label} ${message}`);
  assign(typed);
}
