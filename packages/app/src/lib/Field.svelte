<script lang="ts">
  import { validateField, type FieldSchema } from '@beautique/core';

  interface Props {
    name: string;
    field: FieldSchema;
    /** The explicitly set value, or undefined when the default applies. */
    value: unknown;
    onchange: (value: unknown) => void;
  }
  let { name, field, value, onchange }: Props = $props();

  const message = $derived(value === undefined ? null : validateField(field, value));
  const id = $derived(`field-${name}`);

  function numberInput(event: Event): void {
    const raw = (event.currentTarget as HTMLInputElement).value;
    onchange(raw.trim() === '' ? undefined : Number(raw));
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
      {:else}
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
