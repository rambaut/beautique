# Writing a module

A module adds one model to BEAUtique: a substitution model, a clock, a tree prior, a trait model. This guide builds one from nothing, the TN93 substitution model, and then covers the parts of the API that the example does not need. The finished file is `examples/modules/tn93.module.js`.

You need to know the BEAST XML for your model. BEAUtique takes care of everything around it: the form in the app, validation, priors, the operator schedule, the logs, partition prefixes on ids, templates and the command line.

## How a module fits in

A module is a plain JavaScript object. It does not write a file; it *declares* things and the pipeline assembles them:

| The module declares | BEAUtique does |
|---|---|
| `options`: the settings a user can change | Builds the form, validates values, exposes each setting as `models.<instance>.<option>` for `--set` and templates |
| `parameters`: names, starting values, bounds, default priors | Writes the `<prior>` block and the log columns; lists them in the Priors step, where the user can change them |
| `operators`: the moves on those parameters | Writes the `<operators>` block; lists them in the Operators step |
| `generate`: XML elements for named sections | Places each section in BEAST's block order |
| `refs`: elements other modules need to point at this one | Hands them to the modules that ask with `ctx.ref(name)` |

Every function receives a context, `ctx`, with the option values and the helpers it needs. Because nothing is imported, a module can be a single `.js` file that is loaded without rebuilding BEAUtique.

## Step 1: the smallest module that works

A module needs an API version, an id, the slot it fills, a label, and a `generate` function. A substitution model must also publish a `substitutionModel` reference, which is how the site model finds it.

```js
export default {
  apiVersion: 1,
  id: 'substitution.tn93',
  slot: 'substitution',
  label: 'TN93',
  description: 'Separate rates for the two kinds of transition (A-G and C-T) relative to transversions.',
  citation: 'Tamura & Nei (1993) Mol Biol Evol 10:512-526',

  refs: (ctx) => ({ substitutionModel: ctx.xml.ref('TN93Model', ctx.id('tn93')) }),

  generate: (ctx) => {
    const { el } = ctx.xml;
    return {
      substitutionModel: [
        el('TN93Model', { id: ctx.id('tn93') }, [
          el('frequencies', {}, [
            el('frequencyModel', { dataType: 'nucleotide' }, [
              el('frequencies', {}, [el('parameter', { id: ctx.id('frequencies'), value: '0.25 0.25 0.25 0.25' })]),
            ]),
          ]),
          el('kappa1', {}, [el('parameter', { id: ctx.id('kappa1'), value: 2, lower: 0 })]),
          el('kappa2', {}, [el('parameter', { id: ctx.id('kappa2'), value: 2, lower: 0 })]),
        ]),
      ],
    };
  },
};
```

Three things to notice:

- **`ctx.xml.el(name, attributes, children)`** builds an element. There is no string templating: the pipeline indents and escapes. `ctx.xml.ref(name, id)` builds `<name idref="id"/>` and `ctx.xml.comment(text)` a comment.
- **`ctx.id('tn93')`** makes an XML id. With one substitution model it is `tn93`; when the alignment is split by codon position and there are two, it becomes `CP1+2.tn93` and `CP3.tn93`. Always make ids this way, and never write a bare id.
- **`substitutionModel`** is the name of a section. The sections, in output order, are listed in `packages/core/src/module-api.ts`.

Try it:

```
node packages/cli/dist/beautique.js generate --module tn93.module.js \
    --data examples/data/YFV.fasta --set models.substitution.module=substitution.tn93
```

This already runs in BEAST, but nothing is estimated: the parameters have no priors and no operators, so they stay at their starting values.

## Step 2: parameters

Declare the parameters and let the pipeline write them. A parameter with a `prior` is estimated; the prior you give is the default, and the user can change it.

