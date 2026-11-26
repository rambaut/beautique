<script lang="ts">
  import { isVisible, resolveOptions, type OptionsSchema, type OptionValues } from '@beautique/core';
  import Field from './Field.svelte';

  interface Props {
    schema: OptionsSchema;
    /** Explicitly set values; edited in place. Unset keys take the schema default. */
    values: OptionValues;
    prefix?: string;
  }
  let { schema, values, prefix = '' }: Props = $props();

  const resolved = $derived(resolveOptions(schema, values));

  function set(key: string, value: unknown): void {
    if (value === undefined) delete values[key];
    else values[key] = value;
  }
</script>

{#each Object.entries(schema) as [key, field] (key)}
  {#if isVisible(field, resolved)}
    <Field name={prefix + key} {field} value={values[key]} onchange={(v) => set(key, v)} />
  {/if}
{/each}
