<script lang="ts">
  import { app } from '../lib/state.svelte';

  const LIMIT = 200;
  const dates = $derived(app.doc.data.dates);
  const sample = $derived(app.labels[0] ?? '');
  const fields = $derived(dates.delimiter === '' ? [sample] : sample.split(dates.delimiter));
  const taxa = $derived(app.preview.taxa);
  const dated = $derived(taxa.filter((t) => t.date !== undefined));
  const range = $derived(
    dated.length > 0
      ? { min: Math.min(...dated.map((t) => t.date as number)), max: Math.max(...dated.map((t) => t.date as number)) }
      : null,
  );
</script>

{#if app.alignments.length === 0}
  <section class="card"><p>Load sequence data first.</p></section>
{:else}
  <section class="card">
    <h2>Sampling dates</h2>
    <div class="field">
      <label for="date-mode">Tip dates</label>
      <div class="control">
        <select id="date-mode" bind:value={dates.mode}>
          <option value="none">Not dated</option>
          <option value="labelField">Read from the taxon label</option>
          {#if app.tables.length > 0}<option value="column">Read from a metadata column</option>{/if}
        </select>
        <button onclick={() => app.detectDates()}>Detect</button>
      </div>
    </div>
    {#if dates.mode === 'labelField'}
      <div class="field">
        <label for="date-delimiter">Label delimiter</label>
        <div class="control">
          <input id="date-delimiter" class="short" type="text" maxlength="1" bind:value={dates.delimiter} />
        </div>
      </div>
      <div class="field">
        <label for="date-field">Date field</label>
        <div class="control">
          <select id="date-field" value={dates.field} onchange={(e) => (dates.field = Number(e.currentTarget.value))}>
            <option value={-1}>Last field</option>
            {#each fields as text, i (i)}
              <option value={i}>Field {i + 1} (e.g. {text})</option>
            {/each}
          </select>
        </div>
        <p class="help">Dates may be yyyy-MM-dd, yyyy-MM, yyyy or a decimal year.</p>
      </div>
    {/if}
    {#if dates.mode === 'column'}
      <div class="field">
        <label for="date-column">Date column</label>
        <div class="control">
          <select
            id="date-column"
            value={dates.table && dates.column ? JSON.stringify([dates.table, dates.column]) : ''}
            onchange={(e) => {
              const [table, column] = JSON.parse(e.currentTarget.value || '["",""]') as [string, string];
              dates.table = table;
              dates.column = column;
            }}
          >
            <option value="">Choose…</option>
            {#each app.tables as table (table.id)}
              {#each table.columns as column (column)}
                <option value={JSON.stringify([table.id, column])}>{column} ({table.name})</option>
              {/each}
            {/each}
          </select>
        </div>
        <p class="help">Dates may be yyyy-MM-dd, yyyy-MM, yyyy or a decimal year.</p>
      </div>
    {/if}
    {#if dates.mode !== 'none'}
      {#if range}
        <p>
          {dated.length} of {taxa.length} taxa dated, from {range.min.toFixed(3)} to {range.max.toFixed(3)}
          (a span of {(range.max - range.min).toFixed(2)} years).
        </p>
      {/if}
    {/if}
  </section>

  <section class="card">
    <h2>Taxa</h2>
    <table>
      <thead><tr><th>Taxon</th><th class="num">Date (decimal year)</th><th>Precision</th></tr></thead>
      <tbody>
        {#each taxa.slice(0, LIMIT) as taxon (taxon.key)}
          <tr>
            <td class="mono">{taxon.id}</td>
            <td class="num">{taxon.date === undefined ? '' : taxon.date.toFixed(4)}</td>
            <td>{taxon.datePrecision ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if taxa.length > LIMIT}<p class="help">Showing the first {LIMIT} of {taxa.length} taxa.</p>{/if}
  </section>
{/if}
