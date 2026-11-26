import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'tree.timeTree',
  slot: 'tree',
  label: 'Time tree',
  description: 'A rooted tree with branch lengths in units of time, sampled with subtree-leap moves.',
  parameters: () => [
    { name: 'treeModel.rootHeight', log: false },
    { name: 'treeModel.internalNodeHeights', log: false },
    { name: 'treeModel.allInternalNodeHeights', log: false },
  ],
  operators: (ctx) => [
    {
      key: 'subtreeLeap',
      label: 'Subtree leap',
      element: 'subtreeLeap',
      tuning: { name: 'size', value: 1 },
      weight: ctx.data.ntax,
      children: [ctx.ref('treeModel')],
    },
    {
      key: 'fixedHeightSubtreePruneRegraft',
      label: 'Fixed-height subtree prune and regraft',
      element: 'fixedHeightSubtreePruneRegraft',
      weight: ctx.data.ntax / 10,
      children: [ctx.ref('treeModel')],
    },
  ],
  refs: (ctx) => ({
    treeModel: ctx.xml.ref('treeModel', 'treeModel'),
    allInternalNodeHeights: ctx.paramRef('treeModel.allInternalNodeHeights'),
  }),
  generate: (ctx) => {
    const { el, ref, comment } = ctx.xml;
    const treeModel = ref('treeModel', 'treeModel');
    const dated = ctx.data.hasDates;
    return {
      treeModel: [
        comment('Generate a tree model'),
        el('treeModel', { id: 'treeModel' }, [
          ctx.ref('startingTree'),
          el('rootHeight', {}, [ctx.param('treeModel.rootHeight')]),
          el('nodeHeights', { internalNodes: true }, [ctx.param('treeModel.internalNodeHeights')]),
          el('nodeHeights', { internalNodes: true, rootNode: true }, [
            ctx.param('treeModel.allInternalNodeHeights'),
          ]),
        ]),
      ],
      treeStatistics: [
        el('treeHeightStatistic', { id: 'rootHeight' }, [treeModel]),
        el('treeLengthStatistic', { id: 'treeLength' }, [treeModel]),
        dated ? el('tmrcaStatistic', { id: 'age(root)', absolute: true }, [treeModel]) : [],
      ].flat(),
      screenLog: [
        dated
          ? el('column', { label: 'age(root)', sf: 6, width: 12 }, [ref('tmrcaStatistic', 'age(root)')])
          : el('column', { label: 'rootHeight', sf: 6, width: 12 }, [ref('treeHeightStatistic', 'rootHeight')]),
      ],
      fileLog: [
        ref('treeHeightStatistic', 'rootHeight'),
        dated ? ref('tmrcaStatistic', 'age(root)') : [],
        ref('treeLengthStatistic', 'treeLength'),
      ].flat(),
    };
  },
});
