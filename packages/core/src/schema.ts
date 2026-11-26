/**
 * Declarative option schemas. A module describes its settings with these field
 * types; the app renders a stock control for each, and the same validation runs
 * in the app, in template resolution and in the CLI.
 *
 * There are scalar types, and references to the shared objects of an analysis
 * (taxon sets and timelines). Vector, matrix, distribution, group and list
 * types are added with the features that need them.
 */

/** A serialisable condition on another field of the same schema. */
export interface Condition {
  field: string;
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
}

interface FieldBase {
  label: string;
  help?: string;
  /** The field is shown (and validated) only when this holds. */
  visibleWhen?: Condition;
}

export interface TextField extends FieldBase {
  type: 'text';
  default?: string;
  required?: boolean;
  /** Regular expression the whole value must match. */
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface IntegerField extends FieldBase {
  type: 'integer';
  default?: number;
  /** When true the value may be left empty; the module decides what that means. */
  optional?: boolean;
  min?: number;
  max?: number;
  step?: number;
  units?: string;
}

export interface RealField extends FieldBase {
  type: 'real';
  default?: number;
  /** When true the value may be left empty; the module decides what that means. */
  optional?: boolean;
  min?: number;
  max?: number;
  /** When true the value must be strictly greater than `min`. */
  exclusiveMin?: boolean;
  /** When true the value must be strictly less than `max`. */
  exclusiveMax?: boolean;
  step?: number;
  units?: string;
}

export interface BooleanField extends FieldBase {
  type: 'boolean';
  default?: boolean;
}

export interface Choice {
  value: string;
  label: string;
  help?: string;
}

export interface ChoiceField extends FieldBase {
  type: 'choice';
  default?: string;
  choices: Choice[];
}

/** A reference to one taxon set (the value is its id, or null), or with `multiple` to several (an array of ids). */
export interface TaxonSetRefField extends FieldBase {
  type: 'taxonSetRef';
  multiple?: boolean;
  /** At least one set must be chosen. */
  required?: boolean;
}

/** A reference to a timeline (the value is its id, or null). */
export interface TimelineRefField extends FieldBase {
  type: 'timelineRef';
  required?: boolean;
}

export type FieldSchema =
  | TextField
  | IntegerField
  | RealField
  | BooleanField
  | ChoiceField
  | TaxonSetRefField
  | TimelineRefField;

/** The shared objects that reference fields may point to. */
export interface SchemaRefs {
  taxonSets: { id: string; name: string }[];
  timelines: { id: string; name: string }[];
}
export type OptionsSchema = Record<string, FieldSchema>;
export type OptionValues = Record<string, unknown>;

export interface FieldIssue {
  field: string;
  message: string;
}

function fallback(field: FieldSchema): unknown {
  if ('default' in field && field.default !== undefined) return field.default;
  switch (field.type) {
    case 'text':
      return '';
    case 'boolean':
      return false;
    case 'choice':
      return field.choices[0]?.value;
    case 'taxonSetRef':
      return field.multiple ? [] : null;
    case 'timelineRef':
      return null;
    default:
      return undefined;
  }
}

/** Fill in defaults for every field that has no explicit value. Unknown keys are dropped. */
export function resolveOptions(schema: OptionsSchema, values: OptionValues = {}): OptionValues {
  const resolved: OptionValues = {};
  for (const [key, field] of Object.entries(schema)) {
    const value = values[key];
    resolved[key] = value === undefined || value === null ? fallback(field) : value;
  }
  return resolved;
}

export function conditionHolds(condition: Condition | undefined, values: OptionValues): boolean {
  if (!condition) return true;
  const value = values[condition.field];
  if ('equals' in condition && value !== condition.equals) return false;
  if ('notEquals' in condition && value === condition.notEquals) return false;
  if (condition.in && !condition.in.includes(value)) return false;
  return true;
}

export function isVisible(field: FieldSchema, values: OptionValues): boolean {
  return conditionHolds(field.visibleWhen, values);
}

/**
 * Validate one value against its field. Returns a message, or null when valid.
 * References are checked against `refs` when it is given.
 */
export function validateField(field: FieldSchema, value: unknown, refs?: SchemaRefs): string | null {
  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string') return 'must be text';
      if (field.required && value.trim() === '') return 'is required';
      if (field.minLength !== undefined && value.length < field.minLength) {
        return `must be at least ${field.minLength} characters`;
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `must be at most ${field.maxLength} characters`;
      }
      if (field.pattern && value !== '' && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
        return 'is not in the expected format';
      }
      return null;
    }
    case 'integer':
    case 'real': {
      if (field.optional && (value === undefined || value === null)) return null;
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (field.type === 'integer' && !Number.isInteger(value)) return 'must be a whole number';
      const exclusiveMin = field.type === 'real' && field.exclusiveMin;
      const exclusiveMax = field.type === 'real' && field.exclusiveMax;
      if (field.min !== undefined && (exclusiveMin ? value <= field.min : value < field.min)) {
        return exclusiveMin ? `must be greater than ${field.min}` : `must be at least ${field.min}`;
      }
      if (field.max !== undefined && (exclusiveMax ? value >= field.max : value > field.max)) {
        return exclusiveMax ? `must be less than ${field.max}` : `must be at most ${field.max}`;
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'choice':
      return field.choices.some((c) => c.value === value)
        ? null
        : `must be one of: ${field.choices.map((c) => c.value).join(', ')}`;
    case 'taxonSetRef': {
      const ids = field.multiple ? value : value === null || value === undefined ? [] : [value];
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return 'must refer to taxon sets';
      if (field.required && ids.length === 0) {
        return field.multiple ? 'needs at least one taxon set' : 'needs a taxon set';
      }
      if (refs && ids.some((id) => !refs.taxonSets.some((s) => s.id === id))) {
        return 'refers to a taxon set that no longer exists';
      }
      return null;
    }
    case 'timelineRef':
      if (value === null || value === undefined) return field.required ? 'needs a timeline' : null;
      if (typeof value !== 'string') return 'must refer to a timeline';
      if (refs && !refs.timelines.some((t) => t.id === value)) return 'refers to a timeline that no longer exists';
      return null;
  }
}

/** Validate resolved values against a schema. Hidden fields are not validated. */
export function validateOptions(schema: OptionsSchema, values: OptionValues, refs?: SchemaRefs): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const [key, field] of Object.entries(schema)) {
    if (!isVisible(field, values)) continue;
    const message = validateField(field, values[key], refs);
    if (message) issues.push({ field: key, message: `${field.label} ${message}` });
  }
  return issues;
}

/**
 * Convert a string (from the command line or a text input) into a value of the
 * field's type. References may be given by name or id when `refs` is given;
 * several taxon sets are separated by commas.
 */
export function coerceValue(field: FieldSchema, raw: string, refs?: SchemaRefs): unknown {
  const idOf = (list: { id: string; name: string }[] | undefined, text: string): string =>
    list?.find((item) => item.id === text || item.name === text)?.id ?? text;
  switch (field.type) {
    case 'integer':
    case 'real': {
      const n = Number(raw);
      return raw.trim() === '' ? Number.NaN : n;
    }
    case 'boolean':
      if (/^(true|yes|1|on)$/i.test(raw)) return true;
      if (/^(false|no|0|off)$/i.test(raw)) return false;
      return raw;
    case 'taxonSetRef': {
      const names = raw.split(',').map((n) => n.trim()).filter((n) => n !== '');
      const ids = names.map((n) => idOf(refs?.taxonSets, n));
      return field.multiple ? ids : (ids[0] ?? null);
    }
    case 'timelineRef':
      return raw.trim() === '' ? null : idOf(refs?.timelines, raw.trim());
    default:
      return raw;
  }
}
