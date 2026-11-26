import { defineModule } from '@beautique/core';
import { originFacts, originParameter, scaleOperator } from './origin';

export default defineModule({
  apiVersion: 1,
  id: 'treePrior.birthDeathSampling',
  slot: 'treePrior',
  label: 'Birth-death with serial sampling',
  description:
    'A birth-death tree prior with constant rates of birth, death and sampling through time. Suited to trees of an epidemic sampled over its course.',
  citation: 'Stadler (2010) J Theor Biol 267:396-404',
  facts: originFacts,
  parameters: (ctx) => [
    {
      name: 'bdss.birthRate',
      description: 'Birth (transmission) rate, per lineage per year',
      value: 2,
      lower: 0,
      prior: { type: 'logNormal', mu: 1, sigma: 1.5 },
    },
    {
      name: 'bdss.relativeDeathRate',
      description: 'Death rate as a fraction of the birth rate',
      value: 0.5,
      lower: 0,
      upper: 1,
      prior: { type: 'uniform', lower: 0, upper: 1 },
    },
    {
      name: 'bdss.psi',
      description: 'Rate of sampling lineages through time, per lineage per year',
      value: 2,
      lower: 0,
      prior: { type: 'logNormal', mu: 1, sigma: 1.5 },
    },
    originParameter(ctx, 'bdss.origin'),
  ],
  operators: (ctx) => [
    scaleOperator(ctx, 'bdss.birthRate'),
    {
      key: 'bdss.relativeDeathRate.randomWalk',
      element: 'randomWalkOperator',
      tuning: { name: 'windowSize', value: 0.1 },
      attrs: { boundaryCondition: 'reflecting' },
      weight: 1,
      children: [ctx.paramRef('bdss.relativeDeathRate')],
    },
    scaleOperator(ctx, 'bdss.psi'),
    scaleOperator(ctx, 'bdss.origin'),
  ],
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const likelihood = ref('speciationLikelihood', 'speciation');
    return {
      treePriorModel: [
        comment('Birth-death model with serial sampling (Stadler, 2010)'),
        el('birthDeathSerialSampling', { id: 'bdss', units: 'years', hasFinalSample: false }, [
          el('birthRate', {}, [ctx.param('bdss.birthRate')]),
          el('relativeDeathRate', {}, [ctx.param('bdss.relativeDeathRate')]),
          el('psi', {}, [ctx.param('bdss.psi')]),
          el('origin', {}, [ctx.param('bdss.origin')]),
        ]),
      ],
      treePrior: [
        comment('The likelihood of the tree under the birth-death model'),
        el('speciationLikelihood', { id: 'speciation' }, [
          el('model', {}, [ref('birthDeathSerialSampling', 'bdss')]),
          el('speciesTree', {}, [ctx.ref('treeModel')]),
        ]),
      ],
      prior: [likelihood],
      fileLogLikelihoods: [likelihood],
    };
  },
});
