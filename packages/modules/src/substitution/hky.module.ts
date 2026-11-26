import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'substitution.hky',
  slot: 'substitution',
  label: 'HKY',
  description: 'Two substitution rates: transitions and transversions, with unequal base frequencies.',
  citation: 'Hasegawa, Kishino & Yano (1985) J Mol Evol 22:160-174',
  options: {
    frequencies: {
      type: 'choice',
      label: 'Base frequencies',
      default: 'estimated',
      choices: [
        { value: 'estimated', label: 'Estimated' },
        { value: 'equal', label: 'All equal (fixed)' },
      ],
    },
  },
  parameters: (ctx) => [
    {
      name: 'kappa',
      description: 'HKY transition-transversion rate ratio',
      value: 2,
      lower: 0,
      prior: { type: 'logNormal', mu: 1, sigma: 1.25 },
    },
    {
      name: 'frequencies',
      description: 'Base frequencies',
      value: [0.25, 0.25, 0.25, 0.25],
      prior: ctx.options.frequencies === 'estimated' ? { type: 'dirichlet', alpha: 1, sumsTo: 1 } : undefined,
      log: ctx.options.frequencies === 'estimated',
    },
  ],
  operators: (ctx) => [
    {
      key: 'kappa.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 1,
      children: [ctx.paramRef('kappa')],
    },
    ...(ctx.options.frequencies === 'estimated'
      ? [
          {
            key: 'frequencies.deltaExchange',
            element: 'deltaExchange',
            tuning: { name: 'delta', value: 0.01 },
            weight: 1,
            children: [ctx.paramRef('frequencies')],
          },
        ]
      : []),
  ],
  refs: (ctx) => ({ substitutionModel: ctx.xml.ref('HKYModel', ctx.id('hky')) }),
  generate: (ctx) => {
    const { el, comment } = ctx.xml;
    return {
      substitutionModel: [
        comment('The HKY substitution model (Hasegawa, Kishino & Yano, 1985)'),
        el('HKYModel', { id: ctx.id('hky') }, [
          el('frequencies', {}, [
            el('frequencyModel', { dataType: 'nucleotide' }, [el('frequencies', {}, [ctx.param('frequencies')])]),
          ]),
          el('kappa', {}, [ctx.param('kappa')]),
        ]),
      ],
    };
  },
});
