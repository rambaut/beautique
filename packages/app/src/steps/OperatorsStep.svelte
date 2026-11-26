<script lang="ts">
  import type { ResolvedOperator } from '@beautique/core';
  import { app } from '../lib/state.svelte';

  const operators = $derived(app.preview.operators);
  const issues = $derived(app.preview.issues.filter((i) => i.path?.startsWith('operators.')));

  function number(raw: string): number | undefined {
    return raw.trim() === '' ? undefined : Number(raw);
  }
</script>

<section class="card wide">
  <h2>Operators</h2>
  <p class="help">
    Operators propose new values during the MCMC. The weight sets how often each one is used; tuning values are
    adjusted automatically as the chain runs.
  </p>
  <table>
    <thead>
      <tr><th>Use</th><th>Operator</th><th>Model</th><th>Weight</th><th>Tuning</th><th></th></tr>
    </thead>
    <tbody>
      {#each operators as o (o.key)}
        {@const problems = issues.filter((i) => i.path === `operators.${o.key}`)}
        <tr class:changed={app.doc.operators[o.key] !== undefined} class:off={o.disabled}>
          <td>
            <input
              type="checkbox"
              aria-label={`Use ${o.label}`}
              checked={!o.disabled}
              onchange={(e) => app.overrideOperator(o.key, { disabled: !e.currentTarget.checked })}
            />
          </td>
          <td>
            <span class="mono">{o.label}</span>
            {#each problems as issue (issue.message)}<span class="message block">{issue.message}</span>{/each}
          </td>
          <td>{o.ownerLabel}</td>
          <td>
            <input
              class="short"
              type="number"
              step="any"
              min="0"
              aria-label={`Weight of ${o.label}`}
              value={Number.isNaN(o.weight) ? '' : o.weight}
              oninput={(e) => app.overrideOperator(o.key, { weight: number(e.currentTarget.value) })}
            />
          </td>
          <td>
            {#if o.decl.tuning}
              <label class="inline">
                {o.decl.tuning.name}
                <input
                  class="short"
                  type="number"
                  step="any"
                  aria-label={`${o.decl.tuning.name} of ${o.label}`}
                  value={o.tuning === undefined || Number.isNaN(o.tuning) ? '' : o.tuning}
                  oninput={(e) => app.overrideOperator(o.key, { tuning: number(e.currentTarget.value) })}
                />
              </label>
            {/if}
          </td>
          <td>
            {#if app.doc.operators[o.key] !== undefined}
              <button class="link" onclick={() => delete app.doc.operators[o.key]}>Reset</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
