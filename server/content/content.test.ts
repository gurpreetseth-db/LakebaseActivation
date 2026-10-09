import { describe, expect, test } from 'vitest';
import { loadConfig, loadModules, loadQuestions } from './loader.js';

// These tests validate the externally-editable content files so a bad edit to
// config/app.config.json or config/content/*.json fails CI instead of the UI.

describe('content files', () => {
  test('config loads and module weights sum to 100', () => {
    const config = loadConfig();
    expect(config.modules.length).toBeGreaterThan(0);
    const totalWeight = config.modules.reduce((sum, m) => sum + m.weight, 0);
    expect(totalWeight).toBe(100);
  });

  test('every module has learning content and a lab', () => {
    const config = loadConfig();
    const modules = loadModules();
    for (const meta of config.modules) {
      const content = modules.modules[meta.key];
      expect(content, `missing content for module ${meta.key}`).toBeDefined();
      expect(content.overview.length).toBeGreaterThan(0);
      expect(content.objectives.length).toBeGreaterThan(0);
      expect(content.lab.steps.length).toBeGreaterThan(0);
    }
  });

  test('every question is well-formed and its answer is a valid choice', () => {
    const questions = loadQuestions();
    const config = loadConfig();
    const moduleKeys = new Set(config.modules.map((m) => m.key));
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(moduleKeys.has(q.moduleKey), `question ${q.id} has unknown module ${q.moduleKey}`).toBe(true);
      expect(q.choices.length).toBeGreaterThanOrEqual(2);
      const choiceKeys = q.choices.map((c) => c.key);
      expect(choiceKeys, `question ${q.id} answer not in choices`).toContain(q.correctAnswer);
      expect(q.explanation.length).toBeGreaterThan(0);
    }
  });

  test('question ids are unique', () => {
    const ids = loadQuestions().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every module has at least one question', () => {
    const questions = loadQuestions();
    for (const meta of loadConfig().modules) {
      const count = questions.filter((q) => q.moduleKey === meta.key).length;
      expect(count, `module ${meta.key} has no questions`).toBeGreaterThan(0);
    }
  });
});
