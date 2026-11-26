<script lang="ts">
  import { nameProblem, newTaxonSet } from '@beautique/core';
  import { app } from '../lib/state.svelte';

  const LIMIT = 400;
  let selectedId = $state<string | null>(null);
  let filter = $state('');

  const sets = $derived(app.taxonSets);
  const selected = $derived(sets.find((s) => s.id === selectedId) ?? sets[0]);
  const taxa = $derived(app.preview.taxa);
  const members = $derived(new Set(selected?.taxa ?? []));
  const shown = $derived.by(() => {
    const text = filter.trim().toLowerCase();
    return text === '' ? taxa : taxa.filter((t) => t.label.toLowerCase().includes(text));
  });
  const outside = $derived(shown.filter((t) => !members.has(t.key)));
  const inside = $derived(shown.filter((t) => members.has(t.key)));
  const problem = $derived(
    selected ? nameProblem(selected.name, sets.filter((s) => s !== selected).map((s) => s.name)) : null,
  );

  function add(): void {
    const set = newTaxonSet(sets);
    sets.push(set);
    selectedId = set.id;
    filter = '';
  }

  function remove(id: string): void {
    const index = sets.findIndex((s) => s.id === id);
    if (index >= 0) sets.splice(index, 1);
    selectedId = null;
  }

  function include(keys: string[]): void {
    if (selected) selected.taxa = [...new Set([...selected.taxa, ...keys])];
  }

  function exclude(keys: string[]): void {
    const gone = new Set(keys);
    if (selected) selected.taxa = selected.taxa.filter((k) => !gone.has(k));
  }
</script>

{#if app.alignments.length === 0}
  <section class="card"><p>Load sequence data first.</p></section>
{:else}
  <section class="card">
    <h2>Taxon sets</h2>
    <p class="help">
      A taxon set is a named group of taxa. Each set has the time of its most recent common ancestor logged, and
      can be given its own clock rate in the Clock step.
    </p>
    {#if sets.length > 0}
      <table>
        <thead><tr><th>Name</th><th class="num">Taxa</th><th>Clade</th><th></th></tr></thead>
        <tbody>
          {#each sets as set (set.id)}
            <tr class:selected={set === selected}>
              <td><button class="link" onclick={() => ((selectedId = set.id), (filter = ''))}>{set.name || '(no name)'}</button></td>
              <td class="num">{set.taxa.length}</td>
              <td>{set.monophyletic ? 'constrained' : ''}</td>
              <td class="nowrap"><button onclick={() => remove(set.id)} aria-label={`Delete ${set.name}`}>Delete</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <p><button class="primary" onclick={add}>New taxon set</button></p>
  </section>

  {#if selected}
    <section class="card wide">
      <h2>Edit “{selected.name}”</h2>
      <div class="field" class:invalid={problem !== null}>
        <label for="set-name">Name</label>
        <div class="control">
          <input id="set-name" type="text" bind:value={selected.name} aria-invalid={problem !== null} />
        </div>
        {#if problem}<p class="message">The taxon set {problem}</p>{/if}
      </div>
      <div class="field">
        <label class="check">
          <input
            type="checkbox"
            checked={selected.monophyletic === true}
            onchange={(e) => (selected.monophyletic = e.currentTarget.checked || undefined)}
          />
          Constrain these taxa to be a clade (monophyletic)
        </label>
      </div>
      <div class="field">
        <label for="set-filter">Show taxa containing</label>
        <div class="control">
          <input id="set-filter" type="search" bind:value={filter} placeholder="part of a taxon label" />
          <button onclick={() => include(outside.map((t) => t.key))} disabled={outside.length === 0}>
            Add all {outside.length} shown
          </button>
          <button onclick={() => exclude(inside.map((t) => t.key))} disabled={inside.length === 0}>
            Remove all {inside.length} shown
          </button>
        </div>
      </div>
      <div class="picker">
        <div>
          <h3>Not in the set <span class="help">{outside.length}</span></h3>
          <ul aria-label="Taxa not in the set">
            {#each outside.slice(0, LIMIT) as taxon (taxon.key)}
              <li><button class="mono" onclick={() => include([taxon.key])} title={`Add ${taxon.label} to the set`}>{taxon.label}</button></li>
            {/each}
          </ul>
          {#if outside.length > LIMIT}<p class="help">Showing the first {LIMIT}; narrow the list with the filter.</p>{/if}
        </div>
        <div>
          <h3>In the set <span class="help">{inside.length}{filter.trim() ? ` of ${selected.taxa.length}` : ''}</span></h3>
          <ul aria-label="Taxa in the set">
            {#each inside.slice(0, LIMIT) as taxon (taxon.key)}
              <li><button class="mono" onclick={() => exclude([taxon.key])} title={`Remove ${taxon.label} from the set`}>{taxon.label}</button></li>
            {/each}
          </ul>
          {#if inside.length > LIMIT}<p class="help">Showing the first {LIMIT}; narrow the list with the filter.</p>{/if}
        </div>
      </div>
      <p class="help">Click a taxon to move it to the other list.</p>
    </section>
  {/if}
{/if}
