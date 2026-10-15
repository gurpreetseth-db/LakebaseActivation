/**
 * Builds the retrieval corpus from the editable content files, so the assistant
 * always answers from the same material the learner sees. Each chunk has a
 * stable id and a content hash so unchanged chunks are never re-embedded.
 */
import { createHash } from 'node:crypto';
import type { AppConfig, DemoContent, FitContent, KnowledgeContent, ModulesContent, Question } from '../content/loader.js';
import type { PublicFieldkit } from '../content/fieldkit.js';

export interface DocRef {
  label: string;
  url: string;
}

export interface Chunk {
  id: string;
  source: string;
  title: string;
  content: string;
  hash: string;
  /** Documentation to show alongside answers that cite this passage (not embedded). */
  docs: DocRef[];
}

/** Resolves a doc path against the docs base URL; absolute URLs pass through unchanged. */
export function resolveDoc(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

const MAX_CHARS = 1200;

function make(id: string, source: string, title: string, content: string, docs: DocRef[] = []): Chunk {
  const text = content.trim();
  return { id, source, title, content: text, hash: createHash('sha256').update(`${title}\n${text}`).digest('hex'), docs };
}

/** Splits long text on paragraph boundaries so each chunk stays embedding-friendly. */
export function splitText(text: string, max = MAX_CHARS): string[] {
  const out: string[] = [];
  let buf = '';
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length + 2 > max) {
      out.push(buf);
      buf = '';
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (buf) out.push(buf);
  return out;
}

export function buildChunks(input: {
  config: AppConfig;
  modules: ModulesContent;
  questions: Question[];
  fit: FitContent;
  demo: DemoContent;
  knowledge: KnowledgeContent;
  /** Already filtered to approved slides (use loadPublicFieldkit). */
  fieldkit?: PublicFieldkit;
}): Chunk[] {
  const { config, modules, questions, fit, demo, knowledge, fieldkit } = input;
  const chunks: Chunk[] = [];
  const base = config.branding.docsBaseUrl;
  const moduleDocs = (key: string): DocRef[] =>
    (modules.modules[key]?.docLinks ?? []).map((d) => ({ label: d.label, url: resolveDoc(base, d.path) }));

  for (const k of knowledge.entries) {
    const docs = k.docs.map((path) => ({ label: knowledge.docs[path] ?? path, url: resolveDoc(base, path) }));
    chunks.push(make(`kb:${k.id}`, 'Lakebase reference', k.title, k.content, docs));
  }

  for (const meta of config.modules) {
    const m = modules.modules[meta.key];
    if (!m) continue;
    const body = [`Objectives:\n- ${m.objectives.join('\n- ')}`, ...m.overview].join('\n\n');
    splitText(body).forEach((part, i) =>
      chunks.push(make(`mod:${meta.key}:${i}`, `Module: ${meta.title}`, meta.title, part, moduleDocs(meta.key))),
    );
    const summarised = m.docLinks.filter((d) => d.summary.length > 0);
    if (summarised.length > 0) {
      const text = summarised.map((d) => `${d.label}:\n- ${d.summary.join('\n- ')}`).join('\n\n');
      splitText(text).forEach((part, i) =>
        chunks.push(make(`docs:${meta.key}:${i}`, `Documentation summary: ${meta.title}`, `${meta.title} — documentation summary`, part, moduleDocs(meta.key))),
      );
    }
    chunks.push(
      make(`lab:${meta.key}`, `Lab: ${meta.title}`, m.lab.title, `${m.lab.intro}\n${m.lab.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`, moduleDocs(meta.key)),
    );
  }

  for (const q of questions) {
    const correct = q.choices.find((c) => c.key === q.correctAnswer)?.text ?? '';
    chunks.push(make(`qa:${q.id}`, 'Knowledge check', q.prompt, `${q.prompt}\nAnswer: ${correct}\n${q.explanation}`, moduleDocs(q.moduleKey)));
  }

  for (const q of fit.questions) {
    const notes = q.options.filter((o) => o.note).map((o) => `${o.label}: ${o.note}`);
    if (notes.length) chunks.push(make(`fit:${q.id}`, 'Fit guidance', q.prompt, notes.join('\n')));
  }

  for (const s of demo.sections) {
    chunks.push(make(`demo:${s.key}`, 'Demo walkthrough', s.title, [...s.body, ...s.steps].join('\n')));
  }

  for (const section of fieldkit?.sections ?? []) {
    for (const sl of section.slides) {
      chunks.push(
        make(`fk:${sl.n}`, `Field Kit: ${section.title}`, sl.title, sl.text, [
          // In-app link (not an external doc): opens the slide in the Field Kit tab.
          { label: `Field Kit — ${section.title}`, url: `/fieldkit/${section.key}?slide=${sl.n}` },
        ]),
      );
    }
  }

  return chunks;
}
