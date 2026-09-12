import { Component, inject, input, output } from '@angular/core';

import type { DeviceView } from '../core/console.models';
import { deviceStatus } from '../shared/device-status';
import { formatMoment, formatSince, formatText } from '../shared/format';
import { CopyButtonComponent } from '../shared/copy-button';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';

/** The devices list. Everything it knows comes from its inputs; it changes nothing itself. */
@Component({
  selector: 'console-device-table',
  imports: [CopyButtonComponent, TranslatePipe],
  template: `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>{{ 'console.devices.name' | t }}</th>
            @if (detailed()) {
              <th>{{ 'console.devices.kind' | t }}</th>
              <th>{{ 'console.devices.owner' | t }}</th>
            }
            <th>{{ 'console.devices.status' | t }}</th>
            <th>{{ 'console.devices.connectedSince' | t }}</th>
            <th>{{ 'console.devices.lastSeen' | t }}</th>
            @if (detailed()) {
              <th>{{ 'console.devices.ip' | t }}</th>
            }
            <th>{{ 'console.devices.version' | t }}</th>
            @if (detailed()) {
              <th>{{ 'console.devices.via' | t: { names: '' } }}</th>
            }
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (device of devices(); track device.id) {
            <tr>
              <td class="cell-name">
                {{ device.name }}
                @if (device.access === 'relay-login') {
                  <span class="tag" [title]="'console.devices.accessHint' | t">
                    {{ 'console.devices.accessTag' | t }}
                  </span>
                }
              </td>
              @if (detailed()) {
                <td>{{ kindLabel(device) }}</td>
                <td>{{ owner(device) }}</td>
              }
              <td>
                <span class="status" [attr.data-tone]="statusOf(device).tone">
                  {{ statusOf(device).key | t }}
                </span>
              </td>
              <td>{{ since(device.connectedSince) }}</td>
              <td>{{ moment(device.lastSeenAt) }}</td>
              @if (detailed()) {
                <td class="cell-mono">{{ text(device.lastIp) }}</td>
              }
              <td class="cell-mono">{{ text(device.lastVersion) }}</td>
              @if (detailed()) {
                <td>{{ via(device) }}</td>
              }
              <td>
                <div class="cell-actions">
                  <button type="button" class="btn btn-link" (click)="opened.emit(device)">
                    {{ 'console.common.details' | t }}
                  </button>
                  <console-copy-button
                    buttonClass="btn btn-link"
                    label="console.devices.copyUrl"
                    [value]="device.accessUrl"
                  />
                </div>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DeviceTableComponent {
  private readonly i18n = inject(I18nService);

  readonly devices = input.required<DeviceView[]>();
  /** Administrators see ownership, source address and the route a device is reached through. */
  readonly detailed = input(false);

  readonly opened = output<DeviceView>();

  protected readonly statusOf = deviceStatus;
  protected readonly text = formatText;

  protected moment(value: number | null): string {
    return formatMoment(value, this.i18n.locale());
  }

  protected since(value: number | null): string {
    return formatSince(value, this.i18n.locale());
  }

  protected kindLabel(device: DeviceView): string {
    return this.i18n.t(
      device.kind === 'relay' ? 'console.devices.kindRelay' : 'console.devices.kindDesktop',
    );
  }

  protected owner(device: DeviceView): string {
    return formatText(device.ownerUsername);
  }

  /** An empty route means the device dialled this relay itself rather than a downstream one. */
  protected via(device: DeviceView): string {
    if (device.viaNames.length === 0) {
      return this.i18n.t('console.devices.viaDirect');
    }
    return this.i18n.t('console.devices.via', { names: device.viaNames.join(' → ') });
  }
}
