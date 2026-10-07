import { Component, signal } from '@angular/core';

import { registerRemoteAccessGuideTranslations } from '../core/i18n/remote-access-guide.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { ExternalLinkDirective, SUPPORT_EMAIL } from '../shared/external-link.directive';
import { IconComponent } from '../shared/icon/icon';

registerRemoteAccessGuideTranslations();

@Component({
  selector: 'app-remote-access-guide',
  imports: [TranslatePipe, IconComponent, ExternalLinkDirective],
  template: `
    <section class="access-guide" [attr.aria-label]="'remote.guideTitle' | t">
      <h3>{{ 'remote.guideTitle' | t }}</h3>
      <div class="access-paths">
        <article>
          <h4><app-icon name="devices" [size]="16" />{{ 'remote.guideLan' | t }}</h4>
          <p>{{ 'remote.guideLanHint' | t }}</p>
        </article>
        <article>
          <h4><app-icon name="external" [size]="16" />{{ 'remote.guideInternet' | t }}</h4>
          <p>{{ 'remote.guideInternetHint' | t }}</p>
        </article>
      </div>
      <div class="relay-options">
        <article>
          <h4>{{ 'remote.guideSelfHost' | t }}</h4>
          <p>{{ 'remote.guideSelfHostHint' | t }}</p>
          <a
            appExternalLink
            href="https://www.termexo.com/guide.html#remote"
            target="_blank"
            rel="noopener noreferrer"
            (openFailed)="error.set($event)"
          >
            <app-icon name="external" [size]="14" />{{ 'remote.guideDocs' | t }}
          </a>
        </article>
        <article>
          <h4>{{ 'remote.guideFreeRelay' | t }}</h4>
          <p>{{ 'remote.guideFreeRelayHint' | t }}</p>
          <a appExternalLink [href]="'mailto:' + email" (openFailed)="error.set($event)">
            {{ 'remote.guideApply' | t }}
          </a>
          <span class="support-email">{{ email }}</span>
        </article>
      </div>
      @if (error()) {
        <p role="alert" class="link-error">{{ 'remote.guideOpenFailed' | t }}: {{ error() }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 18px;
    }
    .access-guide {
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-box);
      background: var(--surface-inset);
    }
    h3 {
      margin: 0 0 12px;
      color: var(--text);
      font-size: 13px;
    }
    h4 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      color: var(--text-secondary);
      font-size: 12px;
    }
    p {
      margin: 7px 0 0;
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.65;
    }
    .access-paths,
    .relay-options {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .relay-options {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
    article {
      min-width: 0;
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      margin-top: 10px;
      padding: 6px 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-field);
      color: var(--accent);
      background: var(--surface-2);
      font-size: 12px;
      text-decoration: none;
    }
    a:hover {
      border-color: var(--accent);
    }
    a:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .support-email {
      display: block;
      margin-top: 6px;
      color: var(--text-secondary);
      font-size: 12px;
      overflow-wrap: anywhere;
      user-select: text;
    }
    .link-error {
      color: var(--danger);
      overflow-wrap: anywhere;
    }
    @media (max-width: 600px) {
      .access-paths,
      .relay-options {
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
      }
      a {
        min-height: 40px;
      }
    }
  `,
})
export class RemoteAccessGuideComponent {
  protected readonly email = SUPPORT_EMAIL;
  protected readonly error = signal<string | null>(null);
}
