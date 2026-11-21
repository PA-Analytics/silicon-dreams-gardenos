export type Lang = 'en' | 'es';

const KEY = 'sd_lang_v1';

export function detectLang(): Lang {
  try {
    if (typeof location !== 'undefined') {
      const p = new URLSearchParams(location.search).get('lang');
      if (p === 'es' || p === 'en') return p;
    }
    const stored = globalThis.localStorage?.getItem(KEY);
    if (stored === 'es' || stored === 'en') return stored;
  } catch { /* storage/location optional in tests */ }
  return 'en';
}

let currentLang: Lang = detectLang();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(next: Lang): Lang {
  currentLang = next;
  try {
    globalThis.localStorage?.setItem(KEY, next);
  } catch { /* optional */ }
  return currentLang;
}

export function tr(en: string, es: string, lang: Lang = currentLang): string {
  return lang === 'es' ? es : en;
}
