import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  alignmentFromFasta,
  bindData,
  defineModule,
  generate,
  listSettings,
  openSettings,
  setSetting,
  type AnalysisDocument,
} from '@beautique/core';
import { builtinModules, createRegistry, defaultTemplate } from '../src/index';

const registry = createRegistry();

const DATED = `>A|Guinea|2014-03-01
ACGTACGTAC
>B|Guinea|2014-06-15
ACGTACGTAA
>C|Liberia|2014-09-30
ACGAACGTAA
>D|Liberia|2015-01-20
ACGAACGTCA
`;
const UNDATED = '>one\nACGT\n>two\nACGA\n>three\nACCA\n';

function project(fasta = DATED, name = 'test'): AnalysisDocument {
  const doc = bindData(defaultTemplate(), [alignmentFromFasta(fasta, 'a1', 'genomes')]);
  doc.name = name;
  return doc;
}

function xmlOf(doc: AnalysisDocument): string {
  const result = generate(doc, registry);
  expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  return result.xml as string;
}

/** Every idref must point at an id defined earlier in the file, and ids must be unique. */
function checkReferences(xml: string): void {
  const defined = new Set<string>();
  for (const m of xml.matchAll(/\s(id|idref)="([^"]*)"/g)) {
    if (m[1] === 'id') {
      expect(defined.has(m[2]), `duplicate id ${m[2]}`).toBe(false);
      defined.add(m[2]);
    } else {
      expect(defined.has(m[2]), `idref ${m[2]} used before it is defined`).toBe(true);
    }
  }
}

describe('built-in modules', () => {
  it('are discovered from the module files', () => {
    expect(builtinModules.map((m) => m.id)).toEqual([
      'clock.strict',
      'siteHeterogeneity.gamma',
      'startingTree.random',
      'substitution.hky',
      'tree.timeTree',
      'treePrior.constant',
    ]);
  });
});

