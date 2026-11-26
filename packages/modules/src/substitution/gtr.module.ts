import { defineModule } from '@beautique/core';
import { frequencyModel, frequencyOperators, frequencyOptions, frequencyParameter } from './frequencies';

export default defineModule({
  apiVersion: 1,
  id: 'substitution.gtr',
  slot: 'substitution',
  label: 'GTR',
  description: 'The general time-reversible model: a separate rate for each of the six pairs of bases.',
  citation: 'Tavaré (1986) Lect Math Life Sci 17:57-86',
  options: { ...frequencyOptions },
  parameters: (ctx) => [
    {
      name: 'gtr.rates',
      description: 'GTR relative substitution rates (AC, AG, AT, CG, CT, GT)',
      dimension: 6,
      value: 1,
      lower: 0,
      prior: { type: 'dirichlet', alpha: 1, sumsTo: 6 },
    },
    frequencyParameter(ctx),
  ],
  operators: (ctx) => [
    {
      key: 'gtr.rates.deltaExchange',
      element: 'deltaExchange',
      tuning: { name: 'delta', value: 0.01 },
      weight: 1,
      children: [ctx.paramRef('gtr.rates')],
    },
    ...frequencyOperators(ctx),
  ],
  refs: (ctx) => ({ substitutionModel: ctx.xml.ref('gtrModel', ctx.id('gtr')) }),
  generate: (ctx) => {
    const { el, comment } = ctx.xml;
    return {
      substitutionModel: [
        comment('The general time reversible (GTR) substitution model'),
        el('gtrModel', { id: ctx.id('gtr') }, [frequencyModel(ctx), el('rates', {}, [ctx.param('gtr.rates')])]),
      ],
    };
  },
});
