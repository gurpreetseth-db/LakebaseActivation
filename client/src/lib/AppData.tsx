import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchConfig, fetchModules, fetchQuestions } from './api';
import { loadPartner, loadProgress, savePartner, saveModuleProgress, resetAll } from './storage';
import type { AppConfig, ModulesContent, Question, Partner, Progress, ModuleProgress } from './types';

interface AppDataValue {
  config: AppConfig;
  modules: ModulesContent;
  questions: Question[];
  partner: Partner | null;
  progress: Progress;
  setPartner: (p: Partner) => void;
  recordModule: (moduleKey: string, result: ModuleProgress) => void;
  reset: () => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

type Status = 'loading' | 'ready' | 'error';

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>('');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [modules, setModules] = useState<ModulesContent | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [partner, setPartnerState] = useState<Partner | null>(() => loadPartner());
  const [progress, setProgress] = useState<Progress>(() => loadProgress());

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchConfig(), fetchModules(), fetchQuestions()])
      .then(([cfg, mods, qs]) => {
        if (cancelled) return;
        setConfig(cfg);
        setModules(mods);
        setQuestions(qs);
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="animate-pulse text-sm text-muted-foreground">Loading enablement content…</p>
      </div>
    );
  }

  if (status === 'error' || !config || !modules || !questions) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold text-destructive">Couldn’t load content</h1>
          <p className="text-sm text-muted-foreground">{error || 'The content files failed to load.'}</p>
        </div>
      </div>
    );
  }

  const value: AppDataValue = {
    config,
    modules,
    questions,
    partner,
    progress,
    setPartner: (p) => {
      savePartner(p);
      setPartnerState(p);
    },
    recordModule: (moduleKey, result) => {
      setProgress({ ...saveModuleProgress(moduleKey, result) });
    },
    reset: () => {
      resetAll();
      setPartnerState(null);
      setProgress({});
    },
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
