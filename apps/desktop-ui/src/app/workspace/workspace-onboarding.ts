import { Component, output } from '@angular/core';

import { registerOnboardingTranslations } from '../core/i18n/onboarding.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';

registerOnboardingTranslations();

/**
 * What the workspace area shows before there is a workspace to show.
 *
 * The app used to seed three sample workspaces on a first run, whose Agent terminals resumed
 * session ids that never existed — a new install opened on two terminals reporting errors. It
 * starts empty now, and this says what a workspace is and what to do first.
 */
@Component({
  selector: 'app-workspace-onboarding',
  imports: [IconComponent, TranslatePipe],
  template: `
    <section class="onboarding">
      <div class="onboarding-head">
        <span class="onboarding-mark" aria-hidden="true">
          <img src="termexo-mark.svg" alt="" />
        </span>
        <h1>{{ 'onboarding.title' | t }}</h1>
        <p>{{ 'onboarding.lead' | t }}</p>
      </div>

      <ol class="onboarding-steps">
        <li>
          <b>1</b>
          <div>
            <strong>{{ 'onboarding.step1Title' | t }}</strong>
            <span>{{ 'onboarding.step1Body' | t }}</span>
          </div>
        </li>
        <li>
          <b>2</b>
          <div>
            <strong>{{ 'onboarding.step2Title' | t }}</strong>
            <span>{{ 'onboarding.step2Body' | t }}</span>
          </div>
        </li>
        <li>
          <b>3</b>
          <div>
            <strong>{{ 'onboarding.step3Title' | t }}</strong>
            <span>{{ 'onboarding.step3Body' | t }}</span>
          </div>
        </li>
      </ol>

      <button
        type="button"
        class="btn btn-primary btn-sm"
        data-testid="onboarding-create-workspace"
        (click)="createRequested.emit()"
      >
        <app-icon name="plus" [size]="14" />
        {{ 'onboarding.create' | t }}
      </button>

      <p class="onboarding-privacy">{{ 'onboarding.privacy' | t }}</p>
    </section>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: auto;
    }

    .onboarding {
      display: grid;
      max-width: 520px;
      min-height: 100%;
      align-content: center;
      justify-items: center;
      gap: 20px;
      padding: 32px 24px;
      margin: 0 auto;
      text-align: center;
    }

    .onboarding-head {
      display: grid;
      justify-items: center;
      gap: 12px;
    }

    .onboarding-mark {
      display: grid;
      width: 52px;
      height: 52px;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
      border-radius: 12px;
      background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
    }

    .onboarding-mark img {
      display: block;
      width: 28px;
      height: 28px;
    }

    h1 {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
    }

    .onboarding-head p {
      margin: 0;
      max-width: 42em;
      color: var(--text-secondary);
      font-size: 11px;
      line-height: 1.65;
    }

    /* The steps are an order, so they read down the page rather than across it. */
    .onboarding-steps {
      display: grid;
      width: 100%;
      gap: 4px;
      padding: 8px;
      margin: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-box);
      background: var(--surface-1);
      list-style: none;
      text-align: left;
    }

    .onboarding-steps li {
      display: grid;
      align-items: start;
      gap: 10px;
      padding: 9px 8px;
      grid-template-columns: 20px minmax(0, 1fr);
    }

    .onboarding-steps b {
      display: grid;
      width: 20px;
      height: 20px;
      place-items: center;
      border-radius: 50%;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
      font: 700 10px/1 var(--mono);
    }

    .onboarding-steps strong {
      display: block;
      font-size: 11px;
      font-weight: 620;
    }

    .onboarding-steps span {
      display: block;
      margin-top: 4px;
      color: var(--text-muted);
      font-size: 10px;
      line-height: 1.55;
    }

    .onboarding-privacy {
      margin: 0;
      color: var(--text-muted);
      font-size: 9px;
      line-height: 1.5;
    }
  `,
})
export class WorkspaceOnboardingComponent {
  readonly createRequested = output<void>();
}
