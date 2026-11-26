import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'startingTree.random',
  slot: 'startingTree',
  label: 'Random coalescent tree',
  description: 'A starting tree simulated under a constant-size coalescent, respecting the tip dates.',
  options: {
    popSize: {
      type: 'real',
      label: 'Population size for the simulation',
      help: 'Larger values give a deeper starting tree.',
      default: 100,
      min: 0,
      exclusiveMin: true,
    },
  },
  refs: (ctx) => ({ startingTree: ctx.xml.ref('coalescentTree', 'startingTree') }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    return {
      startingTree: [
        comment('A constant-size coalescent model used only to generate the starting tree'),
        el('constantSize', { id: 'initialDemo', units: 'years' }, [
          el('populationSize', {}, [
            el('parameter', { id: 'initialDemo.popSize', value: ctx.options.popSize as number }),
          ]),
        ]),
        comment('Generate a random starting tree under the coalescent process'),
        el('coalescentSimulator', { id: 'startingTree' }, [ref('taxa', 'taxa'), ref('constantSize', 'initialDemo')]),
      ],
    };
  },
});
