import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'treePrior.constant',
  slot: 'treePrior',
  label: 'Coalescent: constant size',
  description: 'A coalescent tree prior with a population of constant effective size.',
  citation: 'Kingman (1982) Stoch Proc Appl 13:235-248',
  parameters: () => [
    {
      name: 'constant.popSize',
      description: 'Effective population size (scaled by generation time)',
      value: 1,
      lower: 0,
      prior: { type: 'gamma', shape: 0.001, scale: 1000 },
    },
  ],
  operators: (ctx) => [
    {
      key: 'constant.popSize.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 3,
      children: [ctx.paramRef('constant.popSize')],
    },
  ],
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const likelihood = ref('coalescentLikelihood', 'coalescent');
    return {
      treePriorModel: [
        comment('A constant population size coalescent model'),
        el('constantSize', { id: 'constant', units: 'years' }, [
          el('populationSize', {}, [ctx.param('constant.popSize')]),
        ]),
      ],
      treePrior: [
        comment('The coalescent likelihood of the tree'),
        el('coalescentLikelihood', { id: 'coalescent' }, [
          el('model', {}, [ref('constantSize', 'constant')]),
          el('populationTree', {}, [ctx.ref('treeModel')]),
        ]),
      ],
      prior: [likelihood],
      fileLogLikelihoods: [likelihood],
    };
  },
});
