/**
 * Sequence data, taxon labels and dates.
 *
 * Taxon labels may carry metadata as delimited fields (usually `|`). One field,
 * normally the first, is the key that links a taxon across sources. The taxon
 * list of an analysis is the union of the keys found in all sources.
 */

import type { Issue } from './module-api';

export interface LabelRule {
  /** Field delimiter. An empty string means labels are not split. */
  delimiter: string;
  /** Index of the field used as the taxon key, or 'label' for the whole label. */
  keyField: number | 'label';
}

export interface SequenceRecord {
  label: string;
  sequence: string;
}

/** A set of alignment columns, as in BEAST's `<patterns from to every>`. Positions are 1-based. */
export interface SiteRange {
  from?: number;
  to?: number;
  every?: number;
}

export interface CharSet {
  name: string;
  ranges: SiteRange[];
}

/** Number of sites selected by the ranges (all sites when there are none). */
export function countSites(ranges: SiteRange[] | undefined, nchar: number): number {
  if (!ranges || ranges.length === 0) return nchar;
  let count = 0;
  for (const range of ranges) {
    const from = range.from ?? 1;
    const to = Math.min(range.to ?? nchar, nchar);
    if (to >= from) count += Math.floor((to - from) / (range.every ?? 1)) + 1;
  }
  return count;
}

export interface AlignmentData {
  id: string;
  name: string;
  dataType: 'nucleotide';
  labelRule: LabelRule;
  sequences: SequenceRecord[];
  /** Named site sets from the source file (NEXUS charsets); each becomes a partition. */
  charsets?: CharSet[];
}

/** A table of metadata about the taxa, from a CSV or TSV file. One column holds the taxon key. */
export interface MetadataTable {
  id: string;
  name: string;
  columns: string[];
  rows: string[][];
  /** Index of the column that identifies the taxon: its key or its whole label. */
  keyColumn: number;
  /** When false, rows for taxa that are in no alignment are ignored instead of adding taxa. */
  addsTaxa?: boolean;
}

/** Where a value for each taxon is read from: a field of its label, or a column of a metadata table. */
export type ValueSource =
  | { kind: 'labelField'; delimiter: string; field: number }
  | { kind: 'column'; table: string; column: string };

export interface DateSpec {
  /**
   * auto: detect when data is attached (used in templates);
   * none: tips are not dated;
   * labelField: read the date from a delimited field of the label;
   * column: read the date from a column of a metadata table.
   */
  mode: 'auto' | 'none' | 'labelField' | 'column';
  /** Delimiter used to find the date field (independent of the key delimiter). */
  delimiter: string;
  /** Zero-based field index; negative values count from the end (-1 is the last field). */
  field: number;
  /** For mode `column`: the id of the table and the name of its column. */
  table?: string;
  column?: string;
}

export type TaxonIdStyle = 'label' | 'key';

export interface DataSection {
  alignments: AlignmentData[];
  /** Metadata tables. Their taxa are added to those of the alignments. */
  tables?: MetadataTable[];
  dates: DateSpec;
  /** Whether XML taxon ids are the full original label or only the key. */
  taxonIdStyle: TaxonIdStyle;
}

export interface Taxon {
  key: string;
  /** The id used in the XML. */
  id: string;
  /** The label as first seen. */
  label: string;
  /** Decimal year, when dated. */
  date?: number;
  datePrecision?: DatePrecision;
  /** Ids of the sources that contain this taxon. */
  sources: string[];
}

export type DatePrecision = 'decimal' | 'day' | 'month' | 'year';

export interface ParsedDate {
  value: number;
  precision: DatePrecision;
}

export function splitLabel(label: string, delimiter: string): string[] {
  return delimiter === '' ? [label] : label.split(delimiter);
}

export function taxonKey(label: string, rule: LabelRule): string {
  if (rule.keyField === 'label' || rule.delimiter === '') return label;
  const fields = splitLabel(label, rule.delimiter);
  return fields[rule.keyField] ?? label;
}

function field(label: string, delimiter: string, index: number): string | undefined {
  const fields = splitLabel(label, delimiter);
  return fields[index < 0 ? fields.length + index : index];
}

/**
 * Choose a label rule for a set of labels: split on `|` and use the first field
 * as the key when that gives a unique key for every label, otherwise use the
 * whole label.
 */
