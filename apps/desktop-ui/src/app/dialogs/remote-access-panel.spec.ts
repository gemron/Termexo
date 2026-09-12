import { ComponentFixture, TestBed } from '@angular/core/testing';

import type {
  QrCodeImage,
  RelayEnrollRequest,
  RelayStatus,
  RemoteAccessSettings,
  RemoteAccessStatus,
} from '../core/models/remote-access.models';
import { RemoteAccessService } from '../core/services/remote-access.service';
import { RemoteAccessPanelComponent } from './remote-access-panel';

const TOKEN = 'token-value';

function relayStatus(overrides: Partial<RelayStatus> = {}): RelayStatus {
  return {
    state: 'disabled',
    error: null,
    deviceId: null,
    deviceName: null,
    addresses: [],
    connectedSince: null,
    ...overrides,
  };
}

function accessStatus(overrides: Partial<RemoteAccessStatus> = {}): RemoteAccessStatus {
  return {
    settings: {
      enabled: true,
      bindAddress: '0.0.0.0',
      port: 7420,
      tls: true,
      relay: { enabled: false, url: '', certificateFingerprint: null },
    },
    running: true,
    error: null,
    addresses: [{ address: '192.168.1.10', interfaceName: 'Wi-Fi', loopback: false }],
    token: TOKEN,
    connectedClients: 0,
    relay: relayStatus(),
    ...overrides,
  };
}

/**
 * Keeps the real link builders and replaces only what would reach the backend.
 *
 * The panel's job is to turn a status into a link and a form into one command, so the builders
 * have to be the production ones for the assertions below to mean anything.
 */
class FakeRemoteAccessService extends RemoteAccessService {
  status = accessStatus();
  readonly saved: RemoteAccessSettings[] = [];
  readonly enrolled: RelayEnrollRequest[] = [];
  disconnectCalls = 0;
  enrollError: string | null = null;

  override getStatus(): Promise<RemoteAccessStatus> {
    return Promise.resolve(this.status);
  }

  override updateSettings(settings: RemoteAccessSettings): Promise<RemoteAccessStatus> {
    this.saved.push(settings);
    return Promise.resolve(this.status);
  }

  override regenerateToken(): Promise<RemoteAccessStatus> {
    return Promise.resolve(this.status);
  }

  override renderQr(): Promise<QrCodeImage> {
    return Promise.resolve({ path: 'M0 0h1v1h-1z', size: 21 });
  }

  override enrollRelayDevice(request: RelayEnrollRequest): Promise<RemoteAccessStatus> {
    this.enrolled.push(request);
    return this.enrollError ? Promise.reject(this.enrollError) : Promise.resolve(this.status);
  }

  override disconnectRelay(): Promise<RemoteAccessStatus> {
    this.disconnectCalls += 1;
    return Promise.resolve(this.status);
  }
}

