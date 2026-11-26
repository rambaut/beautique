<script lang="ts">
  import {
    defaultPrior,
    PRIOR_TYPES,
    priorParam,
    type PriorSpec,
    type PriorType,
    type ResolvedParameter,
  } from '@beautique/core';
  import { app } from '../lib/state.svelte';

  const parameters = $derived(app.preview.parameters.filter((p) => p.decl.prior));
  const issues = $derived(app.preview.issues.filter((i) => i.path?.startsWith('parameters.')));

  function setType(p: ResolvedParameter, type: PriorType): void {
    app.overrideParameter(p.key, { prior: type === p.decl.prior?.type ? undefined : defaultPrior(type) });
  }

  function setParam(p: ResolvedParameter, name: string, raw: string): void {
    const prior = { ...(p.prior as PriorSpec), [name]: raw.trim() === '' ? Number.NaN : Number(raw) } as PriorSpec;
    app.overrideParameter(p.key, { prior });
  }

  function setInitial(p: ResolvedParameter, raw: string): void {
    app.overrideParameter(p.key, { value: raw.trim() === '' ? undefined : Number(raw) });
  }

  function reset(p: ResolvedParameter): void {
    app.overrideParameter(p.key, { prior: undefined, value: undefined });
  }
</script>

<section class="card wide">
  <h2>Parameters and their priors</h2>
  <p class="help">Each model sets a default prior for its parameters. Changes made here are kept if the model is repartitioned.</p>
  <table>
    <thead>
      <tr><th>Parameter</th><th>Prior</th><th>Prior parameters</th><th>Initial value</th><th></th></tr>
    </thead>
    <tbody>
      {#each parameters as p (p.key)}
        {@const prior = p.prior as PriorSpec}
        {@const problems = issues.filter((i) => i.path === `parameters.${p.key}`)}
        <tr class:changed={app.doc.parameters[p.key] !== undefined}>
          <td>
            <span class="mono">{p.id}</span>
            {#if p.decl.description}<span class="help block">{p.decl.description}</span>{/if}
            {#each problems as issue (issue.message)}<span class="message block">{issue.message}</span>{/each}
          </td>
          <td>
            <select aria-label={`Prior for ${p.id}`} value={prior.type} onchange={(e) => setType(p, e.currentTarget.value as PriorType)}>
              {#each Object.entries(PRIOR_TYPES) as [type, info] (type)}
                <option value={type}>{info.label}</option>
              {/each}
            </select>
          </td>
          <td>
            <div class="control">
              {#each PRIOR_TYPES[prior.type].params as param (param.name)}
                <label class="inline">
                  {param.name}
                  <input
                    class="short"
                    type="number"
                    step="any"
                    aria-label={`${param.name} of the prior for ${p.id}`}
                    value={Number.isNaN(priorParam(prior, param.name)) ? '' : priorParam(prior, param.name)}
                    oninput={(e) => setParam(p, param.name, e.currentTarget.value)}
                  />
                </label>
              {/each}
            </div>
          </td>
          <td>
            {#if typeof p.value === 'number'}
              <input
                class="short"
                type="number"
                step="any"
                aria-label={`Initial value of ${p.id}`}
                value={Number.isNaN(p.value) ? '' : p.value}
                oninput={(e) => setInitial(p, e.currentTarget.value)}
              />
            {:else if Array.isArray(p.value)}
              <span class="mono">{p.value.join(' ')}</span>
            {/if}
          </td>
          <td>
            {#if app.doc.parameters[p.key] !== undefined}
              <button class="link" onclick={() => reset(p)}>Reset</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