export function detectLabelRule(labels: string[]): LabelRule {
  const delimiter = '|';
  if (labels.length > 0 && labels.every((l) => l.includes(delimiter))) {
    const keys = new Set(labels.map((l) => splitLabel(l, delimiter)[0]));
    if (keys.size === labels.length && !keys.has('')) return { delimiter, keyField: 0 };
    return { delimiter, keyField: 'label' };
  }
  return { delimiter: '', keyField: 'label' };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Parse a date into a decimal year. Accepted forms: a decimal year (2014.37),
 * yyyy-MM-dd, yyyy-MM (taken as the middle of the month) and yyyy (taken as
 * the number itself, as BEAUti does).
 */
export function parseDate(textValue: string): ParsedDate | null {
  const value = textValue.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const leap = isLeapYear(year);
    const monthDays = DAYS_IN_MONTH[month - 1] + (leap && month === 2 ? 1 : 0);
    if (month < 1 || month > 12 || day < 1 || day > monthDays) return null;
    const dayOfYear = DAYS_BEFORE_MONTH[month - 1] + (leap && month > 2 ? 1 : 0) + day;
    return { value: year + (dayOfYear - 1) / (leap ? 366 : 365), precision: 'day' };
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(value);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    const leap = isLeapYear(year);
    const monthDays = DAYS_IN_MONTH[month - 1] + (leap && month === 2 ? 1 : 0);
    const start = DAYS_BEFORE_MONTH[month - 1] + (leap && month > 2 ? 1 : 0);
    return { value: year + (start + monthDays / 2) / (leap ? 366 : 365), precision: 'month' };
  }
  if (/^\d{4}$/.test(value)) return { value: Number(value), precision: 'year' };
  if (/^\d{1,4}\.\d+$/.test(value)) return { value: Number(value), precision: 'decimal' };
  return null;
}

/**
 * Look for a delimited field that parses as a date in every label. Tries the
 * last field, then the first, then the others, for each candidate delimiter.
 */
export function detectDateSpec(labels: string[]): DateSpec {
  const none: DateSpec = { mode: 'none', delimiter: '|', field: -1 };
  if (labels.length === 0) return none;
  for (const delimiter of ['|', '_', '/']) {
    const counts = labels.map((l) => splitLabel(l, delimiter).length);
    const minFields = Math.min(...counts);
    if (minFields < 2) continue;
    const candidates = [-1, 0];
    for (let i = 1; i < minFields - 1; i++) candidates.push(i);
    for (const index of candidates) {
      if (labels.every((l) => parseDate(field(l, delimiter, index) ?? '') !== null)) {
        return { mode: 'labelField', delimiter, field: index };
      }
    }
  }
  return none;
}

/** Whether the table and column that a source names exist (always true for a label field). */
export function sourceExists(data: DataSection, source: ValueSource): boolean {
  if (source.kind === 'labelField') return true;
  return (data.tables ?? []).some((t) => t.id === source.table && t.columns.includes(source.column));
}

/**
 * A function that reads a taxon's value from a source: undefined when the
 * taxon has no such field or no row in the table. Values are trimmed.
 */
export function valueReader(data: DataSection): (taxon: Taxon, source: ValueSource) => string | undefined {
  const keyOfLabel = new Map<string, string>();
  for (const alignment of data.alignments) {
    for (const record of alignment.sequences) keyOfLabel.set(record.label, taxonKey(record.label, alignment.labelRule));
  }
  type Index = { table: MetadataTable; byKey: Map<string, string[]> };
  const indexes = new Map<string, Index>();
  const index = (id: string): Index | undefined => {
    let entry = indexes.get(id);
    const table = (data.tables ?? []).find((t) => t.id === id);
    if (!entry && table) {
      const byKey = new Map<string, string[]>();
      for (const row of table.rows) {
        const value = (row[table.keyColumn] ?? '').trim();
        const key = keyOfLabel.get(value) ?? value;
        if (!byKey.has(key)) byKey.set(key, row);
      }
      entry = { table, byKey };
      indexes.set(id, entry);
    }
    return entry;
  };
  return (taxon, source) => {
    if (source.kind === 'labelField') return field(taxon.label, source.delimiter, source.field)?.trim();
    const entry = index(source.table);
    const column = entry ? entry.table.columns.indexOf(source.column) : -1;
    return column < 0 ? undefined : entry?.byKey.get(taxon.key)?.[column]?.trim();
  };
}

