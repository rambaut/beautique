<script lang="ts">
  import {
    addTrait,
    describeValueSource,
    guessTraitType,
    nameProblem,
    removeTrait,
    resolveTrait,
    setInstanceModule,
    setTraitType,
    type TraitType,
    type ValueSource,
  } from '@beautique/core';
  import InstanceCard from '../lib/InstanceCard.svelte';
  import { app, registry } from '../lib/state.svelte';

  const LABEL_DELIMITERS = ['|', '_', '/'];
  const STATE_LIMIT = 60;
  let selectedId = $state<string | null>(null);

  const traits = $derived(app.traits);
  const selected = $derived(traits.find((t) => t.id === selectedId) ?? traits[0]);
  const taxa = $derived(app.preview.taxa);
  const data = $derived(app.document.data);
  const resolved = $derived(selected ? resolveTrait($state.snapshot(selected), data, taxa) : null);
  const problem = $derived(
    selected
      ? nameProblem(selected.name, [
          ...traits.filter((t) => t !== selected).map((t) => t.name),
          ...app.taxonSets.map((s) => s.name),
        ])
      : null,
  );

  /** Everywhere a value for each taxon can be read from, with an example. */
  const choices = $derived.by(() => {
    const list: { key: string; source: ValueSource; label: string }[] = [];
    for (const table of app.tables) {
      table.columns.forEach((column, i) => {
        if (i === table.keyColumn) return;
        const source: ValueSource = { kind: 'column', table: table.id, column };
        const example = table.rows[0]?.[i] ?? '';
        list.push({ key: JSON.stringify(source), source, label: `${column} (${table.name}; e.g. ${example})` });
      });
    }
    const sample = app.labels[0] ?? '';
    for (const delimiter of LABEL_DELIMITERS) {
      const fields = sample.split(delimiter);
      if (fields.length < 2) continue;
      fields.forEach((text, i) => {
        // the last field is counted from the end, as labels can differ in their number of fields
        const source: ValueSource = { kind: 'labelField', delimiter, field: i === fields.length - 1 ? -1 : i };
        list.push({
          key: JSON.stringify(source),
          source,
          label: `Label field ${i + 1}, split on ${delimiter} (e.g. ${text})`,
        });
      });
    }
    return list;
  });

  function defaultModule(type: TraitType): string {
    return registry.bySlot('trait').find((m) => m.traitType === type)?.id ?? '';
  }

  function add(): void {
    let n = 1;
    while (traits.some((t) => t.name === `trait${n}`)) n++;
    const trait = addTrait(app.doc, { name: `trait${n}`, type: 'discrete', sources: [], module: defaultModule('discrete') });
    selectedId = trait.id;
  }

  function setType(type: TraitType): void {
    if (selected) setTraitType(app.doc, selected.id, type, defaultModule(type));
  }

  function setSource(index: number, key: string): void {
    if (!selected || (selected.sources[index] && key === JSON.stringify(selected.sources[index]))) return;
    const choice = choices.find((c) => c.key === key);
    if (!choice) selected.sources.splice(index, 1);
    else selected.sources[index] = choice.source;
    // the first choice of values settles what kind of trait it is
    if (choice && index === 0 && selected.sources.length === 1) {
      setType(guessTraitType(choice.source, data, taxa));
    }
  }

  const dimensionLabel = (i: number, count: number): string =>
    count <= 2 ? (['First value (latitude)', 'Second value (longitude)'][i] ?? `Value ${i + 1}`) : `Value ${i + 1}`;
</script>

