import { defineModule, type ModuleContext, type TraitInfo } from '@beautique/core';
import { hmcOperator, useHmc } from '../hmc';

const traitOf = (ctx: ModuleContext): TraitInfo => {
  if (!ctx.trait) throw new Error('this model needs a trait');
  return ctx.trait;
};
type Rates = 'homogeneous' | 'cauchy' | 'gamma' | 'lognormal';
const ratesOf = (ctx: ModuleContext): Rates => ctx.options.rates as Rates;
/** The lognormal relaxed random walk can have its branch rates moved by Hamiltonian Monte Carlo. */
const hmcRates = (ctx: ModuleContext): boolean => useHmc(ctx) && ratesOf(ctx) === 'lognormal';

export default defineModule({
  apiVersion: 1,
  id: 'trait.continuous',
  slot: 'trait',
  traitType: 'continuous',
  label: 'Continuous phylogeography',
  description:
    'The trait changes along the branches of the tree as a random walk (Brownian diffusion), with a rate of diffusion that can differ between branches. For coordinates, this is continuous phylogeography.',
  citation: 'Lemey, Rambaut, Welch & Suchard (2010) Mol Biol Evol 27:1877-1885',
  supportsHmc: true,
  options: {
    rates: {
      type: 'choice',
      label: 'Rate of diffusion among branches',
      default: 'cauchy',
      choices: [
        { value: 'homogeneous', label: 'The same on every branch (homogeneous Brownian)' },
        { value: 'cauchy', label: 'Relaxed random walk: Cauchy' },
        { value: 'gamma', label: 'Relaxed random walk: gamma' },
        { value: 'lognormal', label: 'Relaxed random walk: lognormal' },
      ],
    },
    latLong: {
      type: 'boolean',
      label: 'The values are latitude and longitude',
      help: 'The rate of diffusion is then reported in great-circle distance (km per year).',
      default: false,
    },
    jitter: {
      type: 'real',
      label: 'Jitter for tips with the same values',
      help: 'Tips with identical values are moved apart at random within a window of this size, which the model needs. Use 0 for none.',
      default: 0.001,
      min: 0,
    },
  },
  validate: (ctx) => {
    const trait = traitOf(ctx);
    return ctx.options.latLong === true && trait.dimension !== 2
      ? [
          {
            severity: 'error',
            message: `Trait "${trait.name}" needs two values, latitude then longitude, to be treated as coordinates`,
            path: 'traits',
          },
        ]
      : [];
  },
  parameters: (ctx) => {
    const rates = ratesOf(ctx);
    return [
      ...(rates === 'homogeneous' ? [] : [{ name: 'diffusion.rates', lower: 0, log: false }]),
      ...(rates === 'lognormal'
        ? [
            {
              name: 'stdev',
              description: 'Standard deviation of the lognormal distribution of diffusion rates among branches',
              value: 1,
              lower: 0,
              prior: { type: 'exponential' as const, mean: 1 },
            },
          ]
        : []),
      ...(rates === 'gamma'
        ? [
            {
              name: 'halfDF',
              description: 'Shape of the gamma distribution of diffusion rates among branches',
              value: 0.5,
              lower: 0,
              prior: { type: 'exponential' as const, mean: 1 },
            },
          ]
        : []),
    ];
  },
  operators: (ctx) => {
    const { el, ref } = ctx.xml;
    const trait = traitOf(ctx);
    const rates = ratesOf(ctx);
    const scale = (name: string, weight: number) => ({
      key: `${name}.scale`,
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight,
      children: [ctx.paramRef(name)],
    });
    return [
      ...(rates === 'homogeneous' || hmcRates(ctx) ? [] : [scale('diffusion.rates', 30)]),
      ...(hmcRates(ctx)
        ? [
            hmcOperator({
              key: 'diffusion.rates.hmc',
              label: `HMC(${ctx.id('diffusion.rates')})`,
              weight: 5,
              nSteps: 5,
              attrs: { drawVariance: 1 },
              children: [
                el('jointGradient', {}, [
                  el('gradient', {}, [
                    ref('distributionLikelihood', ctx.id('diffusion.prior')),
                    ctx.paramRef('diffusion.rates'),
                  ]),
                  el('branchRateGradient', { traitName: trait.name }, [
                    ref('traitDataLikelihood', ctx.id('traitLikelihood')),
                  ]),
                ]),
                ctx.paramRef('diffusion.rates'),
                el('signTransform', {}, [ctx.paramRef('diffusion.rates')]),
              ],
            }),
          ]
        : []),
      ...(rates === 'lognormal' ? [scale('stdev', 5)] : []),
      ...(rates === 'gamma' ? [scale('halfDF', 1)] : []),
      {
        key: 'precision.gibbs',
        label: `precisionGibbs(${ctx.id('precision')})`,
        element: 'precisionGibbsOperator',
        weight: trait.dimension,
        children: [
          el('wishartStatistics', { traitName: trait.name }, [ref('traitDataLikelihood', ctx.id('traitLikelihood'))]),
          ref('multivariateWishartPrior', ctx.id('precisionPrior')),
        ],
      },
    ];
  },
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const trait = traitOf(ctx);
    const d = trait.dimension;
    const rates = ratesOf(ctx);
    const relaxed = rates !== 'homogeneous';
    const id = (local: string): string => ctx.id(local);
    const column = (i: number, diagonal: number, other: number): string =>
      Array.from({ length: d }, (_, j) => (i === j ? diagonal : other)).join(' ');
    const precision = ref('matrixParameter', id('precision'));
    const likelihood = ref('traitDataLikelihood', id('traitLikelihood'));
    const branchRates = ref('arbitraryBranchRates', id('diffusion.branchRates'));
    const jitter = ctx.options.jitter as number;

    const distribution =
      rates === 'lognormal'
        ? el('logNormalDistributionModel', { meanInRealSpace: true }, [
            el('mean', {}, [el('parameter', { value: 1, lower: 0 })]),
            el('stdev', {}, [ctx.param('stdev')]),
          ])
        : el('onePGammaDistributionModel', {}, [
            el('shape', {}, [rates === 'gamma' ? ctx.param('halfDF') : el('parameter', { value: 0.5 })]),
          ]);

    return {
      traitModel: [
        comment(`Brownian diffusion of "${trait.name}" (${d} ${d === 1 ? 'dimension' : 'dimensions'})`),
        el('multivariateDiffusionModel', { id: id('diffusionModel') }, [
          el('precisionMatrix', {}, [
            el(
              'matrixParameter',
              { id: id('precision') },
              Array.from({ length: d }, (_, i) =>
                el('parameter', { id: id(`precision.col${i + 1}`), value: column(i, 0.05, 0.002) }),
              ),
            ),
          ]),
        ]),
        el('multivariateWishartPrior', { id: id('precisionPrior'), df: d }, [
          el('scaleMatrix', {}, [
            el('matrixParameter', {}, Array.from({ length: d }, (_, i) => el('parameter', { value: column(i, 1, 0) }))),
          ]),
          el('data', {}, [ref('parameter', id('precision'))]),
        ]),
        relaxed
          ? [
              comment('Relaxed random walk: each branch has its own rate of diffusion'),
              // The gamma and Cauchy models put the gamma on a branch scalar of the precision, the reciprocal of the rate.
              el('arbitraryBranchRates', { id: id('diffusion.branchRates'), reciprocal: rates !== 'lognormal' }, [
                ctx.ref('treeModel'),
                el('rates', {}, [ctx.param('diffusion.rates')]),
              ]),
              el('distributionLikelihood', { id: id('diffusion.prior') }, [
                el('data', {}, [ctx.paramRef('diffusion.rates')]),
                el('distribution', {}, [distribution]),
              ]),
            ]
          : [],
        el(
          'traitDataLikelihood',
          {
            id: id('traitLikelihood'),
            traitName: trait.name,
            useTreeLength: true,
            scaleByTime: true,
            reportAsMultivariate: true,
            reciprocalRates: false,
            integrateInternalTraits: true,
          },
          [
            ref('multivariateDiffusionModel', id('diffusionModel')),
            ctx.ref('treeModel'),
            el('traitParameter', {}, [el('parameter', { id: `leaf.${trait.name}` })]),
            jitter > 0
              ? el('jitter', { window: new Array(d).fill(jitter).join(' '), duplicatesOnly: true }, [
                  ref('parameter', `leaf.${trait.name}`),
                ])
              : [],
            el('conjugateRootPrior', {}, [
              el('meanParameter', {}, [el('parameter', { value: new Array(d).fill(0).join(' ') })]),
              el('priorSampleSize', {}, [el('parameter', { value: 0.000001 })]),
            ]),
            relaxed ? branchRates : [],
          ],
        ),
        d === 2 ? el('correlation', { id: id('correlation'), dimension1: 1, dimension2: 2 }, [precision]) : [],
        el('matrixInverse', { id: id('varCovar') }, [precision]),
        d === 2
          ? el(
              'traitDataContinuousDiffusionStatistic',
              {
                id: id('diffusionRate'),
                traitName: trait.name,
                displacementScheme: ctx.options.latLong === true ? 'greatCircleDistance' : 'linear',
                scalingScheme: 'dependent',
                weightingScheme: 'weighted',
              },
              [likelihood],
            )
          : [],
      ],
      prior: [
        relaxed ? [ref('distributionLikelihood', id('diffusion.prior')), branchRates] : [],
        ref('multivariateWishartPrior', id('precisionPrior')),
      ],
      likelihood: [likelihood],
      fileLog: [
        precision,
        d === 2 ? ref('correlation', id('correlation')) : [],
        ref('matrixInverse', id('varCovar')),
        d === 2 ? ref('traitDataContinuousDiffusionStatistic', id('diffusionRate')) : [],
      ],
      fileLogLikelihoods: [likelihood],
      treeLog: [
        el('trait', { name: trait.name, tag: trait.name }, [likelihood]),
        ref('multivariateDiffusionModel', id('diffusionModel')),
        relaxed ? el('trait', { name: 'rate', tag: id('rate') }, [branchRates]) : [],
      ],
    };
  },
});
