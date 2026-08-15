import { Component, inject } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';

@Component({
  selector: 'app-language-toggle',
  imports: [TPipe],
  templateUrl: './language-toggle.html',
  styleUrl: './language-toggle.scss',
})
export class LanguageToggle {
  protected readonly i18n = inject(I18nService);
}
