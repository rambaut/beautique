import { defineModule, type ModuleContext, type TaxonSetInfo } from '@beautique/core';
import { rateEstimated, rateOperators, rateOptions, rateParameter } from './rate';

const clades = (ctx: ModuleContext): TaxonSetInfo[] => (ctx.options.clades as string[]).map((id) => ctx.taxonSet(id));
const rateName = (set: TaxonSetInfo): string => `${set.name}.rate`;

export default defineModule({
  apiVersion: 1,
  id: 'clock.localClade',
  slot: 'clock',
  label: 'Local clocks on clades',
  description:
    'A background rate for the tree, with a different rate on the branches of each chosen clade. Clades are taxon sets; the rate applies below the most recent common ancestor of the set.',
  citation: 'Yoder & Yang (2000) Mol Biol Evol 17:1081-1090',
  options: {
    clades: {
      type: 'taxonSetRef',
      label: 'Clades with their own rate',
      help: 'Taxon sets are made in the Taxon sets step.',
      multiple: true,
      required: true,
    },
    includeStem: {
      type: 'boolean',
      label: 'The clade rate also applies to the branch leading to the clade',
      default: true,
    },
    relative: {
      type: 'boolean',
      label: 'Clade rates are multiples of the background rate',
      help: 'Otherwise each clade rate is a rate in its own right.',
      default: false,
    },
    ...rateOptions,
  },
  validate: (ctx) =>
    clades(ctx)
      .filter((set) => set.size < 2)
      .map((set) => ({
        severity: 'error' as const,
        message: `Local clocks on clades: taxon set "${set.name}" needs at least two taxa`,
        path: ctx.optionPath('clades'),
      })),
  parameters: (ctx) => {
    const relative = ctx.options.relative === true;
    const estimate = rateEstimated(ctx);
    return [
      rateParameter(ctx, 'clock.rate', 'Background substitution rate'),
      ...clades(ctx).map((set) => ({
        name: rateName(set),
        description: relative
          ? `Rate in clade ${set.name}, as a multiple of the background rate`
          : `Substitution rate in clade ${set.name}`,
        value: relative || !estimate ? 1 : 0.001,
        lower: 0,
        prior:
          relative || !estimate
            ? ({ type: 'logNormal', mu: 0, sigma: 1 } as const)
            : ({ type: 'ctmcScale' } as const),
      })),
    ];
  },
  operators: (ctx) => {
    const names = clades(ctx).map(rateName);
    return [
      // Rates that are multiples of the background rate do not trade against tree height.
      ...rateOperators(ctx, 'clock.rate', ctx.options.relative === true ? [] : names),
      ...names.map((name) => ({
        key: `${name}.scale`,
        element: 'scaleOperator',
        tuning: { name: 'scaleFactor', value: 0.75 },
        weight: 3,
        children: [ctx.paramRef(name)],
      })),
    ];
  },
  refs: (ctx) => ({ branchRates: ctx.xml.ref('localClockModel', ctx.id('branchRates')) }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const branchRates = ref('localClockModel', ctx.id('branchRates'));
    return {
      clock: [
        comment('Local clocks: a background rate and a rate for each chosen clade (Yoder & Yang, 2000)'),
        el('localClockModel', { id: ctx.id('branchRates') }, [
          ctx.ref('treeModel'),
          el('rate', {}, [ctx.param('clock.rate')]),
          clades(ctx).map((set) =>
            el('clade', { includeStem: ctx.options.includeStem === true, relative: ctx.options.relative === true }, [
              ctx.param(rateName(set)),
              ref('taxa', set.name),
            ]),
          ),
        ]),
        el(
          'rateStatistic',
          { id: ctx.id('meanRate'), name: ctx.id('meanRate'), mode: 'mean', internal: true, external: true },
          [ctx.ref('treeModel'), branchRates],
        ),
      ],
      prior: [branchRates],
      fileLog: [ref('rateStatistic', ctx.id('meanRate'))],
      fileLogLikelihoods: [branchRates],
      treeLog: [el('trait', { name: 'rate', tag: ctx.id('rate') }, [branchRates])],
    };
  },
});
