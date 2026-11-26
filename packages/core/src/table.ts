import type { MetadataTable } from './data';

/** Split one line of delimited text, honouring double-quoted fields. */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"' && current === '') quoted = true;
    else if (c === delimiter) {
      fields.push(current.trim());
      current = '';
    } else current += c;
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a CSV or TSV file with a header row into a metadata table. The
 * delimiter is a tab if the header has one, otherwise a comma. The first
 * column is taken as the taxon key; that can be changed afterwards.
 */
export function parseTable(textValue: string, id: string, name: string): MetadataTable {
  const lines = textValue
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new Error(`"${name}" needs a header row and at least one row of data`);
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const columns = splitLine(lines[0], delimiter);
  if (columns.length < 2) throw new Error(`"${name}" is not a table: its first row has only one column`);
  if (columns.some((c) => c === '')) throw new Error(`"${name}" has a column with no name`);
  if (new Set(columns).size !== columns.length) throw new Error(`"${name}" has two columns with the same name`);
  const rows = lines.slice(1).map((line, i) => {
    const row = splitLine(line, delimiter);
    if (row.length > columns.length) {
      throw new Error(`"${name}", row ${i + 2}: ${row.length} values but only ${columns.length} columns`);
    }
    while (row.length < columns.length) row.push('');
    return row;
  });
  return { id, name, columns, rows, keyColumn: 0 };
}

/** True when the text looks like a delimited table, not sequence data or JSON. */
export function looksLikeTable(textValue: string): boolean {
  const first =
    textValue
      .replace(/^﻿/, '')
      .split(/\r\n|\n|\r/)
      .find((l) => l.trim() !== '') ?? '';
  return !/^\s*([>;{]|#NEXUS)/i.test(first) && /[\t,]/.test(first);
}
