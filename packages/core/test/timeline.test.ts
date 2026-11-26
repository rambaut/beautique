import { describe, expect, it } from 'vitest';
import {
  coerceValue,
  nameProblem,
  nestTaxonSets,
  newTaxonSet,
  newTimeline,
  resolveOptions,
  resolveTimeline,
  validateField,
  type FieldSchema,
  type SchemaRefs,
  type Timeline,
} from '../src/index';

const base = { id: 't1', name: 'eras' };

describe('resolveTimeline', () => {
  it('counts equal epochs back from the most recent sample', () => {
    const timeline: Timeline = { ...base, kind: 'regular', epochCount: 4, duration: 6, units: 'months' };
    const { timeline: resolved, problems } = resolveTimeline(timeline, 2020.5);
    expect(problems).toEqual([]);
    expect(resolved?.heights).toEqual([0.5, 1, 1.5]);
    expect(resolved?.epochs).toEqual(['after 2020', '2019.5 to 2020', '2019 to 2019.5', 'before 2019']);
  });

  it('converts days and weeks to years', () => {
    const weekly = resolveTimeline({ ...base, kind: 'regular', epochCount: 3, duration: 2, units: 'weeks' }, undefined);
    expect(weekly.timeline?.heights).toEqual([14 / 365.25, 28 / 365.25].map((h) => Number(h.toPrecision(12))));
    expect(weekly.timeline?.epochs[0]).toMatch(/^after 0\.038\d+ years ago$/);
  });

  it('places dates before the most recent sample, in any order', () => {
    const timeline: Timeline = { ...base, kind: 'dates', dates: ['2019-07-02', ' 2020-01-01 ', '2018.25'] };
    const { timeline: resolved } = resolveTimeline(timeline, 2020.5);
    expect(resolved?.heights[0]).toBe(0.5);
    expect(resolved?.heights[2]).toBe(2.25);
    expect(resolved?.transitions).toEqual(['2020-01-01', '2019-07-02', '2018.25']);
    expect(resolved?.epochs).toEqual([
      'after 2020-01-01',
      '2019-07-02 to 2020-01-01',
      '2018.25 to 2019-07-02',
      'before 2018.25',
    ]);
  });

  it('takes transition times as given', () => {
    const { timeline: resolved } = resolveTimeline({ ...base, kind: 'heights', heights: [3, 1] }, undefined);
    expect(resolved?.heights).toEqual([1, 3]);
    expect(resolved?.epochs).toHaveLength(3);
  });

  it('explains what is wrong', () => {
    const problems = (timeline: Timeline, mostRecent?: number): string[] => resolveTimeline(timeline, mostRecent).problems;
    expect(problems({ ...base, kind: 'regular', epochCount: 1, duration: 0 })).toEqual([
      'the number of epochs must be a whole number, 2 or more',
      'the duration of an epoch must be greater than 0',
    ]);
    expect(problems({ ...base, kind: 'dates', dates: ['2020-01-01'] })).toEqual([
      'transitions given as dates need the tips to be dated',
    ]);
    expect(problems({ ...base, kind: 'dates', dates: [] }, 2020)).toEqual(['add at least one transition date']);
    expect(problems({ ...base, kind: 'dates', dates: ['2021-01-01', 'soon', '2019-06'] }, 2020)).toEqual([
      '2021-01-01 is not before the most recent sample',
      '"soon" is not a date (use yyyy-MM-dd or a decimal year)',
      '"2019-06" is not a date (use yyyy-MM-dd or a decimal year)',
    ]);
    expect(problems({ ...base, kind: 'heights', heights: [1, 1] })).toEqual(['two transitions are at the same time']);
    expect(problems({ ...base, kind: 'heights', heights: [-1] })).toEqual(['transition times must be greater than 0']);
  });

  it('makes new timelines with unused names', () => {
    const first = newTimeline([]);
    const second = newTimeline([first], 'heights');
    expect([first.name, second.name, second.kind]).toEqual(['timeline1', 'timeline2', 'heights']);
    expect(resolveTimeline(first, 2020).problems).toEqual([]);
  });
});

describe('taxon sets', () => {
  it('checks names', () => {
    expect(nameProblem('clade A', [])).toMatch(/spaces/);
    expect(nameProblem('', [])).toBe('needs a name');
    expect(nameProblem('taxa', [])).toMatch(/cannot be called/);
    expect(nameProblem('B.1.1.7', ['B.1.1.7'])).toMatch(/same name/);
    expect(nameProblem('B.1.1.7', ['B.1'])).toBeNull();
    expect(newTaxonSet([newTaxonSet([])]).name).toBe('set2');
  });

  it('nests clades and finds the ones that cannot both be clades', () => {
    const nesting = nestTaxonSets([
      { id: 'all', taxa: ['a', 'b', 'c', 'd', 'e'] },
      { id: 'abc', taxa: ['a', 'b', 'c'] },
      { id: 'ab', taxa: ['a', 'b'] },
      { id: 'de', taxa: ['d', 'e'] },
    ]);
    expect(nesting.conflicts).toEqual([]);
    expect(Object.fromEntries(nesting.parent)).toEqual({ all: null, abc: 'all', ab: 'abc', de: 'all' });

    const clash = nestTaxonSets([
      { id: 'ab', taxa: ['a', 'b'] },
      { id: 'bc', taxa: ['b', 'c'] },
      { id: 'ba', taxa: ['b', 'a'] },
    ]);
    expect(clash.conflicts).toEqual([
      ['ab', 'bc'],
      ['ab', 'ba'],
      ['bc', 'ba'],
    ]);
  });
});

describe('reference fields', () => {
  const refs: SchemaRefs = {
    taxonSets: [
      { id: 's1', name: 'Guinea' },
      { id: 's2', name: 'Liberia' },
    ],
    timelines: [{ id: 't1', name: 'eras' }],
  };
  const many: FieldSchema = { type: 'taxonSetRef', label: 'Clades', multiple: true, required: true };
  const one: FieldSchema = { type: 'taxonSetRef', label: 'Clade' };
  const timeline: FieldSchema = { type: 'timelineRef', label: 'Timeline', required: true };

  it('default to nothing chosen', () => {
    expect(resolveOptions({ many, one, timeline }, {})).toEqual({ many: [], one: null, timeline: null });
  });

  it('are validated against the sets and timelines that exist', () => {
    expect(validateField(many, [], refs)).toBe('needs at least one taxon set');
    expect(validateField(many, ['s1', 's2'], refs)).toBeNull();
    expect(validateField(many, ['s1', 'gone'], refs)).toBe('refers to a taxon set that no longer exists');
    expect(validateField(many, 's1', refs)).toBe('must refer to taxon sets');
    expect(validateField(one, null, refs)).toBeNull();
    expect(validateField(one, 's2', refs)).toBeNull();
    expect(validateField(timeline, null, refs)).toBe('needs a timeline');
    expect(validateField(timeline, 't9', refs)).toBe('refers to a timeline that no longer exists');
    expect(validateField(timeline, 't9')).toBeNull();
  });

  it('accept names or ids from the command line', () => {
    expect(coerceValue(many, 'Guinea, s2', refs)).toEqual(['s1', 's2']);
    expect(coerceValue(many, '', refs)).toEqual([]);
    expect(coerceValue(one, 'Liberia', refs)).toBe('s2');
    expect(coerceValue(timeline, 'eras', refs)).toBe('t1');
    expect(coerceValue(timeline, ' ', refs)).toBeNull();
  });
});
