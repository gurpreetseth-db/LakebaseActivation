import { describe, expect, test } from 'vitest';
import { loadFit } from './loader.js';
import { evaluateFit } from './fit.js';

const fit = loadFit();
const best = Object.fromEntries(fit.questions.map((q) => [q.id, q.options.find((o) => o.flag === 'green')!.key]));

describe('fit-checker', () => {
  test('all-green answers are a good fit', () => {
    expect(evaluateFit(fit, best).verdict).toBe('good');
  });

  test('any red answer is a blocker', () => {
    const q = fit.questions.find((x) => x.options.some((o) => o.flag === 'red'))!;
    const red = q.options.find((o) => o.flag === 'red')!;
    const r = evaluateFit(fit, { ...best, [q.id]: red.key });
    expect(r.verdict).toBe('notYet');
    expect(r.counts.red).toBe(1);
  });

  test('enough yellow answers means proceed with care', () => {
    const answers = { ...best };
    let yellows = 0;
    for (const q of fit.questions) {
      const y = q.options.find((o) => o.flag === 'yellow');
      if (y && yellows < fit.verdicts.caution.yellowThreshold) {
        answers[q.id] = y.key;
        yellows += 1;
      }
    }
    expect(evaluateFit(fit, answers).verdict).toBe('caution');
  });

  test('rejects an incomplete answer set', () => {
    expect(() => evaluateFit(fit, {})).toThrow();
  });
});
