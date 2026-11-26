import { defineModule, type ModuleContext } from '@beautique/core';

/** One rate parameter for each epoch of the timeline, most recent first. */
const rateNames = (ctx: ModuleContext): string[] =>
  ctx.timeline(ctx.options.timeline).epochs.map((_, i) => `clock.epoch${i + 1}.rate`);

export default defineModule({
  apiVersion: 1,
  id: 'clock.epoch',
  slot: 'clock',
  label: 'Local clocks in epochs',
  description:
    'The rate changes at fixed times: every lineage has the same rate within an epoch of the chosen timeline. A branch that crosses a transition gets the time-weighted average of the rates.',
  options: {
    timeline: {
      type: 'timelineRef',
      label: 'Timeline',
      help: 'Timelines are made in the Timelines step.',
      required: true,
    },
  },
  validate: (ctx) =>
    ctx.data.hasDates
      ? []
      : [
          {
            severity: 'error',
            message: 'Local clocks in epochs need dated tips, so that the epochs and the rates are on a scale of time',
          },
        ],
  parameters: (ctx) => {
    const { epochs } = ctx.timeline(ctx.options.timeline);
    return rateNames(ctx).map((name, i) => ({
      name,
      description: `Substitution rate in epoch ${i + 1} (${epochs[i]})`,
      value: 0.001,
      lower: 0,
      prior: { type: 'ctmcScale' as const },
      screen: i === 0,
    }));
  },
  operators: (ctx) => {
    const names = rateNames(ctx);
    const { el } = ctx.xml;
    return [
      ...names.map((name) => ({
        key: `${name}.scale`,
        element: 'scaleOperator',
        tuning: { name: 'scaleFactor', value: 0.75 },
        weight: 3,
        children: [ctx.paramRef(name)],
      })),
      {
        key: 'clock.epochs.upDown',
        label: 'upDown(node heights / all epoch rates)',
        element: 'upDownOperator',
        tuning: { name: 'scaleFactor', value: 0.75 },
        weight: 3,
        children: [
          el('up', {}, [ctx.ref('allInternalNodeHeights')]),
          el('down', {}, names.map((name) => ctx.paramRef(name))),
        ],
      },
    ];
  },
  refs: (ctx) => ({ branchRates: ctx.xml.ref('rateEpochBranchRates', ctx.id('branchRates')) }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const timeline = ctx.timeline(ctx.options.timeline);
    const names = rateNames(ctx);
    const branchRates = ref('rateEpochBranchRates', ctx.id('branchRates'));
    return {
      clock: [
        comment(
          `Epoch clock on timeline "${timeline.name}": transition times are in years before the most recent sample`,
        ),
        el('rateEpochBranchRates', { id: ctx.id('branchRates') }, [
          timeline.heights.map((height, i) => [
            comment(`epoch ${i + 1}: ${timeline.epochs[i]}`),
            el('epoch', { transitionTime: height }, [ctx.param(names[i])]),
          ]),
          comment(`epoch ${names.length}: ${timeline.epochs[names.length - 1]}`),
          el('rate', {}, [ctx.param(names[names.length - 1])]),
        ]),
        el(
          'rateStatistic',
          { id: ctx.id('meanRate'), name: ctx.id('meanRate'), mode: 'mean', internal: true, external: true },
          [ctx.ref('treeModel'), branchRates],
        ),
      ],
      prior: [branchRates],
      fileLog: [ref('rateStatistic', ctx.id('meanRate'))],
      treeLog: [el('trait', { name: 'rate', tag: ctx.id('rate') }, [branchRates])],
    };
  },
});
