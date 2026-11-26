import { defineModule, type ModuleContext } from '@beautique/core';

/** The rate is estimated when asked for, or by default whenever the tips are dated. */
function estimated(ctx: ModuleContext): boolean {
  const mode = ctx.options.rateMode;
  return mode === 'estimate' || (mode === 'auto' && ctx.data.hasDates);
}

export default defineModule({
  apiVersion: 1,
  id: 'clock.strict',
  slot: 'clock',
  label: 'Strict clock',
  description: 'A single evolutionary rate on every branch of the tree.',
  options: {
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
  },
  parameters: (ctx) => {
    const estimate = estimated(ctx);
    const fixed = ctx.options.rateMode === 'fixed' ? (ctx.options.fixedRate as number) : 1;
    return [
      {
        name: 'clock.rate',
        description: 'Substitution rate',
        value: estimate ? 0.001 : fixed,
        lower: 0,
        prior: estimate ? { type: 'ctmcScale' } : undefined,
        screen: estimate,
      },
    ];
  },
  operators: (ctx) => {
    if (!estimated(ctx)) return [];
    const { el } = ctx.xml;
    return [
      {
        key: 'clock.rate.scale',
        element: 'scaleOperator',
        tuning: { name: 'scaleFactor', value: 0.75 },
        weight: 3,
        children: [ctx.paramRef('clock.rate')],
      },
      {
        key: 'clock.rate.upDown',
        label: 'Scale node heights up and the rate down',
        element: 'upDownOperator',
        tuning: { name: 'scaleFactor', value: 0.75 },
        weight: 3,
        children: [
          el('up', {}, [ctx.ref('allInternalNodeHeights')]),
          el('down', {}, [ctx.paramRef('clock.rate')]),
        ],
      },
    ];
  },
  refs: (ctx) => ({ branchRates: ctx.xml.ref('strictClockBranchRates', ctx.id('branchRates')) }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const branchRates = ref('strictClockBranchRates', ctx.id('branchRates'));
    return {
      clock: [
        comment('The strict clock (uniform rates across branches)'),
        el('strictClockBranchRates', { id: ctx.id('branchRates') }, [el('rate', {}, [ctx.param('clock.rate')])]),
        el(
          'rateStatistic',
          { id: ctx.id('meanRate'), name: ctx.id('meanRate'), mode: 'mean', internal: true, external: true },
          [ctx.ref('treeModel'), branchRates],
        ),
      ],
      prior: [branchRates],
      fileLog: [ref('rateStatistic', ctx.id('meanRate'))],
      fileLogLikelihoods: [branchRates],
      treeLog: [el('trait', { name: 'rate', tag: ctx.id('rate') }, [branchRates])],
    };
  },
});
