import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConsoleApiService } from '../core/console-api.service';
import type { EnrollmentView } from '../core/console.models';
import { EnrollmentsPageComponent } from './enrollments-page';

const CODE = 'K7QP-2M4X-9ZTD';

function enrollment(overrides: Partial<EnrollmentView> = {}): EnrollmentView {
  return {
    id: 'e1',
    kind: 'desktop',
    ownerUserId: null,
    ownerUsername: null,
    note: null,
    createdBy: 'admin',
    createdAt: 1,
    expiresAt: 2,
    usedAt: null,
    usedByDeviceId: null,
    status: 'pending',
    ...overrides,
  };
}

describe('EnrollmentsPageComponent', () => {
  let fixture: ComponentFixture<EnrollmentsPageComponent>;
  let root: HTMLElement;
  let createEnrollment: ReturnType<typeof vi.fn>;

  const issueButton = () => root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
  const revealed = () => root.querySelector('.code-reveal code')?.textContent?.trim();

  async function mount(): Promise<void> {
    fixture = TestBed.createComponent(EnrollmentsPageComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    createEnrollment = vi.fn().mockResolvedValue({ enrollment: enrollment(), code: CODE });
    TestBed.configureTestingModule({
      imports: [EnrollmentsPageComponent],
      providers: [
        {
          provide: ConsoleApiService,
          useValue: {
            listEnrollments: vi.fn().mockResolvedValue([enrollment()]),
            listUsers: vi.fn().mockResolvedValue([]),
            createEnrollment,
            cancelEnrollment: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows nothing secret until a code has actually been issued', async () => {
    await mount();

    expect(revealed()).toBeUndefined();
  });

  it('reveals the issued code once, prominently, with a way to copy it', async () => {
    await mount();

    issueButton().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(createEnrollment).toHaveBeenCalledWith({ kind: 'desktop', ttlMinutes: 15 });
    expect(revealed()).toBe(CODE);
    expect(root.querySelector('.code-reveal console-copy-button')).not.toBeNull();
  });

  it('drops the previous code when a new one is issued, so only one is ever on screen', async () => {
    await mount();
    issueButton().click();
    await fixture.whenStable();
    fixture.detectChanges();

    createEnrollment.mockResolvedValue({ enrollment: enrollment({ id: 'e2' }), code: 'NEW-CODE' });
    issueButton().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelectorAll('.code-reveal')).toHaveLength(1);
    expect(revealed()).toBe('NEW-CODE');
  });

  it('refuses a lifetime the relay would reject anyway', async () => {
    await mount();
    const ttl = root.querySelector<HTMLInputElement>('input[name="ttl"]')!;
    ttl.value = '5000';
    ttl.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(issueButton().disabled).toBe(true);
    expect(root.querySelector('.field-error')).not.toBeNull();
  });
});
