import { describe, expect, it } from 'vitest';
import {
  addTrait,
  alignmentFromFasta,
  assignSetting,
  bindData,
  deriveTaxa,
  generate,
  makeTemplate,
  modulesFromExports,
  openSettings,
  parseTable,
  setCodonScheme,
  setSetting,
  settingField,
  templateRequirements,
  type AnalysisDocument,
} from '@beautique/core';
import { builtinTemplates, createRegistry, defaultTemplate, findTemplate } from '../src/index';

const registry = createRegistry();

const FASTA = `>A|Guinea|2014-03-01
ACGTACGTACGT
>B|Guinea|2014-06-15
ACGTACGTAAGT
>C|Liberia|2014-09-30
ACGAACGTAAGT
>D|Liberia|2015-01-20
ACGAACGTCAGT
`;
const TABLE = `taxon,latitude,longitude
A,9.5,-13.7
B,9.6,-13.6
C,6.3,-10.8
D,8.5,-13.2
`;

const alignment = () => alignmentFromFasta(FASTA, 'alignment-1', 'genomes');

/** Apply a template to the example data, as the CLI does. */
function apply(template: AnalysisDocument): AnalysisDocument {
  const doc = bindData(template, [alignment()]);
  doc.data.tables = [parseTable(TABLE, 'table-1', 'places')];
  return doc;
}

