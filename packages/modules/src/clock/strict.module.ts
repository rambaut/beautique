import { defineModule } from '@beautique/core';
import { rateOperators, rateOptions, rateParameter } from './rate';

export default defineModule({
  apiVersion: 1,
  id: 'clock.strict',
  slot: 'clock',
  label: 'Strict clock',
  description: 'A single evolutionary rate on every branch of the tree.',
  options: { ...rateOptions },
  parameters: (ctx) => [rateParameter(ctx, 'clock.rate', 'Substitution rate')],
  operators: (ctx) => rateOperators(ctx, 'clock.rate'),
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