describe('generate', () => {
  it('writes a complete tip-dated analysis', () => {
    const xml = xmlOf(project());
    checkReferences(xml);
    expect(xml).toMatchSnapshot();
  });

  it('estimates the clock rate only when tips are dated', () => {
    const dated = xmlOf(project());
    expect(dated).toContain('<date value="2014.4520547945206" direction="forwards" units="years"/>');
    expect(dated).toContain('<parameter id="clock.rate" value="0.001" lower="0"/>');
    expect(dated).toContain('<ctmcScalePrior>');
    expect(dated).toContain('<upDownOperator');
    expect(dated).toContain('<tmrcaStatistic id="age(root)" absolute="true">');

    const undated = xmlOf(project(UNDATED));
    checkReferences(undated);
    expect(undated).not.toContain('<date ');
    expect(undated).toContain('<parameter id="clock.rate" value="1" lower="0"/>');
    expect(undated).not.toContain('ctmcScalePrior');
    expect(undated).not.toContain('upDownOperator');
    expect(undated).not.toContain('age(root)');
  });

  it('follows module options and the optional site heterogeneity slot', () => {
    const doc = project();
    setSetting(doc, registry, 'models.substitution.frequencies', 'equal');
    setSetting(doc, registry, 'models.clock.rateMode', 'fixed');
    setSetting(doc, registry, 'models.clock.fixedRate', '0.0008');
    doc.partitions[0].siteHeterogeneity = null;
    const xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml).not.toContain('dirichletPrior');
    expect(xml).not.toContain('deltaExchange');
    expect(xml).not.toContain('gammaShape');
    expect(xml).not.toContain('"alpha"');
    expect(xml).toContain('<parameter id="clock.rate" value="0.0008" lower="0"/>');
  });

  it('applies MCMC settings and names the output files after the analysis', () => {
    const doc = project(DATED, 'ebov');
    doc.mcmc = { chainLength: 5000, logEvery: 50 };
    const xml = xmlOf(doc);
    expect(xml).toContain('<mcmc id="mcmc" chainLength="5000" autoOptimize="true" operatorAnalysis="ebov.ops">');
    expect(xml).toContain('<log id="fileLog" logEvery="50" fileName="ebov.log" overwrite="false">');
    expect(xml).toContain('checkpointEvery="500" checkpointFinal="5000" fileName="ebov.chkpt"');
  });

  it('applies user overrides of priors, initial values and operator weights', () => {
    const doc = project();
    doc.parameters.kappa = { value: 4, prior: { type: 'exponential', mean: 2 } };
    doc.operators['kappa.scale'] = { weight: 5 };
    doc.operators.subtreeLeap = { disabled: true };
    const xml = xmlOf(doc);
    expect(xml).toContain('<parameter id="kappa" value="4" lower="0"/>');
    expect(xml).toMatch(/<exponentialPrior mean="2" offset="0">\s*<parameter idref="kappa"\/>/);
    expect(xml).toContain('<scaleOperator scaleFactor="0.75" weight="5">');
    expect(xml).not.toContain('<subtreeLeap');
  });

  it('writes the union of taxa, padding partitions that lack a taxon', () => {
    const doc = bindData(defaultTemplate(), [
      alignmentFromFasta('>A|2001\nACGT\n>B|2002\nACGA\n', 'a1', 'gene1'),
      alignmentFromFasta('>B|2002\nTTTTTT\n>C|2003\nTTTTAA\n', 'a2', 'gene2'),
    ]);
    const result = generate(doc, registry);
    expect(result.issues.map((i) => i.severity)).toEqual(['warning', 'warning']);
    const xml = result.xml as string;
    checkReferences(xml);
    expect(result.taxa.map((t) => t.key)).toEqual(['A', 'B', 'C']);
    expect(xml).toContain('<alignment id="gene1.alignment" dataType="nucleotide">');
    expect(xml).toMatch(/<taxon idref="C\|2003"\/>\s*\?\?\?\?\s*<\/sequence>/);
    expect(xml).toMatch(/<taxon idref="A\|2001"\/>\s*\?\?\?\?\?\?\s*<\/sequence>/);
    // both partitions share the models, in one likelihood
    expect(xml.match(/<partition>/g)).toHaveLength(2);
    expect(xml.match(/<siteModel id=/g)).toHaveLength(1);
    expect(xml).toContain('<patterns idref="gene2.patterns"/>');
  });

  it('can elide sequence data for previews', () => {
    const xml = generate(project(), registry, { elideSequences: true }).xml as string;
    expect(xml).toContain('[10 sites]');
    expect(xml).not.toContain('ACGTACGTAC');
  });

  it('reports problems instead of writing XML', () => {
    const empty = generate(defaultTemplate(), registry);
    expect(empty.xml).toBeUndefined();
    expect(empty.issues.map((i) => i.message)).toContain('No sequence data has been loaded');

    const doc = project();
    doc.components.find((c) => c.id === 'clock')!.module = 'clock.missing';
    doc.mcmc.chainLength = 0;
    doc.components.find((c) => c.id === 'siteHeterogeneity')!.options.categories = 1;
    const result = generate(doc, registry);
    expect(result.xml).toBeUndefined();
    expect(result.issues.map((i) => i.message)).toEqual([
      'Chain length must be at least 1',
      'siteHeterogeneity: Number of rate categories must be at least 2',
      'Module "clock.missing" (used by "clock") is not available',
    ]);
  });
});

