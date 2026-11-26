<script lang="ts">
  import {
    codonSchemeOf,
    countSites,
    linkPartition,
    setCodonScheme,
    unlinkPartition,
    type CodonScheme,
    type Partition,
    type SiteRange,
  } from '@beautique/core';
  import { app, registry } from '../lib/state.svelte';

  const UNLINK = '__unlink__';

  function describeSites(sites: SiteRange[] | undefined): string {
    if (!sites || sites.length === 0) return 'All sites';
    return sites
      .map((r) => {
        const from = r.from ?? 1;
        const span = r.to === from ? `${from}` : `${from}–${r.to ?? 'end'}`;
        return r.every && r.every > 1 ? `${span} by ${r.every}` : span;
      })
      .join(', ');
  }

  function siteCount(partition: Partition): number {
    const alignment = app.alignments.find((a) => a.id === partition.alignment);
    return countSites(partition.sites, alignment?.sequences[0]?.sequence.length ?? 0);
  }

  function choices(slot: 'substitution' | 'clock'): { id: string; label: string }[] {
    const ids = [...new Set(app.doc.partitions.map((p) => p[slot]))];
    return ids.map((id) => {
      const instance = app.doc.components.find((c) => c.id === id);
      const label = (instance && registry.get(instance.module)?.label) ?? instance?.module ?? '?';
      // the name only matters when there is more than one model to tell apart
      return { id, label: ids.length > 1 ? `${instance?.name ?? id} (${label})` : label };
    });
  }

  function isShared(partition: Partition, slot: 'substitution' | 'clock'): boolean {
    return app.doc.partitions.some((p) => p !== partition && p[slot] === partition[slot]);
  }

  function relink(partition: Partition, slot: 'substitution' | 'clock', value: string): void {
    if (value === UNLINK) unlinkPartition(app.doc, partition.id, slot);
    else linkPartition(app.doc, partition.id, slot, value);
  }
</script>

{#if app.alignments.length === 0}
  <section class="card"><p>Load sequence data first.</p></section>
{:else}
  <section class="card">
    <h2>Codon positions</h2>
    <p class="help">
      For protein-coding alignments that start at the first codon position. Each group of codon positions gets its
      own substitution model and its own relative rate.
    </p>
    {#each app.alignments as alignment (alignment.id)}
      {@const scheme = codonSchemeOf(app.doc, alignment.id)}
      <div class="field">
        <label for={`codon-${alignment.id}`}>{alignment.name}</label>
        <div class="control">
          <select
            id={`codon-${alignment.id}`}
            value={scheme}
            onchange={(e) => setCodonScheme(app.doc, alignment, e.currentTarget.value as CodonScheme)}
          >
            <option value="none">Not partitioned by codon position</option>
            <option value="12+3">2 partitions: positions (1 + 2), 3</option>
            <option value="1+2+3">3 partitions: positions 1, 2, 3</option>
            {#if scheme === 'custom'}<option value="custom" disabled>Partitioned by the file's character sets</option>{/if}
          </select>
        </div>
      </div>
    {/each}
  </section>

  <section class="card">
    <h2>Partitions</h2>
    <p class="help">
      Partitions that share a substitution model or clock estimate one set of parameters for it. Choose "Separate
      copy" to give a partition its own.
    </p>
    <table>
      <thead>
        <tr><th>Partition</th><th>Data</th><th>Sites</th><th class="num">Count</th><th>Substitution model</th><th>Clock</th></tr>
      </thead>
      <tbody>
        {#each app.doc.partitions as partition (partition.id)}
          <tr>
            <td>{partition.name}</td>
            <td>{app.alignments.find((a) => a.id === partition.alignment)?.name ?? ''}</td>
            <td class="nowrap">{describeSites(partition.sites)}</td>
            <td class="num">{siteCount(partition)}</td>
            {#each ['substitution', 'clock'] as const as slot (slot)}
              <td>
                <select
                  aria-label={`${slot === 'clock' ? 'Clock' : 'Substitution model'} for ${partition.name}`}
                  value={partition[slot]}
                  onchange={(e) => relink(partition, slot, e.currentTarget.value)}
                >
                  {#each choices(slot) as choice (choice.id)}
                    <option value={choice.id}>{choice.label}</option>
                  {/each}
                  {#if isShared(partition, slot)}<option value={UNLINK}>Separate copy</option>{/if}
                </select>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}
