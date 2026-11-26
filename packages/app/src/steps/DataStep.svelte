<script lang="ts">
  import type { AlignmentData } from '@beautique/core';
  import { app } from '../lib/state.svelte';

  let dragging = $state(false);

  function drop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer?.files.length) void app.importFiles(event.dataTransfer.files);
  }

  function picked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) void app.importFiles(input.files);
    input.value = '';
  }

  function fieldsOf(alignment: AlignmentData): string[] {
    const delimiter = alignment.labelRule.delimiter;
    const first = alignment.sequences[0]?.label ?? '';
    return delimiter === '' ? [] : first.split(delimiter);
  }

  function setKey(alignment: AlignmentData, value: string): void {
    app.updateAlignment(alignment.id, {
      labelRule: { ...alignment.labelRule, keyField: value === 'label' ? 'label' : Number(value) },
    });
  }

  function setDelimiter(alignment: AlignmentData, delimiter: string): void {
    app.updateAlignment(alignment.id, {
      labelRule: { delimiter, keyField: delimiter === '' ? 'label' : alignment.labelRule.keyField },
    });
  }
</script>

<section class="card">
  <h2>Sequence data</h2>
  <label
    class="dropzone"
    class:dragging
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={drop}
  >
    <input type="file" accept=".fasta,.fas,.fa,.fna,.nex,.nexus,.nxs,.txt" multiple onchange={picked} />
    <strong>Choose FASTA or NEXUS files</strong> or drop them here
    <span class="help">Each file is an aligned set of sequences. Character sets in a NEXUS file become partitions.</span>
  </label>
  {#if app.importError}<p class="message" role="alert">{app.importError}</p>{/if}

  {#if app.alignments.length > 0}
    <table>
      <thead>
        <tr><th>Name</th><th class="num">Sequences</th><th class="num">Sites</th><th>Label delimiter</th><th>Taxon key</th><th></th></tr>
      </thead>
      <tbody>
        {#each app.alignments as alignment (alignment.id)}
          <tr>
            <td>{alignment.name}</td>
            <td class="num">{alignment.sequences.length}</td>
            <td class="num">{alignment.sequences[0]?.sequence.length ?? 0}</td>
            <td>
              <input
                class="short"
                type="text"
                maxlength="1"
                aria-label={`Label delimiter for ${alignment.name}`}
                placeholder="none"
                value={alignment.labelRule.delimiter}
                oninput={(e) => setDelimiter(alignment, e.currentTarget.value)}
              />
            </td>
            <td>
              <select
                aria-label={`Taxon key for ${alignment.name}`}
                value={String(alignment.labelRule.keyField)}
                onchange={(e) => setKey(alignment, e.currentTarget.value)}
              >
                <option value="label">Whole label</option>
                {#each fieldsOf(alignment) as text, i (i)}
                  <option value={String(i)}>Field {i + 1} (e.g. {text})</option>
                {/each}
              </select>
            </td>
            <td><button class="link" onclick={() => app.removeAlignment(alignment.id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

{#if app.alignments.length > 0}
  <section class="card">
    <h2>Taxa</h2>
    <p>
      <strong>{app.preview.taxa.length}</strong> taxa in total
      {#if app.alignments.length > 1}(the union of all files, linked by the taxon key){/if}.
    </p>
    <div class="field">
      <label for="taxon-id-style">Taxon names in the BEAST file</label>
      <div class="control">
        <select id="taxon-id-style" bind:value={app.doc.data.taxonIdStyle}>
          <option value="label">Full label</option>
          <option value="key">Taxon key only</option>
        </select>
      </div>
    </div>
  </section>
{/if}
