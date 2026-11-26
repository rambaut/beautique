import { defineModule } from '@beautique/core';
import { hmcOperator } from '../hmc';
import { rateOperators, rateOptions, rateParameter } from './rate';

export default defineModule({
  apiVersion: 1,
  id: 'clock.shrinkage',
  slot: 'clock',
  label: 'Shrinkage local clock',
  description:
    'Rates are inherited along the tree and change between a branch and its parent only where the data call for it: a prior that shrinks most changes towards zero finds the local clocks without their being specified. Always sampled by Hamiltonian Monte Carlo.',
  citation: 'Fisher, Ji, Nishimura, Baele, Lemey & Suchard (2023) Syst Biol 72:1136-1153',
  supportsHmc: true,
  options: { ...rateOptions },
  // its operators need gradients of the sequence likelihood
  facts: () => ({ usePreOrder: true }),
  parameters: (ctx) => [
    rateParameter(ctx, 'clock.rate', 'Overall substitution rate'),
    { name: 'substBranchRates.rates', description: 'Relative rate of each branch', value: 1, log: false },
    {
      name: 'globalScale',
      description: 'Overall size of the changes of rate between a branch and its parent',
      value: 1,
      lower: 0,
      prior: { type: 'gamma', shape: 1, scale: 2 },
    },
  ],
  operators: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const incrementGradient = ref('gradientWrtIncrements', ctx.id('incrementGradient'));
    return [
      ...rateOperators(ctx, 'clock.rate'),
      {
        key: 'shrinkage.gibbs',
        label: 'bayesianBridgeGibbs(scales of the changes of rate)',
        element: 'bayesianBridgeGibbsOperator',
        weight: 4,
        children: [ref('autoCorrelatedRatesPrior', ctx.id('substBranchRatesPrior')), ctx.priorRef('globalScale')],
      },
      hmcOperator({
        key: 'shrinkage.hmc',
        label: `HMC(${ctx.id('substBranchRates.rates')})`,
        weight: 8,
        nSteps: 5,
        attrs: {
          autoOptimize: undefined,
          gradientCheckCount: undefined,
          drawVariance: 1,
          preconditioningUpdateFrequency: 1,
          preconditioningDelay: 0,
        },
        children: [
          el('jointGradient', {}, [
            comment('gradient of the likelihood with respect to the changes of rate'),
            el('branchRateGradientWrtIncrements', {}, [
              el('branchRateGradient', { traitName: 'Sequence' }, [ref('treeDataLikelihood', ctx.id('treeLikelihood'))]),
              incrementGradient,
            ]),
            incrementGradient,
          ]),
          el('preconditioner', {}, [ref('bayesianBridgeDistribution', ctx.id('bbDistribution'))]),
        ],
      }),
    ];
  },
  refs: (ctx) => ({ branchRates: ctx.xml.ref('scaledByTreeTimeBranchRates', ctx.id('branchRates')) }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const branchRates = ref('scaledByTreeTimeBranchRates', ctx.id('branchRates'));
    const substBranchRates = ref('arbitraryBranchRates', ctx.id('substBranchRates'));
    const ratesPrior = ref('autoCorrelatedRatesPrior', ctx.id('substBranchRatesPrior'));
    const fixed = (name: string, value: number) => el(name, {}, [el('parameter', { id: ctx.id(name), value })]);
    return {
      clock: [
        comment('The shrinkage local clock (Fisher et al, 2023)'),
        el(
          'arbitraryBranchRates',
          { id: ctx.id('substBranchRates'), centerAtOne: false, randomizeRates: true, randomScale: 0.1 },
          [ctx.ref('treeModel'), el('rates', {}, [ctx.param('substBranchRates.rates')])],
        ),
        comment('Bayesian bridge prior on the change of log rate between each branch and its parent'),
        el('bayesianBridgeDistribution', { id: ctx.id('bbDistribution') }, [
          el('dimension', {}, [ctx.paramRef('substBranchRates.rates')]),
          fixed('slabWidth', 2),
          el('globalScale', {}, [ctx.param('globalScale')]),
          fixed('exponent', 0.25),
          fixed('localScale', 10),
        ]),
        el(
          'autoCorrelatedRatesPrior',
          { id: ctx.id('substBranchRatesPrior'), scaling: 'none', log: true, operateOnIncrements: true },
          [substBranchRates, ref('bayesianBridgeDistribution', ctx.id('bbDistribution'))],
        ),
        comment('The branch rates, scaled so that clock.rate is the mean rate over the tree'),
        el('scaledByTreeTimeBranchRates', { id: ctx.id('branchRates') }, [
          substBranchRates,
          ctx.ref('treeModel'),
          ctx.param('clock.rate'),
        ]),
        el('gradientWrtIncrements', { id: ctx.id('incrementGradient') }, [ratesPrior]),
        el(
          'rateStatistic',
          { id: ctx.id('meanRate'), name: ctx.id('meanRate'), mode: 'mean', internal: true, external: true },
          [ctx.ref('treeModel'), branchRates],
        ),
        el(
          'rateStatistic',
          {
            id: ctx.id('coefficientOfVariation'),
            name: ctx.id('coefficientOfVariation'),
            mode: 'coefficientOfVariation',
            internal: true,
            external: true,
          },
          [ctx.ref('treeModel'), branchRates],
        ),
      ],
      prior: [ratesPrior, substBranchRates, branchRates],
      fileLog: [
        ref('rateStatistic', ctx.id('meanRate')),
        ref('rateStatistic', ctx.id('coefficientOfVariation')),
      ],
      fileLogLikelihoods: [branchRates],
      treeLog: [el('trait', { name: 'rate', tag: ctx.id('rate') }, [branchRates])],
    };
  },
});
