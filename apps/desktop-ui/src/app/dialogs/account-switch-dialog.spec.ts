import { ComponentFixture, TestBed } from '@angular/core/testing';

import { type AccountProfile } from '../core/models/agent.models';
import { AccountSwitchDialogComponent } from './account-switch-dialog';

const account = (
  id: string,
  name: string,
  overrides: Partial<AccountProfile> = {},
): AccountProfile => ({
  id,
  name,
  agentType: 'claude',
  isDefault: false,
  isSystem: false,
  authenticated: true,
  diagnostic: '',
  ...overrides,
});

const SYSTEM = account('claude-system', 'System Claude', { isDefault: true });
const WORK = account('claude-work', 'Work');
const SIGNED_OUT = account('claude-spare', 'Spare', { authenticated: false });
const CODEX = account('codex-work', 'Codex Work', { agentType: 'codex' });

describe('AccountSwitchDialogComponent', () => {
  let fixture: ComponentFixture<AccountSwitchDialogComponent>;
  let component: AccountSwitchDialogComponent;
  let root: HTMLElement;

  const optionFor = (name: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.profile-option')).find((button) =>
      button.textContent?.includes(name),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountSwitchDialogComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(AccountSwitchDialogComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('accounts', [SYSTEM, WORK, SIGNED_OUT, CODEX]);
    fixture.componentRef.setInput('agentType', 'claude');
    fixture.componentRef.setInput('terminalName', 'Claude 1');
    fixture.componentRef.setInput('currentAccountProfileId', 'claude-system');
    fixture.detectChanges();
  });

  it('offers only the accounts belonging to the terminal’s agent', () => {
    expect(optionFor('Codex Work')).toBeUndefined();
    expect(optionFor('Work')).toBeDefined();
  });

  it('shows and disables the account the terminal already runs on', () => {
    const current = optionFor('System Claude');

    expect(current?.disabled).toBe(true);
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(optionFor('Work')?.disabled).toBe(false);
  });

  it('emits only a switchable account', () => {
    const chosen: string[] = [];
    component.confirmed.subscribe((value) => chosen.push(value));

    optionFor('Work')!.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();

    expect(chosen).toEqual(['claude-work']);
  });

  it('warns before restarting onto an account that has not signed in', () => {
    expect(root.querySelector('.account-blocker')).toBeNull();

    optionFor('Spare')!.click();
    fixture.detectChanges();

    expect(root.querySelector('.account-blocker')?.textContent).toContain('login');
  });

  it('cannot switch when the running account is the only one the agent has', () => {
    fixture.componentRef.setInput('accounts', [SYSTEM]);
    fixture.detectChanges();

    expect(root.querySelector<HTMLButtonElement>('footer .primary')?.disabled).toBe(true);
  });
});
