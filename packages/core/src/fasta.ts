import { detectLabelRule, type AlignmentData, type SequenceRecord } from './data';

/** Parse FASTA text into labelled sequences. The whole header line is the label. */
export function parseFasta(textValue: string): SequenceRecord[] {
  const records: SequenceRecord[] = [];
  let label: string | null = null;
  let parts: string[] = [];
  const flush = (): void => {
    if (label !== null) records.push({ label, sequence: parts.join('') });
  };
  for (const rawLine of textValue.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      flush();
      label = line.slice(1).trim();
      parts = [];
    } else if (label === null) {
      throw new Error('Not a FASTA file: sequence data found before the first ">" header');
    } else {
      parts.push(line.replace(/\s+/g, ''));
    }
  }
  flush();
  if (records.length === 0) throw new Error('No sequences found in the FASTA file');
  return records;
}

/** Build an alignment from FASTA text, checking that it is aligned. */
export function alignmentFromFasta(textValue: string, id: string, name: string): AlignmentData {
  const sequences = parseFasta(textValue);
  const length = sequences[0].sequence.length;
  const ragged = sequences.find((s) => s.sequence.length !== length);
  if (ragged) {
    throw new Error(
      `"${name}" is not aligned: "${ragged.label}" has ${ragged.sequence.length} sites but "${sequences[0].label}" has ${length}`,
    );
  }
  const empty = sequences.find((s) => s.label === '');
  if (empty) throw new Error(`"${name}" contains a sequence with no label`);
  return {
    id,
    name,
    dataType: 'nucleotide',
    labelRule: detectLabelRule(sequences.map((s) => s.label)),
    sequences,
  };
}
