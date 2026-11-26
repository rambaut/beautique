<script lang="ts">
  import { templateRequirements } from '@beautique/core';
  import { app } from './state.svelte';

  // What the template reads from the data stays true once data is loaded, so the document is asked directly.
  const needs = $derived(templateRequirements(app.doc));
</script>

<section class="card">
  <h2>{app.templateTitle ?? 'Template'}</h2>
  {#if app.template.description}<p>{app.template.description}</p>{/if}
  {#if needs.length > 0}
    <p>It expects of the data:</p>
    <ul class="plain">
      {#each needs as need (need)}<li>{need}</li>{/each}
    </ul>
    <p class="help">
      If your data are arranged differently, <button class="link" onclick={() => app.showAllSteps()}>show all steps</button>
      and change where the dates and traits are read from.
    </p>
  {/if}
</section>
