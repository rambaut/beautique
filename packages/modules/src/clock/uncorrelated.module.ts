import {
  defineModule,
  type Contributions,
  type FactValue,
  type ModuleContext,
  type OperatorDecl,
  type ParameterDecl,
} from '@beautique/core';
import { hmcOperator, useHmc } from '../hmc';
import { rateOperators, rateOptions, rateParameter } from './rate';

/** Parameter names for each choice of distribution of rates among branches. */
const DISTRIBUTIONS = {
  lognormal: { mean: 'ucld.mean', spread: 'ucld.stdev', spreadLabel: 'standard deviation' },
  gamma: { mean: 'ucgd.mean', spread: 'ucgd.shape', spreadLabel: 'shape' },
  exponential: { mean: 'uced.mean', spread: undefined, spreadLabel: '' },
} as const;

const names = (ctx: ModuleContext): (typeof DISTRIBUTIONS)[keyof typeof DISTRIBUTIONS] =>
  DISTRIBUTIONS[ctx.options.distribution as keyof typeof DISTRIBUTIONS];

/**
 * With gradient-based operators the lognormal clock is written in its
 * continuous form: every branch has a rate of its own, moved by Hamiltonian
 * Monte Carlo (Ji et al 2020). The other distributions have no such form.
 */
const continuous = (ctx: ModuleContext): boolean => useHmc(ctx) && ctx.options.distribution === 'lognormal';

const scale = (ctx: ModuleContext, name: string): OperatorDecl => ({
  key: `${name}.scale`,
  element: 'scaleOperator',
  tuning: { name: 'scaleFactor', value: 0.75 },
  weight: 3,
  children: [ctx.paramRef(name)],
});

const statistics = (ctx: ModuleContext, branchRates: ReturnType<ModuleContext['xml']['ref']>) => {
  const { el } = ctx.xml;
  const statistic = (name: string, mode: string) =>
    el('rateStatistic', { id: ctx.id(name), name: ctx.id(name), mode, internal: true, external: true }, [
      ctx.ref('treeModel'),
      branchRates,
    ]);
  return [
    statistic('meanRate', 'mean'),
    statistic('coefficientOfVariation', 'coefficientOfVariation'),
    el('rateCovarianceStatistic', { id: ctx.id('covariance'), name: ctx.id('covariance') }, [
      ctx.ref('treeModel'),
      branchRates,
    ]),
  ];
};

const logs = (ctx: ModuleContext, branchRates: ReturnType<ModuleContext['xml']['ref']>): Contributions => {
  const { el, ref } = ctx.xml;
  return {
    fileLog: [
      ref('rateStatistic', ctx.id('meanRate')),
      ref('rateStatistic', ctx.id('coefficientOfVariation')),
      ref('rateCovarianceStatistic', ctx.id('covariance')),
    ],
    fileLogLikelihoods: [branchRates],
    treeLog: [el('trait', { name: 'rate', tag: ctx.id('rate') }, [branchRates])],
  };
};

/** The discretized form: each branch is assigned one of a set of rate categories. */
function discretized(ctx: ModuleContext): Contributions {
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
      el('gammaDistributionModel', {}, [el('mean', {}, [ctx.param(mean)]), el('shape', {}, [ctx.param(spread as string)])]),
    exponential: () => el('exponentialDistributionModel', {}, [el('mean', {}, [ctx.param(mean)])]),
  }[ctx.options.distribution as keyof typeof DISTRIBUTIONS]();
  return {
    clock: [
      comment('The uncorrelated relaxed clock (Drummond, Ho, Phillips & Rambaut, 2006)'),
      el('discretizedBranchRates', { id: ctx.id('branchRates') }, [
        ctx.ref('treeModel'),
        el('distribution', {}, [distribution]),
        el('rateCategories', {}, [ctx.param('branchRates.categories')]),
      ]),
      statistics(ctx, branchRates),
    ],
    prior: [branchRates],
    ...logs(ctx, branchRates),
  };
}

