<script lang="ts">
  import { setInstanceModule, setSiteHeterogeneity, type Slot } from '@beautique/core';
  import InstanceCard from '../lib/InstanceCard.svelte';
  import { app } from '../lib/state.svelte';

  let { step }: { step: 'substitution' | 'clock' | 'tree' } = $props();

  /** The distinct models of a partition-level slot, in partition order. */
  function distinct(slot: 'substitution' | 'clock'): string[] {
    return [...new Set(app.doc.partitions.map((p) => p[slot]))];
  }

  function qualifier(slot: Slot, id: string, count: number): string {
    return count > 1 ? (app.doc.components.find((c) => c.id === id)?.name ?? '') : '';
  }

  const setModule = (id: string) => (moduleId: string | null) => {
    if (moduleId) setInstanceModule(app.doc, id, moduleId);
  };
</script>

{#if step === 'substitution'}
  {@const ids = distinct('substitution')}
  {#each ids as id (id)}
    {@const heterogeneity = app.doc.partitions.find((p) => p.substitution === id)?.siteHeterogeneity ?? null}
    <InstanceCard kind="substitution" instanceId={id} qualifier={qualifier('substitution', id, ids.length)} onmodule={setModule(id)}>
      <InstanceCard
        nested
        kind="siteHeterogeneity"
        instanceId={heterogeneity}
        qualifier={id}
        optional
        onmodule={(moduleId) => setSiteHeterogeneity(app.doc, id, moduleId)}
      />
    </InstanceCard>
  {/each}
  {#if ids.length > 1}
    <p class="help">
      Each group of partitions has its own substitution model. Partitions are linked and unlinked in the
      <button class="link" onclick={() => (app.step = 'partitions')}>Partitions</button> step.
    </p>
  {/if}
{:else if step === 'clock'}
  {@const ids = distinct('clock')}
  {#each ids as id (id)}
    <InstanceCard kind="clock" instanceId={id} qualifier={qualifier('clock', id, ids.length)} onmodule={setModule(id)} />
  {/each}
{:else}
  <InstanceCard kind="treePrior" instanceId={app.doc.tree.treePrior} onmodule={setModule(app.doc.tree.treePrior)} />
  <InstanceCard kind="startingTree" instanceId={app.doc.tree.startingTree} onmodule={setModule(app.doc.tree.startingTree)} />
{/if}
