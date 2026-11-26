<script lang="ts">
  import { SLOT_LABELS, type Slot } from '@beautique/core';
  import type { Snippet } from 'svelte';
  import { app, registry } from './state.svelte';
  import SchemaForm from './SchemaForm.svelte';

  interface Props {
    /** The slot the model fills. (Not called `slot`: Svelte reserves that attribute.) */
    kind: Slot;
    /** The model instance shown, or null for an empty optional slot. */
    instanceId: string | null;
    /** Shown after the slot label, to tell several models of a kind apart. */
    qualifier?: string;
    /** Optional slots offer "None". */
    optional?: boolean;
    onmodule: (moduleId: string | null) => void;
    /** Rendered as a plain section inside another card. */
    nested?: boolean;
    children?: Snippet;
  }
  let { kind, instanceId, qualifier = '', optional = false, onmodule, nested = false, children }: Props = $props();

  const modules = $derived(registry.bySlot(kind));
  const instance = $derived(app.doc.components.find((c) => c.id === instanceId));
  const module = $derived(instance ? registry.get(instance.module) : undefined);
  const selectId = $derived(`module-${kind}-${instanceId ?? 'none'}${qualifier}`);
</script>

<section class={nested ? 'nested' : 'card'}>
  {#if nested}
    <h3>{SLOT_LABELS[kind]}</h3>
  {:else}
    <h2>{SLOT_LABELS[kind]}{#if qualifier}<span class="qualifier">{qualifier}</span>{/if}</h2>
  {/if}
  <div class="field">
    <label for={selectId}>{nested ? `${SLOT_LABELS[kind]} model` : 'Model'}</label>
    <div class="control">
      <select id={selectId} value={instance?.module ?? ''} onchange={(e) => onmodule(e.currentTarget.value || null)}>
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
  {@render children?.()}
</section>
