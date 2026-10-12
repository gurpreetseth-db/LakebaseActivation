import { describe, expect, test } from 'vitest';
import { loadConfig, loadQuestions } from '../content/loader.js';
import { csvCell, isAdmin, leaderboard, summarize, toCsv, type PartnerRecord, type ProgressRecord } from './admin.js';
import { certificateEligibility, displayName, levelLabel, overallScore } from './scoring.js';

const config = loadConfig();
const questions = loadQuestions();
const allModules = (score: number) => Object.fromEntries(config.modules.map((m) => [m.key, score]));

const partner = (email: string, over: Partial<PartnerRecord> = {}): PartnerRecord => ({
  email,
  name: 'Jordan Rivera',
  org: 'Acme',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-02T00:00:00.000Z',
  leaderboardOptIn: false,
  ...over,
});
const prog = (email: string, moduleKey: string, score: number, answers: Record<string, string> = {}): ProgressRecord => ({
  email,
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

  test('certificate needs every module and the pass threshold', () => {
    expect(certificateEligibility(config, allModules(100)).eligible).toBe(true);
    const partial = { [config.modules[0].key]: 100 };
    const r = certificateEligibility(config, partial);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/remaining modules/);
    const low = certificateEligibility(config, allModules(config.scoring.passThreshold - 10));
    expect(low.eligible).toBe(false);
    expect(low.reasons.join(' ')).toMatch(/pass threshold/);
  });

  test('display names hide the surname', () => {
    expect(displayName('Jordan Rivera')).toBe('Jordan R.');
    expect(displayName('  Cher ')).toBe('Cher');
    expect(displayName('Ana Maria de la Cruz')).toBe('Ana C.');
    expect(displayName('   ')).toBe('Partner');
  });
});

describe('admin', () => {
  test('admin check is case-insensitive and rejects missing identity', () => {
    expect(isAdmin('Boss@Example.com', ['boss@example.com'])).toBe(true);
    expect(isAdmin(undefined, ['boss@example.com'])).toBe(false);
    expect(isAdmin('other@example.com', ['boss@example.com'])).toBe(false);
    expect(isAdmin('boss@example.com', [])).toBe(false);
  });

  test('summary aggregates modules, hardest questions and certification', () => {
    const q = questions[0];
    const wrong = q.choices.find((c) => c.key !== q.correctAnswer)!.key;
    const progress = [
      ...config.modules.map((m) => prog('a@x.co', m.key, 100, m.key === q.moduleKey ? { [q.id]: q.correctAnswer } : {})),
      prog('b@x.co', q.moduleKey, 20, { [q.id]: wrong }),
    ];
    const s = summarize({
      config,
      questions,
      partners: [partner('a@x.co', { name: 'Ann A' }), partner('b@x.co', { name: 'Bob B', org: 'Other' }), partner('c@x.co')],
      progress,
    });
    expect(s.totals).toMatchObject({ partners: 3, organizations: 2, active: 2, certified: 1 });
    const mod = s.modules.find((m) => m.key === q.moduleKey)!;
    expect(mod.learners).toBe(2);
    expect(mod.avgScore).toBe(60);
    expect(s.hardestQuestions[0]).toMatchObject({ id: q.id, asked: 2, accuracy: 50 });
    expect(s.partners[0].email).toBe('a@x.co');
  });

  test('modules nobody has taken report no average instead of zero', () => {
    const s = summarize({ config, questions, partners: [partner('a@x.co')], progress: [] });
    expect(s.modules.every((m) => m.learners === 0 && m.avgScore === null && m.passRate === null)).toBe(true);
    expect(s.totals).toMatchObject({ partners: 1, active: 0, avgOverall: 0, certified: 0 });
    expect(s.hardestQuestions).toEqual([]);
  });
});

describe('leaderboard', () => {
  test('only opted-in partners with progress appear, ranked by score', () => {
    const m = config.modules[0].key;
    const board = leaderboard(
      config,
      [partner('a@x.co', { leaderboardOptIn: true, name: 'Zed Z' }), partner('b@x.co', { leaderboardOptIn: true, name: 'Amy A' }), partner('c@x.co'), partner('d@x.co', { leaderboardOptIn: true })],
      [prog('a@x.co', m, 90), prog('b@x.co', m, 40), prog('c@x.co', m, 100)],
    );
    expect(board.map((e) => e.email)).toEqual(['a@x.co', 'b@x.co']);
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
