import type { ModuleContext, OperatorDecl, OptionsSchema, ParameterDecl } from '@beautique/core';

/** The "estimate or fix the overall rate" options shared by the clock models. */
export const rateOptions: OptionsSchema = {
  rateMode: {
    type: 'choice',
    label: 'Clock rate',
    default: 'auto',
    choices: [
      { value: 'auto', label: 'Estimate if tips are dated, otherwise fix at 1' },
      { value: 'estimate', label: 'Estimate' },
      { value: 'fixed', label: 'Fix to a value' },
    ],
  },
  fixedRate: {
    type: 'real',
    label: 'Fixed rate',
    default: 1,
    min: 0,
    exclusiveMin: true,
    units: 'substitutions per site per year',
    visibleWhen: { field: 'rateMode', equals: 'fixed' },
  },
};

/** The rate is estimated when asked for, or by default whenever the tips are dated. */
export function rateEstimated(ctx: ModuleContext): boolean {
  const mode = ctx.options.rateMode;
  return mode === 'estimate' || (mode === 'auto' && ctx.data.hasDates);
}

/** The declaration of the overall rate parameter under the given name. */
export function rateParameter(ctx: ModuleContext, name: string, description: string): ParameterDecl {
  const estimate = rateEstimated(ctx);
  const fixed = ctx.options.rateMode === 'fixed' ? (ctx.options.fixedRate as number) : 1;
  return {
    name,
    description,
    value: estimate ? 0.001 : fixed,
    lower: 0,
    prior: estimate ? { type: 'ctmcScale' } : undefined,
    screen: estimate,
  };
}

/**
 * Operators on the overall rate: a scale move, and one that trades rates against
 * tree height. `alsoDown` names further rate parameters that move with the rate.
 */
export function rateOperators(ctx: ModuleContext, name: string, alsoDown: string[] = []): OperatorDecl[] {
  if (!rateEstimated(ctx)) return [];
  const { el } = ctx.xml;
  const down = [name, ...alsoDown];
  return [
    {
      key: `${name}.scale`,
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 3,
      children: [ctx.paramRef(name)],
    },
    {
      key: `${name}.upDown`,
      label: `upDown(node heights / ${down.map((d) => ctx.id(d)).join(', ')})`,
      element: 'upDownOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 3,
      children: [
        el('up', {}, [ctx.ref('allInternalNodeHeights')]),
        el('down', {}, down.map((d) => ctx.paramRef(d))),
      ],
    },
  ];
}