```js
  parameters: (ctx) => [
    {
      name: 'kappa1',
      description: 'TN93 A-G transition rate relative to transversions',
      value: 2,
      lower: 0,
      prior: { type: 'logNormal', mu: 1, sigma: 1.25 },
    },
    {
      name: 'kappa2',
      description: 'TN93 C-T transition rate relative to transversions',
      value: 2,
      lower: 0,
      prior: { type: 'logNormal', mu: 1, sigma: 1.25 },
    },
    {
      name: 'frequencies',
      description: 'Base frequencies',
      value: [0.25, 0.25, 0.25, 0.25],
      prior: { type: 'dirichlet', alpha: 1, sumsTo: 1 },
    },
  ],
```

In `generate`, replace each hand-written `<parameter>` with `ctx.param(name)`, which writes the defining element with the id, value and bounds from the declaration:

```js
          el('kappa1', {}, [ctx.param('kappa1')]),
          el('kappa2', {}, [ctx.param('kappa2')]),
```

Use `ctx.param` exactly once for each parameter, where it is defined, and `ctx.paramRef(name)` everywhere else. The priors now appear in the `<prior>` block and the Priors step, and the parameters are logged. The prior types are `logNormal`, `normal`, `gamma`, `exponential`, `laplace`, `uniform`, `dirichlet`, `ctmcScale` and `oneOnX`; see `PriorSpec` in `module-api.ts` for what each takes.

## Step 3: operators

An operator declaration names the BEAST element, its weight, its tuning attribute if it has one, and its children. `key` identifies it within the module, so that the user's changes to its weight or tuning are remembered.

```js
  operators: (ctx) => [
    ...['kappa1', 'kappa2'].map((name) => ({
      key: `${name}.scale`,
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 1,
      children: [ctx.paramRef(name)],
    })),
    {
      key: 'frequencies.deltaExchange',
      element: 'deltaExchange',
      tuning: { name: 'delta', value: 0.01 },
      weight: 1,
      children: [ctx.paramRef('frequencies')],
    },
  ],
```

The module now does what a built-in one does.

## Step 4: options

Options are the settings shown to the user. Each is a field with a type, a label and a default; the app draws the control and the same validation runs in the app and on the command line.

```js
  options: {
    frequencies: {
      type: 'choice',
      label: 'Base frequencies',
      default: 'estimated',
      choices: [
        { value: 'estimated', label: 'Estimated' },
        { value: 'equal', label: 'All equal (fixed)' },
      ],
    },
    linkKappas: { type: 'boolean', label: 'Start both transition rates at the same value', default: true },
    kappa2: {
      type: 'real',
      label: 'Initial C-T transition rate',
      default: 2,
      min: 0,
      exclusiveMin: true,
      visibleWhen: { field: 'linkKappas', equals: false },
    },
  },
```

`ctx.options` holds the values with defaults filled in, and `parameters`, `operators` and `generate` can all depend on them. Here the frequencies lose their prior and their operator when they are fixed:

```js
    const estimated = ctx.options.frequencies === 'estimated';
    ...
      {
        name: 'frequencies',
        value: [0.25, 0.25, 0.25, 0.25],
        prior: estimated ? { type: 'dirichlet', alpha: 1, sumsTo: 1 } : undefined,
        log: estimated,
      },
```

A parameter without a prior is a fixed value. `visibleWhen` hides a field, and skips its validation, until another field has a given value.

| Field type | Value | Constraints |
|---|---|---|
| `text` | string | `required`, `pattern`, `minLength`, `maxLength` |
| `integer`, `real` | number | `min`, `max`, `step`, `units`; `optional` allows it to be left empty; `real` also has `exclusiveMin` and `exclusiveMax` |
| `boolean` | true or false | |
| `choice` | one of `choices` | |
| `taxonSetRef` | the id of a taxon set, or with `multiple` an array of ids | `required` |
| `timelineRef` | the id of a timeline | `required` |

For a reference field, `ctx.taxonSet(value)` gives the set's XML id and size, and `ctx.timeline(value)` the transition times and epoch labels. `packages/modules/src/clock/local-clade.module.ts` and `epoch.module.ts` show both.

## Step 5: use it

On the command line, `--module file.js` loads a module file, and can be repeated. In the app, the Template step has a **Load module files** button. Either way the module then appears wherever the built-in ones do, its settings can be put in a template's list of settings to ask for, and a template or project can name it:

