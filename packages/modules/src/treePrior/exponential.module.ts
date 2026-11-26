import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'treePrior.exponential',
  slot: 'treePrior',
  label: 'Coalescent: exponential growth',
  description: 'A coalescent tree prior with a population that grows (or declines) exponentially.',
  citation: 'Griffiths & Tavaré (1994) Phil Trans R Soc B 344:403-410',
  parameters: () => [
    {
      name: 'exponential.popSize',
      description: 'Effective population size at the time of the most recent sample',
      value: 1,
      lower: 0,
      prior: { type: 'gamma', shape: 0.001, scale: 1000 },
    },
    {
      name: 'exponential.growthRate',
      description: 'Exponential growth rate per year',
      value: 0,
      prior: { type: 'laplace', mean: 0, scale: 100 },
    },
  ],
  operators: (ctx) => [
    {
      key: 'exponential.popSize.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 3,
      children: [ctx.paramRef('exponential.popSize')],
    },
    {
      key: 'exponential.growthRate.randomWalk',
      element: 'randomWalkOperator',
      tuning: { name: 'windowSize', value: 1 },
      weight: 3,
      children: [ctx.paramRef('exponential.growthRate')],
    },
  ],
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const likelihood = ref('coalescentLikelihood', 'coalescent');
    return {
      treePriorModel: [
        comment('An exponential growth coalescent model'),
        el('exponentialGrowth', { id: 'exponential', units: 'years' }, [
          el('populationSize', {}, [ctx.param('exponential.popSize')]),
          el('growthRate', {}, [ctx.param('exponential.growthRate')]),
        ]),
      ],
      treePrior: [
        comment('The coalescent likelihood of the tree'),
        el('coalescentLikelihood', { id: 'coalescent' }, [
          el('model', {}, [ref('exponentialGrowth', 'exponential')]),
          el('populationTree', {}, [ctx.ref('treeModel')]),
        ]),
      ],
      prior: [likelihood],
      fileLogLikelihoods: [likelihood],
    };
  },
});
