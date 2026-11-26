import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  alignmentFromFasta,
  alignmentFromText,
  bindData,
  defineModule,
  generate,
  listSettings,
  openSettings,
  linkPartition,
  setCodonScheme,
  setSetting,
  setSiteHeterogeneity,
  unlinkPartition,
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
      'clock.epoch',
      'clock.localClade',
      'clock.strict',
      'clock.uncorrelated',
      'siteHeterogeneity.gamma',
      'startingTree.random',
      'substitution.gtr',
      'substitution.hky',
      'tree.timeTree',
      'treePrior.birthDeathSampling',
      'treePrior.constant',
      'treePrior.episodicBirthDeathSampling',
      'treePrior.exponential',
      'treePrior.skygrid',
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
    doc.parameters['substitution/kappa'] = { value: 4, prior: { type: 'exponential', mean: 2 } };
    doc.operators['substitution/kappa.scale'] = { weight: 5 };
    doc.operators['tree/subtreeLeap'] = { disabled: true };
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
      'Gamma: Number of rate categories must be at least 2',
      'The clock module "clock.missing" is not available',
    ]);
  });
});

describe('overrides', () => {
  it('rejects invalid priors, initial values and operator weights', () => {
    const doc = project();
    doc.parameters['substitution/kappa'] = { value: -1, prior: { type: 'logNormal', mu: 1, sigma: 0 } };
    doc.operators['substitution/kappa.scale'] = { weight: 0 };
    const result = generate(doc, registry);
    expect(result.xml).toBeUndefined();
    expect(result.issues.map((i) => [i.path, i.message])).toEqual([
      ['parameters.substitution/kappa', 'kappa: Lognormal prior: sigma must be greater than 0'],
      ['parameters.substitution/kappa', 'kappa: the initial value -1 is outside its bounds (0 to ∞)'],
      ['operators.substitution/kappa.scale', 'scale(kappa): the weight must be greater than 0'],
    ]);
  });

  it('keep applying when partitioning changes the XML ids', () => {
    const doc = project();
    doc.parameters['substitution/kappa'] = { value: 7 };
    setCodonScheme(doc, doc.data.alignments[0], '12+3');
    expect(xmlOf(doc)).toContain('<parameter id="CP1+2.kappa" value="7" lower="0"/>');
  });
});

