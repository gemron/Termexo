import { ComponentFixture, TestBed } from '@angular/core/testing';

import { type AgentInstallation } from '../core/models/agent.models';
import {
  OpenCodeLaunchDialogComponent,
  type OpenCodeLaunchDialogValue,
} from './opencode-launch-dialog';

const INSTALLATION: AgentInstallation = {
  agentType: 'opencode',
  installed: true,
  executablePath: 'opencode',
  version: '1.2.3',
  healthy: true,
  diagnostic: 'OpenCode 可用',
};

describe('OpenCodeLaunchDialogComponent', () => {
  let fixture: ComponentFixture<OpenCodeLaunchDialogComponent>;
  let root: HTMLElement;

  function launchValue(): OpenCodeLaunchDialogValue | undefined {
    let value: OpenCodeLaunchDialogValue | undefined;
    fixture.componentInstance.launched.subscribe((event) => (value = event));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    return value;
  }

  function setText(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpenCodeLaunchDialogComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(OpenCodeLaunchDialogComponent);
    fixture.componentRef.setInput('installation', INSTALLATION);
    fixture.componentRef.setInput('workingDirectory', 'D:/devlop/Termexo');
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  it('will not launch while OpenCode is not detected', () => {
    fixture.componentRef.setInput('installation', { ...INSTALLATION, healthy: false });
    fixture.detectChanges();

    expect(launchValue()).toBeUndefined();
  });

  it('leaves the model unset so OpenCode falls back to its own configuration', () => {
    const value = launchValue();

    expect(value?.model).toBeUndefined();
    expect(value?.autoConfirm).toBe(false);
  });

  it('carries the chosen model and automatic confirmation to the caller', () => {
    const inputs = root.querySelectorAll<HTMLInputElement>('.form-grid input[type="text"]');
    setText(inputs[1], 'anthropic/claude-sonnet-4-5');
    const autoConfirm = root.querySelector<HTMLInputElement>('.auto-confirm-control input')!;
    autoConfirm.checked = true;
    autoConfirm.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const value = launchValue();

    expect(value?.model).toBe('anthropic/claude-sonnet-4-5');
    expect(value?.autoConfirm).toBe(true);
  });

  it('trims a padded session name rather than passing the spaces through', () => {
    const inputs = root.querySelectorAll<HTMLInputElement>('.form-grid input[type="text"]');
    setText(inputs[0], '  OpenCode 适配  ');

    expect(launchValue()?.name).toBe('OpenCode 适配');
  });
});
