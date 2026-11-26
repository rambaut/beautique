<script lang="ts">
  import { nameProblem, newTimeline, resolveTimeline, TIME_UNITS, type TimelineKind } from '@beautique/core';
  import { app } from '../lib/state.svelte';

  const KINDS: { value: TimelineKind; label: string }[] = [
    { value: 'regular', label: 'Epochs of equal duration' },
    { value: 'dates', label: 'Transitions at dates' },
    { value: 'heights', label: 'Transitions at times before the most recent sample' },
  ];
  const WIDTH = 640;
  const HEIGHT = 120;
  const BINS = 48;

  let selectedId = $state<string | null>(null);

  const timelines = $derived(app.timelines);
  const selected = $derived(timelines.find((t) => t.id === selectedId) ?? timelines[0]);
  const mostRecent = $derived(app.mostRecent);
  const resolution = $derived(selected ? resolveTimeline($state.snapshot(selected), mostRecent) : null);
  const problem = $derived(
    selected ? nameProblem(selected.name, timelines.filter((t) => t !== selected).map((t) => t.name)) : null,
  );

  /** Sample ages (years before the most recent sample), for the picture. */
  const ages = $derived(
    mostRecent === undefined ? [] : app.preview.taxa.map((t) => mostRecent - (t.date as number)),
  );
  const picture = $derived.by(() => {
    const heights = resolution?.timeline?.heights ?? [];
    const extent = Math.max(...ages, ...heights.map((h) => h * 1.15), 1e-9);
    const x = (height: number): number => WIDTH - (height / extent) * WIDTH;
    const counts = new Array<number>(BINS).fill(0);
    for (const age of ages) counts[Math.min(BINS - 1, Math.floor((age / extent) * BINS))]++;
    const tallest = Math.max(...counts, 1);
    return { heights, extent, x, counts, tallest };
  });

  function add(): void {
    const timeline = newTimeline(timelines, mostRecent === undefined ? 'heights' : 'regular');
    timelines.push(timeline);
    selectedId = timeline.id;
  }

  function remove(id: string): void {
    const index = timelines.findIndex((t) => t.id === id);
    if (index >= 0) timelines.splice(index, 1);
    selectedId = null;
  }

  function describe(id: string): string {
    const timeline = timelines.find((t) => t.id === id);
    const resolved = timeline && resolveTimeline($state.snapshot(timeline), mostRecent).timeline;
    return resolved ? `${resolved.epochs.length} epochs` : 'not complete';
  }
</script>

