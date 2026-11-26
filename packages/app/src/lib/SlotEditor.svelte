<script lang="ts">
  import { SLOT_LABELS, type Slot } from '@beautique/core';
  import { app, registry } from './state.svelte';
  import SchemaForm from './SchemaForm.svelte';

  interface Props {
    slot: Slot;
    /** Optional slots offer "None". */
    optional?: boolean;
  }
  let { slot, optional = false }: Props = $props();

  const modules = $derived(registry.bySlot(slot));
</script>

{#each app.instancesFor(slot) as instanceId (instanceId)}
  {@const instance = app.doc.components.find((c) => c.id === instanceId)}
  {@const module = instance ? registry.get(instance.module) : undefined}
  <section class="card">
    <h2>{SLOT_LABELS[slot]}</h2>
    <div class="field">
      <label for={`module-${slot}-${instanceId}`}>Model</label>
      <div class="control">
        <select
          id={`module-${slot}-${instanceId}`}
          value={instance?.module ?? ''}
          onchange={(e) => app.setModule(slot, instanceId, e.currentTarget.value || null)}
        >
          {#if optional}<option value="">None</option>{/if}
          {#if instance && !module}<option value={instance.module}>{instance.module} (not available)</option>{/if}
          {#each modules as m (m.id)}
            <option value={m.id}>{m.label}</option>
          {/each}
        </select>
      </div>
      {#if module?.description}<p class="help">{module.description}</p>{/if}
      {#if module?.citation}<p class="help cite">{module.citation}</p>{/if}
    </div>
    {#if instance && module?.options}
      <SchemaForm schema={module.options} values={instance.options} prefix={`${instance.id}-`} />
    {/if}
  </section>
{/each}
