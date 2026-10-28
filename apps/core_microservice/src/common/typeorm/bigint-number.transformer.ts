import { ValueTransformer } from 'typeorm';

// Postgres returns bigint as string; counters stay well below 2^53.
export const bigintNumberTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) =>
    value === null || value === undefined ? value : Number(value),
};
