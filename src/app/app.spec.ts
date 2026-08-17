import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BrowserStorage } from './core/storage/browser-storage';
import { APP_VERSION } from './core/version';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: BrowserStorage, useValue: { read: () => null, write: () => undefined } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the product title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-copy strong')?.textContent).toContain('LEGO Track Designer');
  });

  it('should render the app version', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-version')?.textContent?.trim()).toBe(`v${APP_VERSION}`);
  });
});
