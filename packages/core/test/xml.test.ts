import { describe, expect, it } from 'vitest';
import { comment, el, ref, serialize } from '../src/xml';

describe('xml', () => {
  it('serializes nested elements, references, comments and text', () => {
    const tree = el('a', { id: 'x', n: 1.5, flag: false, skipped: undefined }, [
      comment('note'),
      ref('b', 'y'),
      el('c', {}, ['ACGT']),
      null,
      [el('d')],
    ]);
    expect(serialize(tree)).toBe(
      ['<a id="x" n="1.5" flag="false">', '\t<!-- note -->', '\t<b idref="y"/>', '\t<c>', '\t\tACGT', '\t</c>', '\t<d/>', '</a>'].join('\n'),
    );
  });

  it('escapes attribute values and text', () => {
    expect(serialize(el('t', { id: 'A&B|"x"<1>' }, ['a<b&c']))).toBe(
      '<t id="A&amp;B|&quot;x&quot;&lt;1&gt;">\n\ta&lt;b&amp;c\n</t>',
    );
  });

  it('keeps comments well formed', () => {
    expect(serialize(comment('a -- b'))).toBe('<!-- a - - b -->');
  });
});
