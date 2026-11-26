import type { FactValue, ModuleContext, OperatorDecl, ParameterDecl } from '@beautique/core';

/**
 * The height the starting tree is asked to have under a model with a time of
 * origin: twice the span of the sampling dates, or 1 when the tips are not dated.
 */
export function startingRootHeight(ctx: ModuleContext): number {
  const range = ctx.data.dateRange;
  const span = range ? range.max - range.min : 0;
  return span > 0 ? Number((2 * span).toPrecision(6)) : 1;
}

/** Asks the starting tree module for a tree that starts below the origin. */
export function originFacts(ctx: ModuleContext): Record<string, FactValue> {
  return { startingRootHeight: startingRootHeight(ctx) };
}

/**
 * The time of origin of a birth-death process, in years before the most recent
 * sample. It must be older than the root, so it starts a quarter above the
 * height asked of the starting tree.
 */
export function originParameter(ctx: ModuleContext, name: string): ParameterDecl {
  return {
    name,
    description: 'Time of origin of the process, before the most recent sample (must be older than the root)',
    value: Number((1.25 * startingRootHeight(ctx)).toPrecision(6)),
    lower: 0,
    prior: { type: 'logNormal', mu: 1, sigma: 1.5 },
  };
}

export function scaleOperator(ctx: ModuleContext, name: string, weight = 1): OperatorDecl {
  return {
    key: `${name}.scale`,
    element: 'scaleOperator',
    tuning: { name: 'scaleFactor', value: 0.75 },
    weight,
    children: [ctx.paramRef(name)],
  };
}
