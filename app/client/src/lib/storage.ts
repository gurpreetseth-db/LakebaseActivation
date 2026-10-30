// Client-side persistence. The browser keeps the learner's company/nickname, their learner code (the only
// credential) and a cache of results; there is no name or email.
import type { Learner, Progress, ModuleProgress } from './types';

const LEARNER_KEY = 'lbpr.learner';
const CODE_KEY = 'lbpr.code';
const PROGRESS_KEY = 'lbpr.progress';

// Earlier versions stored name and email here; remove them as soon as this build runs.
try {
  localStorage.removeItem('lbpr.partner');
} catch {
  /* storage unavailable */
}

export function loadLearner(): Learner | null {
  try {
    const raw = localStorage.getItem(LEARNER_KEY);
    return raw ? (JSON.parse(raw) as Learner) : null;
  } catch {
    return null;
  }
}

export function saveLearner(learner: Learner): void {
  localStorage.setItem(LEARNER_KEY, JSON.stringify(learner));
}

export function loadCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

export function saveCode(code: string): void {
  localStorage.setItem(CODE_KEY, code);
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    return {};
  }
}

export function saveModuleProgress(moduleKey: string, result: ModuleProgress): Progress {
  const progress = loadProgress();
  progress[moduleKey] = result;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  return progress;
}

const LABS_KEY = 'lbpr.labs';

export function loadLabsLocal(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(LABS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number[]>) : {};
  } catch {
    return {};
  }
}

export function saveLabLocal(moduleKey: string, steps: number[]): void {
  const all = loadLabsLocal();
  all[moduleKey] = steps;
  localStorage.setItem(LABS_KEY, JSON.stringify(all));
}

/** Clears cached results only (the learner stays signed in). */
export function resetProgressLocal(): void {
  localStorage.removeItem(LABS_KEY);
  localStorage.removeItem(PROGRESS_KEY);
}

/** Forgets everything on this device, including the learner code. */
export function resetAll(): void {
  resetProgressLocal();
  localStorage.removeItem(LEARNER_KEY);
  localStorage.removeItem(CODE_KEY);
}
