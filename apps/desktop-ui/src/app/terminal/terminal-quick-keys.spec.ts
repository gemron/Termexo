import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nService } from '../core/i18n/i18n.service';
import { QUICK_KEY_TRANSLATIONS } from '../core/i18n/quick-keys.i18n';
import { AGENT_LABELS, type AgentType } from '../core/models/workspace.models';
import type { QuickKey } from './terminal-key-sequences';
import { TerminalQuickKeysComponent } from './terminal-quick-keys';

describe('TerminalQuickKeysComponent', () => {
  let fixture: ComponentFixture<TerminalQuickKeysComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    TestBed.inject(I18nService).setPreference('en');
    fixture = TestBed.createComponent(TerminalQuickKeysComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    root = fixture.nativeElement;
  });

  function selectAgent(agent: AgentType) {
    fixture.componentRef.setInput('agentType', agent);
    fixture.detectChanges();
  }

  function open() {
    root.querySelector<HTMLButtonElement>('[data-testid=quick-keys-toggle]')!.click();
    fixture.detectChanges();
  }

  const button = (key: QuickKey) => root.querySelector<HTMLButtonElement>(`[data-key=${key}]`);

  it('starts collapsed and switches agent-specific keys on the existing open panel', () => {
    expect(root.querySelector('.quick-key-pad')).toBeNull();
    selectAgent('claude');
    open();
    expect(root.textContent).toContain('Claude Code');
    expect(button('ctrlO')?.textContent).toContain('Transcript');
    expect(button('ctrlT')).toBeNull();
    expect(button('shiftLeft')).toBeNull();
    selectAgent('codex');
    expect(root.textContent).toContain('Codex CLI');
    expect(button('ctrlO')).toBeNull();
    expect(button('ctrlT')?.textContent).toContain('Transcript');
    expect(button('shiftTab')?.textContent).toContain('Plan mode');
    expect(button('shiftLeft')?.textContent).toContain('Edit queued input');
  });

  it('uses Grok meanings for shared shortcuts and does not advertise Esc as interruption', () => {
    selectAgent('grok');
    open();
    expect(button('ctrlR')?.textContent).toContain('Sessions');
    expect(button('ctrlT')?.textContent).toContain('To-do list');
    expect(button('escape')?.textContent).toContain('Back / close');
    expect(button('ctrlC')?.classList.contains('destructive')).toBe(true);
    selectAgent('claude');
    expect(button('ctrlR')?.textContent).toContain('Find history');
    expect(button('escape')?.textContent).toContain('Interrupt / back');
  });

  it('provides OpenCode leader keys and emits each press once without closing the pad', () => {
    const received: QuickKey[] = [];
    fixture.componentInstance.keyPressed.subscribe((key) => received.push(key));
    selectAgent('opencode');
    open();
    button('ctrlXThenM')!.click();
    button('down')!.click();
    button('down')!.click();
    button('enter')!.click();
    fixture.detectChanges();
    expect(received).toEqual(['ctrlXThenM', 'down', 'down', 'enter']);
    expect(root.querySelector('.quick-key-pad')).not.toBeNull();
  });

  it('uses editing and scrolling keys for Antigravity and ordinary shell controls for Shell', () => {
    selectAgent('antigravity');
    open();
    expect(button('ctrlJ')?.textContent).toContain('New line');
    expect(button('pageDown')?.textContent).toContain('Page down');
    expect(button('shiftTab')).toBeNull();
    selectAgent('shell');
    expect(button('shiftTab')?.textContent).toContain('Previous field');
    expect(button('home')).not.toBeNull();
    expect(button('ctrlJ')).toBeNull();
    expect(button('ctrlP')).toBeNull();
  });

  it('keeps keyboard focus from being changed by a mouse press or its parent handler', () => {
    open();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    let bubbled = false;
    root.addEventListener('mousedown', () => {
      bubbled = true;
    });
    button('enter')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).toBe(false);
  });

  it('labels every agent key in every supported language, including accessible button names', () => {
    open();
    for (const language of Object.keys(QUICK_KEY_TRANSLATIONS)) {
      TestBed.inject(I18nService).setPreference(
        language as Parameters<I18nService['setPreference']>[0],
      );
      for (const agent of Object.keys(AGENT_LABELS) as AgentType[]) {
        selectAgent(agent);
        expect(root.querySelector('.quick-key-heading')?.textContent).toContain(
          AGENT_LABELS[agent],
        );
        expect(root.textContent).not.toContain('quickKeys.');
        expect(root.querySelectorAll('[data-key]')).toHaveLength(agent === 'codex' ? 13 : 12);
        for (const key of root.querySelectorAll('[data-key]')) {
          expect(key.getAttribute('aria-label')).toBeTruthy();
          expect(key.getAttribute('aria-label')).not.toContain('quickKeys.');
        }
      }
    }
  });
});
