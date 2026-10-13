#!/usr/bin/env node
/**
 * Builds the Field Kit assets from the curated deck PDF. Slide numbers are PAGE NUMBERS in that PDF.
 * Only cleared pages are used: fieldkit.approvedSlides minus heldSlides in config/app.config.json,
 * restricted to the pages that have content in config/content/fieldkit.json. Nothing else from the PDF
 * is rendered or copied.
 *
 *   1. In Google Slides: File -> Download -> PDF document (.pdf)
 *   2. Save it as fieldkit-source/deck.pdf   (that folder is git-ignored; never commit the full deck)
 *   3. node scripts/build-fieldkit.mjs [--pdf path/to/deck.pdf] [--dry-run] [--force]
 *
 * Output (committed, served by the app) in client/public/<imageDir>/:
 *   slide-NN.png                 one image per cleared slide
 *   <pdfFile>                    a PDF containing only the cleared slides, in slide order
 *
 * Needs poppler (pdfinfo, pdftotext, pdftoppm, pdfseparate, pdfunite):  brew install poppler
 *
 * The deck changes often, so each page's text is compared with `expectTitle` in fieldkit.json; a page
 * whose text does not match is skipped (the deck was reordered). --force overrides after you have checked.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const root = new URL('..', import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(root, 'config/app.config.json'), 'utf8'));
const content = JSON.parse(readFileSync(join(root, 'config/content/fieldkit.json'), 'utf8'));
const { approvedSlides, heldSlides, imageDir, pdfFile } = config.fieldkit;

const allowed = new Set();
for (const part of approvedSlides.split(',')) {
  const [a, b] = part.split('-').map(Number);
  for (let n = a; n <= (b ?? a); n++) allowed.add(n);
}
for (const h of Object.keys(heldSlides)) allowed.delete(Number(h));
const slides = content.sections
  .flatMap((s) => s.slides)
  .filter((s) => allowed.has(s.n))
  .sort((a, b) => a.n - b.n);

const pdf = resolve(root, opt('--pdf') ?? 'fieldkit-source/deck.pdf');
const outDir = join(root, 'client/public', imageDir);
const pad = (n) => String(n).padStart(2, '0');
const png = (n) => join(outDir, `slide-${pad(n)}.png`);

const tool = (name, a) => execFileSync(name, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function need(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
  } catch {
    console.error(`Missing "${name}". Install poppler first:  brew install poppler`);
    process.exit(2);
  }
}
const pageCount = (file) => Number(/^Pages:\s+(\d+)/m.exec(tool('pdfinfo', [file]))?.[1] ?? 0);

console.log(`Source PDF:  ${pdf}`);
console.log(`Writing to:  ${outDir}`);
console.log(`Cleared slides (${slides.length}): ${slides.map((s) => s.n).join(', ')}`);
console.log(`Held back:   ${Object.keys(heldSlides).join(', ') || 'none'}`);

if (!existsSync(pdf)) {
  console.error(
    `\nPDF not found. Export the deck from Google Slides (File -> Download -> PDF document) and save it as\n  ${pdf}`,
  );
  process.exit(1);
}
for (const t of ['pdfinfo', 'pdftotext', 'pdftoppm', 'pdfseparate', 'pdfunite']) need(t);

const pages = pageCount(pdf);
console.log(`PDF has ${pages} pages.\n`);
if (pages === 0) {
  console.error('Could not read the PDF.');
  process.exit(1);
}

// NFKC folds ligatures such as "ﬁ" so PDF text matches the plain-letter titles in fieldkit.json.
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');
const pageText = (n) => tool('pdftotext', ['-f', String(n), '-l', String(n), '-q', pdf, '-']);

const ok = [];
let skipped = 0;
for (const s of slides) {
  if (s.n > pages) {
    console.warn(`  skip  slide ${s.n}: the PDF only has ${pages} pages`);
    skipped += 1;
    continue;
  }
  const text = pageText(s.n);
  const expect = norm(s.expectTitle).slice(0, 18);
  if (!force && expect && !norm(text).includes(expect)) {
    console.warn(
      `  skip  slide ${s.n}: expected "${s.expectTitle}" but page ${s.n} starts with "${text.replace(/\s+/g, ' ').trim().slice(0, 60)}" ` +
        '(deck reordered? re-run with --force after checking)',
    );
    skipped += 1;
    continue;
  }
  ok.push(s);
}

if (dryRun) {
  console.log(`\nWould render ${ok.length} slides and a ${ok.length}-page PDF; ${skipped} skipped.`);
  process.exit(skipped ? 1 : 0);
}
if (ok.length === 0) {
  console.error('\nNothing to build. Read the messages above for the reason.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const s of ok) {
  // 1600px wide keeps text legible full-screen without huge files.
  tool('pdftoppm', [
    '-f', String(s.n),
    '-l', String(s.n),
    '-png',
    '-singlefile',
    '-scale-to-x', '1600',
    '-scale-to-y', '-1',
    pdf,
    png(s.n).replace(/\.png$/, ''),
  ]);
  console.log(`  ok    slide ${s.n}  ${s.title}  (${Math.round(statSync(png(s.n)).size / 1024)} KB)`);
}

// A PDF with only the cleared pages, in slide order.
const tmp = mkdtempSync(join(tmpdir(), 'fieldkit-'));
try {
  tool('pdfseparate', ['-f', '1', '-l', String(pages), pdf, join(tmp, 'p-%d.pdf')]);
  const out = join(outDir, pdfFile);
  tool('pdfunite', [...ok.map((s) => join(tmp, `p-${s.n}.pdf`)), out]);
  const outPages = pageCount(out);
  if (outPages !== ok.length) throw new Error(`Selected PDF has ${outPages} pages, expected ${ok.length}`);
  console.log(`  ok    ${pdfFile}  (${outPages} pages, ${Math.round(statSync(out).size / 1024)} KB)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Remove anything that is no longer cleared, so de-approving a slide really removes it.
const keep = new Set([...ok.map((s) => `slide-${pad(s.n)}.png`), pdfFile]);
for (const f of readdirSync(outDir)) {
  if ((/^slide-\d+\.png$/.test(f) || f.endsWith('.pdf')) && !keep.has(f)) {
    unlinkSync(join(outDir, f));
    console.log(`  removed ${f} (no longer cleared)`);
  }
}

console.log(`\nBuilt ${ok.length} slides${skipped ? `, skipped ${skipped}` : ''}. Review client/public/${imageDir}/, then commit it.`);
process.exit(skipped ? 1 : 0);
