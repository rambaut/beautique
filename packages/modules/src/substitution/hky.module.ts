import { defineModule } from '@beautique/core';
import { frequencyModel, frequencyOperators, frequencyOptions, frequencyParameter } from './frequencies';

export default defineModule({
  apiVersion: 1,
  id: 'substitution.hky',
  slot: 'substitution',
  label: 'HKY',
  description: 'Two substitution rates: transitions and transversions, with unequal base frequencies.',
  citation: 'Hasegawa, Kishino & Yano (1985) J Mol Evol 22:160-174',
  options: { ...frequencyOptions },
  parameters: (ctx) => [
    {
      name: 'kappa',
      description: 'HKY transition-transversion rate ratio',
      value: 2,
      lower: 0,
      prior: { type: 'logNormal', mu: 1, sigma: 1.25 },
    },
    frequencyParameter(ctx),
  ],
  operators: (ctx) => [
    {
      key: 'kappa.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 1,
      children: [ctx.paramRef('kappa')],
    },
    ...frequencyOperators(ctx),
  ],
  refs: (ctx) => ({ substitutionModel: ctx.xml.ref('HKYModel', ctx.id('hky')) }),
  generate: (ctx) => {
    const { el, comment } = ctx.xml;
    return {
      substitutionModel: [
        comment('The HKY substitution model (Hasegawa, Kishino & Yano, 1985)'),
        el('HKYModel', { id: ctx.id('hky') }, [frequencyModel(ctx), el('kappa', {}, [ctx.param('kappa')])]),
      ],
    };
  },
});
