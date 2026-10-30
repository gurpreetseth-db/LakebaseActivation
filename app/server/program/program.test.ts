import { describe, expect, test } from 'vitest';
import { loadConfig, loadQuestions } from '../content/loader.js';
import { csvCell, isAdmin, leaderboard, summarize, toCsv, type LearnerRecord, type ProgressRecord } from './admin.js';
import { levelLabel, overallScore } from './scoring.js';

const config = loadConfig();
const questions = loadQuestions();
const allModules = (score: number) => Object.fromEntries(config.modules.map((m) => [m.key, score]));

const learner = (id: string, over: Partial<LearnerRecord> = {}): LearnerRecord => ({
  id,
  org: 'Acme',
  nickname: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-02T00:00:00.000Z',
  leaderboardOptIn: false,
  ...over,
});
const prog = (learnerId: string, moduleKey: string, score: number, answers: Record<string, string> = {}): ProgressRecord => ({
  learnerId,
  moduleKey,
  score,
  attempts: 1,
  answers,
});

describe('scoring', () => {
  test('weighted overall counts unattempted modules as zero', () => {
    expect(overallScore(config, allModules(100))).toBe(100);
    expect(overallScore(config, {})).toBe(0);
    const first = config.modules[0];
    expect(overallScore(config, { [first.key]: 100 })).toBe(Math.round(first.weight));
  });

  test('level labels follow the configured bands', () => {
    expect(levelLabel(config, 0)).toBe(config.scoring.maturityLevels[0].label);
    expect(levelLabel(config, 100)).toBe(config.scoring.maturityLevels[config.scoring.maturityLevels.length - 1].label);
  });
});

describe('admin', () => {
  test('admin check is case-insensitive and rejects missing identity', () => {
    expect(isAdmin('Boss@Example.com', ['boss@example.com'])).toBe(true);
    expect(isAdmin(undefined, ['boss@example.com'])).toBe(false);
    expect(isAdmin('other@example.com', ['boss@example.com'])).toBe(false);
    expect(isAdmin('boss@example.com', [])).toBe(false);
  });

  test('summary aggregates modules, hardest questions and progress by company', () => {
    const q = questions[0];
    const wrong = q.choices.find((c) => c.key !== q.correctAnswer)!.key;
    const progress = [
      ...config.modules.map((m) => prog('a', m.key, 100, m.key === q.moduleKey ? { [q.id]: q.correctAnswer } : {})),
      prog('b', q.moduleKey, 20, { [q.id]: wrong }),
    ];
    const s = summarize({
      config,
      questions,
      learners: [learner('a'), learner('b', { org: 'Other' }), learner('c'), learner('d', { org: ' acme ' })],
      progress,
    });
    expect(s.totals).toMatchObject({ learners: 4, organizations: 2, active: 2, completed: 1 });
    const mod = s.modules.find((m) => m.key === q.moduleKey)!;
    expect(mod.learners).toBe(2);
    expect(mod.avgScore).toBe(60);
    expect(s.hardestQuestions[0]).toMatchObject({ id: q.id, asked: 2, accuracy: 50 });
    // Companies are matched case/space-insensitively; the finisher's company ranks first.
    expect(s.organizations[0]).toMatchObject({ org: 'Acme', learners: 3, started: 1, completed: 1, avgOverall: 100 });
    expect(s.organizations[1]).toMatchObject({ org: 'Other', learners: 1, started: 1, completed: 0 });
    expect(JSON.stringify(s)).not.toMatch(/"id":"a"/);
  });

  test('modules nobody has taken report no average instead of zero', () => {
    const s = summarize({ config, questions, learners: [learner('a')], progress: [] });
    expect(s.modules.every((m) => m.learners === 0 && m.avgScore === null && m.passRate === null)).toBe(true);
    expect(s.totals).toMatchObject({ learners: 1, active: 0, avgOverall: 0, completed: 0 });
    expect(s.hardestQuestions).toEqual([]);
  });
});

describe('leaderboard', () => {
  test('only opted-in learners with progress appear, ranked by score, under a nickname', () => {
    const m = config.modules[0].key;
    const board = leaderboard(
      config,
      [
        learner('a', { leaderboardOptIn: true, nickname: 'Zed' }),
        learner('b', { leaderboardOptIn: true, nickname: 'Amy' }),
        learner('c'),
        learner('d', { leaderboardOptIn: true }),
        learner('e', { leaderboardOptIn: true, nickname: '  ' }),
      ],
      [prog('a', m, 90), prog('b', m, 40), prog('c', m, 100), prog('e', m, 10)],
    );
    expect(board.map((e) => e.name)).toEqual(['Zed', 'Amy', 'Anonymous learner']);
  });
});

describe('csv', () => {
  test('quotes special characters and neutralises formula injection', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(true)).toBe('true');
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\n1,"x,y"\n');
  });
});
