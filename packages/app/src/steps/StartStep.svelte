<script lang="ts">
  import { SLOT_LABELS } from '@beautique/core';
  import { builtinTemplates, type BuiltinTemplate } from '@beautique/modules';
  import { app } from '../lib/state.svelte';

  const templates = builtinTemplates.map((t) => ({ ...t, description: t.make().template?.description ?? '' }));

  function choose(template: BuiltinTemplate): void {
    app.useTemplate(template.make(), template.title);
  }

  function openFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) void app.importFiles(input.files);
    input.value = '';
  }

  function loadModules(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) void app.loadModules(input.files);
    input.value = '';
  }
</script>

<section class="card">
  <h2>Start from a template</h2>
  <p>
    A template is a ready-made design for an analysis. It asks for a few settings and takes care of the rest; you
    can still see and change everything by showing all the steps.
    {#if app.alignments.length > 0}The data you have loaded are kept when you choose a template.{/if}
  </p>
  <ul class="templates">
    {#each templates as template (template.id)}
      <li>
        <button aria-pressed={app.guided && app.templateTitle === template.title} onclick={() => choose(template)}>
          <strong>{template.title}</strong>
          <span>{template.description}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if app.importError}<p class="message" role="alert">{app.importError}</p>{/if}
  <div class="control">
    <label class="button">
      Open a template file
      <input type="file" accept=".json,application/json" onchange={openFile} />
    </label>
    <button onclick={() => app.useTemplate(templates[0].make(), null, false)}>Design the analysis step by step</button>
  </div>
  <p class="help">
    Any analysis can be saved as a template of your own, in the Save as template step when all steps are shown.
  </p>
</section>

<section class="card">
  <h2>Extra modules</h2>
  <p>
    A module adds a model to BEAUtique: a substitution model, a clock, a tree prior or a trait model. Modules that
    are not built in come as JavaScript files.
  </p>
  <div class="control">
    <label class="button">
      Load module files
      <input type="file" accept=".js,.mjs,text/javascript" multiple onchange={loadModules} />
    </label>
  </div>
  <p class="help">A module is a program that runs in this page. Load only files from people you trust.</p>
  {#if app.moduleError}<p class="message" role="alert">{app.moduleError}</p>{/if}
  {#if app.moduleFiles.length > 0}
    <table>
      <thead><tr><th>Module</th><th>Kind</th><th>File</th></tr></thead>
      <tbody>
        {#each app.moduleFiles as loaded (loaded.file)}
          {#each loaded.modules as module (module.id)}
            <tr><td>{module.label} <span class="help mono">{module.id}</span></td><td>{SLOT_LABELS[module.slot]}</td><td>{loaded.file}</td></tr>
          {/each}
        {/each}
      </tbody>
    </table>
    <p class="help">Loaded modules last until the page is reloaded. Load them again before opening a project that uses them.</p>
  {/if}
</section>