describe('module registry', () => {
  const extra = defineModule({
    apiVersion: 1,
    id: 'substitution.jc',
    slot: 'substitution',
    label: 'JC69',
    refs: (ctx) => ({ substitutionModel: ctx.xml.ref('HKYModel', ctx.id('jc')) }),
    generate: (ctx) => ({
      substitutionModel: [
        ctx.xml.el('HKYModel', { id: ctx.id('jc') }, [
          ctx.xml.el('frequencies', {}, [
            ctx.xml.el('frequencyModel', { dataType: 'nucleotide' }, [
              ctx.xml.el('frequencies', {}, [ctx.xml.el('parameter', { value: '0.25 0.25 0.25 0.25' })]),
            ]),
          ]),
          ctx.xml.el('kappa', {}, [ctx.xml.el('parameter', { value: 1 })]),
        ]),
      ],
    }),
  });

  it('accepts drop-in modules that use only their context', () => {
    const withExtra = createRegistry([extra]);
    const doc = project();
    doc.components.find((c) => c.id === 'substitution')!.module = 'substitution.jc';
    const xml = generate(doc, withExtra).xml as string;
    checkReferences(xml);
    expect(xml).toContain('<HKYModel id="jc">');
    expect(xml).not.toContain('"kappa"');
  });

  it('rejects modules it cannot use', () => {
    expect(() => createRegistry([{ ...extra, apiVersion: 2 }])).toThrow(/module API 2/);
    expect(() => createRegistry([{ ...extra, id: 'substitution.hky' }])).toThrow(/already registered/);
    expect(() => createRegistry([{ ...extra, slot: 'nonsense' as never }])).toThrow(/unknown slot/);
  });
});

describe('settings and templates', () => {
  it('lists the applicable settings and those a template asks for', () => {
    const doc = defaultTemplate();
    expect(openSettings(doc, registry).map((s) => s.path)).toEqual(['name', 'mcmc.chainLength']);
    const paths = (): string[] => listSettings(doc, registry).map((s) => s.path);
    expect(paths()).not.toContain('models.clock.fixedRate');
    setSetting(doc, registry, 'models.clock.rateMode', 'fixed');
    expect(paths()).toContain('models.clock.fixedRate');
  });

  it('converts and validates values set by path', () => {
    const doc = defaultTemplate();
    setSetting(doc, registry, 'mcmc.chainLength', '2000');
    expect(doc.mcmc.chainLength).toBe(2000);
    expect(() => setSetting(doc, registry, 'mcmc.chainLength', '0')).toThrow(/at least 1/);
    expect(() => setSetting(doc, registry, 'mcmc.chainLength', 'many')).toThrow(/must be a number/);
    expect(() => setSetting(doc, registry, 'models.clock.rateMode', 'sometimes')).toThrow(/must be one of/);
    expect(() => setSetting(doc, registry, 'models.nothing.x', '1')).toThrow(/Unknown setting/);
    expect(() => setSetting(doc, registry, 'name', 'has space')).toThrow(/expected format/);
  });

  it('binds data to a template without changing the template', () => {
    const template = defaultTemplate();
    const doc = project();
    expect(template.partitions[0].alignment).toBeNull();
    expect(doc.kind).toBe('project');
    expect(doc.partitions[0].alignment).toBe('a1');
    expect(doc.data.dates).toEqual({ mode: 'labelField', delimiter: '|', field: -1 });
  });
});

describe('YFV example', () => {
  it('has the same model structure as the BEAUti reference', () => {
    const fasta = readFileSync(new URL('../../../examples/data/YFV.fasta', import.meta.url), 'utf8');
    const result = generate(bindData(defaultTemplate(), [alignmentFromFasta(fasta, 'a1', 'YFV')]), registry);
    expect(result.issues).toEqual([]);
    const xml = result.xml as string;
    checkReferences(xml);
    expect(result.taxa).toHaveLength(71);
    const blocks = [...xml.matchAll(/^\t<([A-Za-z]+)/gm)].map((m) => m[1]);
    expect(blocks).toEqual([
      'taxa',
      'alignment',
      'patterns',
      'constantSize',
      'constantSize',
      'coalescentSimulator',
      'treeModel',
      'treeHeightStatistic',
      'treeLengthStatistic',
      'tmrcaStatistic',
      'coalescentLikelihood',
      'strictClockBranchRates',
      'rateStatistic',
      'HKYModel',
      'siteModel',
      'treeDataLikelihood',
      'operators',
      'mcmc',
      'report',
    ]);
    expect(xml).toContain('<subtreeLeap size="1" weight="71">');
    expect(xml).toContain('<fixedHeightSubtreePruneRegraft weight="7.1">');
  });
});
