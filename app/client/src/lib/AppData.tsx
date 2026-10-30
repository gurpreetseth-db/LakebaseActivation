import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  UnknownCodeError,
  fetchConfig,
  fetchIsAdmin,
  fetchLakebaseStatus,
  fetchLearner,
  fetchModules,
  fetchQuestions,
  resetRemoteProgress,
} from './api';
import { loadCode, loadLearner, loadProgress, resetAll, resetProgressLocal, saveCode, saveLearner, saveModuleProgress } from './storage';
import type { AppConfig, LakebaseStatus, Learner, ModulesContent, Question, Progress, ModuleProgress } from './types';

interface AppDataValue {
  config: AppConfig;
  modules: ModulesContent;
  questions: Question[];
  learner: Learner | null;
  progress: Progress;
  lakebase: LakebaseStatus | null;
  isAdmin: boolean;
  /** Why the learner was signed out automatically (e.g. their data expired), if it happened. */
  notice: string;
  /** Starts a session. `code` is null when the server is unavailable and progress stays on this browser. */
  signIn: (learner: Learner, code: string | null, progress?: Progress) => void;
  recordModule: (moduleKey: string, result: ModuleProgress) => void;
  /** Forget this browser's profile and learner code. Saved results stay on the server until the code is used again. */
  signOut: () => void;
  /** Delete the learner's saved module results (here and in Lakebase). The learner stays signed in. */
  resetProgress: () => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

type Status = 'loading' | 'ready' | 'error';

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>('');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [modules, setModules] = useState<ModulesContent | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [learner, setLearner] = useState<Learner | null>(() => loadLearner());
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [lakebase, setLakebase] = useState<LakebaseStatus | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Pull saved progress from Lakebase for a signed-in learner. Server data wins over the browser cache;
  // a network failure keeps the local copy, but a code the server no longer knows signs the learner out.
  const syncRemote = () => {
    if (!loadCode()) return;
    fetchLearner()
      .then(({ learner: remote, progress: saved }) => {
        saveLearner(remote);
        setLearner(remote);
        const merged = { ...loadProgress(), ...saved };
        Object.entries(merged).forEach(([k, v]) => saveModuleProgress(k, v));
        setProgress(merged);
      })
      .catch((err: Error) => {
        if (err instanceof UnknownCodeError) {
          resetAll();
          setLearner(null);
          setProgress({});
          setNotice(
            'Your learner code is no longer recognised. Learner data is deleted after a period of inactivity or when an erasure request is approved. Sign up again, or enter a different code.',
          );
        }
      })
      .finally(() => {
        fetchLakebaseStatus().then(setLakebase).catch(() => undefined);
      });
  };

  useEffect(() => {
    fetchLakebaseStatus().then(setLakebase).catch(() => undefined);
    fetchIsAdmin().then(setIsAdmin).catch(() => undefined);
    syncRemote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    learner,
    progress,
    lakebase,
    isAdmin,
    notice,
    signIn: (l, code, saved) => {
      saveLearner(l);
      if (code) saveCode(code);
      const merged = { ...loadProgress(), ...(saved ?? {}) };
      Object.entries(merged).forEach(([k, v]) => saveModuleProgress(k, v));
      setProgress(merged);
      setNotice('');
      setLearner(l);
    },
    recordModule: (moduleKey, result) => {
      setProgress({ ...saveModuleProgress(moduleKey, result) });
    },
    signOut: () => {
      resetAll();
      setLearner(null);
      setProgress({});
    },
    resetProgress: () => {
      resetRemoteProgress().catch(() => undefined);
      resetProgressLocal();
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
