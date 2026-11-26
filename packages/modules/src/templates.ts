/**
 * The built-in templates: near-complete analyses for common questions in
 * genomic epidemiology. Each is made in code from the default template, so
 * they stay valid as the document format and the modules change.
 */

import { addTrait, setCodonScheme, setInstanceModule, type AnalysisDocument } from '@beautique/core';
import { defaultTemplate } from './index';

export interface BuiltinTemplate {
  id: string;
  title: string;
  /** The template document; a fresh copy on each call. */
  make(): AnalysisDocument;
}

function build(description: string, ask: string[], change: (doc: AnalysisDocument) => void): () => AnalysisDocument {
  return () => {
    const doc = defaultTemplate();
    change(doc);
    doc.template = { description, ask: ['name', ...ask, 'mcmc.chainLength'] };
    return doc;
  };
}

const option = (doc: AnalysisDocument, id: string, values: Record<string, unknown>): void => {
  Object.assign(doc.components.find((c) => c.id === id)?.options ?? {}, values);
};

export const builtinTemplates: BuiltinTemplate[] = [
  {
    id: 'default',
    title: 'Basic dated tree',
    make: build('HKY + gamma, strict clock, constant-size coalescent. A quick first look at a dataset.', [], () => {}),
  },
  {
    id: 'outbreak-growth',
    title: 'Outbreak growth rate',
    make: build(
      'For a recent outbreak sampled over weeks to months: HKY + gamma, strict clock and an exponentially growing population. Reports the growth rate.',
      ['models.clock.rateMode', 'models.clock.fixedRate'],
      (doc) => setInstanceModule(doc, 'treePrior', 'treePrior.exponential'),
    ),
  },
  {
    id: 'skygrid-relaxed',
    title: 'Population history (skygrid)',
    make: build(
      'For an endemic or long-sampled virus: GTR + gamma, uncorrelated lognormal relaxed clock and a Bayesian skygrid of population size through time.',
      ['models.treePrior.gridPoints', 'models.treePrior.cutOff'],
      (doc) => {
        setInstanceModule(doc, 'substitution', 'substitution.gtr');
        setInstanceModule(doc, 'clock', 'clock.uncorrelated');
        setInstanceModule(doc, 'treePrior', 'treePrior.skygrid');
      },
    ),
  },
  {
    id: 'coding-skygrid',
    title: 'Coding sequence, by codon position',
    make: build(
      'For an in-frame protein-coding alignment: codon positions 1+2 and 3 each have their own HKY + gamma model and relative rate, with a strict clock and a Bayesian skygrid.',
      ['models.treePrior.gridPoints', 'models.treePrior.cutOff'],
      (doc) => {
        setInstanceModule(doc, 'treePrior', 'treePrior.skygrid');
        // the split is made on a stand-in alignment and left unbound
        doc.partitions[0].alignment = 'template';
        setCodonScheme(doc, { id: 'template', name: '' }, '12+3');
        for (const partition of doc.partitions) partition.alignment = null;
      },
    ),
  },
  {
    id: 'discrete-phylogeography',
    title: 'Discrete phylogeography',
    make: build(
      'Where lineages moved between a set of places. Taxon labels are fields separated by "|", with the place in the second field and the date in the last: name|place|date. HKY + gamma, strict clock, skygrid, and a symmetric model of movement with BSSVS.',
      ['models.trait-location.structure', 'models.trait-location.markovJumps', 'models.treePrior.cutOff'],
      (doc) => {
        setInstanceModule(doc, 'treePrior', 'treePrior.skygrid');
        doc.data.dates = { mode: 'labelField', delimiter: '|', field: -1 };
        addTrait(doc, {
          name: 'location',
          type: 'discrete',
          sources: [{ kind: 'labelField', delimiter: '|', field: 1 }],
          module: 'trait.discrete',
        });
      },
    ),
  },
  {
    id: 'continuous-phylogeography',
    title: 'Continuous phylogeography',
    make: build(
      'How lineages spread over a landscape. Needs a metadata table whose first column is the taxon and which has columns called latitude and longitude. HKY + gamma, strict clock, skygrid, and a Cauchy relaxed random walk.',
      ['models.trait-location.rates', 'models.trait-location.jitter', 'models.treePrior.cutOff'],
      (doc) => {
        setInstanceModule(doc, 'treePrior', 'treePrior.skygrid');
        addTrait(doc, {
          name: 'location',
          type: 'continuous',
          sources: [
            { kind: 'column', table: 'table-1', column: 'latitude' },
            { kind: 'column', table: 'table-1', column: 'longitude' },
          ],
          module: 'trait.continuous',
        });
        option(doc, 'trait-location', { latLong: true });
      },
    ),
  },
  {
    id: 'birth-death-epochs',
    title: 'Reproductive number through time',
    make: build(
      'For an outbreak: birth-death-sampling with rates that change every month for a year back from the last sample, logging the effective reproductive number in each month. HKY + gamma and a strict clock.',
      ['models.treePrior.treatmentProbability'],
      (doc) => {
        doc.timelines = [{ id: 'timeline-1', name: 'months', kind: 'regular', epochCount: 12, duration: 1, units: 'months' }];
        setInstanceModule(doc, 'treePrior', 'treePrior.episodicBirthDeathSampling');
        option(doc, 'treePrior', { timeline: 'timeline-1' });
      },
    ),
  },
];

export function findTemplate(id: string): BuiltinTemplate | undefined {
  return builtinTemplates.find((t) => t.id === id);
}
