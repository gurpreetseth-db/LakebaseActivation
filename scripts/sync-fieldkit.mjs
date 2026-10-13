#!/usr/bin/env node
/**
 * Downloads slide images for the Field Kit tab from the source Google Slides deck.
 * Only slides cleared in config/app.config.json (fieldkit.approvedSlides minus heldSlides)
 * that exist in config/content/fieldkit.json are fetched; images of slides that are no longer
 * cleared are deleted. Run it with YOUR Google login:
 *
 *   gcloud auth application-default login \
 *     --scopes=https://www.googleapis.com/auth/presentations.readonly,https://www.googleapis.com/auth/cloud-platform
 *   node scripts/sync-fieldkit.mjs --dry-run     # show what would be fetched
 *   node scripts/sync-fieldkit.mjs               # fetch images into client/public/<imageDir>/
 *   node scripts/sync-fieldkit.mjs --check       # report which images are present
 *
 * The deck is updated continuously, so each slide's title is compared with `expectTitle` in
 * fieldkit.json; a mismatch means the deck was reordered and that slide is skipped (use --force
 * to override after checking).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const check = args.includes('--check');
const force = args.includes('--force');

const root = new URL('..', import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(root, 'config/app.config.json'), 'utf8'));
const content = JSON.parse(readFileSync(join(root, 'config/content/fieldkit.json'), 'utf8'));
const { deckId, approvedSlides, heldSlides, imageDir } = config.fieldkit;

const allowed = new Set();
for (const part of approvedSlides.split(',')) {
  const [a, b] = part.split('-').map(Number);
  for (let n = a; n <= (b ?? a); n++) allowed.add(n);
}
for (const h of Object.keys(heldSlides)) allowed.delete(Number(h));

const slides = content.sections.flatMap((s) => s.slides).filter((s) => allowed.has(s.n));
const outDir = join(root, 'client/public', imageDir);
const file = (n) => join(outDir, `slide-${String(n).padStart(2, '0')}.png`);

if (check) {
  let missing = 0;
  for (const s of slides) {
    const ok = existsSync(file(s.n));
    if (!ok) missing += 1;
    console.log(`${ok ? '  ok     ' : '  MISSING'} slide ${s.n}  ${s.title}${ok ? `  (${Math.round(statSync(file(s.n)).size / 1024)} KB)` : ''}`);
  }
  console.log(`\n${slides.length - missing}/${slides.length} images present.`);
  process.exit(missing ? 1 : 0);
}

console.log(`Deck slides to fetch (${slides.length}): ${slides.map((s) => s.n).join(', ')}`);
console.log(`Held back: ${Object.keys(heldSlides).join(', ') || 'none'}`);
if (dryRun) process.exit(0);

function token() {
  for (const cmd of [['auth', 'application-default', 'print-access-token'], ['auth', 'print-access-token']]) {
    try {
      return execFileSync('gcloud', cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      /* try the next credential source */
    }
  }
  throw new Error('No Google credentials. Run the gcloud auth application-default login command shown at the top of this script.');
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const headers = { Authorization: `Bearer ${token()}` };
const api = async (path) => {
  const res = await fetch(`https://slides.googleapis.com/v1/presentations/${deckId}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slides API ${res.status}: ${body.slice(0, 300)}${res.status === 403 ? '\\nCheck the login has the presentations.readonly scope and access to the deck.' : ''}`);
  }
  return res.json();
};

const deck = await api('?fields=slides(objectId,pageElements(shape(text(textElements(textRun(content))))))');
const textOf = (page) =>
  (page.pageElements ?? [])
    .flatMap((e) => e.shape?.text?.textElements ?? [])
    .map((t) => t.textRun?.content ?? '')
    .join(' ');

mkdirSync(outDir, { recursive: true });
let fetched = 0;
let skipped = 0;
for (const s of slides) {
  const page = deck.slides[s.n - 1];
  if (!page) {
    console.warn(`  skip  slide ${s.n}: the deck has only ${deck.slides.length} slides`);
    skipped += 1;
    continue;
  }
  const expect = norm(s.expectTitle).slice(0, 18);
  if (!force && expect && !norm(textOf(page)).includes(expect)) {
    console.warn(`  skip  slide ${s.n}: title no longer matches "${s.expectTitle}" (deck reordered? use --force after checking)`);
    skipped += 1;
    continue;
  }
  const thumb = await api(
    `/pages/${page.objectId}/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`,
  );
  const img = await fetch(thumb.contentUrl);
  if (!img.ok) throw new Error(`Thumbnail download failed for slide ${s.n}: ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(file(s.n), buf);
  fetched += 1;
  console.log(`  ok    slide ${s.n}  ${s.title}  (${Math.round(buf.length / 1024)} KB)`);
}

// Remove images for slides that are no longer cleared, so de-approving a slide really removes it.
const keep = new Set(slides.map((s) => `slide-${String(s.n).padStart(2, '0')}.png`));
for (const f of readdirSync(outDir)) {
  if (/^slide-\d+\.png$/.test(f) && !keep.has(f)) {
    unlinkSync(join(outDir, f));
    console.log(`  removed ${f} (no longer cleared)`);
  }
}

console.log(`\nFetched ${fetched}, skipped ${skipped}. Review the images, then commit client/public/${imageDir}/.`);
process.exit(skipped ? 1 : 0);