<section class="card">
  <h2>Timelines</h2>
  <p class="help">
    A timeline divides time into epochs. Models that change through time, such as local clocks in epochs and
    birth-death-sampling in epochs, each use one. Several models can share a timeline.
  </p>
  {#if timelines.length > 0}
    <table>
      <thead><tr><th>Name</th><th>Epochs</th><th></th></tr></thead>
      <tbody>
        {#each timelines as timeline (timeline.id)}
          <tr class:selected={timeline === selected}>
            <td><button class="link" onclick={() => (selectedId = timeline.id)}>{timeline.name || '(no name)'}</button></td>
            <td>{describe(timeline.id)}</td>
            <td class="nowrap"><button onclick={() => remove(timeline.id)} aria-label={`Delete ${timeline.name}`}>Delete</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <p><button class="primary" onclick={add}>New timeline</button></p>
</section>

{#if selected}
  <section class="card wide">
    <h2>Edit “{selected.name}”</h2>
    <div class="field" class:invalid={problem !== null}>
      <label for="timeline-name">Name</label>
      <div class="control">
        <input id="timeline-name" type="text" bind:value={selected.name} aria-invalid={problem !== null} />
      </div>
      {#if problem}<p class="message">The timeline {problem}</p>{/if}
    </div>
    <div class="field">
      <label for="timeline-kind">Epochs are given as</label>
      <div class="control">
        <select id="timeline-kind" bind:value={selected.kind}>
          {#each KINDS as kind (kind.value)}<option value={kind.value}>{kind.label}</option>{/each}
        </select>
      </div>
    </div>

    {#if selected.kind === 'regular'}
      <div class="field">
        <label for="timeline-count">Number of epochs</label>
        <div class="control">
          <input id="timeline-count" type="number" min="2" step="1" bind:value={selected.epochCount} />
        </div>
        <p class="help">Counting the oldest epoch, which has no end.</p>
      </div>
      <div class="field">
        <label for="timeline-duration">Duration of each epoch</label>
        <div class="control">
          <input id="timeline-duration" type="number" min="0" step="any" bind:value={selected.duration} />
          <select aria-label="Units of the duration" bind:value={selected.units}>
            {#each Object.entries(TIME_UNITS) as [unit, info] (unit)}<option value={unit}>{info.label}</option>{/each}
          </select>
        </div>
        <p class="help">Epochs are counted back from the most recent sample.</p>
      </div>
    {:else if selected.kind === 'dates'}
      <fieldset class="checks">
        <legend>Transition dates</legend>
        {#each selected.dates ?? [] as _, i (i)}
          <div class="control">
            <input
              type="text"
              aria-label={`Transition date ${i + 1}`}
              placeholder="yyyy-MM-dd"
              bind:value={(selected.dates as string[])[i]}
            />
            <button onclick={() => selected.dates?.splice(i, 1)} aria-label={`Remove transition date ${i + 1}`}>Remove</button>
          </div>
        {/each}
        <p><button onclick={() => (selected.dates = [...(selected.dates ?? []), ''])}>Add a date</button></p>
        <p class="help">A date is yyyy-MM-dd or a decimal year, and must be before the most recent sample.</p>
      </fieldset>
    {:else}
      <fieldset class="checks">
        <legend>Transition times, in years before the most recent sample</legend>
        {#each selected.heights ?? [] as _, i (i)}
          <div class="control">
            <input
              type="number"
              min="0"
              step="any"
              aria-label={`Transition time ${i + 1}`}
              bind:value={(selected.heights as number[])[i]}
            />
            <button onclick={() => selected.heights?.splice(i, 1)} aria-label={`Remove transition time ${i + 1}`}>Remove</button>
          </div>
        {/each}
        <p><button onclick={() => (selected.heights = [...(selected.heights ?? []), 1])}>Add a time</button></p>
      </fieldset>
    {/if}

    {#if resolution && resolution.problems.length > 0}
      <ul class="issues">
        {#each resolution.problems as text (text)}<li class="error">{text.charAt(0).toUpperCase() + text.slice(1)}</li>{/each}
      </ul>
    {:else if resolution?.timeline}
      {@const resolved = resolution.timeline}
      <svg class="timeline" viewBox={`0 0 ${WIDTH} ${HEIGHT + 34}`} role="img" aria-label={`Timeline with ${resolved.epochs.length} epochs`}>
        {#each picture.counts as count, i (i)}
          {#if count > 0}
            <rect
              class="samples"
              x={WIDTH - ((i + 1) / BINS) * WIDTH + 0.5}
              y={HEIGHT - (count / picture.tallest) * (HEIGHT - 26)}
              width={WIDTH / BINS - 1}
              height={(count / picture.tallest) * (HEIGHT - 26)}
            />
          {/if}
        {/each}
        <line class="axis" x1="0" y1={HEIGHT} x2={WIDTH} y2={HEIGHT} />
        {#each picture.heights as height, i (i)}
          <line class="transition" x1={picture.x(height)} y1="14" x2={picture.x(height)} y2={HEIGHT + 4} />
          {#if picture.heights.length <= 12}
            <text class="tick" x={picture.x(height)} y={HEIGHT + 18} text-anchor="middle">{resolved.transitions[i]}</text>
          {/if}
        {/each}
        {#if picture.heights.length <= 12}
          {#each resolved.epochs as _, i (i)}
            {@const right = i === 0 ? WIDTH : picture.x(picture.heights[i - 1])}
            {@const left = i < picture.heights.length ? picture.x(picture.heights[i]) : 0}
            <text class="epoch" x={(left + right) / 2} y="10" text-anchor="middle">{i + 1}</text>
          {/each}
        {/if}
        <text class="tick" x={WIDTH} y={HEIGHT + 32} text-anchor="end">most recent sample →</text>
        <text class="tick" x="0" y={HEIGHT + 32}>← past</text>
      </svg>
      <p class="help">
        {#if ages.length > 0}Grey bars show when the samples were taken.{' '}{/if}Vertical lines are the transitions
        between epochs; epoch 1 is the most recent.
      </p>
      <table>
        <thead><tr><th class="num">Epoch</th><th>Covers</th><th class="num">From (years ago)</th><th class="num">To (years ago)</th></tr></thead>
        <tbody>
          {#each resolved.epochs.slice(0, 50) as label, i (i)}
            <tr>
              <td class="num">{i + 1}</td>
              <td>{label}</td>
              <td class="num">{i === 0 ? 0 : Number(resolved.heights[i - 1].toFixed(4))}</td>
              <td class="num">{i < resolved.heights.length ? Number(resolved.heights[i].toFixed(4)) : '∞'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if resolved.epochs.length > 50}<p class="help">Showing the first 50 of {resolved.epochs.length} epochs.</p>{/if}
    {/if}
  </section>
{/if}
