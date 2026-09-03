import { Component, computed, inject, input, output, signal } from '@angular/core';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { AccountProfile, AgentProtocol } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-account-switch-dialog',
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog model-dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="account-dialog-title">{{ 'accountSwitch.title' | t }}</h2>
            <p>{{ description() }}</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="profile-list">
          @for (account of agentAccounts(); track account.id) {
            <button
              type="button"
              class="profile-option card"
              [class.selected]="account.id === resolvedAccountId()"
              [class.current]="account.id === currentAccountProfileId()"
              [disabled]="account.id === currentAccountProfileId()"
              [attr.aria-current]="account.id === currentAccountProfileId() ? 'true' : null"
              (click)="selectedAccountId.set(account.id)"
            >
              <i [style.background]="accountTone(account)"></i>
              <span
                ><strong>{{ account.name }}</strong
                ><small>{{ accountState(account) }}</small></span
              >
              @if (account.id === currentAccountProfileId()) {
                <span class="current-tag">{{ 'modelSwitch.current' | t }}</span>
              } @else if (account.id === resolvedAccountId()) {
                <app-icon name="check" [size]="15" />
              }
            </button>
          } @empty {
            <p class="account-blocker">
              <app-icon name="triangle-alert" [size]="13" />
              <span>{{ 'launch.noAccountProfile' | t }}</span>
            </p>
          }
        </div>

        <!-- Says why the confirm button is dead, rather than leaving the user to work it out. -->
        @if (agentAccounts().length && !switchableAccounts().length) {
          <p class="account-blocker">
            <app-icon name="triangle-alert" [size]="13" />
            <span>{{ 'accountSwitch.onlyAccount' | t }}</span>
          </p>
        }

        <!--
          Switching to an account that has not signed in is allowed — the restarted terminal simply
          opens on the CLI's own login prompt — but saying so first keeps that from reading as
          Termexo losing the session for nothing.
        -->
        @if (selectedAccount(); as account) {
          @if (!account.authenticated) {
            <p class="account-blocker">
              <app-icon name="triangle-alert" [size]="13" />
              <span>{{ 'launch.accountNotAuthenticated' | t }}</span>
            </p>
          }
        }

        <div class="switch-plan">
          <div>
            <strong>{{ 'accountSwitch.modelUnchanged' | t }}</strong
            ><span>{{ terminalModel() }}</span>
          </div>
          <div>
            <strong>1</strong><span>{{ 'accountSwitch.terminalRestart' | t }}</span>
          </div>
          <div>
            <strong>{{ 'modelSwitch.newSession' | t }}</strong
            ><span>{{ 'accountSwitch.newSessionHelp' | t }}</span>
          </div>
        </div>
        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="busy() || !resolvedAccountId()"
            (click)="confirm()"
          >
            {{ 'accountSwitch.execute' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./dialog.scss', './launch-dialog.scss'],
})
export class AccountSwitchDialogComponent {
  private readonly i18n = inject(I18nService);
  readonly accounts = input<AccountProfile[]>([]);
  readonly agentType = input.required<AgentProtocol>();
  readonly terminalName = input('');
  /** Named in the plan block, because switching the account leaves the model alone. */
  readonly terminalModel = input('');
  readonly currentAccountProfileId = input('');
  readonly busy = input(false);
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  protected readonly selectedAccountId = signal('');
  protected readonly agentAccounts = computed(() =>
    this.accounts().filter((account) => account.agentType === this.agentType()),
  );
  /** The account already running stays listed for context, but cannot be switched to. */
  protected readonly switchableAccounts = computed(() =>
    this.agentAccounts().filter((account) => account.id !== this.currentAccountProfileId()),
  );
  protected readonly resolvedAccountId = computed(() => {
    const accounts = this.switchableAccounts();
    const selected = this.selectedAccountId();
    return (
      accounts.find((account) => account.id === selected)?.id ||
      accounts.find((account) => account.isDefault)?.id ||
      accounts[0]?.id ||
      ''
    );
  });
  protected readonly selectedAccount = computed(() =>
    this.agentAccounts().find((account) => account.id === this.resolvedAccountId()),
  );
  protected readonly description = computed(() =>
    this.i18n.t('accountSwitch.description', { name: this.terminalName() }),
  );

  protected confirm(): void {
    const accountProfileId = this.resolvedAccountId();
    if (accountProfileId) {
      this.confirmed.emit(accountProfileId);
    }
  }

  /** Sign-in state carries the colour, so the row never reports it by colour alone. */
  protected accountTone(account: AccountProfile): string {
    return account.authenticated ? 'var(--color-success)' : 'var(--text-muted)';
  }

  protected accountState(account: AccountProfile): string {
    const state = this.i18n.t(
      account.authenticated ? 'common.authenticated' : 'common.unauthenticated',
    );
    return account.isDefault ? `${state} · ${this.i18n.t('accountSwitch.default')}` : state;
  }
}
