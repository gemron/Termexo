import { ComponentFixture, TestBed } from '@angular/core/testing';

import { type AgentInstallation } from '../core/models/agent.models';
import {
  OpenCodeLaunchDialogComponent,
  type OpenCodeLaunchDialogValue,
} from './opencode-launch-dialog';

/**
 * The launch shell is exercised through a real form so content projection, keyboard handling and
 * the busy state are covered the way the three launch dialogs actually assemble them.
 */
const INSTALLATION: AgentInstallation = {
  agentType: 'opencode',
  installed: true,
  executablePath: 'opencode',
  version: '1.2.3',
  healthy: true,
  diagnostic: 'OpenCode 可用',
};

describe('LaunchDialogShellComponent', () => {
  let fixture: ComponentFixture<OpenCodeLaunchDialogComponent>;
  let root: HTMLElement;
  const launches: OpenCodeLaunchDialogValue[] = [];
  let cancels = 0;

  function sessionNameInput(): HTMLInputElement {
    return root.querySelector<HTMLInputElement>('.session-name-field input')!;
  }

  function pressKey(key: string, init: KeyboardEventInit = {}): void {
    sessionNameInput().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    launches.length = 0;
    cancels = 0;
    await TestBed.configureTestingModule({
      imports: [OpenCodeLaunchDialogComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(OpenCodeLaunchDialogComponent);
    fixture.componentRef.setInput('installation', INSTALLATION);
    fixture.componentRef.setInput('workingDirectory', 'D:/devlop/Termexo');
    fixture.detectChanges();
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.launched.subscribe((value) => launches.push(value));
    fixture.componentInstance.cancelled.subscribe(() => (cancels += 1));
  });

  it('focuses the session name so the dialog is ready to type into', () => {
    expect(document.activeElement).toBe(sessionNameInput());
  });

  it('starts the session on Enter instead of forcing a trip to the button', () => {
    pressKey('Enter');

    expect(launches).toHaveLength(1);
  });

  it('leaves Enter to the IME while a candidate list is open', () => {
    pressKey('Enter', { isComposing: true });

    expect(launches).toHaveLength(0);
  });

  it('closes on Escape', () => {
    pressKey('Escape');

    expect(cancels).toBe(1);
  });

  it('reports the launch in progress and refuses a second one', () => {
    fixture.componentRef.setInput('launching', true);
    fixture.detectChanges();

    const start = root.querySelector<HTMLButtonElement>('footer .primary')!;
    expect(start.disabled).toBe(true);
    start.click();
    pressKey('Enter');

    expect(launches).toHaveLength(0);
  });

  it('keeps the dialog open while a launch is in flight', () => {
    fixture.componentRef.setInput('launching', true);
    fixture.detectChanges();

    pressKey('Escape');
    root
      .querySelector<HTMLDivElement>('.backdrop')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(cancels).toBe(0);
  });

  it('explains why launching is blocked rather than greying the button out in silence', () => {
    fixture.componentRef.setInput('installation', {
      ...INSTALLATION,
      healthy: false,
      diagnostic: '未检测到 OpenCode',
    });
    fixture.detectChanges();

    expect(root.querySelector('footer .primary')?.getAttribute('title')).toBe('未检测到 OpenCode');
  });
});
