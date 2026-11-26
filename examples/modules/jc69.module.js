/**
 * Example of a drop-in module: the Jukes-Cantor (JC69) substitution model.
 *
 * A module is a plain object. Everything it needs arrives through `ctx`, so
 * this file has no imports and can be loaded into BEAUtique as it is:
 *
 *   beautique generate --module examples/modules/jc69.module.js \
 *       --template examples/templates/jc69-strict-constant.json \
 *       --data examples/data/YFV.fasta
 *
 * BEAST X has no separate JC element; JC69 is HKY with kappa fixed at 1 and
 * equal base frequencies, so there are no parameters, priors or operators.
 */
export default {
  apiVersion: 1,
  id: 'substitution.jc69',
  slot: 'substitution',
  label: 'JC69',
  description: 'All substitutions are equally likely and base frequencies are equal.',
  citation: 'Jukes & Cantor (1969) Evolution of protein molecules',

  // A reference other parts of the XML use to point at this model.
  refs: (ctx) => ({ substitutionModel: ctx.xml.ref('HKYModel', ctx.id('jc69')) }),

  generate: (ctx) => {
    const { el, comment } = ctx.xml;
    return {
      substitutionModel: [
        comment('The JC69 substitution model, written as HKY with kappa = 1'),
        el('HKYModel', { id: ctx.id('jc69') }, [
          el('frequencies', {}, [
            el('frequencyModel', { dataType: 'nucleotide' }, [
              el('frequencies', {}, [el('parameter', { id: ctx.id('jc69.frequencies'), value: '0.25 0.25 0.25 0.25' })]),
            ]),
          ]),
          el('kappa', {}, [el('parameter', { id: ctx.id('jc69.kappa'), value: 1 })]),
        ]),
      ],
    };
  },
};
