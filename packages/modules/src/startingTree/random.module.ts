import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'startingTree.random',
  slot: 'startingTree',
  label: 'Random coalescent tree',
  description:
    'A starting tree simulated under a constant-size coalescent, respecting the tip dates and any taxon sets constrained to be clades.',
  options: {
    popSize: {
      type: 'real',
      label: 'Population size for the simulation',
      help: 'Larger values give a deeper starting tree.',
      default: 100,
      min: 0,
      exclusiveMin: true,
    },
    rootHeight: {
      type: 'real',
      label: 'Height of the root',
      help: 'The simulated tree is rescaled to this height. Leave empty to keep the simulated height, unless the tree prior needs the tree to start below a time of origin.',
      optional: true,
      min: 0,
      exclusiveMin: true,
      units: 'years before the most recent sample',
    },
  },
  refs: (ctx) => ({ startingTree: ctx.xml.ref('coalescentTree', 'startingTree') }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const demo = ref('constantSize', 'initialDemo');
    // Each clade is simulated on its own, inside the smallest clade that contains it.
    const clades = ctx.taxonSets.filter((s) => s.monophyletic && s.size > 1);
    const subtrees = (parent: string | null): ReturnType<typeof el>[] =>
      clades
        .filter((s) => s.parent === parent)
        .map((s) => el('coalescentSimulator', {}, [subtrees(s.id), ref('taxa', s.name), demo]));
    const asked = ctx.fact('startingRootHeight');
    const height = ctx.options.rootHeight ?? (typeof asked === 'number' ? asked : undefined);
    return {
      startingTree: [
        comment('A constant-size coalescent model used only to generate the starting tree'),
        el('constantSize', { id: 'initialDemo', units: 'years' }, [
          el('populationSize', {}, [
            el('parameter', { id: 'initialDemo.popSize', value: ctx.options.popSize as number }),
          ]),
        ]),
        comment('Generate a random starting tree under the coalescent process'),
        el('coalescentSimulator', { id: 'startingTree', height: height as number | undefined }, [subtrees(null), ref('taxa', 'taxa'), demo]),
      ],
    };
  },
});
