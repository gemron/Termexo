import type { AgentType } from '../core/models/workspace.models';
import type { QuickKey } from './terminal-key-sequences';

export interface QuickKeyButton {
  readonly key: QuickKey;
  readonly label?: string;
  readonly icon?: string;
  readonly caption: string;
  readonly destructive?: boolean;
}

const key = (key: QuickKey, label: string, action: string): QuickKeyButton => ({
  key,
  label,
  caption: `quickKeys.${action}`,
});
const mode = key('shiftTab', '⇧Tab', 'mode');
const history = key('ctrlR', 'Ctrl+R', 'history');
const newline = key('ctrlJ', 'Ctrl+J', 'newline');
const complete = key('tab', 'Tab', 'complete');
const palette = key('ctrlP', 'Ctrl+P', 'palette');
const cancel: QuickKeyButton = { ...key('ctrlC', 'Ctrl+C', 'cancel'), destructive: true };
const clear = key('ctrlL', 'Ctrl+L', 'clear');

/** Default CLI bindings. Keep agent-specific meanings separate, even for identical key bytes. */
export const AGENT_QUICK_KEY_LAYOUTS: Readonly<Record<AgentType, readonly QuickKeyButton[]>> = {
  claude: [mode, key('ctrlO', 'Ctrl+O', 'transcript'), history, complete, newline, cancel],
  codex: [
    key('shiftTab', '⇧Tab', 'plan'),
    key('ctrlT', 'Ctrl+T', 'transcript'),
    history,
    key('tab', 'Tab', 'queue'),
    newline,
    cancel,
  ],
  opencode: [
    key('shiftTab', '⇧Tab', 'agent'),
    palette,
    key('ctrlXThenM', 'Ctrl+X → M', 'model'),
    key('ctrlT', 'Ctrl+T', 'variant'),
    key('tab', 'Tab', 'tab'),
    cancel,
  ],
  grok: [
    mode,
    palette,
    key('ctrlR', 'Ctrl+R', 'sessions'),
    key('ctrlT', 'Ctrl+T', 'todos'),
    complete,
    cancel,
  ],
  antigravity: [
    newline,
    clear,
    key('pageUp', 'PgUp', 'pageUp'),
    key('pageDown', 'PgDn', 'pageDown'),
    key('tab', 'Tab', 'tab'),
    cancel,
  ],
  shell: [
    complete,
    key('shiftTab', '⇧Tab', 'previous'),
    key('home', 'Home', 'home'),
    key('end', 'End', 'end'),
    clear,
    cancel,
  ],
};

export function navigationKeys(agent: AgentType): readonly QuickKeyButton[] {
  return [
    // Grok uses Ctrl+C to interrupt a turn; Esc only backs out of an overlay.
    key('escape', 'Esc', agent === 'grok' || agent === 'shell' ? 'back' : 'interrupt'),
    { key: 'up', icon: 'arrow-up', caption: 'quickKeys.up' },
    key('enter', 'Enter', 'confirm'),
    { key: 'left', icon: 'arrow-left', caption: 'quickKeys.left' },
    { key: 'down', icon: 'arrow-down', caption: 'quickKeys.down' },
    { key: 'right', icon: 'arrow-right', caption: 'quickKeys.right' },
  ];
}