describe('models', () => {
  const withModule = (id: string, module: string, options: Record<string, unknown> = {}): AnalysisDocument => {
    const doc = project();
    setSetting(doc, registry, `models.${id}.module`, module);
    Object.assign(doc.components.find((c) => c.id === id)!.options, options);
    return doc;
  };

  it('GTR', () => {
    const xml = xmlOf(withModule('substitution', 'substitution.gtr'));
    checkReferences(xml);
    expect(xml).toContain('<gtrModel id="gtr">');
    expect(xml).toContain('<parameter id="gtr.rates" dimension="6" value="1" lower="0"/>');
    expect(xml).toMatch(/<dirichletPrior alpha="1" sumsTo="6">\s*<parameter idref="gtr.rates"\/>/);
    expect(xml).toContain('<gtrModel idref="gtr"/>');
    expect(xml).not.toContain('kappa');
  });

  it('uncorrelated relaxed clocks', () => {
    const lognormal = xmlOf(withModule('clock', 'clock.uncorrelated'));
    checkReferences(lognormal);
    expect(lognormal).toContain('<logNormalDistributionModel meanInRealSpace="true">');
    expect(lognormal).toContain('<parameter id="ucld.mean" value="0.001" lower="0"/>');
    expect(lognormal).toMatch(/<ctmcScale>\s*<parameter idref="ucld.mean"\/>/);
    expect(lognormal).toContain('<swapOperator size="1" autoOptimize="false" weight="10">');
    expect(lognormal).toContain('<rateStatistic idref="coefficientOfVariation"/>');
    expect(lognormal).toMatch(/<treeDataLikelihood id="treeLikelihood"[^>]*>[\s\S]*?<discretizedBranchRates idref="branchRates"\/>/);

    const gamma = xmlOf(withModule('clock', 'clock.uncorrelated', { distribution: 'gamma' }));
    expect(gamma).toContain('<gammaDistributionModel>');
    expect(gamma).toContain('"ucgd.shape"');
    const exponential = xmlOf(withModule('clock', 'clock.uncorrelated', { distribution: 'exponential' }));
    checkReferences(exponential);
    expect(exponential).toContain('<exponentialDistributionModel>');
    expect(exponential).not.toMatch(/ucld|ucgd/);
  });

  it('exponential growth coalescent', () => {
    const xml = xmlOf(withModule('treePrior', 'treePrior.exponential'));
    checkReferences(xml);
    expect(xml).toContain('<exponentialGrowth id="exponential" units="years">');
    expect(xml).toMatch(/<laplacePrior mean="0" scale="100">\s*<parameter idref="exponential.growthRate"\/>/);
    expect(xml).toContain('<randomWalkOperator windowSize="1" weight="3">');
  });

  it('Bayesian skygrid', () => {
    const xml = xmlOf(withModule('treePrior', 'treePrior.skygrid', { gridPoints: 20 }));
    checkReferences(xml);
    expect(xml).toContain('<parameter id="skygrid.logPopSize" dimension="20" value="1"/>');
    expect(xml).toContain('<parameter id="skygrid.numGridPoints" value="19"/>');
    // 1.5 times the span of the tip dates (2014-03-01 to 2015-01-20)
    const cutOff = Number(/id="skygrid.cutOff" value="([^"]+)"/.exec(xml)?.[1]);
    expect(cutOff).toBeCloseTo(1.5 * (2015 + 19 / 365 - (2014 + 59 / 365)), 10);
    expect(xml).toContain('<gmrfGridBlockUpdateOperator weight="2">');
    expect(xmlOf(withModule('treePrior', 'treePrior.skygrid', { cutOff: 5 }))).toContain('id="skygrid.cutOff" value="5"');
  });

  it('skygrid needs a cut-off when tips are not dated', () => {
    const doc = project(UNDATED);
    setSetting(doc, registry, 'models.treePrior.module', 'treePrior.skygrid');
    const result = generate(doc, registry);
    expect(result.xml).toBeUndefined();
    expect(result.issues[0].path).toBe('models.treePrior.cutOff');
    setSetting(doc, registry, 'models.treePrior.cutOff', '10');
    expect(generate(doc, registry).xml).toBeDefined();
  });
});

