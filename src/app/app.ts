import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { I18nService } from './core/i18n/i18n.service';
import { TPipe } from './core/i18n/t.pipe';
import { APP_VERSION } from './core/version';
import { LanguageToggle } from './shared/language-toggle/language-toggle';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TPipe, LanguageToggle],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly appVersion = APP_VERSION;
  private readonly router = inject(Router);
  protected readonly immersive = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/designer')),
      startWith(this.router.url.startsWith('/designer')),
    ),
    { initialValue: false },
  );

  constructor() {
    inject(I18nService);
    effect(() => {
      document.body.classList.toggle('immersive', !!this.immersive());
    });
  }
}
