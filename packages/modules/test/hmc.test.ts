import { describe, expect, it } from 'vitest';
import {
  addTrait,
  alignmentFromFasta,
  bindData,
  generate,
  parseTable,
  parseValueSource,
  setSetting,
  unlinkPartition,
  type AnalysisDocument,
  type GenerateResult,
} from '@beautique/core';
import { createRegistry, defaultTemplate } from '../src/index';

const registry = createRegistry();

const FASTA = `>A|Guinea|2014-03-01
ACGTACGTAC
>B|Guinea|2014-06-15
ACGTACGTAA
>C|Liberia|2014-09-30
ACGAACGTAA
>D|Liberia|2015-01-20
ACGAACGTCA
`;

function project(settings: Record<string, string> = {}, hmc = true): AnalysisDocument {
  const doc = bindData(defaultTemplate(), [alignmentFromFasta(FASTA, 'a1', 'genomes')]);
  if (hmc) setSetting(doc, registry, 'mcmc.operatorStrategy', 'hmc');
  for (const [path, value] of Object.entries(settings)) setSetting(doc, registry, path, value);
  return doc;
}

function result(doc: AnalysisDocument): GenerateResult {
  const generated = generate(doc, registry);
  expect(generated.issues.filter((i) => i.severity === 'error')).toEqual([]);
  // every idref points at an id defined earlier in the file, and ids are unique
  const defined = new Set<string>();
  for (const m of (generated.xml as string).matchAll(/\s(id|idref)="([^"]*)"/g)) {
    if (m[1] === 'id') {
      expect(defined.has(m[2]), `duplicate id ${m[2]}`).toBe(false);
      defined.add(m[2]);
    } else {
      expect(defined.has(m[2]), `idref ${m[2]} used before it is defined`).toBe(true);
    }
  }
  return generated;
}

const xmlOf = (doc: AnalysisDocument): string => result(doc).xml as string;
const operatorsOf = (doc: AnalysisDocument): string[] => result(doc).operators.map((o) => o.label);