describe('partitions', () => {
  const CODING = '>A|2001\nATGAAACCCGGG\n>B|2002\nATGAAGCCCGGA\n>C|2003\nATGAAGCCAGGA\n';
  const coding = (): AnalysisDocument => bindData(defaultTemplate(), [alignmentFromFasta(CODING, 'a1', 'gene')]);

  it('splits by codon position with unlinked models and relative rates', () => {
    const doc = coding();
    setCodonScheme(doc, doc.data.alignments[0], '12+3');
    expect(doc.partitions.map((p) => p.name)).toEqual(['CP1+2', 'CP3']);
    const xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml).toMatch(/<mergePatterns id="CP1\+2.patterns">\s*<patterns from="1" every="3" strip="false">[\s\S]*?<patterns from="2" every="3" strip="false">/);
    expect(xml).toContain('<patterns id="CP3.patterns" from="3" every="3" strip="false">');
    for (const id of ['CP1+2.hky', 'CP3.hky', 'CP1+2.kappa', 'CP3.alpha', 'CP1+2.siteModel']) {
      expect(xml).toContain(`id="${id}"`);
    }
    // weights are total sites / sites in the partition: 12/8 and 12/4
    expect(xml).toMatch(/<relativeRate weight="1.5">\s*<parameter id="CP1\+2.nu" value="0.5" lower="0" upper="1"\/>/);
    expect(xml).toMatch(/<relativeRate weight="3">\s*<parameter id="CP3.nu"/);
    expect(xml).toMatch(/<compoundParameter id="allNus">\s*<parameter idref="CP1\+2.nu"\/>\s*<parameter idref="CP3.nu"\/>/);
    expect(xml).toMatch(/<dirichletPrior alpha="1" sumsTo="1">\s*<parameter idref="allNus"\/>/);
    expect(xml).toContain('<statistic idref="CP3.mu"/>');
    expect(xml.match(/<treeDataLikelihood id=/g)).toHaveLength(1);
    expect(xml).toContain('<mergePatterns idref="CP1+2.patterns"/>');
  });

  it('supports three codon classes and undoing the split', () => {
    const doc = coding();
    setCodonScheme(doc, doc.data.alignments[0], '1+2+3');
    expect(doc.partitions.map((p) => p.name)).toEqual(['CP1', 'CP2', 'CP3']);
    expect(doc.components.filter((c) => c.slot === 'substitution')).toHaveLength(3);
    expect(xmlOf(doc)).toContain('<relativeRate weight="3">');
    setCodonScheme(doc, doc.data.alignments[0], 'none');
    expect(doc.partitions).toHaveLength(1);
    expect(doc.components.filter((c) => c.slot === 'substitution')).toHaveLength(1);
    const xml = xmlOf(doc);
    expect(xml).toContain('<patterns id="patterns" from="1" strip="false">');
    expect(xml).not.toContain('relativeRate');
  });

  it('links and unlinks substitution models and clocks between partitions', () => {
    const doc = coding();
    setCodonScheme(doc, doc.data.alignments[0], '12+3');
    const [first, second] = doc.partitions;

    unlinkPartition(doc, second.id, 'clock');
    let xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml).toContain('<strictClockBranchRates id="CP1+2.branchRates">');
    expect(xml).toContain('<parameter id="CP3.clock.rate" value="0.001" lower="0"/>');
    expect(xml.match(/<treeDataLikelihood id=/g)).toHaveLength(2);
    expect(xml).not.toContain('relativeRate');

    linkPartition(doc, second.id, 'clock', first.clock);
    linkPartition(doc, second.id, 'substitution', first.substitution);
    expect(second.siteHeterogeneity).toBe(first.siteHeterogeneity);
    expect(doc.components.filter((c) => c.slot !== 'tree' && c.slot !== 'startingTree' && c.slot !== 'treePrior')).toHaveLength(3);
    xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml.match(/<siteModel id=/g)).toHaveLength(1);
    expect(xml).toContain('<parameter id="kappa"');
    expect(xml).not.toContain('relativeRate');
  });

  it('removes or changes rate heterogeneity for one substitution model', () => {
    const doc = coding();
    setCodonScheme(doc, doc.data.alignments[0], '12+3');
    setSiteHeterogeneity(doc, doc.partitions[1].substitution, null);
    let xml = xmlOf(doc);
    expect(xml).toContain('id="alpha"');
    expect(xml).not.toContain('CP3.alpha');
    setSiteHeterogeneity(doc, doc.partitions[1].substitution, 'siteHeterogeneity.gamma');
    xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml).toContain('id="CP3.alpha"');
  });

  it('makes a partition for each NEXUS charset and checks site ranges', () => {
    const nexus = `#NEXUS
begin data;
  dimensions ntax=3 nchar=12;
  format datatype=dna missing=? gap=-;
  matrix
    'A|2001' ATGAAACCCGGG
    'B|2002' ATGAAGCCCGGA
    'C|2003' ATGAAGCCAGGA
  ;
end;
begin sets;
  charset geneA = 1-6;
  charset geneB = 7-12;
end;`;
    const doc = bindData(defaultTemplate(), [alignmentFromText(nexus, 'a1', 'genes')]);
    expect(doc.partitions.map((p) => [p.name, p.sites])).toEqual([
      ['geneA', [{ from: 1, to: 6 }]],
      ['geneB', [{ from: 7, to: 12 }]],
    ]);
    const xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml).toContain('<patterns id="geneA.patterns" from="1" to="6" strip="false">');
    expect(xml).toContain('<patterns id="geneB.patterns" from="7" to="12" strip="false">');
    expect(xml.match(/<siteModel id=/g)).toHaveLength(1);

    doc.partitions[1].sites = [{ from: 7, to: 20 }];
    expect(generate(doc, registry).issues.map((i) => i.message)).toContain(
      'Partition "geneB" has a site range outside its alignment (1 to 12)',
    );
  });
});

