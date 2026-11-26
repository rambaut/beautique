#!/usr/bin/env node
/**
 * Integration check: generate a set of analyses covering the available
 * models and run each briefly in a local BEAST X build. Fails if BEAST
 * rejects any file. Usage: node scripts/check-beast.mjs [BEAST dir]
 * Build the CLI first (npm run build:cli).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const CLI = 'packages/cli/dist/beautique.js';
const DATA = 'examples/data/YFV.fasta';
const M = (id, module) => ['-s', `models.${id}.module=${module}`];
const S = (path, value) => ['-s', `${path}=${value}`];

const cases = {
  'hky-strict-constant': [],
  'gtr-strict-constant': [...M('substitution', 'substitution.gtr')],
  'hky-equalfreq-fixedrate': [...S('models.substitution.frequencies', 'equal'), ...S('models.clock.rateMode', 'fixed'), ...S('models.clock.fixedRate', '0.0003')],
  'ucln-constant': [...M('clock', 'clock.uncorrelated')],
  'ucgd-constant': [...M('clock', 'clock.uncorrelated'), ...S('models.clock.distribution', 'gamma')],
  'uced-constant': [...M('clock', 'clock.uncorrelated'), ...S('models.clock.distribution', 'exponential')],
  'strict-exponential': [...M('treePrior', 'treePrior.exponential')],
  'strict-skygrid': [...M('treePrior', 'treePrior.skygrid'), ...S('models.treePrior.gridPoints', '20')],
  'codon12+3-hky': ['--codon', '12+3'],
  'codon1+2+3-gtr-ucln-skygrid': ['--codon', '1+2+3', ...M('substitution', 'substitution.gtr'), ...M('clock', 'clock.uncorrelated'), ...M('treePrior', 'treePrior.skygrid')],
  'undated-skygrid': ['--no-dates', ...M('treePrior', 'treePrior.skygrid'), ...S('models.treePrior.cutOff', '100')],
  'clade-constraints': ['--clade', 'Trinidad=_Trinidad$', '--clade', 'Trinidad70s80s=^19[78].*_Trinidad$', '--taxon-set', 'Brazil=_Brazil$'],
  'local-clock-clades': ['--clade', 'Trinidad=_Trinidad$', '--taxon-set', 'Brazil=_Brazil$', ...M('clock', 'clock.localClade'), ...S('models.clock.clades', 'Trinidad,Brazil')],
  'local-clock-clades-relative': ['--taxon-set', 'Brazil=_Brazil$', ...M('clock', 'clock.localClade'), ...S('models.clock.clades', 'Brazil'), ...S('models.clock.relative', 'true'), ...S('models.clock.includeStem', 'false')],
  'local-clock-epochs': ['--timeline', 'eras=1980-01-01,1995-06-15', ...M('clock', 'clock.epoch'), ...S('models.clock.timeline', 'eras')],
  'birth-death-sampling': [...M('treePrior', 'treePrior.birthDeathSampling')],
  'birth-death-sampling-constant-epoch': [...M('treePrior', 'treePrior.episodicBirthDeathSampling')],
  'birth-death-sampling-epochs': ['--timeline', 'decades=5x10years', ...M('treePrior', 'treePrior.episodicBirthDeathSampling'), ...S('models.treePrior.timeline', 'decades')],
  'discrete-symmetric-bssvs': ['--metadata', 'examples/data/YFV_metadata.tsv', '--discrete-trait', 'country=country'],
  'discrete-asymmetric-markov-jumps': ['--metadata', 'examples/data/YFV_metadata.tsv', '--discrete-trait', 'country=country', ...S('models.trait-country.structure', 'asymmetric'), ...S('models.trait-country.markovJumps', 'true')],
  'discrete-from-label-no-bssvs': ['--discrete-trait', 'country=field:-1:_', ...S('models.trait-country.bssvs', 'false')],
  'continuous-cauchy-latlong': ['--metadata', 'examples/data/YFV_metadata.tsv', '--continuous-trait', 'location=latitude,longitude', ...S('models.trait-location.latLong', 'true')],
  'continuous-gamma': ['--metadata', 'examples/data/YFV_metadata.tsv', '--continuous-trait', 'location=latitude,longitude', ...S('models.trait-location.rates', 'gamma')],
  'continuous-lognormal': ['--metadata', 'examples/data/YFV_metadata.tsv', '--continuous-trait', 'location=latitude,longitude', ...S('models.trait-location.rates', 'lognormal')],
  'continuous-homogeneous-one-dimension': ['--metadata', 'examples/data/YFV_metadata.tsv', '--date-column', 'year', '--continuous-trait', 'latitude=latitude', ...S('models.trait-latitude.rates', 'homogeneous')],
  'discrete-and-continuous-skygrid-ucln': ['--metadata', 'examples/data/YFV_metadata.tsv', '--discrete-trait', 'country=country', '--continuous-trait', 'location=latitude,longitude', ...M('treePrior', 'treePrior.skygrid'), ...M('clock', 'clock.uncorrelated')],
  'epochs-clock-and-birth-death-ucln': ['--codon', '12+3', '--clade', 'Trinidad=_Trinidad$', '--timeline', 'eras=ago:15,30', ...M('treePrior', 'treePrior.episodicBirthDeathSampling'), ...S('models.treePrior.timeline', 'eras'), ...M('clock', 'clock.uncorrelated')],
};

mkdirSync('out/check', { recursive: true });
let failed = 0;
for (const [name, args] of Object.entries(cases)) {
  const xml = `out/check/${name}.xml`;
  const gen = spawnSync('node', [CLI, 'generate', '-d', DATA, '-n', name, '-s', 'mcmc.chainLength=2000', ...args, '-o', xml], { encoding: 'utf8' });
  let status = 'ok';
  let detail = '';
  if (gen.status !== 0) {
    status = 'GENERATE FAILED';
    detail = gen.stderr;
  } else {
    const run = spawnSync('node', ['scripts/run-beast.mjs', xml, ...process.argv.slice(2)], { encoding: 'utf8' });
    const output = run.stdout + run.stderr;
    if (run.status !== 0 || !/^2000\t/m.test(output)) {
      status = 'BEAST FAILED';
      detail = output.split('\n').filter((l) => /error|exception|illegal|invalid|not found|unknown/i.test(l)).slice(0, 8).join('\n') || output.slice(-1500);
    }
  }
  if (status !== 'ok') failed++;
  console.log(`${status.padEnd(16)} ${name}${detail ? `\n${detail}` : ''}`);
}
console.log(failed === 0 ? `All ${Object.keys(cases).length} analyses ran in BEAST` : `${failed} analyses failed`);
process.exit(failed === 0 ? 0 : 1);
