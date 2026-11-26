import type { ModuleContext, OperatorDecl, OptionsSchema, ParameterDecl, XmlElement } from '@beautique/core';

/** Base frequency handling shared by the nucleotide substitution models. */
export const frequencyOptions: OptionsSchema = {
  frequencies: {
    type: 'choice',
    label: 'Base frequencies',
    default: 'estimated',
    choices: [
      { value: 'estimated', label: 'Estimated' },
      { value: 'equal', label: 'All equal (fixed)' },
    ],
  },
};

const estimated = (ctx: ModuleContext): boolean => ctx.options.frequencies === 'estimated';

export function frequencyParameter(ctx: ModuleContext): ParameterDecl {
  return {
    name: 'frequencies',
    description: 'Base frequencies',
    value: [0.25, 0.25, 0.25, 0.25],
    prior: estimated(ctx) ? { type: 'dirichlet', alpha: 1, sumsTo: 1 } : undefined,
    log: estimated(ctx),
  };
}

export function frequencyOperators(ctx: ModuleContext): OperatorDecl[] {
  if (!estimated(ctx)) return [];
  return [
    {
      key: 'frequencies.deltaExchange',
      element: 'deltaExchange',
      tuning: { name: 'delta', value: 0.01 },
      weight: 1,
      children: [ctx.paramRef('frequencies')],
    },
  ];
}

/** The `<frequencies>` child of a substitution model. */
export function frequencyModel(ctx: ModuleContext): XmlElement {
  const { el } = ctx.xml;
  return el('frequencies', {}, [
    el('frequencyModel', { dataType: 'nucleotide' }, [el('frequencies', {}, [ctx.param('frequencies')])]),
  ]);
}