describe('taxon sets and timelines', () => {
  const errorsOf = (doc: AnalysisDocument): string[] =>
    generate(doc, registry).issues.filter((i) => i.severity === 'error').map((i) => i.message);

  /** The dated example with a taxon set for each country and a timeline. */
  function designed(): AnalysisDocument {
    const doc = project();
    doc.taxonSets = [
      { id: 's1', name: 'Guinea', taxa: ['A', 'B'] },
      { id: 's2', name: 'Liberia', taxa: ['C', 'D'], monophyletic: true },
    ];
    doc.timelines = [{ id: 't1', name: 'eras', kind: 'dates', dates: ['2014-07-01', '2014-12-01'] }];
    return doc;
  }

  it('writes each taxon set with its tMRCA, and constrains clades', () => {
    const xml = xmlOf(designed());
    checkReferences(xml);
    expect(xml).toMatch(/<taxa id="Guinea">\s*<taxon idref="A\|Guinea\|2014-03-01"\/>\s*<taxon idref="B\|Guinea\|2014-06-15"\/>\s*<\/taxa>/);
    expect(xml).toMatch(/<tmrcaStatistic id="tmrca\(Guinea\)">\s*<mrca>\s*<taxa idref="Guinea"\/>/);
    expect(xml).toContain('<tmrcaStatistic id="age(Liberia)" absolute="true">');
    expect(xml).toMatch(/<booleanLikelihood>\s*<monophylyStatistic idref="monophyly\(Liberia\)"\/>/);
    expect(xml).not.toContain('monophyly(Guinea)');
    expect(xml).toMatch(/<log id="fileLog"[^>]*>[\s\S]*<tmrcaStatistic idref="tmrca\(Guinea\)"\/>\s*<tmrcaStatistic idref="age\(Guinea\)"\/>/);
    // the starting tree is simulated with the clade as a subtree
    expect(xml).toMatch(
      /<coalescentSimulator id="startingTree">\s*<coalescentSimulator>\s*<taxa idref="Liberia"\/>\s*<constantSize idref="initialDemo"\/>\s*<\/coalescentSimulator>\s*<taxa idref="taxa"\/>/,
    );
  });

  it('nests the starting trees of nested clades', () => {
    const doc = designed();
    doc.taxonSets!.push({ id: 's3', name: 'later', taxa: ['B', 'C', 'D'], monophyletic: true });
    expect(xmlOf(doc)).toMatch(
      /<coalescentSimulator id="startingTree">\s*<coalescentSimulator>\s*<coalescentSimulator>\s*<taxa idref="Liberia"\/>[\s\S]*?<\/coalescentSimulator>\s*<taxa idref="later"\/>/,
    );
  });

  it('reports taxon sets that cannot be used', () => {
    const doc = designed();
    doc.taxonSets!.push(
      { id: 's3', name: 'Liberia', taxa: ['B', 'C'], monophyletic: true },
      { id: 's4', name: 'my set', taxa: ['nobody'] },
    );
    const result = generate(doc, registry);
    expect(result.issues.map((i) => `${i.severity}: ${i.message}`)).toEqual([
      'error: Taxon set "Liberia" has the same name as another',
      'error: Taxon set "Liberia" has the same name as another',
      'error: Taxon set "my set" has a name with spaces or the characters " \' < > &',
      'warning: Taxon set "my set" lists 1 taxa that are not in the data; they are left out',
      'error: Taxon set "my set" is empty',
      'error: Taxon sets "Liberia" and "Liberia" cannot both be clades: they overlap without one containing the other',
    ]);
    expect(result.issues.every((i) => i.path === 'taxonSets')).toBe(true);
  });

  it('rejects a taxon set named like another element of the analysis', () => {
    const doc = designed();
    doc.taxonSets![0].name = 'treeModel';
    expect(errorsOf(doc)).toEqual([
      'The id "treeModel" is used by more than one element of the analysis; rename one of them',
    ]);
  });

  it('local clocks on clades', () => {
    const doc = designed();
    setSetting(doc, registry, 'models.clock.module', 'clock.localClade');
    expect(errorsOf(doc)).toEqual(['Local clocks on clades: Clades with their own rate needs at least one taxon set']);

    setSetting(doc, registry, 'models.clock.clades', 'Guinea,Liberia');
    expect(doc.components.find((c) => c.id === 'clock')?.options.clades).toEqual(['s1', 's2']);
    const xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml).toMatch(
      /<localClockModel id="branchRates">\s*<treeModel idref="treeModel"\/>\s*<rate>\s*<parameter id="clock.rate" value="0.001" lower="0"\/>\s*<\/rate>\s*<clade includeStem="true" relative="false">\s*<parameter id="Guinea.rate" value="0.001" lower="0"\/>\s*<taxa idref="Guinea"\/>/,
    );
    expect(xml).toMatch(/<ctmcScalePrior>\s*<ctmcScale>\s*<parameter idref="Liberia.rate"\/>/);
    expect(xml).toMatch(/<down>\s*<parameter idref="clock.rate"\/>\s*<parameter idref="Guinea.rate"\/>\s*<parameter idref="Liberia.rate"\/>\s*<\/down>/);

    // as multiples of the background rate, with their own prior and no part in the up-down move
    setSetting(doc, registry, 'models.clock.relative', 'true');
    setSetting(doc, registry, 'models.clock.includeStem', 'false');
    const relative = xmlOf(doc);
    expect(relative).toContain('<clade includeStem="false" relative="true">');
    expect(relative).toContain('<parameter id="Guinea.rate" value="1" lower="0"/>');
    expect(relative).toMatch(/<logNormalPrior mu="0" sigma="1" offset="0">\s*<parameter idref="Guinea.rate"\/>/);
    expect(relative).toMatch(/<down>\s*<parameter idref="clock.rate"\/>\s*<\/down>/);

    // a deleted taxon set is reported, not silently dropped
    doc.taxonSets = doc.taxonSets!.filter((s) => s.id !== 's1');
    expect(errorsOf(doc)).toContain(
      'Local clocks on clades: Clades with their own rate refers to a taxon set that no longer exists',
    );
  });

  it('local clocks in epochs', () => {
    const doc = designed();
    setSetting(doc, registry, 'models.clock.module', 'clock.epoch');
    expect(errorsOf(doc)[0]).toBe('Local clocks in epochs: Timeline needs a timeline');

    setSetting(doc, registry, 'models.clock.timeline', 'eras');
    const result = generate(doc, registry);
    const xml = result.xml as string;
    checkReferences(xml);
    const heights = [...xml.matchAll(/<epoch transitionTime="([^"]+)">/g)].map((m) => Number(m[1]));
    expect(heights).toHaveLength(2);
    // the most recent sample is 2015-01-20; the transitions are 2014-12-01 and 2014-07-01
    expect(heights[0]).toBeCloseTo(50 / 365, 6);
    expect(heights[1]).toBeCloseTo(203 / 365, 6);
    expect(xml).toMatch(/<epoch transitionTime="[^"]+">\s*<parameter id="clock.epoch1.rate" value="0.001" lower="0"\/>/);
    expect(xml).toMatch(/<rate>\s*<parameter id="clock.epoch3.rate" value="0.001" lower="0"\/>\s*<\/rate>\s*<\/rateEpochBranchRates>/);
    expect(xml).toMatch(/<down>\s*<parameter idref="clock.epoch1.rate"\/>\s*<parameter idref="clock.epoch2.rate"\/>\s*<parameter idref="clock.epoch3.rate"\/>/);
    expect(result.parameters.find((p) => p.id === 'clock.epoch2.rate')?.decl.description).toBe(
      'Substitution rate in epoch 2 (2014-07-01 to 2014-12-01)',
    );

    doc.timelines![0].dates = ['2016-01-01'];
    expect(errorsOf(doc)[0]).toBe(
      'Local clocks in epochs (parameters): timeline "eras": 2016-01-01 is not before the most recent sample',
    );

    const undated = project(UNDATED);
    undated.timelines = [{ id: 't1', name: 'eras', kind: 'heights', heights: [0.1] }];
    setSetting(undated, registry, 'models.clock.module', 'clock.epoch');
    setSetting(undated, registry, 'models.clock.timeline', 'eras');
    expect(errorsOf(undated)).toEqual([
      'Local clocks in epochs need dated tips, so that the epochs and the rates are on a scale of time',
    ]);
  });

  it('birth-death with serial sampling starts the tree below the origin', () => {
    const doc = designed();
    setSetting(doc, registry, 'models.treePrior.module', 'treePrior.birthDeathSampling');
    const xml = xmlOf(doc);
    checkReferences(xml);
    // the sampling dates span 325 days; the tree starts at twice that and the origin a quarter above
    const height = Number(/<coalescentSimulator id="startingTree" height="([^"]+)">/.exec(xml)?.[1]);
    const origin = Number(/<parameter id="bdss.origin" value="([^"]+)"/.exec(xml)?.[1]);
    expect(height).toBeCloseTo((2 * 325) / 365, 5);
    expect(origin).toBeCloseTo(1.25 * height, 5);
    expect(xml).toMatch(/<speciationLikelihood id="speciation">\s*<model>\s*<birthDeathSerialSampling idref="bdss"\/>/);
    expect(xml).toMatch(/<randomWalkOperator windowSize="0.1" boundaryCondition="reflecting" weight="1">\s*<parameter idref="bdss.relativeDeathRate"\/>/);
    expect(xml).toMatch(/<prior id="prior">[\s\S]*<speciationLikelihood idref="speciation"\/>\s*<\/prior>/);
    expect(xml).not.toContain('coalescentLikelihood');

    // a height set for the starting tree is kept
    setSetting(doc, registry, 'models.startingTree.rootHeight', '5');
    expect(xmlOf(doc)).toContain('<coalescentSimulator id="startingTree" height="5">');
    // and other tree priors leave the simulated height alone
    expect(xmlOf(designed())).toContain('<coalescentSimulator id="startingTree">');
  });

  it('birth-death-sampling in epochs', () => {
    const doc = designed();
    setSetting(doc, registry, 'models.treePrior.module', 'treePrior.episodicBirthDeathSampling');
    const constant = xmlOf(doc);
    checkReferences(constant);
    expect(constant).toContain('<parameter id="ebds.birthRate" value="3" lower="0"/>');
    expect(constant).not.toContain('<grids>');

    setSetting(doc, registry, 'models.treePrior.timeline', 'eras');
    setSetting(doc, registry, 'models.treePrior.treatmentProbability', '0.5');
    const xml = xmlOf(doc);
    checkReferences(xml);
    expect(xml).toContain('<parameter id="ebds.birthRate" dimension="3" value="3" lower="0"/>');
    expect(xml).toContain('<parameter id="ebds.deathRate" dimension="3" value="1" lower="0"/>');
    expect(xml).toMatch(/<treatmentProbability>\s*<parameter dimension="3" value="0.5" lower="0" upper="1"\/>/);
    expect(xml).toMatch(/<numGridPoints>\s*<parameter value="3"\/>/);
    const grid = /<grids>\s*<parameter value="([^"]+)"\/>/.exec(xml)?.[1].split(' ').map(Number) ?? [];
    expect(grid).toHaveLength(3);
    expect(grid[0]).toBe(0);
    expect(grid[2]).toBeCloseTo(203 / 365, 6);
    expect(xml).toMatch(/<birthDeathLikelihood id="birthDeathLikelihood" useNewLoop="true">/);
    expect(xml).toMatch(/<log id="fileLog"[^>]*>[\s\S]*<birthDeathCompoundParameterLogger idref="ebds.Re"\/>/);
  });

  it('survive a round trip through JSON and are optional in older documents', () => {
    const doc = designed();
    setSetting(doc, registry, 'models.clock.module', 'clock.localClade');
    setSetting(doc, registry, 'models.clock.clades', 'Liberia');
    const copy = JSON.parse(JSON.stringify(doc)) as AnalysisDocument;
    expect(xmlOf(copy)).toBe(xmlOf(doc));

    const older = project();
    delete older.taxonSets;
    delete older.timelines;
    expect(xmlOf(older)).toBe(xmlOf(project()));
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
    expect(listSettings(doc, registry).map((s) => s.path)).toContain('models.treePrior.module');
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
    expect(() => setSetting(doc, registry, 'models.clock.module', 'treePrior.skygrid')).toThrow(/must be one of/);
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
