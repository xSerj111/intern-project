import { bigintNumberTransformer } from './bigint-number.transformer';

describe('bigintNumberTransformer', () => {
  it('converts a bigint string from the database to a number', () => {
    expect(bigintNumberTransformer.from('42')).toBe(42);
  });

  it('passes a numeric value through as a number', () => {
    expect(bigintNumberTransformer.from(7)).toBe(7);
  });

  it('keeps null and undefined from the database unchanged', () => {
    expect(bigintNumberTransformer.from(null)).toBeNull();
    expect(bigintNumberTransformer.from(undefined)).toBeUndefined();
  });

  it('writes numbers, null and undefined unchanged', () => {
    expect(bigintNumberTransformer.to(5)).toBe(5);
    expect(bigintNumberTransformer.to(null)).toBeNull();
    expect(bigintNumberTransformer.to(undefined)).toBeUndefined();
  });
});