function xmlOf(doc: AnalysisDocument): string {
  const result = generate(doc, registry);
  expect(result.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
  return result.xml as string;
}

describe('the built-in templates', () => {
  it('have unique ids, and "default" is the default template', () => {
    expect(new Set(builtinTemplates.map((t) => t.id)).size).toBe(builtinTemplates.length);
    expect(findTemplate('default')?.make()).toEqual({ ...defaultTemplate(), template: findTemplate('default')?.make().template });
    expect(findTemplate('nothing')).toBeUndefined();
  });

  for (const template of builtinTemplates) {
    it(`${template.id}: is a template that asks for settings it has`, () => {
      const doc = template.make();
      expect(doc.kind).toBe('template');
      expect(doc.data.alignments).toEqual([]);
      expect(doc.template?.description).toBeTruthy();
      for (const path of doc.template?.ask ?? []) {
        expect(settingField(doc, registry, path), `${path} is not a setting`).toBeDefined();
      }
      // a fresh copy each time
      expect(template.make()).not.toBe(doc);
    });

    it(`${template.id}: generates an analysis when given data`, () => {
      const xml = xmlOf(apply(template.make()));
      expect(xml).toContain('<mcmc id="mcmc"');
    });
  }

  it('hold what they describe', () => {
    const make = (id: string): string => xmlOf(apply(findTemplate(id)!.make()));
    expect(make('outbreak-growth')).toContain('<exponentialGrowth');
    expect(make('skygrid-relaxed')).toMatch(/<gtrModel[\s\S]*<discretizedBranchRates[\s\S]*<gmrfSkyGridLikelihood/);
    const coding = make('coding-skygrid');
    expect(coding).toContain('id="CP1+2.hky"');
    expect(coding).toContain('id="CP3.hky"');
    expect(make('discrete-phylogeography')).toMatch(/<attr name="location">\s*Liberia/);
    expect(make('continuous-phylogeography')).toMatch(/<attr name="location">\s*9\.5 -13\.7/);
    expect(make('birth-death-epochs')).toContain('Birth-death-sampling model with 12 epochs');
  });

  it('say what they expect of the data', () => {
    expect(templateRequirements(findTemplate('default')!.make())).toEqual([]);
    expect(templateRequirements(findTemplate('discrete-phylogeography')!.make())).toEqual([
      'Sampling dates in the last field of the taxon labels, split on "|"',
      'Trait "location" (discrete) from field 2 of the taxon labels, split on "|"',
    ]);
    expect(templateRequirements(findTemplate('continuous-phylogeography')!.make())).toEqual([
      'Trait "location" (continuous) from the column "latitude" of the first metadata table and the column "longitude" of the first metadata table',
    ]);
    expect(templateRequirements(findTemplate('coding-skygrid')!.make())).toEqual([
      'A protein-coding alignment in frame, split into CP1+2, CP3',
    ]);
  });

  it('report a missing metadata table in words', () => {
    const doc = bindData(findTemplate('continuous-phylogeography')!.make(), [alignment()]);
    expect(generate(doc, registry).issues.map((i) => i.message)).toContain(
      'Trait "location" needs a metadata table with columns called "latitude" and "longitude"',
    );
  });
});

describe('making a template from a project', () => {
  function project(): AnalysisDocument {
    const doc = apply(defaultTemplate());
    doc.name = 'ebola';
    setCodonScheme(doc, alignment(), '12+3');
    setSetting(doc, registry, 'models.treePrior.module', 'treePrior.skygrid');
    setSetting(doc, registry, 'models.treePrior.gridPoints', '10');
    setSetting(doc, registry, 'mcmc.chainLength', '5000');
    const keys = deriveTaxa(doc.data).taxa.map((t) => t.key);
    doc.taxonSets = [{ id: 'taxonset-1', name: 'Guinea', taxa: keys.slice(0, 2), monophyletic: true }];
    doc.timelines = [{ id: 'timeline-1', name: 'halves', kind: 'regular', epochCount: 2, duration: 6, units: 'months' }];
    setSetting(doc, registry, 'models.clock.module', 'clock.epoch');
    setSetting(doc, registry, 'models.clock.timeline', 'halves');
    addTrait(doc, {
      name: 'place',
      type: 'continuous',
      sources: [
        { kind: 'column', table: 'table-1', column: 'latitude' },
        { kind: 'column', table: 'table-1', column: 'longitude' },
      ],
      module: 'trait.continuous',
    });
    doc.parameters['substitution/kappa'] = { prior: { type: 'exponential', mean: 3 } };
    return doc;
  }

  it('drops the data and keeps the design', () => {
    const template = makeTemplate(project(), { description: 'Mine', ask: ['name', 'models.treePrior.gridPoints'] });
    expect(template.kind).toBe('template');
    expect(template.data.alignments).toEqual([]);
    expect(template.data.tables).toEqual([]);
    expect(JSON.stringify(template)).not.toContain('ACGT');
    expect(template.partitions.map((p) => [p.name, p.alignment])).toEqual([
      ['CP1+2', null],
      ['CP3', null],
    ]);
    expect(template.taxonSets).toEqual([{ id: 'taxonset-1', name: 'Guinea', taxa: [], monophyletic: true }]);
    expect(template.template).toEqual({ description: 'Mine', ask: ['name', 'models.treePrior.gridPoints'] });
    expect(openSettings(template, registry).map((s) => [s.path, s.value])).toEqual([
      ['name', 'analysis'],
      ['models.treePrior.gridPoints', 10],
    ]);
    expect(templateRequirements(template)).toEqual([
      'Sampling dates in the last field of the taxon labels, split on "|"',
      'Trait "place" (continuous) from the column "latitude" of the first metadata table and the column "longitude" of the first metadata table',
      'Taxa for the taxon set "Guinea"',
      'A protein-coding alignment in frame, split into CP1+2, CP3',
    ]);
  });

  it('gives the same analysis when applied to the same data', () => {
    const original = project();
    const again = apply(makeTemplate(original));
    again.taxonSets![0].taxa = [...original.taxonSets![0].taxa];
    expect(again.name).toBe('analysis');
    again.name = original.name;
    expect(xmlOf(again)).toBe(xmlOf(original));
  });

  it('does not change the project, and a single partition goes back to taking the name of the data', () => {
    const original = apply(defaultTemplate());
    const before = JSON.stringify(original);
    const template = makeTemplate(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(template.partitions).toEqual([{ ...defaultTemplate().partitions[0] }]);
    expect(template.template?.ask).toEqual(['name', 'mcmc.chainLength']);
    const bound = bindData(template, [alignmentFromFasta(FASTA, 'alignment-1', 'other')]);
    expect(bound.partitions[0].name).toBe('other');
  });
});

describe('settings by path', () => {
  it('are assigned without checking, and undefined puts back the default', () => {
    const doc = defaultTemplate();
    assignSetting(doc, 'mcmc.chainLength', -5);
    expect(doc.mcmc.chainLength).toBe(-5);
    assignSetting(doc, 'mcmc.chainLength', undefined);
    expect(doc.mcmc).toEqual({});
    assignSetting(doc, 'models.substitution.frequencies', 'equal');
    expect(doc.components[0].options).toEqual({ frequencies: 'equal' });
    assignSetting(doc, 'models.substitution.frequencies', undefined);
    expect(doc.components[0].options).toEqual({});
    assignSetting(doc, 'models.clock.module', 'clock.uncorrelated');
    expect(doc.components.find((c) => c.id === 'clock')?.module).toBe('clock.uncorrelated');
    assignSetting(doc, 'name', 'x');
    expect(doc.name).toBe('x');
    assignSetting(doc, 'models.nothing.here', 1);
    assignSetting(doc, 'nonsense', 1);
  });

  it('have a field only when they exist', () => {
    const doc = defaultTemplate();
    expect(settingField(doc, registry, 'name')?.label).toBe('Analysis name');
    expect(settingField(doc, registry, 'mcmc.chainLength')?.type).toBe('integer');
    expect(settingField(doc, registry, 'models.clock.module')?.type).toBe('choice');
    expect(settingField(doc, registry, 'models.clock.rateMode')).toBeDefined();
    expect(settingField(doc, registry, 'models.clock.nothing')).toBeUndefined();
    expect(settingField(doc, registry, 'models.nothing.module')).toBeUndefined();
    expect(settingField(doc, registry, 'mcmc.nothing')).toBeUndefined();
  });
});

describe('module files', () => {
  it('export one module or several by default', () => {
    const one = { apiVersion: 1, id: 'substitution.x', slot: 'substitution', label: 'X', generate: () => ({}) };
    expect(modulesFromExports({ default: one })).toEqual([one]);
    expect(modulesFromExports({ default: [one, one] })).toHaveLength(2);
    expect(() => modulesFromExports({})).toThrow('Not a BEAUtique module file');
    expect(() => modulesFromExports({ default: [] })).toThrow('Not a BEAUtique module file');
    expect(() => modulesFromExports({ default: 'text' })).toThrow('Not a BEAUtique module file');
  });
});