describe('the HMC operator strategy', () => {
  it('changes nothing for models without gradient-based operators', () => {
    const standard = xmlOf(project({}, false));
    expect(xmlOf(project())).toBe(standard);
    expect(standard).not.toContain('hamiltonianMonteCarloOperator');
    expect(standard).toContain('usePreOrder="false"');
  });

  it('moves the skygrid by HMC, with its precision prior defined before the operators', () => {
    const settings = { 'models.treePrior.module': 'treePrior.skygrid', 'models.treePrior.gridPoints': '10' };
    const standard = operatorsOf(project(settings, false));
    expect(standard).toContain('gmrfGridBlockUpdate(skygrid.logPopSize, skygrid.precision)');

    const doc = project(settings);
    expect(operatorsOf(doc)).not.toContain('gmrfGridBlockUpdate(skygrid.logPopSize, skygrid.precision)');
    expect(operatorsOf(doc)).toContain('HMC(skygrid.logPopSize, skygrid.precision)');
    const xml = xmlOf(doc);
    expect(xml).toMatch(
      /<hamiltonianMonteCarloOperator stepSize="0.01" nSteps="50" mode="vanilla" autoOptimize="true" gradientCheckCount="0" gradientCheckTolerance="0.1" preconditioning="none" preconditioningUpdateFrequency="100" weight="2">/,
    );
    expect(xml).toMatch(/<gradient>\s*<gammaPrior idref="skygrid.precision.prior"\/>\s*<parameter idref="skygrid.precision"\/>\s*<\/gradient>/);
    expect(xml).toMatch(/<signTransform start="1" end="1">\s*<compoundParameter idref="skygrid.parameters"\/>/);
    // the prior is written once, with an id, and referred to inside <prior>
    expect(xml.match(/<gammaPrior id="skygrid.precision.prior" shape="0.001" scale="1000" offset="0">/g)).toHaveLength(1);
    expect(xml).toMatch(/<prior id="prior">[\s\S]*<gammaPrior idref="skygrid.precision.prior"\/>/);
    expect(xml.indexOf('<gammaPrior id="skygrid.precision.prior"')).toBeLessThan(xml.indexOf('<operators id="operators"'));

    // a prior chosen by the user is the one the gradient uses
    doc.parameters['treePrior/skygrid.precision'] = { prior: { type: 'exponential', mean: 2 } };
    const edited = xmlOf(doc);
    expect(edited).toMatch(/<exponentialPrior id="skygrid.precision.prior" mean="2" offset="0">/);
    expect(edited).toMatch(/<gradient>\s*<exponentialPrior idref="skygrid.precision.prior"\/>/);
  });

  it('writes the lognormal relaxed clock with a rate for each branch', () => {
    const settings = { 'models.clock.module': 'clock.uncorrelated' };
    const standard = xmlOf(project(settings, false));
    expect(standard).toContain('<discretizedBranchRates id="branchRates">');
    expect(standard).toContain('usePreOrder="false"');

    const generated = result(project(settings));
    const xml = generated.xml as string;
    expect(xml).not.toContain('discretizedBranchRates');
    expect(xml).toMatch(
      /<arbitraryBranchRates id="branchRates" centerAtOne="false">\s*<treeModel idref="treeModel"\/>\s*<rates>\s*<parameter id="branchRates.rates" value="1" lower="0"\/>\s*<\/rates>\s*<location>\s*<parameter id="ucld.mean" value="0.001" lower="0"\/>\s*<\/location>\s*<scale>\s*<parameter id="ucld.stdev" value="1" lower="0"\/>/,
    );
    expect(xml).toMatch(/<distributionLikelihood id="ratesPrior">/);
    expect(xml).toContain('<treeDataLikelihood id="treeLikelihood" useAmbiguities="false" usePreOrder="true">');
    expect(xml).toMatch(
      /<jointGradient>\s*<hessian>\s*<distributionLikelihood idref="ratesPrior"\/>\s*<parameter idref="branchRates.rates"\/>\s*<\/hessian>\s*<branchRateGradient traitName="Sequence">\s*<treeDataLikelihood idref="treeLikelihood"\/>/,
    );
    expect(xml).toMatch(/<exponentialPrior mean="1" offset="0">\s*<parameter idref="ucld.stdev"\/>/);
    expect(xml).toMatch(/<prior id="prior">[\s\S]*<distributionLikelihood idref="ratesPrior"\/>\s*<arbitraryBranchRates idref="branchRates"\/>/);
    expect(generated.operators.map((o) => o.label)).toEqual(
      expect.arrayContaining(['scale(ucld.mean)', 'scale(ucld.stdev)', 'HMC(branchRates.rates)']),
    );
    expect(generated.operators.some((o) => /categories/.test(o.label))).toBe(false);

    // the gamma and exponential clocks have no gradient-based form
    const gamma = xmlOf(project({ ...settings, 'models.clock.distribution': 'gamma' }));
    expect(gamma).toContain('<discretizedBranchRates id="branchRates">');
    expect(gamma).not.toContain('hamiltonianMonteCarloOperator');
  });

  it('gives each clock its own pre-order tree likelihood', () => {
    // two alignments: the first under a relaxed clock, the second under its own strict clock
    const two = bindData(defaultTemplate(), [
      alignmentFromFasta(FASTA, 'a1', 'genomes'),
      alignmentFromFasta(FASTA, 'a2', 'second'),
    ]);
    setSetting(two, registry, 'mcmc.operatorStrategy', 'hmc');
    unlinkPartition(two, two.partitions[1].id, 'clock');
    setSetting(two, registry, `models.${two.partitions[0].clock}.module`, 'clock.uncorrelated');
    const xml = xmlOf(two);
    expect(xml).toContain('<treeDataLikelihood id="genomes.treeLikelihood" useAmbiguities="false" usePreOrder="true">');
    expect(xml).toContain('<treeDataLikelihood id="second.treeLikelihood" useAmbiguities="false" usePreOrder="false">');
    expect(xml).toMatch(/<branchRateGradient traitName="Sequence">\s*<treeDataLikelihood idref="genomes.treeLikelihood"\/>/);
  });

  it('writes the shrinkage local clock, which is always sampled by HMC', () => {
    const generated = result(project({ 'models.clock.module': 'clock.shrinkage' }, false));
    const xml = generated.xml as string;
    expect(xml).toContain('<arbitraryBranchRates id="substBranchRates" centerAtOne="false" randomizeRates="true" randomScale="0.1">');
    expect(xml).toMatch(/<bayesianBridgeDistribution id="bbDistribution">\s*<dimension>\s*<parameter idref="substBranchRates.rates"\/>/);
    expect(xml).toMatch(/<globalScale>\s*<parameter id="globalScale" value="1" lower="0"\/>/);
    expect(xml).toContain('<autoCorrelatedRatesPrior id="substBranchRatesPrior" scaling="none" log="true" operateOnIncrements="true">');
    expect(xml).toMatch(/<scaledByTreeTimeBranchRates id="branchRates">\s*<arbitraryBranchRates idref="substBranchRates"\/>\s*<treeModel idref="treeModel"\/>\s*<parameter id="clock.rate"/);
    expect(xml).toContain('usePreOrder="true"');
    expect(xml).toMatch(/<bayesianBridgeGibbsOperator weight="4">\s*<autoCorrelatedRatesPrior idref="substBranchRatesPrior"\/>\s*<gammaPrior idref="globalScale.prior"\/>/);
    expect(xml).toMatch(/<gammaPrior id="globalScale.prior" shape="1" scale="2" offset="0">/);
    expect(xml).toMatch(/<preconditioner>\s*<bayesianBridgeDistribution idref="bbDistribution"\/>/);
    expect(xml).toMatch(/<hamiltonianMonteCarloOperator stepSize="0.01" nSteps="5" mode="vanilla" drawVariance="1" preconditioningUpdateFrequency="1" preconditioningDelay="0" weight="8">/);
    expect(generated.operators.map((o) => o.label)).toContain('HMC(substBranchRates.rates)');
  });

  it('moves the rates of birth-death-sampling in epochs by HMC', () => {
    const doc = project({ 'models.treePrior.module': 'treePrior.episodicBirthDeathSampling' });
    doc.timelines = [{ id: 't1', name: 'halves', kind: 'heights', heights: [0.4] }];
    setSetting(doc, registry, 'models.treePrior.timeline', 'halves');
    const generated = result(doc);
    const xml = generated.xml as string;
    for (const rate of ['birthRate', 'deathRate', 'samplingRate']) {
      expect(xml).toMatch(
        new RegExp(
          `<birthDeathLikelihoodGradient wrtParameter="${rate}" useNewLoop="true">\\s*<birthDeathLikelihood idref="birthDeathLikelihood"/>\\s*<treeModel idref="treeModel"/>\\s*</birthDeathLikelihoodGradient>\\s*<gradient>\\s*<logNormalPrior idref="ebds.${rate}.prior"/>\\s*<parameter idref="ebds.${rate}"/>`,
        ),
      );
    }
    expect(generated.operators.map((o) => o.label)).toEqual(
      expect.arrayContaining(['HMC(ebds.birthRate)', 'HMC(ebds.deathRate)', 'HMC(ebds.samplingRate)', 'scale(ebds.origin)']),
    );
    expect(generated.operators.some((o) => o.label === 'scale(ebds.birthRate)')).toBe(false);
  });

  it('moves the branch rates of the lognormal relaxed random walk by HMC', () => {
    const withLocation = (hmc: boolean, rates: string): AnalysisDocument => {
      const template = defaultTemplate();
      template.data.tables = [parseTable('taxon,lat,long\nA,9.5,-13.7\nB,9.6,-13.1\nC,6.3,-10.8\nD,8.5,-13.2\n', 't1', 'meta')];
      const doc = bindData(template, [alignmentFromFasta(FASTA, 'a1', 'genomes')]);
      addTrait(doc, {
        name: 'location',
        type: 'continuous',
        sources: ['lat', 'long'].map((s) => parseValueSource(s, doc.data)),
        module: 'trait.continuous',
      });
      setSetting(doc, registry, 'models.trait-location.rates', rates);
      if (hmc) setSetting(doc, registry, 'mcmc.operatorStrategy', 'hmc');
      return doc;
    };
    const xml = xmlOf(withLocation(true, 'lognormal'));
    expect(xml).toMatch(
      /<jointGradient>\s*<gradient>\s*<distributionLikelihood idref="location.diffusion.prior"\/>\s*<parameter idref="location.diffusion.rates"\/>\s*<\/gradient>\s*<branchRateGradient traitName="location">\s*<traitDataLikelihood idref="location.traitLikelihood"\/>/,
    );
    expect(operatorsOf(withLocation(true, 'lognormal'))).not.toContain('scale(location.diffusion.rates)');
    expect(operatorsOf(withLocation(false, 'lognormal'))).toContain('scale(location.diffusion.rates)');
    // the Cauchy model keeps its standard operators
    expect(xmlOf(withLocation(true, 'cauchy'))).not.toContain('hamiltonianMonteCarloOperator');
  });

  it('lets the step size and weight of an HMC operator be changed, or the operator switched off', () => {
    const doc = project({ 'models.treePrior.module': 'treePrior.skygrid' });
    doc.operators['treePrior/skygrid.hmc'] = { tuning: 0.05, weight: 5 };
    expect(xmlOf(doc)).toMatch(/<hamiltonianMonteCarloOperator stepSize="0.05" [^>]*weight="5">/);
    doc.operators['treePrior/skygrid.hmc'] = { disabled: true };
    expect(xmlOf(doc)).not.toContain('hamiltonianMonteCarloOperator');
  });
});
