import { describe, expect, it } from 'vitest';
import {
  addTrait,
  alignmentFromFasta,
  bindData,
  deriveTaxa,
  describeValueSource,
  generate,
  guessTraitType,
  looksLikeTable,
  parseTable,
  parseValueSource,
  removeTrait,
  resolveTrait,
  setSetting,
  setTraitType,
  type AnalysisDocument,
  type Trait,
} from '@beautique/core';
import { createRegistry, defaultTemplate } from '../src/index';

const registry = createRegistry();

const FASTA = `>A|Guinea|2014-03-01
ACGTACGTAC
>B|Guinea|2014-06-15
ACGTACGTAA
>C|Liberia|2014-09-30
ACGAACGTAA
>D|Sierra Leone|2015-01-20
ACGAACGTCA
`;
const TABLE = `taxon,sampled,host,lat,long,"notes, free text"
A,2014-03-01,human,9.5,-13.7,"first, ""index"" case"
B,2014-06-15,human,9.5,-13.7,
C,2014-09-30,bat,6.3,-10.8,
D,2015-01-20,?,8.5,-13.2,
`;

function project(withTable = true): AnalysisDocument {
  const template = defaultTemplate();
  if (withTable) template.data.tables = [parseTable(TABLE, 't1', 'meta')];
  return bindData(template, [alignmentFromFasta(FASTA, 'a1', 'genomes')]);
}

const errorsOf = (doc: AnalysisDocument): string[] =>
  generate(doc, registry).issues.filter((i) => i.severity === 'error').map((i) => i.message);

function xmlOf(doc: AnalysisDocument): string {
  expect(errorsOf(doc)).toEqual([]);
  const xml = generate(doc, registry).xml as string;
  const defined = new Set<string>();
  for (const m of xml.matchAll(/\s(id|idref)="([^"]*)"/g)) {
    if (m[1] === 'id') {
      expect(defined.has(m[2]), `duplicate id ${m[2]}`).toBe(false);
      defined.add(m[2]);
    } else {
      expect(defined.has(m[2]), `idref ${m[2]} used before it is defined`).toBe(true);
    }
  }
  return xml;
}

