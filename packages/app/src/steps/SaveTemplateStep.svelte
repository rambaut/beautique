<script lang="ts">
  import { listSettings, makeTemplate, templateRequirements, type AnalysisDocument, type SettingInfo } from '@beautique/core';
  import { app, registry } from '../lib/state.svelte';

  const groups = $derived.by(() => {
    const byGroup = new Map<string, SettingInfo[]>();
    for (const setting of listSettings(app.doc, registry)) {
      byGroup.set(setting.group, [...(byGroup.get(setting.group) ?? []), setting]);
    }
    return [...byGroup];
  });
  const asked = $derived(groups.flatMap(([, settings]) => settings).filter((s) => s.ask).length);
  const needs = $derived(templateRequirements(makeTemplate($state.snapshot(app.doc) as AnalysisDocument)));

  function ask(path: string, on: boolean): void {
    const template = (app.doc.template ??= { ask: [] });
    template.ask = on ? [...template.ask.filter((p) => p !== path), path] : template.ask.filter((p) => p !== path);
  }

  function describe(text: string): void {
    (app.doc.template ??= { ask: [] }).description = text;
  }

  /** A setting's value in words. */
  function show({ field, value }: SettingInfo): string {
    if (value === undefined || value === null || value === '') return '';
    if (field.type === 'choice') return field.choices.find((c) => c.value === value)?.label ?? String(value);
    if (field.type === 'boolean') return value ? 'Yes' : 'No';
    if (field.type === 'taxonSetRef' || field.type === 'timelineRef') {
      const items = field.type === 'taxonSetRef' ? app.refs.taxonSets : app.refs.timelines;
      return (Array.isArray(value) ? value : [value]).map((id) => items.find((i) => i.id === id)?.name ?? '?').join(', ');
    }
    return String(value);
  }
</script>

<section class="card">
  <h2>Save this design as a template</h2>
  <p>
    A template holds the models and settings of this analysis without the data, so that the same design can be
    applied to other datasets, here or on the command line. Sequences, metadata and the taxa in taxon sets are left out.
  </p>
  <div class="field">
    <label for="template-description">What the template is for</label>
    <textarea
      id="template-description"
      rows="3"
      value={app.template.description ?? ''}
      oninput={(e) => describe(e.currentTarget.value)}
    ></textarea>
    <p class="help">Shown to whoever uses the template. Say what kind of data it suits.</p>
  </div>
  {#if needs.length > 0}
    <p>The template will expect of the data:</p>
    <ul class="plain">
      {#each needs as need (need)}<li>{need}</li>{/each}
    </ul>
  {/if}
  <button class="primary" onclick={() => app.saveTemplate()}>Download {app.fileStem}.template.json</button>
</section>

<section class="card">
  <h2>Settings to ask for</h2>
  <p>
    Tick the settings that whoever uses the template should be asked for; {asked === 0 ? 'none are' : asked === 1 ? 'one is' : `${asked} are`}
    ticked. The value here is offered as the starting value. Everything else is decided by the template.
  </p>
  <table>
    <thead><tr><th>Ask</th><th>Setting</th><th>Value</th></tr></thead>
    <tbody>
      {#each groups as [group, settings] (group)}
        <tr class="group"><th colspan="3">{group}</th></tr>
        {#each settings as setting (setting.path)}
          <tr>
            <td>
              <input
                type="checkbox"
                aria-label={`Ask for ${setting.field.label}`}
                checked={setting.ask}
                onchange={(e) => ask(setting.path, e.currentTarget.checked)}
              />
            </td>
            <td>{setting.field.label}</td>
            <td>{show(setting)} {#if !setting.explicit}<span class="help">default</span>{/if}</td>
          </tr>
        {/each}
      {/each}
    </tbody>
  </table>
</section>
