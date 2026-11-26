import type { CharSet, SequenceRecord, SiteRange } from './data';

export interface NexusData {
  sequences: SequenceRecord[];
  charsets: CharSet[];
}

/** Remove [comments], leaving quoted text alone. */
function stripComments(source: string): string {
  let out = '';
  let depth = 0;
  let quoted = false;
  for (const ch of source) {
    if (depth === 0 && ch === "'") quoted = !quoted;
    if (!quoted && ch === '[') depth++;
    else if (!quoted && ch === ']' && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

/** Split into commands at semicolons that are outside quotes. */
function commands(source: string): string[] {
  const list: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of source) {
    if (ch === "'") quoted = !quoted;
    if (ch === ';' && !quoted) {
      list.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') list.push(current.trim());
  return list;
}

/** Read a possibly quoted taxon label from the start of a line. Returns the label and the rest. */
function readLabel(line: string): [string, string] {
  if (line.startsWith("'")) {
    let label = '';
    let i = 1;
    while (i < line.length) {
      if (line[i] === "'") {
        if (line[i + 1] === "'") {
          label += "'";
          i += 2;
          continue;
        }
        break;
      }
      label += line[i++];
    }
    return [label, line.slice(i + 1)];
  }
  if (line.startsWith('"')) {
    const end = line.indexOf('"', 1);
    return end < 0 ? [line.slice(1), ''] : [line.slice(1, end), line.slice(end + 1)];
  }
  const m = /^(\S+)([\s\S]*)$/.exec(line);
  return m ? [m[1], m[2]] : [line, ''];
}

function parseRanges(spec: string, name: string): SiteRange[] {
  const ranges: SiteRange[] = [];
  for (const token of spec.trim().split(/\s+/)) {
    const m = /^(\d+)(?:-(\d+|\.))?(?:\\(\d+))?$/.exec(token);
    if (!m) throw new Error(`Cannot read the site range "${token}" in charset "${name}"`);
    const from = Number(m[1]);
    const range: SiteRange = { from };
    if (m[2] === undefined) range.to = from;
    else if (m[2] !== '.') range.to = Number(m[2]);
    if (m[3] !== undefined) range.every = Number(m[3]);
    ranges.push(range);
  }
  return ranges;
}

/** Parse the sequence matrix and charsets from a NEXUS file. */
export function parseNexus(source: string): NexusData {
  if (!/^\s*#NEXUS/i.test(source)) throw new Error('Not a NEXUS file: it does not start with #NEXUS');

  const sequences = new Map<string, string>();
  const charsets: CharSet[] = [];
  let block = '';
  let nchar: number | undefined;
  let interleave = false;
  let matchChar: string | undefined;

  for (const command of commands(stripComments(source.replace(/^\s*#NEXUS/i, '')))) {
    const word = (/^\S+/.exec(command)?.[0] ?? '').toLowerCase();
    if (word === 'begin') {
      block = command.slice(5).trim().toLowerCase();
    } else if (word === 'end' || word === 'endblock') {
      block = '';
    } else if (word === 'charset') {
      const m = /^charset\s+('[^']*'|\S+)\s*=\s*([\s\S]*)$/i.exec(command);
      if (!m) throw new Error(`Cannot read the charset definition "${command}"`);
      const name = m[1].replace(/^'|'$/g, '');
      charsets.push({ name, ranges: parseRanges(m[2], name) });
    } else if (block === 'data' || block === 'characters') {
      if (word === 'dimensions') {
        const m = /nchar\s*=\s*(\d+)/i.exec(command);
        if (m) nchar = Number(m[1]);
      } else if (word === 'format') {
        const type = /datatype\s*=\s*(\w+)/i.exec(command)?.[1].toLowerCase();
        if (type && !['dna', 'rna', 'nucleotide'].includes(type)) {
          throw new Error(`Only nucleotide data is supported; this file has datatype=${type}`);
        }
        interleave = /\binterleave\b(?!\s*=\s*no)/i.test(command);
        matchChar = /matchchar\s*=\s*(\S)/i.exec(command)?.[1];
      } else if (word === 'matrix') {
        let current: string | null = null;
        for (const rawLine of command.slice(6).split(/\r\n|\n|\r/)) {
          const line = rawLine.trim();
          if (line === '') continue;
          const filling =
            !interleave && current !== null && nchar !== undefined && (sequences.get(current) ?? '').length < nchar;
          if (filling) {
            sequences.set(current as string, sequences.get(current as string) + line.replace(/\s+/g, ''));
          } else {
            const [label, rest] = readLabel(line);
            current = label;
            sequences.set(label, (sequences.get(label) ?? '') + rest.replace(/\s+/g, ''));
          }
        }
      }
    }
  }

  if (sequences.size === 0) throw new Error('No sequence matrix found in the NEXUS file');
  const records = [...sequences].map(([label, sequence]) => ({ label, sequence }));
  if (matchChar) {
    const first = records[0].sequence;
    for (const record of records.slice(1)) {
      record.sequence = [...record.sequence].map((ch, i) => (ch === matchChar ? (first[i] ?? ch) : ch)).join('');
    }
  }
  return { sequences: records, charsets };
}
