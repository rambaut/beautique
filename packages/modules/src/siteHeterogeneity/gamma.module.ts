import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'siteHeterogeneity.gamma',
  slot: 'siteHeterogeneity',
  label: 'Gamma',
  description: 'Rates vary among sites following a discretised gamma distribution.',
  citation: 'Yang (1994) J Mol Evol 39:306-314',
  options: {
    categories: {
      type: 'integer',
      label: 'Number of rate categories',
      default: 4,
      min: 2,
      max: 32,
    },
  },
  parameters: () => [
    {
      name: 'alpha',
      description: 'Shape of the gamma distribution of rates among sites',
      value: 0.5,
      lower: 0,
      prior: { type: 'exponential', mean: 0.5 },
    },
  ],
  operators: (ctx) => [
    {
      key: 'alpha.scale',
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 1,
      children: [ctx.paramRef('alpha')],
    },
  ],
  generate: (ctx) => ({
    siteModel: [ctx.xml.el('gammaShape', { gammaCategories: ctx.options.categories as number }, [ctx.param('alpha')])],
  }),
});
