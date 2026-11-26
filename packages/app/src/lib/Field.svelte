<script lang="ts">
  import { validateField, type FieldSchema } from '@beautique/core';
  import { app } from './state.svelte';

  interface Props {
    name: string;
    field: FieldSchema;
    /** The explicitly set value, or undefined when the default applies. */
    value: unknown;
    onchange: (value: unknown) => void;
  }
  let { name, field, value, onchange }: Props = $props();

  const isRef = $derived(field.type === 'taxonSetRef' || field.type === 'timelineRef');
  // References are checked even when unset, so that a missing required one is reported.
  const message = $derived(
    value === undefined && !isRef
      ? null
      : validateField(field, value ?? (field.type === 'taxonSetRef' && field.multiple ? [] : null), app.refs),
  );
  const id = $derived(`field-${name}`);

  function numberInput(event: Event): void {
    const raw = (event.currentTarget as HTMLInputElement).value;
    onchange(raw.trim() === '' ? undefined : Number(raw));
  }

  /** Tick or untick one taxon set of a field that takes several. */
  function toggleSet(setId: string, on: boolean): void {
    const current = Array.isArray(value) ? (value as string[]) : [];
    onchange(on ? [...current.filter((s) => s !== setId), setId] : current.filter((s) => s !== setId));
  }
</script>

<div class="field" class:invalid={message !== null}>
  {#if field.type === 'boolean'}
    <label class="check">
      <input
        type="checkbox"
        checked={(value ?? field.default ?? false) === true}
        onchange={(e) => onchange(e.currentTarget.checked)}
      />
      {field.label}
    </label>
  {:else if field.type === 'taxonSetRef' && field.multiple}
    <fieldset class="checks">
      <legend>{field.label}</legend>
      {#each app.taxonSets as set (set.id)}
        <label class="check">
          <input
            type="checkbox"
            checked={Array.isArray(value) && value.includes(set.id)}
            onchange={(e) => toggleSet(set.id, e.currentTarget.checked)}
          />
          {set.name} <span class="help">{set.taxa.length} taxa</span>
        </label>
      {:else}
        <p class="help">
          There are no taxon sets yet. Make them in the
          <button class="link" onclick={() => (app.step = 'taxonSets')}>Taxon sets</button> step.
        </p>
      {/each}
    </fieldset>
  {:else if field.type === 'taxonSetRef' || field.type === 'timelineRef'}
    {@const items = field.type === 'taxonSetRef' ? app.taxonSets : app.timelines}
    {@const target = field.type === 'taxonSetRef' ? 'taxonSets' : 'timelines'}
    <label for={id}>{field.label}</label>
    <div class="control">
      <select {id} value={typeof value === 'string' ? value : ''} onchange={(e) => onchange(e.currentTarget.value || null)}>
        <option value="">{field.required ? 'Choose…' : 'None'}</option>
        {#each items as item (item.id)}
          <option value={item.id}>{item.name}</option>
        {/each}
      </select>
      <button class="link" onclick={() => (app.step = target)}>
        {field.type === 'taxonSetRef' ? 'Edit taxon sets' : 'Edit timelines'}
      </button>
    </div>
  {:else}
    <label for={id}>{field.label}</label>
    <div class="control">
      {#if field.type === 'choice'}
        <select {id} value={value ?? field.default ?? field.choices[0]?.value} onchange={(e) => onchange(e.currentTarget.value)}>
          {#each field.choices as choice (choice.value)}
            <option value={choice.value}>{choice.label}</option>
          {/each}
        </select>
      {:else if field.type === 'text'}
        <input
          {id}
          type="text"
          value={value ?? field.default ?? ''}
          oninput={(e) => onchange(e.currentTarget.value)}
          aria-invalid={message !== null}
        />
      {:else if field.type === 'integer' || field.type === 'real'}
        <input
          {id}
          type="number"
          inputmode={field.type === 'integer' ? 'numeric' : 'decimal'}
          value={value ?? ''}
          placeholder={field.default === undefined ? '' : String(field.default)}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === 'integer' ? 1 : 'any')}
          oninput={numberInput}
          aria-invalid={message !== null}
        />
        {#if field.units}<span class="units">{field.units}</span>{/if}
      {/if}
    </div>
  {/if}
  {#if message}
    <p class="message">{field.label} {message}</p>
  {:else if field.help}
    <p class="help">{field.help}</p>
  {/if}
</div>
