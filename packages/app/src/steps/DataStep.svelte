<script lang="ts">
  import type { AlignmentData, MetadataTable } from '@beautique/core';
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

  /** How many of a table's rows are for taxa that have a sequence. */
  function matched(table: MetadataTable): number {
    return app.preview.taxa.filter((t) => t.sources.includes(table.id) && t.sources.length > 1).length;
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
    <input type="file" accept=".fasta,.fas,.fa,.fna,.nex,.nexus,.nxs,.txt,.csv,.tsv,.tab" multiple onchange={picked} />
    <strong>Choose FASTA, NEXUS, CSV or TSV files</strong> or drop them here
    <span class="help">
      FASTA and NEXUS files are aligned sequences; character sets in a NEXUS file become partitions. CSV and TSV
      files are tables of metadata about the taxa, such as dates, locations and coordinates.
    </span>
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

{#if app.tables.length > 0}
  <section class="card">
    <h2>Metadata</h2>
    <table>
      <thead>
        <tr><th>Name</th><th class="num">Rows</th><th class="num">With a sequence</th><th>Taxon column</th><th>Other rows</th><th></th></tr>
      </thead>
      <tbody>
        {#each app.tables as table (table.id)}
          <tr>
            <td>{table.name}</td>
            <td class="num">{table.rows.length}</td>
            <td class="num">{app.alignments.length > 0 ? matched(table) : ''}</td>
            <td>
              <select
                aria-label={`Taxon column of ${table.name}`}
                value={String(table.keyColumn)}
                onchange={(e) => app.updateTable(table.id, { keyColumn: Number(e.currentTarget.value) })}
              >
                {#each table.columns as column, i (column)}<option value={String(i)}>{column}</option>{/each}
              </select>
            </td>
            <td>
              <select
                aria-label={`Rows of ${table.name} for taxa with no sequence`}
                value={table.addsTaxa === false ? 'ignore' : 'add'}
                onchange={(e) => app.updateTable(table.id, { addsTaxa: e.currentTarget.value === 'add' })}
              >
                <option value="add">Add as taxa</option>
                <option value="ignore">Ignore</option>
              </select>
            </td>
            <td><button class="link" onclick={() => app.removeTable(table.id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="help">
      The taxon column holds the taxon key or the whole taxon label. The other columns can be used for sampling
      dates (Samples and dates step) and traits (Traits step).
    </p>
  </section>
{/if}

{#if app.alignments.length > 0}
  <section class="card">
    <h2>Taxa</h2>
    <p>
      <strong>{app.preview.taxa.length}</strong> taxa in total
      {#if app.alignments.length + app.tables.length > 1}(the union of all files, linked by the taxon key){/if}.
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
