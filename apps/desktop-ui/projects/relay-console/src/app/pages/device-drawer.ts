import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { DevicePatch, DeviceView } from '../core/console.models';
import { ConfirmBlockComponent } from '../shared/confirm-block';
import { CopyButtonComponent } from '../shared/copy-button';
import { deviceStatus } from '../shared/device-status';
import { DrawerComponent } from '../shared/drawer';
import { formatMoment, formatSince, formatText } from '../shared/format';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';

/**
 * One device: what it is doing, what can be changed about it, and how to cut it off.
 *
 * The destructive actions live here rather than in the table so they are always taken next to
 * the device's name and state, never from a row the eye might have slipped onto.
 */
@Component({
  selector: 'console-device-drawer',
  imports: [
    ConfirmBlockComponent,
    CopyButtonComponent,
    DrawerComponent,
    FormsModule,
    TranslatePipe,
  ],
  template: `
    <console-drawer [heading]="device().name" (closed)="closed.emit()">
      <span class="status" [attr.data-tone]="status().tone">{{ status().key | t }}</span>

      <dl class="facts">
        <div>
          <dt>{{ 'console.devices.kind' | t }}</dt>
          <dd>{{ kindLabel() }}</dd>
        </div>
        <div>
          <dt>{{ 'console.devices.owner' | t }}</dt>
          <dd>{{ text(device().ownerUsername) }}</dd>
        </div>
        <div>
          <dt>{{ 'console.devices.connectedSince' | t }}</dt>
          <dd>{{ since(device().connectedSince) }}</dd>
        </div>
        <div>
          <dt>{{ 'console.devices.lastSeen' | t }}</dt>
          <dd>{{ moment(device().lastSeenAt) }}</dd>
        </div>
        <div>
          <dt>{{ 'console.devices.ip' | t }}</dt>
          <dd>{{ text(device().lastIp) }}</dd>
        </div>
        <div>
          <dt>{{ 'console.devices.version' | t }}</dt>
          <dd>{{ text(device().lastVersion) }}</dd>
        </div>
      </dl>

      <div class="field">
        <span>{{ 'console.devices.accessUrl' | t }}</span>
        <div class="code-value">
          <code>{{ device().accessUrl }}</code>
          <console-copy-button label="console.devices.copyUrl" [value]="device().accessUrl" />
        </div>
        <small>{{ 'console.devices.accessUrlHint' | t }}</small>
      </div>

      @if (error()) {
        <div class="alert error" role="alert">{{ error() }}</div>
      }

      <form (ngSubmit)="save()">
        <div class="field-row">
          <label class="field">
            <span>{{ 'console.devices.name' | t }}</span>
            <input
              name="name"
              type="text"
              [disabled]="busy()"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
            @if (nameInvalid()) {
              <small class="field-error" role="alert">
                {{ 'console.devices.nameRequired' | t }}
              </small>
            }
          </label>
          @if (canManage()) {
            <label class="field">
              <span>{{ 'console.devices.note' | t }}</span>
              <input
                name="note"
                type="text"
                [disabled]="busy()"
                [ngModel]="note()"
                (ngModelChange)="note.set($event)"
              />
            </label>
          }
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="!canSave()">
            {{ (busy() ? 'console.common.saving' : 'console.common.save') | t }}
          </button>
        </div>
      </form>

      @if (canManage() && device().online) {
        <div class="form-actions">
          <button type="button" class="btn" [disabled]="busy()" (click)="disconnect()">
            {{ 'console.devices.disconnect' | t }}
          </button>
        </div>
        <small>{{ 'console.devices.disconnectHint' | t }}</small>
      }

      @if (!device().revokedAt) {
        @if (confirmingRevoke()) {
          <console-confirm
            [message]="revokeMessage()"
            [confirmLabel]="'console.devices.revokeAction' | t"
            [busy]="busy()"
            (confirmed)="revoke()"
            (cancelled)="confirmingRevoke.set(false)"
          />
        } @else {
          <div class="form-actions">
            <button
              type="button"
              class="btn btn-danger"
              [disabled]="busy()"
              (click)="confirmingRevoke.set(true)"
            >
              {{ 'console.devices.revoke' | t }}
            </button>
          </div>
        }
      }
    </console-drawer>
  `,
})
export class DeviceDrawerComponent {
  private readonly i18n = inject(I18nService);

  readonly device = input.required<DeviceView>();
  /** True for an administrator: only they may edit the note or drop a live tunnel. */
  readonly canManage = input(false);
  readonly busy = input(false);
  readonly error = input('');

  readonly closed = output<void>();
  readonly saved = output<DevicePatch>();
  readonly revoked = output<void>();
  readonly disconnected = output<void>();

  protected readonly name = signal('');
  protected readonly note = signal('');
  protected readonly confirmingRevoke = signal(false);

  protected readonly text = formatText;
  protected readonly status = computed(() => deviceStatus(this.device()));
  protected readonly kindLabel = computed(() =>
    this.i18n.t(
      this.device().kind === 'relay' ? 'console.devices.kindRelay' : 'console.devices.kindDesktop',
    ),
  );
  protected readonly nameInvalid = computed(() => this.name().trim().length === 0);
  protected readonly revokeMessage = computed(() =>
    this.i18n.t('console.devices.revokeConfirm', { name: this.device().name }),
  );

  protected readonly canSave = computed(() => {
    if (this.busy() || this.nameInvalid()) {
      return false;
    }
    const device = this.device();
    return this.name().trim() !== device.name || this.note().trim() !== (device.note ?? '');
  });

  /** Which device the form below was filled from, so a poll does not overwrite what is typed. */
  private loadedDeviceId = '';

  constructor() {
    // The list refreshes underneath this drawer every ten seconds and hands over fresh objects
    // each time. Only a different device is a reason to reload the form.
    effect(() => {
      const device = this.device();
      if (device.id === this.loadedDeviceId) {
        return;
      }
      this.loadedDeviceId = device.id;
      untracked(() => {
        this.name.set(device.name);
        this.note.set(device.note ?? '');
        this.confirmingRevoke.set(false);
      });
    });
  }

  protected moment(value: number | null): string {
    return formatMoment(value, this.i18n.locale());
  }

  protected since(value: number | null): string {
    return formatSince(value, this.i18n.locale());
  }

  protected save(): void {
    if (!this.canSave()) {
      return;
    }
    const patch: DevicePatch = { name: this.name().trim() };
    if (this.canManage()) {
      patch.note = this.note().trim();
    }
    this.saved.emit(patch);
  }

  protected revoke(): void {
    this.confirmingRevoke.set(false);
    this.revoked.emit();
  }

  protected disconnect(): void {
    this.disconnected.emit();
  }
}
