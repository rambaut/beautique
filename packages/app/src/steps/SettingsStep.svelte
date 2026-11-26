<script lang="ts">
  import { assignSetting, openSettings, type SettingInfo } from '@beautique/core';
  import Field from '../lib/Field.svelte';
  import { app, registry } from '../lib/state.svelte';

  /** The settings the template asks for, under the headings they belong to. */
  const groups = $derived.by(() => {
    const byGroup = new Map<string, SettingInfo[]>();
    for (const setting of openSettings(app.doc, registry)) {
      byGroup.set(setting.group, [...(byGroup.get(setting.group) ?? []), setting]);
    }
    return [...byGroup];
  });
</script>

{#each groups as [group, settings] (group)}
  <section class="card">
    <h2>{group}</h2>
    {#each settings as setting (setting.path)}
      <Field
        name={`ask-${setting.path}`}
        field={setting.field}
        value={setting.explicit ? setting.value : undefined}
        onchange={(value) => assignSetting(app.doc, setting.path, value)}
      />
    {/each}
  </section>
{:else}
  <section class="card"><p>This template asks for nothing: it is ready to generate once it has data.</p></section>
{/each}

<p class="help">
  The template decides everything else.
  <button class="link" onclick={() => app.showAllSteps()}>Show all steps</button> to see or change it, or go on to
  <button class="link" onclick={() => (app.step = 'generate')}>Generate</button>.
</p>
