import { DOCUMENT_FORMAT, DOCUMENT_FORMAT_VERSION, ModuleRegistry } from '@beautique/core';
import type { AnalysisDocument, ModuleDefinition } from '@beautique/core';

/**
 * Built-in modules are discovered at build time: any file under this folder
 * named `*.module.ts` that default-exports a module definition is included.
 */
const discovered = import.meta.glob<ModuleDefinition>('./**/*.module.ts', { eager: true, import: 'default' });

export const builtinModules: ModuleDefinition[] = Object.keys(discovered)
  .sort()
  .map((path) => discovered[path]);

export function createRegistry(extra: ModuleDefinition[] = []): ModuleRegistry {
  return new ModuleRegistry([...builtinModules, ...extra]);
}

/**
 * The template a new analysis starts from: HKY + gamma, strict clock,
 * constant-size coalescent, with dates detected from the taxon labels.
 */
export function defaultTemplate(): AnalysisDocument {
  return {
    format: DOCUMENT_FORMAT,
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: 'template',
    name: 'analysis',
    data: {
      alignments: [],
      dates: { mode: 'auto', delimiter: '|', field: -1 },
      taxonIdStyle: 'label',
    },
    taxonSets: [],
    timelines: [],
    traits: [],
    partitions: [
      {
        id: 'partition',
        name: '',
        alignment: null,
        substitution: 'substitution',
        siteHeterogeneity: 'siteHeterogeneity',
        clock: 'clock',
      },
    ],
    tree: { tree: 'tree', startingTree: 'startingTree', treePrior: 'treePrior' },
    components: [
      { id: 'substitution', slot: 'substitution', module: 'substitution.hky', name: 'substitution', options: {} },
      {
        id: 'siteHeterogeneity',
        slot: 'siteHeterogeneity',
        module: 'siteHeterogeneity.gamma',
        name: 'siteHeterogeneity',
        options: {},
      },
      { id: 'clock', slot: 'clock', module: 'clock.strict', name: 'clock', options: {} },
      { id: 'tree', slot: 'tree', module: 'tree.timeTree', name: 'tree', options: {} },
      { id: 'startingTree', slot: 'startingTree', module: 'startingTree.random', name: 'startingTree', options: {} },
      { id: 'treePrior', slot: 'treePrior', module: 'treePrior.constant', name: 'treePrior', options: {} },
    ],
    parameters: {},
    operators: {},
    mcmc: {},
    template: {
      description: 'HKY + gamma, strict clock, constant-size coalescent.',
      ask: ['name', 'mcmc.chainLength'],
    },
  };
}
