import { TestBed } from '@angular/core/testing';

import { RemoteHostsDialogComponent } from './remote-hosts-dialog';
import { RemoteHostsService } from '../core/services/remote-hosts.service';

describe('RemoteHostsDialogComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [RemoteHostsDialogComponent],
      providers: [RemoteHostsService],
    });
  });

  it('auto-fills the address, token, and default name when a full access link is pasted', async () => {
    const fixture = TestBed.createComponent(RemoteHostsDialogComponent);
    fixture.detectChanges();

    const addButton = fixture.nativeElement.querySelector(
      '[data-testid="remote-hosts-add"]',
    ) as HTMLButtonElement;
    addButton.click();
    fixture.detectChanges();

    const pasteInput = fixture.nativeElement.querySelector(
      '[data-testid="remote-host-paste-link"]',
    ) as HTMLInputElement;
    pasteInput.value =
      'https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/#token=test_token_123';
    pasteInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const urlInput = fixture.nativeElement.querySelector(
      '[data-testid="remote-host-url"]',
    ) as HTMLInputElement;
    const nameInput = fixture.nativeElement.querySelector(
      '[data-testid="remote-host-name"]',
    ) as HTMLInputElement;
    const saveButton = fixture.nativeElement.querySelector(
      '[data-testid="remote-host-save"]',
    ) as HTMLButtonElement;

    expect(urlInput.value).toBe('https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/');
    expect(nameInput.value).toBe('relay.example.com (abcdef)');
    expect(saveButton.disabled).toBe(false);

    saveButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('[data-testid="remote-host-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('relay.example.com (abcdef)');
  });
});
