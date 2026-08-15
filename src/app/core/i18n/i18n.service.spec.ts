import { TestBed } from '@angular/core/testing';
import { BrowserStorage } from '../storage/browser-storage';
import { I18nService } from './i18n.service';

describe('I18nService', () => {
  let memory: Record<string, unknown>;

  beforeEach(() => {
    memory = {};
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BrowserStorage,
          useValue: {
            read: (key: string) => memory[key] ?? null,
            write: (key: string, value: unknown) => {
              memory[key] = value;
            },
          },
        },
      ],
    });
  });

  it('defaults to English and can switch to Dutch', () => {
    const i18n = TestBed.inject(I18nService);
    expect(i18n.t('nav.home')).toBe('Home');
    i18n.setLocale('nl');
    expect(i18n.t('nav.home')).toBe('Start');
    expect(i18n.t('designer.parkingItem', { n: 1, studs: 16 })).toContain('16');
  });
});
