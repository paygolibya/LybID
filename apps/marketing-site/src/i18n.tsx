import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ar, en, type Dictionary } from './translations';

type Lang = 'ar' | 'en';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dictionary;
  isAr: boolean;
  // Font-family class pair for the current language — Amiri/Plex Sans
  // Arabic vs Fraunces/Plex Sans, applied per-element rather than
  // globally so English words (LybID, MRZ) inside Arabic copy still
  // render in a Latin-appropriate face where used deliberately.
  fontDisplay: string;
  fontBody: string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = 'lybid-marketing-lang';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    return saved === 'en' ? 'en' : 'ar';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Private browsing / storage disabled — language just won't persist
      // across visits, not worth failing the page over.
    }
  }, [lang]);

  const value = useMemo<LanguageContextValue>(() => {
    const isAr = lang === 'ar';
    return {
      lang,
      setLang: setLangState,
      t: isAr ? ar : en,
      isAr,
      fontDisplay: isAr ? 'font-display-ar' : 'font-display',
      fontBody: isAr ? 'font-body-ar' : 'font-body',
    };
  }, [lang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
