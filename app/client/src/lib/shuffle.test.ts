import { describe, expect, test } from 'vitest';
import { shuffle } from './shuffle';

describe('shuffle', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];

  test('is deterministic for a seed and keeps every item', () => {
    expect(shuffle(items, 7)).toEqual(shuffle(items, 7));
    expect([...shuffle(items, 7)].sort()).toEqual(items);
  });

  test('different seeds can give different orders and input is not mutated', () => {
    const orders = new Set([1, 2, 3, 4, 5].map((s) => shuffle(items, s).join('')));
    expect(orders.size).toBeGreaterThan(1);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