```
node packages/cli/dist/beautique.js generate --module examples/modules/tn93.module.js \
    --data examples/data/YFV.fasta --set models.substitution.module=substitution.tn93 \
    --set models.substitution.frequencies=equal
node packages/cli/dist/beautique.js describe --module examples/modules/tn93.module.js \
    --set models.substitution.module=substitution.tn93      # its settings and their paths
npm run beast -- YFV.xml       # run it in a local BEAST build
```

A module file runs as a program, with whatever the app or the command line can do. BEAUtique loads one only when the user asks it to, and users should load only files they trust. A project or template that uses a module does not contain it: load the module file first, then open the project.

A file can hold several modules by exporting an array of them as its default.

To make a module built-in instead, save it as `packages/modules/src/<slot>/<name>.module.ts` and wrap the object in `defineModule` from `@beautique/core` for type checking. Files with that name are found at build time; nothing else needs editing. Add a case to `packages/modules/test/generate.test.ts` and to `scripts/check-beast.mjs`.

## The rest of the API

**Slots.** `substitution`, `siteHeterogeneity` and `clock` belong to partitions; `tree`, `startingTree` and `treePrior` to the tree; `trait` to one trait. The slot decides where in the app the module is offered and what `ctx.prefix` is.

**References between modules.** `refs` publishes elements under well-known names, and `ctx.ref(name)` fetches one, throwing if no module in use provides it. The names in use are `treeModel`, `allInternalNodeHeights`, `startingTree`, `branchRates` and `substitutionModel`. A clock, for example, publishes `branchRates` and asks for `treeModel`.

**Facts.** `facts` publishes plain values for other modules, read with `ctx.fact(name)`. The birth-death tree priors publish `startingRootHeight` so that the starting tree is built below their time of origin.

**Checks.** `validate(ctx)` returns issues that the option schema cannot express, each with a severity, a message and, from `ctx.optionPath(name)`, the setting it concerns, so that the app can lead the user to it. The skygrid uses it to ask for a cut-off when the tips are not dated.

**The data.** `ctx.data` has the number of taxa, whether every tip is dated, and the range of dates. Modules do not see sequences.

**Other sections.** Besides top-level blocks, a module can add to the blocks the pipeline builds: `prior` and `likelihood` (a coalescent likelihood goes in `prior`), `screenLog`, `fileLog`, `fileLogLikelihoods` and `treeLog`. A site heterogeneity module adds children to its `<siteModel>` with the `siteModel` section.

**Trait models.** A module in the `trait` slot declares the `traitType` it handles, `discrete` or `continuous`, and reads `ctx.trait` for the trait's name, dimension and states. The values are already on the taxa as `<attr name=...>`. It writes its model in the `traitModel` section, which comes after the tree likelihoods of the sequence data. `packages/modules/src/trait/` has the two built-in ones.

**Hamiltonian Monte Carlo.** A module with gradient-based operators sets `supportsHmc: true` and returns them from `operators` when `ctx.operatorStrategy` is `'hmc'`. `ctx.priorRef(name)` gives a reference to a parameter's prior for use in a gradient, whatever prior the user has chosen. A clock whose operators need gradients of the sequence likelihood publishes the fact `usePreOrder: true`. `packages/modules/src/treePrior/skygrid.module.ts` and `clock/uncorrelated.module.ts` are examples.

**Versions.** `apiVersion` is the version of this API the module was written for, currently 1. BEAUtique refuses a module written for a version it does not support, with a message that says so. `minBeast` records the earliest BEAST X version that can run the module's XML.

## Checking your module

1. `beautique describe --module file.js --set models.<instance>.module=<id>` lists the module's settings with their paths, defaults and choices. Check that the labels read well on their own.
2. Generate with the alignment split by codon position (`--codon 12+3`) and check that every id of yours carries the prefix. A bare id shows up as a duplicate.
3. Run the file in BEAST with a short chain: `npm run beast -- file.xml`.
4. Load the module in the app and change each option, watching the XML preview.
