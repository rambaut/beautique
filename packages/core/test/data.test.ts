import { describe, expect, it } from 'vitest';
import { deriveTaxa, detectDateSpec, detectLabelRule, parseDate, taxonKey, type AlignmentData } from '../src/data';
import { countSites } from '../src/data';
import { alignmentFromFasta, alignmentFromText, parseFasta } from '../src/fasta';
import { parseNexus } from '../src/nexus';
import { defaultPrior, describePrior, validatePrior } from '../src/priors';

describe('dates', () => {
  it('parses the supported date forms to decimal years', () => {
    // value BEAUti writes for this Makona label
    expect(parseDate('2015-02-12')?.value).toBeCloseTo(2015.1150684931506, 12);
    expect(parseDate('2016-12-31')?.value).toBeCloseTo(2016 + 365 / 366, 12);
    expect(parseDate('2016-03-01')?.value).toBeCloseTo(2016 + 60 / 366, 12);
    expect(parseDate('2015-02')).toEqual({ value: 2015 + (31 + 14) / 365, precision: 'month' });
    expect(parseDate('2009')).toEqual({ value: 2009, precision: 'year' });
    expect(parseDate('2014.37')).toEqual({ value: 2014.37, precision: 'decimal' });
  });

  it('rejects things that are not dates', () => {
    for (const bad of ['', 'Trinidad', '2015-13-01', '2015-02-30', '20150212', 'KU296526']) {
      expect(parseDate(bad), bad).toBeNull();
    }
  });

  it('detects which label field holds the date', () => {
    expect(detectDateSpec(['EBOV|MK2008|SLE|2015-02-12', 'EBOV|MK2826|SLE|2015-03-08'])).toEqual({
      mode: 'labelField',
      delimiter: '|',
      field: -1,
    });
    expect(detectDateSpec(['2009_TVP11767_Trinidad', '1999_BeH613582_Brazil'])).toEqual({
      mode: 'labelField',
      delimiter: '_',
      field: 0,
    });
    expect(detectDateSpec(['a|x|2001|k', 'b|y|2002|k']).field).toBe(2);
    expect(detectDateSpec(['seq1', 'seq2']).mode).toBe('none');
  });
});

describe('taxon labels', () => {
  it('uses the first |-delimited field as the key when it is unique', () => {
    const rule = detectLabelRule(['A1|Guinea|2014-03-01', 'A2|Guinea|2014-03-02']);
    expect(rule).toEqual({ delimiter: '|', keyField: 0 });
    expect(taxonKey('A1|Guinea|2014-03-01', rule)).toBe('A1');
  });

  it('falls back to the whole label when the first field is not unique or there is no delimiter', () => {
    expect(detectLabelRule(['EBOV|A1', 'EBOV|A2']).keyField).toBe('label');
    expect(detectLabelRule(['2009_x', '1999_y'])).toEqual({ delimiter: '', keyField: 'label' });
  });
});

describe('taxa', () => {
  const alignment = (id: string, labels: string[]): AlignmentData => ({
    id,
    name: id,
    dataType: 'nucleotide',
    labelRule: { delimiter: '|', keyField: 0 },
    sequences: labels.map((label) => ({ label, sequence: 'ACGT' })),
  });

  it('is the union of the taxa in all sources, linked by key', () => {
    const { taxa, issues } = deriveTaxa({
      alignments: [alignment('s1', ['A|2001', 'B|2002']), alignment('s2', ['B|2002|extra', 'C|2003'])],
      dates: { mode: 'labelField', delimiter: '|', field: 1 },
      taxonIdStyle: 'key',
    });
    expect(taxa.map((t) => [t.id, t.date, t.sources])).toEqual([
      ['A', 2001, ['s1']],
      ['B', 2002, ['s1', 's2']],
      ['C', 2003, ['s2']],
    ]);
    expect(issues.map((i) => i.severity)).toEqual(['warning', 'warning']);
  });

  it('reports duplicate taxa and unreadable dates as errors', () => {
    const { issues } = deriveTaxa({
      alignments: [alignment('s1', ['A|2001', 'A|2001', 'B|unknown'])],
      dates: { mode: 'labelField', delimiter: '|', field: -1 },
      taxonIdStyle: 'label',
    });
    expect(issues.map((i) => i.message)).toEqual([
      '"s1" has more than one sequence for taxon "A"',
      'No date could be read from 1 of 2 taxon labels (B|unknown)',
    ]);
  });
});

describe('fasta', () => {
  it('parses multi-line records with any line ending', () => {
    expect(parseFasta('>a|1\r\nAC\r\nGT\r\n\r\n>b|2\nAC GT\n')).toEqual([
      { label: 'a|1', sequence: 'ACGT' },
      { label: 'b|2', sequence: 'ACGT' },
    ]);
  });

  it('rejects unaligned or malformed input', () => {
    expect(() => alignmentFromFasta('>a\nACGT\n>b\nACG\n', 'x', 'test')).toThrow(/not aligned/);
    expect(() => parseFasta('ACGT\n')).toThrow(/Not a FASTA file/);
    expect(() => parseFasta('')).toThrow(/No sequences/);
  });
});

