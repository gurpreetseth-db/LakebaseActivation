/**
 * Field Kit slides are Databricks-internal material shown to external partners, so access is
 * allow-list only: a slide is served or indexed iff its number is in fieldkit.approvedSlides
 * and not in fieldkit.heldSlides. Everything else in the content file is ignored.
 */
import { loadConfig, loadFieldkitRaw, type AppConfig } from './loader.js';

export function parseSlideRanges(spec: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    const end = b ?? a;
    if (!Number.isInteger(a) || !Number.isInteger(end) || end < a) throw new Error(`Invalid slide range: ${part}`);
    for (let n = a; n <= end; n++) out.add(n);
  }
  return out;
}

export function allowedSlides(config: AppConfig): Set<number> {
  const allowed = parseSlideRanges(config.fieldkit.approvedSlides);
  for (const held of Object.keys(config.fieldkit.heldSlides)) allowed.delete(Number(held));
  return allowed;
}

export const slideFile = (n: number) => `slide-${String(n).padStart(2, '0')}.png`;

export interface PublicSlide {
  n: number;
  title: string;
  text: string;
  note?: string;
  image: string;
}

export interface PublicSection {
  key: string;
  title: string;
  summary: string;
  takeaways: string[];
  modules: string[];
  slides: PublicSlide[];
}

export interface PublicFieldkit {
  deckTitle: string;
  edition: string;
  /** PDF containing only the cleared slides. */
  pdf: string;
  sections: PublicSection[];
}

/** The partner-safe view: allowed slides only, no held reasons or expected titles. */
export function loadPublicFieldkit(config: AppConfig = loadConfig()): PublicFieldkit {
  const allowed = allowedSlides(config);
  const sections = loadFieldkitRaw()
    .sections.map((s) => ({
      key: s.key,
      title: s.title,
      summary: s.summary,
      takeaways: s.takeaways,
      modules: s.modules,
      slides: s.slides
        .filter((sl) => allowed.has(sl.n))
        .map((sl) => ({
          n: sl.n,
          title: sl.title,
          text: sl.text,
          ...(sl.note ? { note: sl.note } : {}),
          image: `/${config.fieldkit.imageDir}/${slideFile(sl.n)}`,
        })),
    }))
    .filter((s) => s.slides.length > 0);
  return {
    deckTitle: config.fieldkit.deckTitle,
    edition: config.fieldkit.edition,
    pdf: `/${config.fieldkit.imageDir}/${config.fieldkit.pdfFile}`,
    sections,
  };
}
