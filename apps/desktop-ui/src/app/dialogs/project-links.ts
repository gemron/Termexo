import { Component, signal } from '@angular/core';

import { registerProjectLinkTranslations } from '../core/i18n/project-links.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { ExternalLinkDirective } from '../shared/external-link.directive';
import { IconComponent } from '../shared/icon/icon';

registerProjectLinkTranslations();

const PROJECT_LINKS = [
  { label: 'projectLinks.home', icon: 'external', url: 'https://www.termexo.com' },
  { label: 'projectLinks.star', icon: 'star', url: 'https://github.com/gemron/Termexo' },
] as const;

/** Kept outside the scrolling settings body so project links remain visible on every tab. */
@Component({
  selector: 'app-project-links',
  imports: [IconComponent, TranslatePipe, ExternalLinkDirective],
  template: `
    <footer>
      <p>{{ 'projectLinks.support' | t }}</p>
      <nav [attr.aria-label]="'projectLinks.group' | t">
        @for (link of links; track link.url) {
          <a
            appExternalLink
            [href]="link.url"
            target="_blank"
            rel="noopener noreferrer"
            (openFailed)="error.set($event)"
          >
            <app-icon [name]="link.icon" [size]="14" />
            {{ link.label | t }}
          </a>
        }
      </nav>
      @if (error()) {
        <p class="link-error" role="alert">{{ 'projectLinks.openFailed' | t }}: {{ error() }}</p>
      }
    </footer>
  `,
  styles: `
    :host {
      display: block;
      flex: 0 0 auto;
      border-top: 1px solid var(--border);
    }
    footer {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 16px;
      padding: 10px 16px;
      background: var(--surface-raised);
    }
    p {
      flex: 1;
      margin: 0;
      color: var(--text-muted);
      font-size: 11px;
      line-height: 1.4;
    }
    nav {
      display: flex;
      gap: 8px;
    }
    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-field);
      color: var(--text-secondary);
      background: var(--surface-2);
      font-size: 12px;
      text-decoration: none;
    }
    a:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
    a:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .link-error {
      flex-basis: 100%;
      color: var(--danger);
      overflow-wrap: anywhere;
    }
    @media (max-width: 600px) {
      footer {
        gap: 8px;
        padding: 10px 12px;
      }
      p,
      nav {
        flex-basis: 100%;
      }
      a {
        flex: 1;
        min-width: 0;
        min-height: 40px;
      }
    }
  `,
})
export class ProjectLinksComponent {
  protected readonly links = PROJECT_LINKS;
  protected readonly error = signal<string | null>(null);
}
