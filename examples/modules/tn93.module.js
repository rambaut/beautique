/**
 * Worked example of a drop-in module: the TN93 substitution model.
 * docs/writing-modules.md builds this file up step by step.
 *
 *   beautique generate --module examples/modules/tn93.module.js \
 *       --data examples/data/YFV.fasta --set models.substitution.module=substitution.tn93
 *
 * Everything the module needs arrives through `ctx`, so the file has no imports
 * and can be loaded into the app or the command-line tool as it is.
 */
export default {
  apiVersion: 1,
  id: 'substitution.tn93',
  slot: 'substitution',
  label: 'TN93',
  description: 'Separate rates for the two kinds of transition (A-G and C-T) relative to transversions.',
  citation: 'Tamura & Nei (1993) Mol Biol Evol 10:512-526',

  // The settings the user can change. The app builds the form from this.
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
    linkKappas: {
      type: 'boolean',
      label: 'Start both transition rates at the same value',
      default: true,
    },
    kappa2: {
      type: 'real',
      label: 'Initial C-T transition rate',
      default: 2,
      min: 0,
      exclusiveMin: true,
      visibleWhen: { field: 'linkKappas', equals: false },
    },
  },

  // The parameters, with their starting values, bounds and default priors.
  // The pipeline writes the priors and the log columns from these.
  parameters: (ctx) => {
    const estimated = ctx.options.frequencies === 'estimated';
    return [
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
        value: ctx.options.linkKappas ? 2 : ctx.options.kappa2,
        lower: 0,
        prior: { type: 'logNormal', mu: 1, sigma: 1.25 },
      },
      {
        name: 'frequencies',
        description: 'Base frequencies',
        value: [0.25, 0.25, 0.25, 0.25],
        // a parameter with no prior is a fixed value: no prior is written, and here it is not logged either
        prior: estimated ? { type: 'dirichlet', alpha: 1, sumsTo: 1 } : undefined,
        log: estimated,
      },
    ];
  },

  // The operators that move the parameters during the MCMC.
  operators: (ctx) => [
    ...['kappa1', 'kappa2'].map((name) => ({
      key: `${name}.scale`,
      element: 'scaleOperator',
      tuning: { name: 'scaleFactor', value: 0.75 },
      weight: 1,
      children: [ctx.paramRef(name)],
    })),
    ctx.options.frequencies === 'estimated' && {
      key: 'frequencies.deltaExchange',
      element: 'deltaExchange',
      tuning: { name: 'delta', value: 0.01 },
      weight: 1,
      children: [ctx.paramRef('frequencies')],
    },
  ].filter(Boolean),

  // What the site model and tree likelihood use to refer to this model.
  refs: (ctx) => ({ substitutionModel: ctx.xml.ref('TN93Model', ctx.id('tn93')) }),

  // The XML. `ctx.param` writes the defining <parameter> element; `ctx.id` adds the
  // partition prefix (as in CP1+2.tn93) when there is more than one substitution model.
  generate: (ctx) => {
    const { el, comment } = ctx.xml;
    return {
      substitutionModel: [
        comment('The TN93 substitution model (Tamura & Nei, 1993)'),
        el('TN93Model', { id: ctx.id('tn93') }, [
          el('frequencies', {}, [
            el('frequencyModel', { dataType: 'nucleotide' }, [el('frequencies', {}, [ctx.param('frequencies')])]),
          ]),
          el('kappa1', {}, [ctx.param('kappa1')]),
          el('kappa2', {}, [ctx.param('kappa2')]),
        ]),
      ],
    };
  },
};
