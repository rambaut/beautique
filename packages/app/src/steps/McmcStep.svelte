<script lang="ts">
  import { mcmcSchema, usedInstanceIds, type OptionValues } from '@beautique/core';
  import Field from '../lib/Field.svelte';
  import SchemaForm from '../lib/SchemaForm.svelte';
  import { app, registry } from '../lib/state.svelte';

  const stem = $derived(app.doc.name || 'analysis');

  /** The models in use that have gradient-based operators, and the operators of that kind now in the analysis. */
  const hmcModels = $derived.by(() => {
    const used = usedInstanceIds(app.doc);
    const labels = app.doc.components
      .filter((c) => used.has(c.id))
      .flatMap((c) => (registry.get(c.module)?.supportsHmc ? [registry.get(c.module)?.label ?? c.module] : []));
    return [...new Set(labels)];
  });
  const hmcOperators = $derived(
    app.preview.operators.filter((o) => o.decl.element === 'hamiltonianMonteCarloOperator' && !o.disabled),
  );
</script>

<section class="card">
  <h2>Analysis</h2>
  <Field
    name="name"
    field={{
      type: 'text',
      label: 'Analysis name',
      required: true,
      pattern: '[^\\s/\\\\]+',
      help: `BEAST will write ${stem}.log, ${stem}.trees, ${stem}.ops and ${stem}.chkpt`,
    }}
    value={app.doc.name}
    onchange={(v) => (app.doc.name = String(v ?? ''))}
  />
</section>

<section class="card">
  <h2>MCMC</h2>
  <SchemaForm schema={mcmcSchema} values={app.doc.mcmc as OptionValues} prefix="mcmc-" />
  {#if hmcOperators.length > 0}
    <p>Hamiltonian Monte Carlo operators in this analysis:</p>
    <ul class="plain">
      {#each hmcOperators as operator (operator.key)}<li>{operator.label} <span class="help">{operator.ownerLabel}</span></li>{/each}
    </ul>
  {:else if hmcModels.length > 0}
    <p class="help">
      Models in this analysis with gradient-based operators: {hmcModels.join(', ')}. Some use them only with
      particular settings; the Operators step shows what is in use.
    </p>
  {:else}
    <p class="help">No model in this analysis has gradient-based operators.</p>
  {/if}
</section>
