<script lang="ts">
  import { mcmcSchema, type OptionValues } from '@beautique/core';
  import Field from '../lib/Field.svelte';
  import SchemaForm from '../lib/SchemaForm.svelte';
  import { app } from '../lib/state.svelte';

  const stem = $derived(app.doc.name || 'analysis');
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
</section>