describe('RemoteAccessPanelComponent', () => {
  let fixture: ComponentFixture<RemoteAccessPanelComponent>;
  let root: HTMLElement;
  let service: FakeRemoteAccessService;

  /** In join order: relay address, device name, then the fields the chosen method needs. */
  const relayFields = () =>
    Array.from(root.querySelectorAll<HTMLInputElement>('.remote-relay-fields input'));
  const methodButtons = () =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.remote-relay-method button'));
  const joinButton = () => root.querySelector<HTMLButtonElement>('.remote-relay-actions .primary')!;

  function type(field: HTMLInputElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function mount(status?: RemoteAccessStatus): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [RemoteAccessPanelComponent],
      providers: [{ provide: RemoteAccessService, useClass: FakeRemoteAccessService }],
    }).compileComponents();
    service = TestBed.inject(RemoteAccessService) as FakeRemoteAccessService;
    if (status) {
      service.status = status;
    }
    fixture = TestBed.createComponent(RemoteAccessPanelComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps the join button out of reach until the relay, name and code are all filled in', async () => {
    await mount();
    const [url, name, code] = relayFields();

    expect(joinButton().disabled).toBe(true);

    type(url, 'https://relay.example.com');
    type(name, 'Desk PC');
    expect(joinButton().disabled).toBe(true);

    type(code, 'ABCD-EFGH');
    expect(joinButton().disabled).toBe(false);
  });

  it('rejects a relay address that is not an http(s) origin', async () => {
    await mount();
    const [url, name] = relayFields();

    type(url, 'relay.example.com');
    type(name, 'Desk PC');
    type(relayFields()[2], 'ABCD-EFGH');

    expect(root.querySelector('.field-error')).not.toBeNull();
    expect(joinButton().disabled).toBe(true);
  });

  it('joins with an enrolment code and does not keep the code on screen', async () => {
    await mount();
    const [url, name] = relayFields();
    type(url, 'https://relay.example.com');
    type(name, 'Desk PC');
    type(relayFields()[2], 'ABCD-EFGH');

    joinButton().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.enrolled).toEqual([
      {
        url: 'https://relay.example.com',
        method: { method: 'code', code: 'ABCD-EFGH', name: 'Desk PC' },
        name: 'Desk PC',
      },
    ]);
    expect(relayFields()[2].value).toBe('');
  });

  it('joins with a relay account when that method is picked', async () => {
    await mount();
    const [url, name] = relayFields();
    type(url, 'https://relay.example.com');
    type(name, 'Desk PC');
    methodButtons()[1].click();
    fixture.detectChanges();

    const [, , username, password] = relayFields();
    type(username, 'ada');
    type(password, 'secret');
    joinButton().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.enrolled[0].method).toEqual({
      method: 'password',
      username: 'ada',
      password: 'secret',
      name: 'Desk PC',
    });
    // A password is a one-shot secret; leaving it in the field would only expose it.
    expect(relayFields()[3].value).toBe('');
  });

  it('reports why a join failed instead of leaving the form silent', async () => {
    await mount();
    service.enrollError = '接入码已过期';
    const [url, name] = relayFields();
    type(url, 'https://relay.example.com');
    type(name, 'Desk PC');
    type(relayFields()[2], 'ABCD-EFGH');

    joinButton().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('.remote-alert.error')?.textContent).toContain('接入码已过期');
  });

  it('lists the relay addresses beside the LAN one and links to the chosen relay', async () => {
    await mount(
      accessStatus({
        relay: relayStatus({
          state: 'connected',
          deviceId: 'abc',
          deviceName: 'Desk PC',
          connectedSince: Date.now() - 120_000,
          addresses: [
            { relayId: 'b', relayName: 'relay-b', url: 'https://relay-b.lan/d/abc/', hops: 0 },
            { relayId: 'a', relayName: 'relay-a', url: 'https://relay-a.example/d/abc/', hops: 1 },
          ],
        }),
      }),
    );

    const select = root.querySelector<HTMLSelectElement>('.remote-address-pick select')!;
    const labels = Array.from(select.options).map((option) => option.textContent?.trim());
    expect(labels).toHaveLength(3);
    expect(labels[1]).toContain('relay-b · https://relay-b.lan/d/abc/');
    // An address further up the chain is named by the relay it is reached through.
    expect(labels[2]).toContain('relay-a');

    select.value = 'https://relay-a.example/d/abc/';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(root.querySelector('.remote-link-row code')?.textContent).toBe(
      `https://relay-a.example/d/abc/#token=${TOKEN}`,
    );
  });

  it('offers the relay link even when nothing is listening on the LAN', async () => {
    await mount(
      accessStatus({
        running: false,
        settings: {
          enabled: false,
          bindAddress: '0.0.0.0',
          port: 7420,
          tls: true,
          relay: { enabled: true, url: 'https://relay-b.lan', certificateFingerprint: null },
        },
        relay: relayStatus({
          state: 'connected',
          deviceId: 'abc',
          addresses: [
            { relayId: 'b', relayName: 'relay-b', url: 'https://relay-b.lan/d/abc/', hops: 0 },
          ],
        }),
      }),
    );

    expect(root.querySelector('.remote-link-row code')?.textContent).toBe(
      `https://relay-b.lan/d/abc/#token=${TOKEN}`,
    );
  });

  it('confirms before dropping the relay link and forgetting the credential', async () => {
    await mount(
      accessStatus({
        relay: relayStatus({ state: 'connected', deviceId: 'abc', deviceName: 'Desk PC' }),
      }),
    );

    root.querySelector<HTMLButtonElement>('.remote-relay-disconnect')!.click();
    fixture.detectChanges();
    expect(service.disconnectCalls).toBe(0);

    root.querySelector<HTMLButtonElement>('.remote-confirm-actions .danger')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.disconnectCalls).toBe(1);
  });

  it('carries the relay settings back untouched when the listening options are saved', async () => {
    const relay = { enabled: true, url: 'https://relay-b.lan', certificateFingerprint: 'ab:cd' };
    await mount(
      accessStatus({
        settings: { enabled: true, bindAddress: '0.0.0.0', port: 7420, tls: true, relay },
      }),
    );

    const https = root.querySelector<HTMLInputElement>('.remote-tls input')!;
    https.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.remote-apply .primary')!.click();
    await fixture.whenStable();

    expect(service.saved).toHaveLength(1);
    expect(service.saved[0].tls).toBe(false);
    expect(service.saved[0].relay).toEqual(relay);
  });
});
