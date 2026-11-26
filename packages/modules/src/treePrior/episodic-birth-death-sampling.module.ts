import { defineModule, type ModuleContext, type ParameterDecl } from '@beautique/core';
import { hmcOperator, useHmc } from '../hmc';
import { originFacts, originParameter, scaleOperator, startingRootHeight } from './origin';

/** The transition times of the chosen timeline; none when the rates are constant. */
const heights = (ctx: ModuleContext): number[] =>
  ctx.options.timeline === null ? [] : ctx.timeline(ctx.options.timeline).heights;

const RATES = [
  { name: 'ebds.birthRate', what: 'Birth (transmission) rate', value: 3, mu: 1, wrt: 'birthRate' },
  { name: 'ebds.deathRate', what: 'Death (becoming uninfectious) rate', value: 1, mu: 0, wrt: 'deathRate' },
  { name: 'ebds.samplingRate', what: 'Sampling rate', value: 1, mu: 0, wrt: 'samplingRate' },
] as const;

/**
 * Initial rates are per year and suit a tree a few years deep. For a deeper
 * tree they start lower, in proportion, so that the likelihood can be computed.
 */
const rateScale = (ctx: ModuleContext): number => Math.min(1, 20 / startingRootHeight(ctx));

export default defineModule({
  apiVersion: 1,
  id: 'treePrior.episodicBirthDeathSampling',
  slot: 'treePrior',
  label: 'Birth-death-sampling in epochs',
  description:
    'A birth-death-sampling tree prior whose rates of birth, death and sampling each have a value in every epoch of a timeline. The effective reproductive number in each epoch is logged.',
  citation: 'Stadler, Kühnert, Bonhoeffer & Drummond (2013) PNAS 110:228-233',
  minBeast: '10.6.0',
  supportsHmc: true,
  options: {
    timeline: {
      type: 'timelineRef',
      label: 'Timeline',
      help: 'The epochs between which the rates change; made in the Timelines step. With no timeline the rates are constant.',
    },
    treatmentProbability: {
      type: 'real',
      label: 'Probability that a sampled lineage is removed',
      help: 'With 1, a lineage stops transmitting when it is sampled, so no sample is an ancestor of another.',
      default: 1,
      min: 0,
      max: 1,
    },
    conditionOnSurvival: {
      type: 'boolean',
      label: 'Condition on the process surviving to be sampled',
      default: false,
    },
  },
  facts: originFacts,
  parameters: (ctx) => {
    const epochs = heights(ctx).length + 1;
    const rates: ParameterDecl[] = RATES.map((rate) => ({
      name: rate.name,
      description: `${rate.what}, per lineage per year${epochs > 1 ? ` (one for each of ${epochs} epochs, most recent first)` : ''}`,
      value: Number((rate.value * rateScale(ctx)).toPrecision(3)),
      dimension: epochs > 1 ? epochs : undefined,
      lower: 0,
      prior: { type: 'logNormal', mu: rate.mu, sigma: 1.5 },
    }));
    return [...rates, originParameter(ctx, 'ebds.origin')];
  },
  operators: (ctx) => {
    const { el, ref } = ctx.xml;
    const weight = heights(ctx).length > 0 ? 3 : 1;
    return [
      ...RATES.map((rate) =>
        useHmc(ctx)
          ? hmcOperator({
              key: `${rate.name}.hmc`,
              label: `HMC(${rate.name})`,
              weight,
              nSteps: 10,
              attrs: { drawVariance: 1 },
              children: [
                el('jointGradient', {}, [
                  el('birthDeathLikelihoodGradient', { wrtParameter: rate.wrt, useNewLoop: true }, [
                    ref('birthDeathLikelihood', 'birthDeathLikelihood'),
                    ctx.ref('treeModel'),
                  ]),
                  el('gradient', {}, [ctx.priorRef(rate.name), ctx.paramRef(rate.name)]),
                ]),
                ctx.paramRef(rate.name),
                el('signTransform', {}, [ctx.paramRef(rate.name)]),
              ],
            })
          : scaleOperator(ctx, rate.name, weight),
      ),
      scaleOperator(ctx, 'ebds.origin'),
    ];
  },
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const times = heights(ctx);
    const epochs = times.length + 1;
    const likelihood = ref('birthDeathLikelihood', 'birthDeathLikelihood');
    const fixed = (value: number) =>
      el('parameter', { dimension: epochs > 1 ? epochs : undefined, value, lower: 0, upper: 1 });
    return {
      treePriorModel: [
        comment(
          epochs > 1
            ? `Birth-death-sampling model with ${epochs} epochs (transition times in years before the most recent sample)`
            : 'Birth-death-sampling model with constant rates',
        ),
        el(
          'episodicBirthDeathSamplingModel',
          { id: 'ebds', units: 'years', conditionOnSurvival: ctx.options.conditionOnSurvival === true },
          [
            el('birthRate', {}, [ctx.param('ebds.birthRate')]),
            el('deathRate', {}, [ctx.param('ebds.deathRate')]),
            el('samplingRate', {}, [ctx.param('ebds.samplingRate')]),
            el('samplingProbability', {}, [fixed(0)]),
            el('treatmentProbability', {}, [fixed(ctx.options.treatmentProbability as number)]),
            el('origin', {}, [ctx.param('ebds.origin')]),
            epochs > 1
              ? [
                  el('numGridPoints', {}, [el('parameter', { value: epochs })]),
                  el('cutOff', {}, [el('parameter', { value: times[times.length - 1] })]),
                  el('grids', {}, [el('parameter', { value: [0, ...times].join(' ') })]),
                ]
              : [],
          ],
        ),
      ],
      treePrior: [
        comment('The likelihood of the tree under the birth-death-sampling model'),
        el('birthDeathLikelihood', { id: 'birthDeathLikelihood', useNewLoop: true }, [
          el('model', {}, [ref('episodicBirthDeathSamplingModel', 'ebds')]),
          el('tree', {}, [ctx.ref('treeModel')]),
        ]),
        el(
          'birthDeathCompoundParameterLogger',
          { id: 'ebds.Re', compoundParameterType: 'effectiveReproductiveNumber' },
          [ref('episodicBirthDeathSamplingModel', 'ebds')],
        ),
      ],
      prior: [likelihood],
      fileLog: [ref('birthDeathCompoundParameterLogger', 'ebds.Re')],
      fileLogLikelihoods: [likelihood],
    };
  },
});
