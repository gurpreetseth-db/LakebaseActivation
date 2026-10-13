import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { allowedSlides, loadPublicFieldkit, parseSlideRanges, slideFile } from './fieldkit.js';
import { buildChunks } from '../knowledge/chunks.js';
import { loadConfig, loadDemo, loadFieldkitRaw, loadFit, loadKnowledge, loadModules, loadQuestions } from './loader.js';

const config = loadConfig();

describe('slide allow-list', () => {
  test('parses numbers and ranges and rejects bad input', () => {
    expect([...parseSlideRanges('4-6,9')]).toEqual([4, 5, 6, 9]);
    expect(() => parseSlideRanges('6-4')).toThrow();
    expect(() => parseSlideRanges('a')).toThrow();
  });

  test('held slides are removed from the approved ranges', () => {
    const allowed = allowedSlides(config);
    expect(allowed.has(5)).toBe(true);
    expect(allowed.has(34)).toBe(false); // outside the approved range
    for (const held of Object.keys(config.fieldkit.heldSlides)) expect(allowed.has(Number(held))).toBe(false);
  });

  test('every held slide states why it is held', () => {
    for (const [n, reason] of Object.entries(config.fieldkit.heldSlides)) {
      expect(reason.length, `slide ${n}`).toBeGreaterThan(10);
    }
  });
});

describe('Field Kit content', () => {
  const raw = loadFieldkitRaw();
  const pub = loadPublicFieldkit(config);
  const served = pub.sections.flatMap((s) => s.slides.map((x) => x.n));

  test('the content file only contains cleared slides (guards against pasting an internal slide)', () => {
    const allowed = allowedSlides(config);
    for (const s of raw.sections.flatMap((x) => x.slides)) {
      expect(allowed.has(s.n), `slide ${s.n} is in fieldkit.json but not cleared in app.config.json`).toBe(true);
    }
  });

  test('served slides are unique, ordered per section, and exactly the cleared ones in the file', () => {
    expect(new Set(served).size).toBe(served.length);
    const inFile = raw.sections.flatMap((x) => x.slides.map((y) => y.n));
    expect(served).toEqual(inFile.filter((n) => allowedSlides(config).has(n)));
  });

  test('sections have a summary, takeaways and real modules', () => {
    const modules = new Set(config.modules.map((m) => m.key));
    for (const s of pub.sections) {
      expect(s.summary.length).toBeGreaterThan(20);
      expect(s.takeaways.length).toBeGreaterThan(0);
      for (const m of s.modules) expect(modules.has(m), `${s.key} -> ${m}`).toBe(true);
    }
  });

  test('speaker notes and internal markers never reach served content', () => {
    const blob = JSON.stringify(pub);
    expect(blob).not.toContain('DATABRICKS INTERNAL ONLY');
    expect(blob).not.toMatch(/#(apa|emea)-lakebase/);
    expect(blob).not.toContain('expectTitle');
  });

  test('image paths follow the sync script naming and point under imageDir', () => {
    for (const s of pub.sections.flatMap((x) => x.slides)) {
      expect(s.image).toBe(`/${config.fieldkit.imageDir}/${slideFile(s.n)}`);
    }
  });

  // Before the first `node scripts/build-fieldkit.mjs` there are no images at all (the tab then shows slide
  // text instead). Once any exist, a partial set is a mistake worth failing on.
  const present = served.filter((n) => existsSync(join(process.cwd(), 'client/public', config.fieldkit.imageDir, slideFile(n))));
  test.skipIf(present.length === 0)('images exist for every served slide once the build has run', () => {
    const missing = served.filter((n) => !present.includes(n));
    expect(missing, `missing images for slides: ${missing.join(', ')} (run scripts/build-fieldkit.mjs)`).toEqual([]);
    expect(existsSync(join(process.cwd(), 'client/public', config.fieldkit.imageDir, config.fieldkit.pdfFile))).toBe(true);
  });
});

describe('Field Kit in the knowledge base', () => {
  const chunks = buildChunks({
    config,
    modules: loadModules(),
    questions: loadQuestions(),
    fit: loadFit(),
    demo: loadDemo(),
    knowledge: loadKnowledge(),
    fieldkit: loadPublicFieldkit(config),
  });
  const fk = chunks.filter((c) => c.id.startsWith('fk:'));

  test('only cleared slides are indexed, each linking back to the tab', () => {
    const allowed = allowedSlides(config);
    expect(fk.length).toBeGreaterThan(0);
    for (const c of fk) {
      expect(allowed.has(Number(c.id.slice(3)))).toBe(true);
      expect(c.docs[0].url).toMatch(/^\/fieldkit\/[a-z-]+\?slide=\d+$/);
    }
  });

  test('without Field Kit content nothing is indexed from it', () => {
    const none = buildChunks({ config, modules: loadModules(), questions: loadQuestions(), fit: loadFit(), demo: loadDemo(), knowledge: loadKnowledge() });
    expect(none.some((c) => c.id.startsWith('fk:'))).toBe(false);
  });
});
