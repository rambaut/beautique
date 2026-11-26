/** Adding and removing traits of a document, with the model instance each one has. All change the document in place. */

import type { DataSection, ValueSource } from './data';
import type { AnalysisDocument } from './document';
import type { Trait, TraitType } from './traits';

export interface NewTrait {
  name: string;
  type: TraitType;
  sources: ValueSource[];
  /** Id of the module (slot `trait`) to analyse it with. */
  module: string;
}

/** Add a trait and a model instance for it. The instance id is `trait-<name>`, made unique. */
export function addTrait(doc: AnalysisDocument, spec: NewTrait): Trait {
  const traits = (doc.traits ??= []);
  const stem = `trait-${spec.name.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
  let id = stem;
  for (let n = 2; doc.components.some((c) => c.id === id) || traits.some((t) => t.id === id); n++) id = `${stem}-${n}`;
  doc.components.push({ id, slot: 'trait', module: spec.module, name: spec.name, options: {} });
  const trait: Trait = { id, name: spec.name, type: spec.type, sources: spec.sources, model: id };
  traits.push(trait);
  return trait;
}

export function removeTrait(doc: AnalysisDocument, traitId: string): void {
  const trait = (doc.traits ?? []).find((t) => t.id === traitId);
  if (!trait) return;
  doc.traits = (doc.traits ?? []).filter((t) => t !== trait);
  doc.components = doc.components.filter((c) => c.id !== trait.model);
}

/** Change a trait between discrete and continuous, giving it a model of the new kind. */
export function setTraitType(doc: AnalysisDocument, traitId: string, type: TraitType, module: string): void {
  const trait = (doc.traits ?? []).find((t) => t.id === traitId);
  if (!trait || trait.type === type) return;
  trait.type = type;
  if (type === 'discrete') trait.sources = trait.sources.slice(0, 1);
  const instance = doc.components.find((c) => c.id === trait.model);
  if (instance) {
    instance.module = module;
    instance.options = {};
  }
}

/**
 * Read a source written as text: the name of a column of a metadata table, or
 * `field:N` (optionally `field:N:delimiter`) for the Nth field of the taxon
 * label, counting from 1, or from the end with a negative number.
 */
export function parseValueSource(textValue: string, data: DataSection): ValueSource {
  const text = textValue.trim();
  const m = /^field:(-?\d+)(?::(.+))?$/.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (n === 0) throw new Error(`"${text}": fields are counted from 1, or from the end with -1`);
    return { kind: 'labelField', delimiter: m[2] ?? '|', field: n > 0 ? n - 1 : n };
  }
  const tables = (data.tables ?? []).filter((t) => t.columns.includes(text));
  if (tables.length === 0) throw new Error(`No metadata table has a column called "${text}"`);
  if (tables.length > 1) throw new Error(`More than one metadata table has a column called "${text}"`);
  return { kind: 'column', table: tables[0].id, column: text };
}

/** A short description of a source, for lists and messages. */
export function describeValueSource(source: ValueSource, data: DataSection): string {
  if (source.kind === 'column') {
    const table = (data.tables ?? []).find((t) => t.id === source.table);
    return `${source.column} (${table?.name ?? 'missing table'})`;
  }
  const position = source.field < 0 ? (source.field === -1 ? 'last' : `${-source.field} from the end`) : `${source.field + 1}`;
  return `label field ${position}, split on "${source.delimiter}"`;
}
