import { defineModule, type ModuleContext } from '@beautique/core';
import { rateOperators, rateOptions, rateParameter } from './rate';

/** Parameter names for each choice of distribution of rates among branches. */
const DISTRIBUTIONS = {
  lognormal: { mean: 'ucld.mean', spread: 'ucld.stdev', spreadLabel: 'standard deviation' },
  gamma: { mean: 'ucgd.mean', spread: 'ucgd.shape', spreadLabel: 'shape' },
  exponential: { mean: 'uced.mean', spread: undefined, spreadLabel: '' },
} as const;

const names = (ctx: ModuleContext): (typeof DISTRIBUTIONS)[keyof typeof DISTRIBUTIONS] =>
  DISTRIBUTIONS[ctx.options.distribution as keyof typeof DISTRIBUTIONS];

export default defineModule({
  apiVersion: 1,
  id: 'clock.uncorrelated',
  slot: 'clock',
  label: 'Uncorrelated relaxed clock',
  description: 'Each branch has its own rate, drawn independently from a shared distribution.',
  citation: 'Drummond, Ho, Phillips & Rambaut (2006) PLoS Biol 4:e88',
  options: {
    distribution: {
      type: 'choice',
      label: 'Distribution of rates among branches',
      default: 'lognormal',
      choices: [
        { value: 'lognormal', label: 'Lognormal' },
        { value: 'gamma', label: 'Gamma' },
        { value: 'exponential', label: 'Exponential' },
      ],
    },
    ...rateOptions,
  },
  parameters: (ctx) => {
    const { mean, spread, spreadLabel } = names(ctx);
    return [
      rateParameter(ctx, mean, 'Mean substitution rate of the relaxed clock'),
      ...(spread
        ? [
            {
              name: spread,
              description: `Relaxed clock ${spreadLabel}: how much rates vary among branches`,
              value: 1 / 3,
              lower: 0,
              prior: { type: 'exponential' as const, mean: 1 / 3 },
            },
          ]
        : []),
      { name: 'branchRates.categories', log: false },
    ];
  },
  operators: (ctx) => {
    const { mean, spread } = names(ctx);
    return [
      ...rateOperators(ctx, mean),
      ...(spread
        ? [
            {
              key: `${spread}.scale`,
              element: 'scaleOperator',
              tuning: { name: 'scaleFactor', value: 0.75 },
              weight: 3,
              children: [ctx.paramRef(spread)],
            },
          ]
        : []),
      {
        key: 'branchRates.categories.swap',
        element: 'swapOperator',
        attrs: { size: 1, autoOptimize: false },
        weight: 10,
        children: [ctx.paramRef('branchRates.categories')],
      },
      {
        key: 'branchRates.categories.uniformInteger',
        element: 'uniformIntegerOperator',
        weight: 10,
        children: [ctx.paramRef('branchRates.categories')],
      },
    ];
  },
  refs: (ctx) => ({ branchRates: ctx.xml.ref('discretizedBranchRates', ctx.id('branchRates')) }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const { mean, spread } = names(ctx);
    const branchRates = ref('discretizedBranchRates', ctx.id('branchRates'));
    const distribution = {
      lognormal: () =>
        el('logNormalDistributionModel', { meanInRealSpace: true }, [
          el('mean', {}, [ctx.param(mean)]),
          el('stdev', {}, [ctx.param(spread as string)]),
        ]),
      gamma: () =>
        el('gammaDistributionModel', {}, [
          el('mean', {}, [ctx.param(mean)]),
          el('shape', {}, [ctx.param(spread as string)]),
        ]),
      exponential: () => el('exponentialDistributionModel', {}, [el('mean', {}, [ctx.param(mean)])]),
    }[ctx.options.distribution as keyof typeof DISTRIBUTIONS]();
    const statistic = (name: string, mode: string) =>
      el('rateStatistic', { id: ctx.id(name), name: ctx.id(name), mode, internal: true, external: true }, [
        ctx.ref('treeModel'),
        branchRates,
      ]);
    return {
      clock: [
        comment('The uncorrelated relaxed clock (Drummond, Ho, Phillips & Rambaut, 2006)'),
        el('discretizedBranchRates', { id: ctx.id('branchRates') }, [
          ctx.ref('treeModel'),
          el('distribution', {}, [distribution]),
          el('rateCategories', {}, [ctx.param('branchRates.categories')]),
        ]),
        statistic('meanRate', 'mean'),
        statistic('coefficientOfVariation', 'coefficientOfVariation'),
        el('rateCovarianceStatistic', { id: ctx.id('covariance'), name: ctx.id('covariance') }, [
          ctx.ref('treeModel'),
          branchRates,
        ]),
      ],
      prior: [branchRates],
      fileLog: [
        ref('rateStatistic', ctx.id('meanRate')),
        ref('rateStatistic', ctx.id('coefficientOfVariation')),
        ref('rateCovarianceStatistic', ctx.id('covariance')),
      ],
      fileLogLikelihoods: [branchRates],
      treeLog: [el('trait', { name: 'rate', tag: ctx.id('rate') }, [branchRates])],
    };
  },
});