/** The continuous form: a rate for each branch, drawn from a lognormal with the given mean and spread. */
function continuousRates(ctx: ModuleContext): Contributions {
  const { el, ref, comment } = ctx.xml;
  const branchRates = ref('arbitraryBranchRates', ctx.id('branchRates'));
  return {
    clock: [
      comment('The uncorrelated lognormal relaxed clock with a rate for each branch (Ji et al, 2020)'),
      el('arbitraryBranchRates', { id: ctx.id('branchRates'), centerAtOne: false }, [
        ctx.ref('treeModel'),
        el('rates', {}, [ctx.param('branchRates.rates')]),
        el('location', {}, [ctx.param('ucld.mean')]),
        el('scale', {}, [ctx.param('ucld.stdev')]),
      ]),
      el('distributionLikelihood', { id: ctx.id('ratesPrior') }, [
        el('data', {}, [ctx.paramRef('branchRates.rates')]),
        el('distribution', {}, [
          el('logNormalDistributionModel', { meanInRealSpace: true }, [
            el('mean', {}, [el('parameter', { value: 1, lower: 0 })]),
            el('stdev', {}, [el('parameter', { value: 1, lower: 0 })]),
          ]),
        ]),
      ]),
      statistics(ctx, branchRates),
    ],
    prior: [ref('distributionLikelihood', ctx.id('ratesPrior')), branchRates],
    ...logs(ctx, branchRates),
  };
}

export default defineModule({
  apiVersion: 1,
  id: 'clock.uncorrelated',
  slot: 'clock',
  label: 'Uncorrelated relaxed clock',
  description:
    'Each branch has its own rate, drawn independently from a shared distribution. With gradient-based operators (MCMC step), the lognormal clock is sampled by Hamiltonian Monte Carlo.',
  citation:
    'Drummond, Ho, Phillips & Rambaut (2006) PLoS Biol 4:e88; with HMC: Ji, Zhang, Holbrook, Nishimura, Baele, Rambaut, Lemey & Suchard (2020) Mol Biol Evol 37:3047-3060',
  supportsHmc: true,
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
  facts: (ctx): Record<string, FactValue> => (continuous(ctx) ? { usePreOrder: true } : {}),
  parameters: (ctx) => {
    const { mean, spread, spreadLabel } = names(ctx);
    const parameters: ParameterDecl[] = [rateParameter(ctx, mean, 'Mean substitution rate of the relaxed clock')];
    if (continuous(ctx)) {
      parameters.push(
        {
          name: 'ucld.stdev',
          description: 'Relaxed clock scale: how much rates vary among branches',
          value: 1,
          lower: 0,
          prior: { type: 'exponential', mean: 1 },
        },
        { name: 'branchRates.rates', description: 'Relative rate of each branch', value: 1, lower: 0, log: false },
      );
      return parameters;
    }
    if (spread) {
      parameters.push({
        name: spread,
        description: `Relaxed clock ${spreadLabel}: how much rates vary among branches`,
        value: 1 / 3,
        lower: 0,
        prior: { type: 'exponential', mean: 1 / 3 },
      });
    }
    parameters.push({ name: 'branchRates.categories', log: false });
    return parameters;
  },
  operators: (ctx) => {
    const { mean, spread } = names(ctx);
    const { el, ref } = ctx.xml;
    if (continuous(ctx)) {
      return [
        ...rateOperators(ctx, mean),
        scale(ctx, 'ucld.stdev'),
        hmcOperator({
          key: 'branchRates.rates.hmc',
          label: `HMC(${ctx.id('branchRates.rates')})`,
          weight: 1,
          nSteps: 4,
          attrs: { preconditioning: 'diagonal', preconditioningUpdateFrequency: 10 },
          children: [
            el('jointGradient', {}, [
              el('hessian', {}, [
                ref('distributionLikelihood', ctx.id('ratesPrior')),
                ctx.paramRef('branchRates.rates'),
              ]),
              el('branchRateGradient', { traitName: 'Sequence' }, [
                ref('treeDataLikelihood', ctx.id('treeLikelihood')),
              ]),
            ]),
            ctx.paramRef('branchRates.rates'),
            el('signTransform', {}, [ctx.paramRef('branchRates.rates')]),
          ],
        }),
      ];
    }
    return [
      ...rateOperators(ctx, mean),
      ...(spread ? [scale(ctx, spread)] : []),
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
  refs: (ctx) => ({
    branchRates: ctx.xml.ref(continuous(ctx) ? 'arbitraryBranchRates' : 'discretizedBranchRates', ctx.id('branchRates')),
  }),
  generate: (ctx) => (continuous(ctx) ? continuousRates(ctx) : discretized(ctx)),
});
