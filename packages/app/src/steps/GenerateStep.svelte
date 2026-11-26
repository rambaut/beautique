<script lang="ts">
  import { describePrior } from '@beautique/core';
  import { app } from '../lib/state.svelte';

  const result = $derived(app.preview);
  const errors = $derived(result.issues.filter((i) => i.severity === 'error'));
  const warnings = $derived(result.issues.filter((i) => i.severity === 'warning'));
  const priors = $derived(result.parameters.filter((p) => p.prior));
</script>

<section class="card">
  <h2>Generate BEAST XML</h2>
  {#if errors.length > 0}
    <p>The analysis cannot be generated yet:</p>
    <ul class="issues">
      {#each errors as issue (issue.message)}
        <li class="error">
          <button class="link" onclick={() => (app.step = app.stepOf(issue))}>{issue.message}</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p>
      {result.taxa.length} taxa, {app.doc.partitions.length}
      {app.doc.partitions.length === 1 ? 'partition' : 'partitions'}, {priors.length} parameters with priors,
      {result.operators.filter((o) => !o.disabled).length} operators.
    </p>
  {/if}
  {#if warnings.length > 0}
    <ul class="issues">
      {#each warnings as issue (issue.message)}<li class="warning">{issue.message}</li>{/each}
    </ul>
  {/if}
  <button class="primary" disabled={errors.length > 0} onclick={() => app.downloadXml()}>
    Download {app.doc.name || 'analysis'}.xml
  </button>
</section>

{#if errors.length === 0}
  <section class="card">
    <h2>Priors in this analysis</h2>
    <table>
      <thead><tr><th>Parameter</th><th>Prior</th><th>Description</th></tr></thead>
      <tbody>
        {#each priors as p (p.key)}
          <tr>
            <td class="mono">{p.id}</td>
            <td>{p.prior ? describePrior(p.prior) : ''}</td>
            <td>{p.decl.description ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="help">Change these in the <button class="link" onclick={() => (app.step = 'priors')}>Priors</button> step.</p>
  </section>
{/if}
