import { defineModule, type ModuleContext, type TraitInfo } from '@beautique/core';

const traitOf = (ctx: ModuleContext): TraitInfo => {
  if (!ctx.trait) throw new Error('this model needs a trait');
  return ctx.trait;
};
const symmetric = (ctx: ModuleContext): boolean => ctx.options.structure === 'symmetric';
/** The number of rates: one for each pair of states, or for each ordered pair. */
const rateCount = (ctx: ModuleContext): number => {
  const k = traitOf(ctx).states.length;
  return symmetric(ctx) ? (k * (k - 1)) / 2 : k * (k - 1);
};
const likelihoodName = (ctx: ModuleContext): string =>
  ctx.options.markovJumps === true ? 'markovJumpsTreeLikelihood' : 'ancestralTreeLikelihood';

export default defineModule({
  apiVersion: 1,
  id: 'trait.discrete',
  slot: 'trait',
  traitType: 'discrete',
  label: 'Discrete phylogeography',
  description:
    'The trait changes along the branches of the tree as a continuous-time Markov chain between its states, and the states of ancestors are reconstructed. For locations, this is discrete phylogeography.',
  citation: 'Lemey, Rambaut, Drummond & Suchard (2009) PLoS Comput Biol 5:e1000520',
  options: {
    structure: {
      type: 'choice',
      label: 'Rates between states',
      default: 'symmetric',
      choices: [
        { value: 'symmetric', label: 'Symmetric: the same rate in both directions' },
        { value: 'asymmetric', label: 'Asymmetric: a rate for each direction' },
      ],
    },
    bssvs: {
      type: 'boolean',
      label: 'Find the rates that are needed (BSSVS)',
      help: 'Bayesian stochastic search variable selection: each rate can be switched off, with a prior that favours few rates.',
      default: true,
    },
    markovJumps: {
      type: 'boolean',
      label: 'Count the changes of state (Markov jumps)',
      help: 'Logs the expected number of changes of state over the tree.',
      default: false,
    },
  },
  validate: (ctx) =>
    traitOf(ctx).states.length < 2
      ? [
          {
            severity: 'error',
            message: `Trait "${traitOf(ctx).name}" needs at least two different states`,
            path: 'traits',
          },
        ]
      : [],
  parameters: (ctx) => {
    const n = rateCount(ctx);
    return [
      {
        name: 'clock.rate',
        description: `Overall rate of change of ${traitOf(ctx).name}, in changes per year`,
        value: ctx.data.hasDates ? 0.001 : 1,
        lower: 0,
        prior: { type: 'ctmcScale' },
        screen: true,
      },
      { name: 'frequencies', dimension: traitOf(ctx).states.length, log: false },
      {
        name: 'rates',
        description: `Relative rates of change between the states of ${traitOf(ctx).name}`,
        value: 1,
        dimension: n,
        lower: 0,
        prior: { type: 'gamma', shape: 1, scale: 1 },
      },
      ...(ctx.options.bssvs === true
        ? [{ name: 'indicators', description: 'Which rates are switched on (1) or off (0)', value: 1, dimension: n }]
        : []),
    ];
  },
  operators: (ctx) => [
    {
      key: 'clock.rate.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 3,
      children: [ctx.paramRef('clock.rate')],
    },
    {
      key: 'rates.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      attrs: { scaleAllIndependently: true },
      weight: 15,
      children: [ctx.paramRef('rates')],
    },
    ...(ctx.options.bssvs === true
      ? [{ key: 'indicators.bitFlip', element: 'bitFlipOperator', weight: 7, children: [ctx.paramRef('indicators')] }]
      : []),
  ],
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const trait = traitOf(ctx);
    const k = trait.states.length;
    const bssvs = ctx.options.bssvs === true;
    const id = (local: string): string => ctx.id(local);
    const dataType = ref('generalDataType', id('dataType'));
    const model = ref('generalSubstitutionModel', id('model'));
    const branchRates = ref('strictClockBranchRates', id('branchRates'));
    const likelihood = ref(likelihoodName(ctx), id('treeLikelihood'));
    // A symmetric model has one parameter for each pair of states, used for both directions.
    const paired = (parameter: ReturnType<typeof el>) =>
      symmetric(ctx) ? el('duplicatedParameter', { copies: 2 }, [parameter]) : parameter;
    // For counting changes: 1 for every change between different states.
    const allChanges = Array.from({ length: k * k }, (_, i) => (Math.floor(i / k) === i % k ? 0 : 1)).join(' ');
    // The fewest rates that keep every state reachable.
    const poisson = symmetric(ctx) ? { mean: Math.LN2, offset: k - 1 } : { mean: k - 1, offset: 0 };

    return {
      dataType: [
        comment(`The ${k} states of the discrete trait "${trait.name}"`),
        el('generalDataType', { id: id('dataType') }, trait.states.map((code) => el('state', { code }))),
        el('attributePatterns', { id: id('pattern'), attribute: trait.name }, [ref('taxa', 'taxa'), dataType]),
      ],
      clock: [
        comment(`The rate of change of "${trait.name}"`),
        el('strictClockBranchRates', { id: id('branchRates') }, [el('rate', {}, [ctx.param('clock.rate')])]),
      ],
      traitModel: [
        comment(
          `${symmetric(ctx) ? 'Symmetric' : 'Asymmetric'} CTMC model of changes of "${trait.name}"${bssvs ? ', with BSSVS' : ''}`,
        ),
        el('generalSubstitutionModel', { id: id('model'), randomizeIndicator: symmetric(ctx) ? undefined : false }, [
          dataType,
          el('frequencies', {}, [
            el('frequencyModel', { id: id('frequencyModel'), normalize: true }, [
              dataType,
              el('frequencies', {}, [ctx.param('frequencies')]),
            ]),
          ]),
          el('rates', {}, [paired(ctx.param('rates'))]),
          bssvs ? el('rateIndicator', {}, [paired(ctx.param('indicators'))]) : [],
        ]),
        bssvs
          ? [
              el('sumStatistic', { id: id('nonZeroRates'), elementwise: true }, [ctx.paramRef('indicators')]),
              el('productStatistic', { id: id('actualRates'), elementwise: false }, [
                ctx.paramRef('indicators'),
                ctx.paramRef('rates'),
              ]),
            ]
          : [],
        el('siteModel', { id: id('siteModel') }, [el('substitutionModel', {}, [model])]),
        comment(`Likelihood of the tree given the values of "${trait.name}" at the tips`),
        el(
          likelihoodName(ctx),
          {
            id: id('treeLikelihood'),
            stateTagName: `${trait.name}.states`,
            useUniformization: true,
            saveCompleteHistory: false,
            logCompleteHistory: false,
          },
          [
            ref('attributePatterns', id('pattern')),
            ctx.ref('treeModel'),
            ref('siteModel', id('siteModel')),
            model,
            model,
            branchRates,
            ctx.options.markovJumps === true ? el('parameter', { id: id('count'), value: allChanges }) : [],
          ],
        ),
      ],
      prior: [
        bssvs
          ? el('poissonPrior', { mean: poisson.mean, offset: poisson.offset }, [ref('statistic', id('nonZeroRates'))])
          : [],
        branchRates,
        model,
      ],
      likelihood: [likelihood],
      screenLog: bssvs
        ? [el('column', { label: id('nonZeroRates'), dp: 0, width: 6 }, [ref('sumStatistic', id('nonZeroRates'))])]
        : [],
      fileLog: [bssvs ? ref('sumStatistic', id('nonZeroRates')) : []],
      fileLogLikelihoods: [likelihood],
      treeLog: [
        el('trait', { name: 'rate', tag: id('rate') }, [branchRates]),
        el('trait', { name: `${trait.name}.states`, tag: trait.name }, [likelihood]),
      ],
    };
  },
});