{#if app.alignments.length === 0}
  <section class="card"><p>Load sequence data first.</p></section>
{:else}
  <section class="card">
    <h2>Traits</h2>
    <p class="help">
      A trait is a value for each taxon, such as the place it was sampled, that is analysed along with the
      sequences. The values come from the taxon labels or from a metadata table loaded in the Data step.
    </p>
    {#if traits.length > 0}
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Model</th><th></th></tr></thead>
        <tbody>
          {#each traits as trait (trait.id)}
            {@const instance = app.doc.components.find((c) => c.id === trait.model)}
            <tr class:selected={trait === selected}>
              <td><button class="link" onclick={() => (selectedId = trait.id)}>{trait.name || '(no name)'}</button></td>
              <td>{trait.type}</td>
              <td>{(instance && registry.get(instance.module)?.label) ?? ''}</td>
              <td class="nowrap">
                <button onclick={() => (removeTrait(app.doc, trait.id), (selectedId = null))} aria-label={`Delete ${trait.name}`}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <p><button class="primary" onclick={add}>New trait</button></p>
  </section>

  {#if selected}
    <section class="card wide">
      <h2>Edit “{selected.name}”</h2>
      <div class="field" class:invalid={problem !== null}>
        <label for="trait-name">Name</label>
        <div class="control">
          <input id="trait-name" type="text" bind:value={selected.name} aria-invalid={problem !== null} />
        </div>
        {#if problem}<p class="message">The trait {problem}</p>{/if}
      </div>
      <div class="field">
        <label for="trait-type">Type</label>
        <div class="control">
          <select id="trait-type" value={selected.type} onchange={(e) => setType(e.currentTarget.value as TraitType)}>
            <option value="discrete">Discrete: one of a set of states</option>
            <option value="continuous">Continuous: one or more numbers</option>
          </select>
        </div>
      </div>
      {#each selected.type === 'discrete' ? [0] : [...selected.sources.keys(), selected.sources.length] as i (i)}
        {@const current = selected.sources[i]}
        {#if i < 6}
          <div class="field">
            <label for={`trait-source-${i}`}>
              {selected.type === 'discrete' ? 'Values' : dimensionLabel(i, Math.max(2, selected.sources.length))}
            </label>
            <div class="control">
              <select
                id={`trait-source-${i}`}
                value={current ? JSON.stringify(current) : ''}
                onchange={(e) => setSource(i, e.currentTarget.value)}
              >
                <option value="">{i === 0 ? 'Choose…' : i < selected.sources.length ? 'Remove' : 'None'}</option>
                {#if current && !choices.some((c) => c.key === JSON.stringify(current))}
                  <option value={JSON.stringify(current)}>{describeValueSource(current, data)}</option>
                {/if}
                {#each choices as choice (choice.key)}<option value={choice.key}>{choice.label}</option>{/each}
              </select>
            </div>
          </div>
        {/if}
      {/each}

      {#if resolved && resolved.problems.length > 0}
        <ul class="issues">
          {#each resolved.problems as text (text)}<li class="error">The trait {text}</li>{/each}
        </ul>
      {:else if resolved && selected.type === 'discrete'}
        <p>
          <strong>{resolved.states.length}</strong> states among {taxa.length - resolved.missing} taxa{#if resolved.missing > 0}; {resolved.missing} taxa have no value{/if}.
        </p>
        <table>
          <thead><tr><th>State</th><th class="num">Taxa</th></tr></thead>
          <tbody>
            {#each resolved.states.slice(0, STATE_LIMIT) as state (state)}
              <tr><td class="mono">{state}</td><td class="num">{resolved.counts.get(state)}</td></tr>
            {/each}
          </tbody>
        </table>
        {#if resolved.states.length > STATE_LIMIT}<p class="help">Showing the first {STATE_LIMIT} states.</p>{/if}
      {:else if resolved}
        <p>
          {taxa.length - resolved.missing} taxa have values{#if resolved.missing > 0}; {resolved.missing} have none{/if}.
        </p>
        <table>
          <thead><tr><th>Value</th><th class="num">Lowest</th><th class="num">Highest</th></tr></thead>
          <tbody>
            {#each resolved.ranges as range, i (i)}
              <tr><td>{i + 1}</td><td class="num">{range.min}</td><td class="num">{range.max}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <InstanceCard
      kind="trait"
      instanceId={selected.model}
      qualifier={selected.name}
      traitType={selected.type}
      onmodule={(moduleId) => {
        if (moduleId && selected.model) setInstanceModule(app.doc, selected.model, moduleId);
      }}
    />
  {/if}
{/if}
