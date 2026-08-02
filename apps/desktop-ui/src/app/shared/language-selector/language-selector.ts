import { Component, inject } from '@angular/core';

import { I18nService, LanguagePreference } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { IconComponent } from '../icon/icon';

@Component({
  selector: 'app-language-selector',
  imports: [IconComponent, TranslatePipe],
  template: `
    <label
      class="language-selector"
      [title]="'language.autoDescription' | t"
      [attr.aria-label]="'language.label' | t"
    >
      <app-icon name="languages" [size]="14" />
      <select [value]="i18n.preference()" (change)="selectLanguage($event)">
        <option value="system">
          {{ 'language.system' | t: { language: i18n.activeLanguageName() } }}
        </option>
        @for (language of i18n.languages; track language.code) {
          <option [value]="language.code">{{ language.name }}</option>
        }
      </select>
      <span aria-hidden="true">{{ i18n.activeShortName() }}</span>
    </label>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .language-selector {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 30px;
      padding: 0 8px;
      border: 1px solid color-mix(in srgb, var(--color-base-content) 14%, transparent);
      border-radius: 7px;
      color: color-mix(in srgb, var(--color-base-content) 78%, transparent);
      background: color-mix(in srgb, var(--color-base-200) 88%, transparent);
      cursor: pointer;
    }
    select {
      position: absolute;
      inset: 0;
      width: 100%;
      opacity: 0;
      cursor: pointer;
    }
    span {
      min-width: 18px;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
    }
    .language-selector:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
  `,
})
export class LanguageSelectorComponent {
  protected readonly i18n = inject(I18nService);

  protected selectLanguage(event: Event): void {
    this.i18n.setPreference((event.target as HTMLSelectElement).value as LanguagePreference);
  }
}
