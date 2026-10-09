// Client-side persistence (v1). Phase 3 can swap these for Lakebase-backed API
// calls without changing the components, which only talk to these helpers.
import type { Partner, Progress, ModuleProgress } from './types';

const PARTNER_KEY = 'lbpr.partner';
const PROGRESS_KEY = 'lbpr.progress';

export function loadPartner(): Partner | null {
  try {
    const raw = localStorage.getItem(PARTNER_KEY);
    return raw ? (JSON.parse(raw) as Partner) : null;
  } catch {
    return null;
  }
}

export function savePartner(partner: Partner): void {
  localStorage.setItem(PARTNER_KEY, JSON.stringify(partner));
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

export function resetAll(): void {
  localStorage.removeItem(PARTNER_KEY);
  localStorage.removeItem(PROGRESS_KEY);
}
