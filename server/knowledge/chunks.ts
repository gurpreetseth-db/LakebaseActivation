/**
 * Builds the retrieval corpus from the editable content files, so the assistant
 * always answers from the same material the learner sees. Each chunk has a
 * stable id and a content hash so unchanged chunks are never re-embedded.
 */
import { createHash } from 'node:crypto';
import type { AppConfig, DemoContent, FitContent, KnowledgeContent, ModulesContent, Question } from '../content/loader.js';

export interface Chunk {
  id: string;
  source: string;
  title: string;
  content: string;
  hash: string;
}

const MAX_CHARS = 1200;

function make(id: string, source: string, title: string, content: string): Chunk {
  const text = content.trim();
  return { id, source, title, content: text, hash: createHash('sha256').update(`${title}\n${text}`).digest('hex') };
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
}): Chunk[] {
  const { config, modules, questions, fit, demo, knowledge } = input;
  const chunks: Chunk[] = [];

  for (const k of knowledge.entries) {
    chunks.push(make(`kb:${k.id}`, 'Lakebase reference', k.title, k.content));
  }

  for (const meta of config.modules) {
    const m = modules.modules[meta.key];
    if (!m) continue;
    const body = [`Objectives:\n- ${m.objectives.join('\n- ')}`, ...m.overview].join('\n\n');
    splitText(body).forEach((part, i) => chunks.push(make(`mod:${meta.key}:${i}`, `Module: ${meta.title}`, meta.title, part)));
    chunks.push(
      make(`lab:${meta.key}`, `Lab: ${meta.title}`, m.lab.title, `${m.lab.intro}\n${m.lab.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`),
    );
  }

  for (const q of questions) {
    const correct = q.choices.find((c) => c.key === q.correctAnswer)?.text ?? '';
    chunks.push(make(`qa:${q.id}`, 'Knowledge check', q.prompt, `${q.prompt}\nAnswer: ${correct}\n${q.explanation}`));
  }

  for (const q of fit.questions) {
    const notes = q.options.filter((o) => o.note).map((o) => `${o.label}: ${o.note}`);
    if (notes.length) chunks.push(make(`fit:${q.id}`, 'Fit guidance', q.prompt, notes.join('\n')));
  }

  for (const s of demo.sections) {
    chunks.push(make(`demo:${s.key}`, 'Demo walkthrough', s.title, [...s.body, ...s.steps].join('\n')));
  }

  return chunks;
}
