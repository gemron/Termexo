import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConsoleApiService } from '../core/console-api.service';
import type { DeviceView } from '../core/console.models';
import { SessionService } from '../core/session.service';
import { I18nService } from '../shared/workspace-ui';
import { DevicesPageComponent } from './devices-page';

const POLL_MS = 10_000;

function device(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 'd1',
    kind: 'desktop',
    name: '家里的台式机',
    ownerUserId: 'u1',
    ownerUsername: 'ada',
    online: true,
    connectedSince: 1_000,
    lastSeenAt: 2_000,
    lastIp: '203.0.113.7',
    lastVersion: '0.9.0',
    via: [],
    viaNames: [],
    revokedAt: null,
    note: null,
    accessUrl: 'https://relay.example.com/d/abc/',
    ...overrides,
  };
}

/**
 * The workspace runs Angular without zone.js, so `fakeAsync` has no zone to patch. Vitest's own
 * fake timers drive the poll instead, and `advanceTimersByTimeAsync` flushes the promises each
 * tick starts.
 */
describe('DevicesPageComponent', () => {
  let fixture: ComponentFixture<DevicesPageComponent>;
  let root: HTMLElement;
  let listAllDevices: ReturnType<typeof vi.fn>;
  let revokeDevice: ReturnType<typeof vi.fn>;

  const rowNames = () =>
    Array.from(root.querySelectorAll('.data-table .cell-name')).map((cell) =>
      cell.textContent?.trim(),
    );

  async function mount(): Promise<void> {
    fixture = TestBed.createComponent(DevicesPageComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    listAllDevices = vi.fn().mockResolvedValue([device()]);
    revokeDevice = vi.fn().mockResolvedValue(device({ revokedAt: 3_000 }));
    TestBed.configureTestingModule({
      imports: [DevicesPageComponent],
      providers: [
        {
          provide: ConsoleApiService,
          useValue: {
            listAllDevices,
            listOwnDevices: vi.fn().mockResolvedValue([]),
            updateDevice: vi.fn(),
            revokeDevice,
            disconnectDevice: vi.fn(),
          },
        },
        { provide: SessionService, useValue: { isAdmin: signal(true) } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('renders the devices the relay reports', async () => {
    await mount();

    expect(rowNames()).toEqual(['家里的台式机']);
  });

  it('offers the next step instead of an empty table', async () => {
    listAllDevices.mockResolvedValue([]);
    await mount();

    // Asserted through the active language, so the test says which wording is used, not which
    // locale the test runner happens to pick.
    const help = TestBed.inject(I18nService).t('console.devices.emptyHelpAdmin');
    expect(root.querySelector('.state-block')?.textContent).toContain(help);
  });

  it('polls every ten seconds and stops when the page is left', async () => {
    vi.useFakeTimers();
    await mount();
    expect(listAllDevices).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(listAllDevices).toHaveBeenCalledTimes(2);

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    // A page nobody is looking at must not keep asking the relay for data.
    expect(listAllDevices).toHaveBeenCalledTimes(2);
  });

  it('asks before revoking a device and only then calls the relay', async () => {
    await mount();

    root.querySelector<HTMLButtonElement>('.cell-actions .btn-link')!.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.drawer-panel .btn-danger')!.click();
    fixture.detectChanges();
    expect(revokeDevice).not.toHaveBeenCalled();

    root.querySelector<HTMLButtonElement>('.inline-confirm .btn-danger')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(revokeDevice).toHaveBeenCalledWith('d1', true);
  });
});
