# BEAUtique

BEAUtique designs [BEAST X](https://beast.community) (v10.6+) analyses for genomic epidemiology of virus genomes and writes the BEAST XML file. It is a browser app and a command-line tool built on the same core, and every model it offers is a self-contained module that can be added without touching the rest of the code.

Status: early development. What it covers so far:

- **Data:** FASTA and NEXUS alignments (NEXUS character sets become partitions), tip dates read from taxon labels.
- **Partitions:** several alignments, codon-position partitions, and linking or unlinking of substitution models and clocks between partitions, with relative rates estimated for partitions under one clock.
- **Taxon sets:** named groups of taxa, picked by filtering the taxon labels. Each has its tMRCA logged and can be constrained to be a clade.
- **Timelines:** named divisions of time into epochs, given as epochs of equal duration, as transition dates, or as times before the most recent sample.
- **Substitution models:** HKY and GTR, with gamma rate heterogeneity.
- **Clocks:** strict; uncorrelated relaxed (lognormal, gamma, exponential); local clocks on clades (a rate for each chosen taxon set); local clocks in epochs (a rate for each epoch of a timeline).
- **Tree priors:** constant-size, exponential-growth and Bayesian skygrid coalescents; birth-death with serial sampling; birth-death-sampling with rates that change between the epochs of a timeline.
- **Settings:** priors, initial values and operators can be edited; analyses can be saved and reopened as project files.

## Getting started

Requires Node.js 22 or later.

```
npm install
npm run dev          # the app, at http://localhost:5173
npm run build        # builds the CLI and the app (packages/app/dist)
```

Command line:

```
node packages/cli/dist/beautique.js generate --data examples/data/YFV.fasta
node packages/cli/dist/beautique.js generate --data examples/data/YFV.fasta --codon 12+3 \
    --set models.clock.module=clock.uncorrelated --set models.treePrior.module=treePrior.skygrid
node packages/cli/dist/beautique.js generate --data examples/data/YFV.fasta \
    --clade 'Trinidad=_Trinidad$' --timeline 'eras=1980-01-01,1995-06-15' \
    --set models.clock.module=clock.localClade --set models.clock.clades=Trinidad \
    --set models.treePrior.module=treePrior.episodicBirthDeathSampling --set models.treePrior.timeline=eras
node packages/cli/dist/beautique.js describe          # settings and their paths
node packages/cli/dist/beautique.js modules           # available modules
node packages/cli/dist/beautique.js --help
```

`generate` starts from a template (the built-in one unless `--template` is given), attaches the data files, applies any `--set path=value` settings and writes `<name>.xml`. A project file saved from the app can be given as the template, in which case no data files are needed.

`--taxon-set name=pattern` defines a taxon set from the taxa whose labels match a regular expression (or `name=@file` for a file listing them), and `--clade` does the same and constrains the set to be a clade. `--timeline name=spec` defines a timeline: `12x1months` for equal epochs, a comma-separated list of dates, or `ago:0.5,1,2` for times in years before the most recent sample. Settings that refer to a taxon set or timeline take its name.

## Layout

| Path | Contents |
|---|---|
| `packages/core` | Document format, module API, option schemas and validation, data import, the XML generation pipeline. No DOM or node dependencies. |
| `packages/modules` | The built-in modules and the default template. |
| `packages/app` | The Svelte single-page app. |
| `packages/cli` | The node command-line tool. |
| `examples` | Example data, a template and a drop-in module. |

## Concepts

**Document.** One JSON format describes an analysis: the data, the partitions, the model instances in use and their options, any overrides of priors and operators, and the MCMC settings. See `packages/core/src/document.ts`. A project file is a document with its sequence data included.

**Partition.** A set of alignment columns with a substitution model, an optional rate heterogeneity model and a clock. Partitions that point at the same model instance share its parameters. When there is more than one model of a kind, each one's XML ids are prefixed with the names of its partitions (`CP1+2.kappa`).

**Template.** A document without data. Settings it gives a value for are fixed, settings it omits take the module's default, and settings listed under `template.ask` are the ones to ask for when the template is applied to a dataset.

**Taxa.** Taxon labels may hold metadata in delimited fields, usually separated by `|`. One field, normally the first, is the key that links a taxon across files. The taxa of an analysis are the union of the keys in all files; a partition that lacks a taxon is written as missing data.

**Taxon set.** A named subset of the taxa, kept in the document so that any model can refer to it. Its name is its XML id. Sets marked as clades are enforced with a monophyly constraint, and the starting tree is built to satisfy them; two such sets must be nested or disjoint.

**Timeline.** A named division of time into epochs, kept in the document so that several models can share it. Whatever way it is given, it resolves to transition times in years before the most recent sample, which is what BEAST's models take. Epoch 1 is the most recent and the last epoch has no end. See `packages/core/src/timeline.ts`.

**Module.** One model or feature: a substitution model, a clock, a tree prior. A module declares its options, the parameters it introduces with their default priors, the operators on them, and the XML it contributes. The pipeline assembles the contributions in BEAST's block order and writes the priors, operator schedule and logs from what the modules declared.

## Writing a module

A module is a plain object. Built-in modules are files named `*.module.ts` under `packages/modules/src/<slot>/` and are discovered at build time; nothing else needs editing. `packages/modules/src/substitution/hky.module.ts` is a good one to copy.

```ts
import { defineModule } from '@beautique/core';

export default defineModule({
  apiVersion: 1,
  id: 'siteHeterogeneity.gamma',
  slot: 'siteHeterogeneity',
  label: 'Gamma',
  options: {
    categories: { type: 'integer', label: 'Number of rate categories', default: 4, min: 2, max: 32 },
  },
  parameters: () => [
    { name: 'alpha', value: 0.5, lower: 0, prior: { type: 'exponential', mean: 0.5 } },
  ],
  operators: (ctx) => [
    { key: 'alpha.scale', element: 'scaleOperator', tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 1, children: [ctx.paramRef('alpha')] },
  ],
  generate: (ctx) => ({
    siteModel: [ctx.xml.el('gammaShape', { gammaCategories: ctx.options.categories }, [ctx.param('alpha')])],
  }),
});
```

- `options` is a schema. The app builds the form from it and the same validation runs in the app and the CLI. Field types so far: `text`, `integer`, `real`, `boolean`, `choice`, each with bounds or patterns, and `taxonSetRef` and `timelineRef`, which let the user choose from the taxon sets and timelines of the analysis. Any field can have a `visibleWhen` condition.
- `parameters` and `operators` are declarations, not XML: the pipeline writes the priors, the operator schedule and the log columns from them, and they are what the Priors and Operators steps of the app let the user change.
- `generate` returns XML element trees keyed by section. The sections and the full API are documented in `packages/core/src/module-api.ts`.
- `refs` publishes reference elements that other modules need, such as `treeModel` or `branchRates`; `ctx.ref(name)` fetches one.
- `ctx.taxonSet(id)` and `ctx.timeline(id)` turn the value of a reference option into the set's XML id and size, or the timeline's transition times and epoch labels. `packages/modules/src/clock/local-clade.module.ts` and `epoch.module.ts` show both.
- `facts` publishes plain values for other modules, and `ctx.fact(name)` reads one. The birth-death tree priors use it to ask the starting tree for a root below their time of origin.

A module that uses only its `ctx` needs no imports, so it can be shipped as a single JavaScript file and loaded without rebuilding BEAUtique. `examples/modules/jc69.module.js` is an example:

```
node packages/cli/dist/beautique.js generate \
    --module examples/modules/jc69.module.js \
    --template examples/templates/jc69-strict-constant.json \
    --data examples/data/YFV.fasta
```

Loading such files in the app is planned; today it works in the CLI.

## Testing

```
npm test                      # unit and golden-file tests (Vitest)
npm run typecheck
npm run e2e                   # browser test (Playwright); PW_CHANNEL=chrome uses an installed Chrome
npm run beast -- out/YFV.xml  # run a generated file in a local BEAST build ($BEAST_HOME or ../BEAST)
npm run check:beast           # generate every model combination in scripts/check-beast.mjs and run each in BEAST
```

When a change to the XML output is intended, update the golden files with `npx vitest run -u` and review the diff.
