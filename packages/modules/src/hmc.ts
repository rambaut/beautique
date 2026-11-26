import type { AttrValue, ModuleContext, OperatorDecl, XmlChild } from '@beautique/core';

export interface HmcSpec {
  key: string;
  label: string;
  weight: number;
  nSteps: number;
  /** Initial step size; tuned as the chain runs. */
  stepSize?: number;
  /** Further attributes, such as preconditioning. */
  attrs?: Record<string, AttrValue>;
  /** The gradient, the parameter, and any transform or preconditioner, in that order. */
  children: XmlChild[];
}

/** True when the analysis asks for gradient-based (Hamiltonian Monte Carlo) operators where a model has them. */
export function useHmc(ctx: ModuleContext): boolean {
  return ctx.operatorStrategy === 'hmc';
}

/** A Hamiltonian Monte Carlo operator. */
export function hmcOperator(spec: HmcSpec): OperatorDecl {
  return {
    key: spec.key,
    label: spec.label,
    element: 'hamiltonianMonteCarloOperator',
    tuning: { name: 'stepSize', value: spec.stepSize ?? 0.01 },
    attrs: { nSteps: spec.nSteps, mode: 'vanilla', autoOptimize: true, gradientCheckCount: 0, ...spec.attrs },
    weight: spec.weight,
    children: spec.children,
  };
}
