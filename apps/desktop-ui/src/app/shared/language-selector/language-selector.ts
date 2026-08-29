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
    /* Mirrors .window-tools .window-tool so the selector reads as a peer of the flat
       icon buttons, not a raised island with its own border and fill. */
    .language-selector {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 28px;
      padding: 0 6px;
      border: 0;
      border-radius: 3px;
      color: var(--text-muted);
      background: transparent;
      cursor: pointer;
    }
    select {
      position: absolute;
      inset: 0;
      width: 100%;
      opacity: 0;
      cursor: pointer;
      color-scheme: dark;
      // Windows WebView2 renders the native <option> popup light even with
      // color-scheme: dark inherited from :root, so the select and each option
      // carry explicit surface/text colors to keep the dropdown in theme.
      background-color: var(--surface-1);
      color: var(--text);
    }
    option {
      background-color: var(--surface-1);
      color: var(--text);
    }
    span {
      min-width: 18px;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
    }
    .language-selector:hover {
      color: var(--text);
      background: var(--surface-2);
    }
  `,
})
export class LanguageSelectorComponent {
  protected readonly i18n = inject(I18nService);

  protected selectLanguage(event: Event): void {
    this.i18n.setPreference((event.target as HTMLSelectElement).value as LanguagePreference);
  }
}
