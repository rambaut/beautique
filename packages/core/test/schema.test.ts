import { describe, expect, it } from 'vitest';
import { coerceValue, resolveOptions, validateOptions, type OptionsSchema } from '../src/schema';

const schema: OptionsSchema = {
  mode: {
    type: 'choice',
    label: 'Mode',
    default: 'auto',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'fixed', label: 'Fixed' },
    ],
  },
  rate: { type: 'real', label: 'Rate', default: 1, min: 0, exclusiveMin: true, visibleWhen: { field: 'mode', equals: 'fixed' } },
  count: { type: 'integer', label: 'Count', default: 4, min: 2, max: 32 },
  name: { type: 'text', label: 'Name', required: true, pattern: '[a-z]+' },
  on: { type: 'boolean', label: 'On' },
};

describe('schema', () => {
  it('fills in defaults and drops unknown keys', () => {
    expect(resolveOptions(schema, { count: 8, bogus: 1 })).toEqual({
      mode: 'auto',
      rate: 1,
      count: 8,
      name: '',
      on: false,
    });
  });

  it('validates bounds, types, patterns and choices', () => {
    const issues = validateOptions(schema, { mode: 'nope', rate: 0, count: 2.5, name: 'ABC', on: 'yes' });
    expect(issues.map((i) => i.field)).toEqual(['mode', 'count', 'name', 'on']);
    expect(validateOptions(schema, { mode: 'auto', rate: 1, count: 33, name: '', on: true }).map((i) => i.message)).toEqual([
      'Count must be at most 32',
      'Name is required',
    ]);
  });

  it('validates a field only while it is visible', () => {
    const values = { mode: 'fixed', rate: 0, count: 4, name: 'abc', on: true };
    expect(validateOptions(schema, values)).toEqual([{ field: 'rate', message: 'Rate must be greater than 0' }]);
    expect(validateOptions(schema, { ...values, mode: 'auto' })).toEqual([]);
  });

  it('coerces strings to the field type', () => {
    expect(coerceValue(schema.count, '12')).toBe(12);
    expect(coerceValue(schema.rate, '1e-3')).toBe(0.001);
    expect(coerceValue(schema.on, 'yes')).toBe(true);
    expect(Number.isNaN(coerceValue(schema.count, ''))).toBe(true);
  });
});
