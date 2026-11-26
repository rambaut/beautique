import type { PriorSpec } from './module-api';
import { el, type XmlElement } from './xml';

export type PriorType = PriorSpec['type'];

interface PriorParam {
  name: string;
  default: number;
  /** Must be greater than zero. */
  positive?: boolean;
}

/** The prior distributions on offer, with their parameters. Drives the prior editor and validation. */
export const PRIOR_TYPES: Record<PriorType, { label: string; params: PriorParam[] }> = {
  logNormal: {
    label: 'Lognormal',
    params: [
      { name: 'mu', default: 1 },
      { name: 'sigma', default: 1, positive: true },
      { name: 'offset', default: 0 },
    ],
  },
  normal: {
    label: 'Normal',
    params: [
      { name: 'mean', default: 0 },
      { name: 'stdev', default: 1, positive: true },
    ],
  },
  gamma: {
    label: 'Gamma',
    params: [
      { name: 'shape', default: 1, positive: true },
      { name: 'scale', default: 1, positive: true },
      { name: 'offset', default: 0 },
    ],
  },
  exponential: {
    label: 'Exponential',
    params: [
      { name: 'mean', default: 1, positive: true },
      { name: 'offset', default: 0 },
    ],
  },
  laplace: {
    label: 'Laplace',
    params: [
      { name: 'mean', default: 0 },
      { name: 'scale', default: 1, positive: true },
    ],
  },
  uniform: {
    label: 'Uniform',
    params: [
      { name: 'lower', default: 0 },
      { name: 'upper', default: 1 },
    ],
  },
  dirichlet: {
    label: 'Dirichlet',
    params: [
      { name: 'alpha', default: 1, positive: true },
      { name: 'sumsTo', default: 1, positive: true },
    ],
  },
  ctmcScale: { label: 'CTMC rate reference', params: [] },
  oneOnX: { label: '1/x', params: [] },
};

/** A prior of the given type with default parameter values. */
export function defaultPrior(type: PriorType): PriorSpec {
  const prior: Record<string, unknown> = { type };
  for (const param of PRIOR_TYPES[type].params) prior[param.name] = param.default;
  return prior as PriorSpec;
}

/** The value of a prior's parameter, with the default for optional ones that are not set. */
export function priorParam(prior: PriorSpec, name: string): number {
  const value = (prior as Record<string, unknown>)[name];
  if (typeof value === 'number') return value;
  return PRIOR_TYPES[prior.type].params.find((p) => p.name === name)?.default ?? Number.NaN;
}

/** Returns a message when the prior's parameters are not valid, otherwise null. */
export function validatePrior(prior: PriorSpec): string | null {
  const info = PRIOR_TYPES[prior.type];
  if (!info) return `unknown prior type "${String(prior.type)}"`;
  for (const param of info.params) {
    const value = priorParam(prior, param.name);
    if (!Number.isFinite(value)) return `${info.label} prior: ${param.name} must be a number`;
    if (param.positive && value <= 0) return `${info.label} prior: ${param.name} must be greater than 0`;
  }
  if (prior.type === 'uniform' && prior.lower >= prior.upper) return 'Uniform prior: lower must be less than upper';
  return null;
}

/** A short description such as "Lognormal(mu=1, sigma=1.25)". */
export function describePrior(prior: PriorSpec): string {
  const info = PRIOR_TYPES[prior.type];
  const shown = info.params
    .filter((p) => !(p.name === 'offset' && priorParam(prior, 'offset') === 0))
    .map((p) => `${p.name}=${priorParam(prior, p.name)}`);
  return shown.length > 0 ? `${info.label}(${shown.join(', ')})` : info.label;
}

const PRIOR_ELEMENTS: Record<PriorType, string> = {
  logNormal: 'logNormalPrior',
  normal: 'normalPrior',
  gamma: 'gammaPrior',
  exponential: 'exponentialPrior',
  laplace: 'laplacePrior',
  uniform: 'uniformPrior',
  dirichlet: 'dirichletPrior',
  ctmcScale: 'ctmcScalePrior',
  oneOnX: 'oneOnXPrior',
};

/** The name of the XML element that `priorElement` writes for a prior. */
export function priorElementName(prior: PriorSpec): string {
  return PRIOR_ELEMENTS[prior.type];
}

/** The prior's XML element around a reference to its parameter. */
export function priorElement(prior: PriorSpec, parameter: XmlElement, treeModel: () => XmlElement): XmlElement {
  const value = (name: string): number => priorParam(prior, name);
  switch (prior.type) {
    case 'logNormal':
      return el('logNormalPrior', { mu: value('mu'), sigma: value('sigma'), offset: value('offset') }, [parameter]);
    case 'normal':
      return el('normalPrior', { mean: value('mean'), stdev: value('stdev') }, [parameter]);
    case 'gamma':
      return el('gammaPrior', { shape: value('shape'), scale: value('scale'), offset: value('offset') }, [parameter]);
    case 'exponential':
      return el('exponentialPrior', { mean: value('mean'), offset: value('offset') }, [parameter]);
    case 'laplace':
      return el('laplacePrior', { mean: value('mean'), scale: value('scale') }, [parameter]);
    case 'uniform':
      return el('uniformPrior', { lower: value('lower'), upper: value('upper') }, [parameter]);
    case 'dirichlet':
      return el('dirichletPrior', { alpha: value('alpha'), sumsTo: value('sumsTo') }, [parameter]);
    case 'ctmcScale':
      return el('ctmcScalePrior', {}, [el('ctmcScale', {}, [parameter]), treeModel()]);
    case 'oneOnX':
      return el('oneOnXPrior', {}, [parameter]);
  }
}