describe('nexus', () => {
  it('parses sequential and interleaved matrices, quoted labels and comments', () => {
    const sequential = `#NEXUS
[a comment; with a semicolon]
BEGIN DATA;
  DIMENSIONS NTAX=2 NCHAR=8;
  FORMAT DATATYPE=DNA MISSING=? GAP=-;
  MATRIX
    'virus A|2001'  ACGT
                    ACGT
    virusB          ACG- [inline] AC?T
  ;
END;`;
    expect(parseNexus(sequential).sequences).toEqual([
      { label: 'virus A|2001', sequence: 'ACGTACGT' },
      { label: 'virusB', sequence: 'ACG-AC?T' },
    ]);

    const interleaved = `#nexus
begin characters;
  dimensions nchar=8;
  format datatype=nucleotide interleave matchchar=.;
  matrix
    a ACGT
    b ...A

    a TTTT
    b .C..
  ;
end;`;
    expect(parseNexus(interleaved).sequences).toEqual([
      { label: 'a', sequence: 'ACGTTTTT' },
      { label: 'b', sequence: 'ACGATCTT' },
    ]);
  });

  it('reads charsets with ranges, steps and open ends', () => {
    const { charsets } = parseNexus(`#NEXUS
begin data; dimensions nchar=4; format datatype=dna; matrix a ACGT b ACGA; end;
begin assumptions;
  charset first = 1-3;
  charset 'third positions' = 3-.\\3;
  charset mixed = 1-10 20 30-40\\2;
end;`.replace(/matrix a ACGT b ACGA/, 'matrix\n a ACGT\n b ACGA\n'));
    expect(charsets).toEqual([
      { name: 'first', ranges: [{ from: 1, to: 3 }] },
      { name: 'third positions', ranges: [{ from: 3, every: 3 }] },
      { name: 'mixed', ranges: [{ from: 1, to: 10 }, { from: 20, to: 20 }, { from: 30, to: 40, every: 2 }] },
    ]);
  });

  it('rejects unsupported or malformed files and detects the format', () => {
    expect(() => parseNexus('>a\nACGT')).toThrow(/does not start with #NEXUS/);
    expect(() => parseNexus('#NEXUS\nbegin data; format datatype=protein; matrix\n a MKV\n; end;')).toThrow(/Only nucleotide/);
    expect(() => parseNexus('#NEXUS\nbegin trees; end;')).toThrow(/No sequence matrix/);
    expect(alignmentFromText('#NEXUS\nbegin data;\nmatrix\n a ACGT\n b ACGA\n;\nend;', 'x', 'n').sequences).toHaveLength(2);
    expect(alignmentFromText('>a\nACGT\n', 'x', 'f').sequences).toHaveLength(1);
    expect(() => alignmentFromText('hello', 'x', 'notes')).toThrow(/not a FASTA or NEXUS file/);
  });
});

describe('site ranges', () => {
  it('counts the sites they select', () => {
    expect(countSites(undefined, 10)).toBe(10);
    expect(countSites([{ from: 1, every: 3 }, { from: 2, every: 3 }], 12)).toBe(8);
    expect(countSites([{ from: 3, every: 3 }], 10)).toBe(3);
    expect(countSites([{ from: 4, to: 6 }], 10)).toBe(3);
    expect(countSites([{ from: 8, to: 20 }], 10)).toBe(3);
  });
});

describe('priors', () => {
  it('have defaults, descriptions and validation', () => {
    expect(defaultPrior('gamma')).toEqual({ type: 'gamma', shape: 1, scale: 1, offset: 0 });
    expect(describePrior({ type: 'logNormal', mu: 1, sigma: 1.25 })).toBe('Lognormal(mu=1, sigma=1.25)');
    expect(describePrior({ type: 'exponential', mean: 0.5, offset: 2 })).toBe('Exponential(mean=0.5, offset=2)');
    expect(describePrior({ type: 'ctmcScale' })).toBe('CTMC rate reference');
    expect(validatePrior({ type: 'gamma', shape: 0, scale: 1 })).toBe('Gamma prior: shape must be greater than 0');
    expect(validatePrior({ type: 'uniform', lower: 2, upper: 1 })).toBe('Uniform prior: lower must be less than upper');
    expect(validatePrior({ type: 'normal', mean: Number.NaN, stdev: 1 })).toBe('Normal prior: mean must be a number');
    expect(validatePrior({ type: 'laplace', mean: 0, scale: 100 })).toBeNull();
  });
});
