import { defineModule, type ModuleContext } from '@beautique/core';

/** The cut-off: as set, or 1.5 times the span of the sampling dates. */
function cutOff(ctx: ModuleContext): number | undefined {
  if (typeof ctx.options.cutOff === 'number') return ctx.options.cutOff;
  const range = ctx.data.dateRange;
  return range && range.max > range.min ? 1.5 * (range.max - range.min) : undefined;
}

export default defineModule({
  apiVersion: 1,
  id: 'treePrior.skygrid',
  slot: 'treePrior',
  label: 'Coalescent: Bayesian skygrid',
  description:
    'A non-parametric coalescent prior: the effective population size changes at fixed grid points in time, smoothed by a Gaussian Markov random field.',
  citation: 'Gill, Lemey, Faria, Rambaut, Shapiro & Suchard (2013) Mol Biol Evol 30:713-724',
  options: {
    gridPoints: {
      type: 'integer',
      label: 'Number of population sizes',
      help: 'The number of intervals with their own population size.',
      default: 50,
      min: 2,
      max: 1000,
    },
    cutOff: {
      type: 'real',
      label: 'Time of the last grid point',
      help: 'How far back from the most recent sample the grid extends. Leave empty to use 1.5 times the span of the sampling dates.',
      optional: true,
      min: 0,
      exclusiveMin: true,
      units: 'years before the most recent sample',
    },
  },
  validate: (ctx) =>
    cutOff(ctx) === undefined
      ? [
          {
            severity: 'error',
            message: 'Bayesian skygrid: set the time of the last grid point (it cannot be worked out without a range of tip dates)',
            path: ctx.optionPath('cutOff'),
          },
        ]
      : [],
  parameters: (ctx) => [
    {
      name: 'skygrid.logPopSize',
      description: 'Log effective population size in each grid interval',
      dimension: ctx.options.gridPoints as number,
      value: 1,
    },
    {
      name: 'skygrid.precision',
      description: 'Precision of the smoothing between adjacent population sizes',
      value: 0.1,
      lower: 0,
      prior: { type: 'gamma', shape: 0.001, scale: 1000 },
    },
    { name: 'skygrid.cutOff', value: cutOff(ctx) ?? 1 },
  ],
  operators: (ctx) => [
    {
      key: 'skygrid.gridBlockUpdate',
      label: 'gmrfGridBlockUpdate(skygrid.logPopSize, skygrid.precision)',
      element: 'gmrfGridBlockUpdateOperator',
      weight: 2,
      children: [ctx.xml.ref('gmrfSkyrideLikelihood', 'skygrid')],
    },
    {
      key: 'skygrid.precision.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 1,
      children: [ctx.paramRef('skygrid.precision')],
    },
  ],
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const likelihood = ref('gmrfSkyGridLikelihood', 'skygrid');
    return {
      treePrior: [
        comment('The Bayesian skygrid coalescent likelihood (skygrid.logPopSize is in log units)'),
        el('gmrfSkyGridLikelihood', { id: 'skygrid' }, [
          el('populationSizes', {}, [ctx.param('skygrid.logPopSize')]),
          el('precisionParameter', {}, [ctx.param('skygrid.precision')]),
          el('numGridPoints', {}, [
            el('parameter', { id: 'skygrid.numGridPoints', value: (ctx.options.gridPoints as number) - 1 }),
          ]),
          el('cutOff', {}, [ctx.param('skygrid.cutOff')]),
          el('populationTree', {}, [ctx.ref('treeModel')]),
        ]),
      ],
      prior: [likelihood],
      fileLogLikelihoods: [likelihood],
    };
  },
});
