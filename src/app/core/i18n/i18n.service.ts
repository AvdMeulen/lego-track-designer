import { Injectable, effect, inject, signal } from '@angular/core';
import { BrowserStorage } from '../storage/browser-storage';
import { Locale, TRANSLATIONS } from './translations';

export const LOCALE_STORAGE_KEY = 'lego-track-designer.locale.v1';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly storage = inject(BrowserStorage);
  readonly locale = signal<Locale>(this.readStoredLocale());

  constructor() {
    effect(() => {
      const locale = this.locale();
      document.documentElement.lang = locale;
      document.title = this.t('app.title');
    });
  }

  setLocale(locale: Locale): void {
    this.locale.set(locale);
    this.storage.write(LOCALE_STORAGE_KEY, locale);
  }

  t(key: string, params?: Record<string, string | number>): string {
    const table = TRANSLATIONS[this.locale()];
    const template = table[key] ?? TRANSLATIONS.en[key] ?? key;
    if (!params) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  }

  private readStoredLocale(): Locale {
    const stored = this.storage.read<Locale>(LOCALE_STORAGE_KEY);
    return stored === 'nl' || stored === 'en' ? stored : 'en';
  }
}