describe('metadata tables', () => {
  it('parses CSV and TSV with quoted fields', () => {
    const table = parseTable(TABLE, 't1', 'meta');
    expect(table.columns).toEqual(['taxon', 'sampled', 'host', 'lat', 'long', 'notes, free text']);
    expect(table.rows[0][5]).toBe('first, "index" case');
    expect(table.rows[1]).toHaveLength(6);
    expect(parseTable('﻿id\tx\r\na\t1\r\n\r\nb\t2\r\n', 't', 'tsv').rows).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(() => parseTable('id,x\n', 't', 'empty')).toThrow(/at least one row/);
    expect(() => parseTable('id,id\na,1\n', 't', 'dup')).toThrow(/same name/);
    expect(() => parseTable('id,x\na,1,2\n', 't', 'wide')).toThrow(/row 2: 3 values but only 2 columns/);
  });

  it('tells tables from sequence files', () => {
    expect(looksLikeTable(TABLE)).toBe(true);
    expect(looksLikeTable('id\tdate\n')).toBe(true);
    expect(looksLikeTable(FASTA)).toBe(false);
    expect(looksLikeTable('#NEXUS\nbegin data;')).toBe(false);
    expect(looksLikeTable('{"a": 1, "b": 2}')).toBe(false);
  });

  it('links rows to taxa by key or by whole label, and adds or ignores the rest', () => {
    const doc = project();
    const table = doc.data.tables![0];
    table.rows.push(['E', '2015-02-01', 'human', '7', '-11', '']);
    table.rows[0][0] = 'A|Guinea|2014-03-01';
    const derived = deriveTaxa(doc.data);
    expect(derived.taxa.map((t) => t.key)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(derived.taxa[0].sources).toEqual(['a1', 't1']);
    expect(derived.issues.map((i) => i.message)).toEqual([
      '1 rows of "meta" are for taxa with no sequence; they are added to the analysis',
      // dates are read from the labels here, and a taxon known only from the table has no label
      'No date could be read from 1 of 5 taxon labels (E)',
      '1 taxa have no sequence in "genomes" and will be written as missing data',
    ]);

    table.addsTaxa = false;
    const ignoring = deriveTaxa(doc.data);
    expect(ignoring.taxa).toHaveLength(4);
    expect(ignoring.issues.map((i) => i.message)).toEqual([
      '1 rows of "meta" are for taxa with no sequence and are ignored',
    ]);

    table.rows.push(['A', '2014-03-02', 'human', '9', '-13', '']);
    expect(deriveTaxa(doc.data).issues[0].message).toBe('"meta" has more than one row for taxon "A"');
  });

  it('gives sampling dates from a column', () => {
    const doc = project();
    const fromLabels = generate(doc, registry).taxa.map((t) => t.date);
    doc.data.dates = { mode: 'column', delimiter: '|', field: -1, table: 't1', column: 'sampled' };
    expect(generate(doc, registry).taxa.map((t) => t.date)).toEqual(fromLabels);

    doc.data.dates.column = 'host';
    expect(errorsOf(doc)[0]).toBe('No date could be read for 4 of 4 taxa (A|Guinea|2014-03-01, B|Guinea|2014-06-15, C|Liberia|2014-09-30, ...)');
    doc.data.dates.column = 'gone';
    expect(errorsOf(doc)[0]).toBe('Choose the metadata column that holds the sampling dates');
  });
});

describe('traits', () => {
  it('reads values from label fields and columns', () => {
    const doc = project();
    const taxa = deriveTaxa(doc.data).taxa;
    const country: Trait = { id: 'x', name: 'country', type: 'discrete', sources: [parseValueSource('field:2', doc.data)], model: null };
    const resolved = resolveTrait(country, doc.data, taxa);
    expect(resolved.states).toEqual(['Guinea', 'Liberia', 'Sierra_Leone']);
    expect(resolved.counts.get('Guinea')).toBe(2);
    expect(resolved.values.get('D')).toBe('Sierra_Leone');
    expect(resolved.missing).toBe(0);

    const host = resolveTrait({ ...country, sources: [parseValueSource('host', doc.data)] }, doc.data, taxa);
    expect(host.states).toEqual(['bat', 'human']);
    expect(host.missing).toBe(1);

    const location = resolveTrait(
      { ...country, type: 'continuous', sources: ['lat', 'long'].map((s) => parseValueSource(s, doc.data)) },
      doc.data,
      taxa,
    );
    expect(location.dimension).toBe(2);
    expect(location.values.get('C')).toBe('6.3 -10.8');
    expect(location.ranges).toEqual([
      { min: 6.3, max: 9.5 },
      { min: -13.7, max: -10.8 },
    ]);

    expect(parseValueSource('field:-1:_', doc.data)).toEqual({ kind: 'labelField', delimiter: '_', field: -1 });
    expect(() => parseValueSource('nowhere', doc.data)).toThrow('No metadata table has a column called "nowhere"');
    expect(() => parseValueSource('field:0', doc.data)).toThrow(/counted from 1/);
    expect(describeValueSource(parseValueSource('lat', doc.data), doc.data)).toBe('lat (meta)');
    expect(describeValueSource(parseValueSource('field:-1', doc.data), doc.data)).toBe('label field last, split on "|"');
    expect(guessTraitType(parseValueSource('lat', doc.data), doc.data, taxa)).toBe('continuous');
    expect(guessTraitType(parseValueSource('host', doc.data), doc.data, taxa)).toBe('discrete');
  });

  it('explains what is wrong with a trait', () => {
    const doc = project();
    const taxa = deriveTaxa(doc.data).taxa;
    const trait: Trait = { id: 'x', name: 'x', type: 'continuous', sources: [], model: null };
    expect(resolveTrait(trait, doc.data, taxa).problems).toEqual(['needs to be told where its values come from']);
    trait.sources = [parseValueSource('host', doc.data)];
    expect(resolveTrait(trait, doc.data, taxa).problems).toEqual(['has 3 values that are not numbers (human, human, bat)']);
    trait.sources = [{ kind: 'column', table: 't1', column: 'gone' }];
    expect(resolveTrait(trait, doc.data, taxa).problems).toEqual(['refers to a metadata column that no longer exists']);
    trait.sources = [{ kind: 'labelField', delimiter: '|', field: 7 }];
    expect(resolveTrait(trait, doc.data, taxa).problems).toEqual(['has no value for any taxon']);
  });

  it('adds, retypes and removes a trait with its model', () => {
    const doc = project();
    const trait = addTrait(doc, { name: 'host', type: 'discrete', sources: [parseValueSource('host', doc.data)], module: 'trait.discrete' });
    expect(trait.id).toBe('trait-host');
    expect(doc.components.find((c) => c.id === 'trait-host')?.module).toBe('trait.discrete');
    setSetting(doc, registry, 'models.trait-host.bssvs', 'false');
    setTraitType(doc, trait.id, 'continuous', 'trait.continuous');
    expect(doc.components.find((c) => c.id === 'trait-host')).toMatchObject({ module: 'trait.continuous', options: {} });
    removeTrait(doc, trait.id);
    expect(doc.traits).toEqual([]);
    expect(doc.components.some((c) => c.slot === 'trait')).toBe(false);
  });
});

describe('discrete phylogeography', () => {
  function withCountry(options: Record<string, string> = {}): AnalysisDocument {
    const doc = project();
    addTrait(doc, { name: 'country', type: 'discrete', sources: [parseValueSource('field:2', doc.data)], module: 'trait.discrete' });
    for (const [key, value] of Object.entries(options)) setSetting(doc, registry, `models.trait-country.${key}`, value);
    return doc;
  }

  it('writes the symmetric model with BSSVS', () => {
    const xml = xmlOf(withCountry());
    expect(xml).toMatch(/<taxon id="D\|Sierra Leone\|2015-01-20">\s*<date [^>]*\/>\s*<attr name="country">\s*Sierra_Leone\s*<\/attr>/);
    expect(xml).toMatch(/<generalDataType id="country.dataType">\s*<state code="Guinea"\/>\s*<state code="Liberia"\/>\s*<state code="Sierra_Leone"\/>/);
    expect(xml).toMatch(/<attributePatterns id="country.pattern" attribute="country">\s*<taxa idref="taxa"\/>/);
    expect(xml).toMatch(/<rates>\s*<duplicatedParameter copies="2">\s*<parameter id="country.rates" dimension="3" value="1" lower="0"\/>/);
    expect(xml).toMatch(/<rateIndicator>\s*<duplicatedParameter copies="2">\s*<parameter id="country.indicators" dimension="3" value="1"\/>/);
    expect(xml).toMatch(/<poissonPrior mean="0.6931471805599453" offset="2">\s*<statistic idref="country.nonZeroRates"\/>/);
    expect(xml).toMatch(/<gammaPrior shape="1" scale="1" offset="0">\s*<parameter idref="country.rates"\/>/);
    expect(xml).toMatch(/<ctmcScalePrior>\s*<ctmcScale>\s*<parameter idref="country.clock.rate"\/>/);
    expect(xml).toMatch(/<ancestralTreeLikelihood id="country.treeLikelihood" stateTagName="country.states"/);
    expect(xml).toMatch(/<likelihood id="likelihood">\s*<treeDataLikelihood idref="treeLikelihood"\/>\s*<ancestralTreeLikelihood idref="country.treeLikelihood"\/>/);
    expect(xml).toMatch(/<bitFlipOperator weight="7">\s*<parameter idref="country.indicators"\/>/);
    expect(xml).toMatch(/<trait name="country.states" tag="country">\s*<ancestralTreeLikelihood idref="country.treeLikelihood"\/>/);
    // the trait model comes after the likelihood of the sequence data
    expect(xml.indexOf('<generalSubstitutionModel id="country.model"')).toBeGreaterThan(xml.indexOf('<treeDataLikelihood id="treeLikelihood"'));
    // the sequence models keep their plain ids
    expect(xml).toContain('<parameter id="clock.rate"');
  });

  it('writes asymmetric rates, no BSSVS and Markov jumps when asked', () => {
    const xml = xmlOf(withCountry({ structure: 'asymmetric', bssvs: 'false', markovJumps: 'true' }));
    expect(xml).toContain('<generalSubstitutionModel id="country.model" randomizeIndicator="false">');
    expect(xml).toMatch(/<rates>\s*<parameter id="country.rates" dimension="6" value="1" lower="0"\/>/);
    expect(xml).not.toContain('indicators');
    expect(xml).not.toContain('poissonPrior');
    expect(xml).toMatch(/<markovJumpsTreeLikelihood id="country.treeLikelihood"[^>]*>[\s\S]*?<parameter id="country.count" value="0 1 1 1 0 1 1 1 0"\/>\s*<\/markovJumpsTreeLikelihood>/);
    expect(xmlOf(withCountry({ structure: 'asymmetric' }))).toContain('<poissonPrior mean="2" offset="0">');
  });

  it('reports traits that cannot be analysed', () => {
    const doc = withCountry();
    doc.traits![0].sources = [parseValueSource('field:1', doc.data)];
    expect(errorsOf(doc)).toEqual([]);
    doc.data.alignments[0].sequences.forEach((s) => (s.label = s.label.replace(/\|[^|]+\|/, '|Guinea|')));
    doc.traits![0].sources = [parseValueSource('field:2', doc.data)];
    expect(errorsOf(doc)).toEqual(['Trait "country" needs at least two different states']);

    const unknown = withCountry();
    unknown.traits![0].sources = [parseValueSource('host', unknown.data)];
    const result = generate(unknown, registry);
    expect(result.issues.map((i) => i.message)).toEqual([
      'Trait "country" has no value for 1 of 4 taxa; they are treated as unknown',
    ]);
    expect(result.xml).toMatch(/<attr name="country">\s*\?\s*<\/attr>/);

    const clash = withCountry();
    clash.taxonSets = [{ id: 's', name: 'country', taxa: ['A', 'B'] }];
    expect(errorsOf(clash)).toEqual(['Trait "country" has the same name as another']);

    const wrong = withCountry();
    wrong.components.find((c) => c.id === 'trait-country')!.module = 'trait.continuous';
    expect(errorsOf(wrong)).toEqual(['"Continuous phylogeography" cannot be used for the discrete trait "country"']);
  });
});

describe('continuous phylogeography', () => {
  function withLocation(options: Record<string, string> = {}, sources = ['lat', 'long']): AnalysisDocument {
    const doc = project();
    addTrait(doc, {
      name: 'location',
      type: 'continuous',
      sources: sources.map((s) => parseValueSource(s, doc.data)),
      module: 'trait.continuous',
    });
    for (const [key, value] of Object.entries(options)) setSetting(doc, registry, `models.trait-location.${key}`, value);
    return doc;
  }

  it('writes the Cauchy relaxed random walk', () => {
    const xml = xmlOf(withLocation({ latLong: 'true' }));
    expect(xml).toMatch(/<attr name="location">\s*9.5 -13.7\s*<\/attr>/);
    expect(xml).toMatch(/<matrixParameter id="location.precision">\s*<parameter id="location.precision.col1" value="0.05 0.002"\/>\s*<parameter id="location.precision.col2" value="0.002 0.05"\/>/);
    expect(xml).toMatch(/<multivariateWishartPrior id="location.precisionPrior" df="2">/);
    expect(xml).toContain('<arbitraryBranchRates id="location.diffusion.branchRates" reciprocal="true">');
    expect(xml).toMatch(/<onePGammaDistributionModel>\s*<shape>\s*<parameter value="0.5"\/>/);
    expect(xml).toMatch(/<jitter window="0.001 0.001" duplicatesOnly="true">\s*<parameter idref="leaf.location"\/>/);
    expect(xml).toContain('displacementScheme="greatCircleDistance"');
    expect(xml).toMatch(/<precisionGibbsOperator weight="2">\s*<wishartStatistics traitName="location">/);
    expect(xml).toMatch(/<scaleOperator scaleFactor="0.75" weight="30">\s*<parameter idref="location.diffusion.rates"\/>/);
    expect(xml).toMatch(/<likelihood id="likelihood">[\s\S]*?<traitDataLikelihood idref="location.traitLikelihood"\/>\s*<\/likelihood>/);
    expect(xml).toMatch(/<trait name="location" tag="location">\s*<traitDataLikelihood idref="location.traitLikelihood"\/>/);
  });

  it('writes the other diffusion models', () => {
    const lognormal = xmlOf(withLocation({ rates: 'lognormal', jitter: '0' }));
    expect(lognormal).toContain('<arbitraryBranchRates id="location.diffusion.branchRates" reciprocal="false">');
    expect(lognormal).toMatch(/<stdev>\s*<parameter id="location.stdev" value="1" lower="0"\/>/);
    expect(lognormal).toMatch(/<exponentialPrior mean="1" offset="0">\s*<parameter idref="location.stdev"\/>/);
    expect(lognormal).not.toContain('<jitter');
    expect(lognormal).toContain('displacementScheme="linear"');

    expect(xmlOf(withLocation({ rates: 'gamma' }))).toMatch(/<shape>\s*<parameter id="location.halfDF" value="0.5" lower="0"\/>/);

    const homogeneous = xmlOf(withLocation({ rates: 'homogeneous' }));
    expect(homogeneous).not.toContain('arbitraryBranchRates');
    expect(homogeneous).not.toContain('diffusion.rates');
  });

  it('handles one dimension, and needs two for coordinates', () => {
    const one = xmlOf(withLocation({}, ['lat']));
    expect(one).toMatch(/<attr name="location">\s*9.5\s*<\/attr>/);
    expect(one).toContain('<multivariateWishartPrior id="location.precisionPrior" df="1">');
    expect(one).not.toContain('<correlation');
    expect(errorsOf(withLocation({ latLong: 'true' }, ['lat']))).toEqual([
      'Trait "location" needs two values, latitude then longitude, to be treated as coordinates',
    ]);
  });

  it('can be combined with a discrete trait, and survives a round trip through JSON', () => {
    const doc = withLocation();
    addTrait(doc, { name: 'host', type: 'discrete', sources: [parseValueSource('host', doc.data)], module: 'trait.discrete' });
    const xml = xmlOf(doc);
    expect(xml).toMatch(/<attr name="location">\s*8.5 -13.2\s*<\/attr>\s*<attr name="host">\s*\?\s*<\/attr>/);
    expect(xmlOf(JSON.parse(JSON.stringify(doc)) as AnalysisDocument)).toBe(xml);
  });
});
