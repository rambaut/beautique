<script lang="ts">
  import { app, STEPS, type StepId } from './lib/state.svelte';
  import DataStep from './steps/DataStep.svelte';
  import DatesStep from './steps/DatesStep.svelte';
  import GenerateStep from './steps/GenerateStep.svelte';
  import McmcStep from './steps/McmcStep.svelte';
  import ModelSteps from './steps/ModelSteps.svelte';
  import OperatorsStep from './steps/OperatorsStep.svelte';
  import PartitionsStep from './steps/PartitionsStep.svelte';
  import PriorsStep from './steps/PriorsStep.svelte';

  let showPreview = $state(true);

  function openProject(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) void app.importFiles(input.files);
    input.value = '';
  }

  const errors = $derived(app.preview.issues.filter((i) => i.severity === 'error'));
  const badges = $derived.by(() => {
    const counts = new Map<StepId, number>();
    for (const issue of errors) {
      const step = app.stepOf(issue);
      counts.set(step, (counts.get(step) ?? 0) + 1);
    }
    return counts;
  });
  const title = $derived(STEPS.find((s) => s.id === app.step)?.label ?? '');
</script>

<div class="shell" class:with-preview={showPreview}>
  <header>
    <span class="wordmark">BEAUtique</span>
    <span class="doc-name">{app.doc.name}</span>
    <span class="spacer"></span>
    <button onclick={() => app.reset()}>New</button>
    <label class="button">
      Open
      <input type="file" accept=".json,application/json" onchange={openProject} />
    </label>
    <button onclick={() => app.saveProject()}>Save project</button>
    <button onclick={() => (showPreview = !showPreview)} aria-pressed={showPreview}>XML preview</button>
  </header>

  <nav aria-label="Steps">
    <ol>
      {#each STEPS as step (step.id)}
        <li>
          <button class:current={app.step === step.id} aria-current={app.step === step.id ? 'step' : undefined} onclick={() => (app.step = step.id)}>
            <span>{step.label}</span>
            {#if step.id === 'generate'}
              {#if errors.length === 0}<span class="badge ok" title="Ready">✓</span>{/if}
            {:else if badges.get(step.id)}
              <span class="badge" title="Problems to fix">{badges.get(step.id)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  <main>
    <h1>{title}</h1>
    {#if app.importError && app.step !== 'data'}<p class="message" role="alert">{app.importError}</p>{/if}
    {#if app.step === 'data'}
      <DataStep />
    {:else if app.step === 'dates'}
      <DatesStep />
    {:else if app.step === 'partitions'}
      <PartitionsStep />
    {:else if app.step === 'substitution' || app.step === 'clock' || app.step === 'tree'}
      <ModelSteps step={app.step} />
    {:else if app.step === 'priors'}
      <PriorsStep />
    {:else if app.step === 'operators'}
      <OperatorsStep />
    {:else if app.step === 'mcmc'}
      <McmcStep />
    {:else}
      <GenerateStep />
    {/if}
  </main>

  {#if showPreview}
    <aside aria-label="XML preview">
      <h2>XML preview <span class="help">sequences not shown</span></h2>
      {#if app.preview.xml !== undefined}
        <pre>{app.preview.xml}</pre>
      {:else}
        <ul class="issues">
          {#each errors as issue (issue.message)}<li class="error">{issue.message}</li>{/each}
        </ul>
      {/if}
    </aside>
  {/if}
</div>