export interface DerivedTaxa {
  taxa: Taxon[];
  issues: Issue[];
}

/** Build the taxon list (the union across all sources) and assign dates. */
export function deriveTaxa(data: DataSection): DerivedTaxa {
  const issues: Issue[] = [];
  const byKey = new Map<string, Taxon>();

  for (const alignment of data.alignments) {
    const seen = new Set<string>();
    for (const record of alignment.sequences) {
      const key = taxonKey(record.label, alignment.labelRule);
      if (seen.has(key)) {
        issues.push({
          severity: 'error',
          message: `"${alignment.name}" has more than one sequence for taxon "${key}"`,
        });
        continue;
      }
      seen.add(key);
      let taxon = byKey.get(key);
      if (!taxon) {
        taxon = {
          key,
          id: data.taxonIdStyle === 'key' ? key : record.label,
          label: record.label,
          sources: [],
        };
        byKey.set(key, taxon);
      }
      taxon.sources.push(alignment.id);
    }
  }

  // A table's key column may hold taxon keys or whole labels. Rows for other taxa add them.
  const keyOfLabel = new Map([...byKey.values()].map((t) => [t.label, t.key]));
  for (const table of data.tables ?? []) {
    const seen = new Set<string>();
    let unmatched = 0;
    for (const row of table.rows) {
      const value = (row[table.keyColumn] ?? '').trim();
      if (value === '') continue;
      const key = byKey.has(value) ? value : (keyOfLabel.get(value) ?? value);
      if (seen.has(key)) {
        issues.push({ severity: 'error', message: `"${table.name}" has more than one row for taxon "${key}"` });
        continue;
      }
      seen.add(key);
      let taxon = byKey.get(key);
      if (!taxon) {
        unmatched++;
        if (table.addsTaxa === false) continue;
        taxon = { key, id: key, label: key, sources: [] };
        byKey.set(key, taxon);
      }
      taxon.sources.push(table.id);
    }
    if (unmatched > 0 && data.alignments.length > 0) {
      issues.push({
        severity: 'warning',
        message:
          table.addsTaxa === false
            ? `${unmatched} rows of "${table.name}" are for taxa with no sequence and are ignored`
            : `${unmatched} rows of "${table.name}" are for taxa with no sequence; they are added to the analysis`,
      });
    }
  }

  const taxa = [...byKey.values()];

  const ids = new Set<string>();
  for (const taxon of taxa) {
    if (ids.has(taxon.id)) {
      issues.push({ severity: 'error', message: `Taxon id "${taxon.id}" is not unique` });
    }
    ids.add(taxon.id);
  }

  if (data.dates.mode === 'labelField' || data.dates.mode === 'column') {
    const undated: string[] = [];
    const source: ValueSource =
      data.dates.mode === 'column'
        ? { kind: 'column', table: data.dates.table ?? '', column: data.dates.column ?? '' }
        : { kind: 'labelField', delimiter: data.dates.delimiter, field: data.dates.field };
    const read = valueReader(data);
    if (!sourceExists(data, source)) {
      issues.push({ severity: 'error', message: 'Choose the metadata column that holds the sampling dates' });
    }
    for (const taxon of taxa) {
      const parsed = parseDate(read(taxon, source) ?? '');
      if (parsed) {
        taxon.date = parsed.value;
        taxon.datePrecision = parsed.precision;
      } else {
        undated.push(taxon.label);
      }
    }
    if (undated.length > 0) {
      const sample = undated.slice(0, 3).join(', ') + (undated.length > 3 ? ', ...' : '');
      issues.push({
        severity: 'error',
        message:
          data.dates.mode === 'column'
            ? `No date could be read for ${undated.length} of ${taxa.length} taxa (${sample})`
            : `No date could be read from ${undated.length} of ${taxa.length} taxon labels (${sample})`,
      });
    }
  }

  for (const alignment of data.alignments) {
    const missing = taxa.filter((t) => !t.sources.includes(alignment.id)).length;
    if (missing > 0) {
      issues.push({
        severity: 'warning',
        message: `${missing} taxa have no sequence in "${alignment.name}" and will be written as missing data`,
      });
    }
  }

  return { taxa, issues };
}
