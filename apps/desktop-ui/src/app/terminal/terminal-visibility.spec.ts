import {
  layoutTerminalCapacity,
  resolveVisibleTerminalIds,
  revealTerminalInLayout,
} from './terminal-visibility';

const TERMINALS = Array.from({ length: 8 }, (_, index) => ({ id: `terminal-${index + 1}` }));

describe('terminal visibility', () => {
  it('limits only the visible panes instead of limiting the terminal collection', () => {
    expect(layoutTerminalCapacity('single')).toBe(1);
    expect(layoutTerminalCapacity('columns')).toBe(2);
    expect(layoutTerminalCapacity('rows')).toBe(2);
    expect(layoutTerminalCapacity('grid')).toBe(4);

    expect(resolveVisibleTerminalIds(TERMINALS, 'terminal-8', [], 'grid')).toEqual([
      'terminal-8',
      'terminal-1',
      'terminal-2',
      'terminal-3',
    ]);
    expect(TERMINALS).toHaveLength(8);
  });

  it('uses custom grid dimensions and clamps unsafe values', () => {
    expect(layoutTerminalCapacity('grid', 3, 2)).toBe(6);
    expect(layoutTerminalCapacity('grid', 0, 99)).toBe(6);
    expect(resolveVisibleTerminalIds(TERMINALS, 'terminal-8', [], 'grid', false, 3, 2)).toEqual([
      'terminal-8',
      'terminal-1',
      'terminal-2',
      'terminal-3',
      'terminal-4',
      'terminal-5',
    ]);
  });

  it('replaces the selected pane when a hidden terminal is requested', () => {
    expect(
      revealTerminalInLayout(
        ['terminal-1', 'terminal-2', 'terminal-3', 'terminal-4'],
        'terminal-2',
        'terminal-8',
        'grid',
      ),
    ).toEqual(['terminal-1', 'terminal-8', 'terminal-3', 'terminal-4']);
  });

  it('removes closed terminals and keeps the active terminal visible', () => {
    expect(
      resolveVisibleTerminalIds(
        TERMINALS.slice(2),
        'terminal-8',
        ['terminal-1', 'terminal-2', 'terminal-3', 'terminal-4'],
        'columns',
      ),
    ).toEqual(['terminal-3', 'terminal-8']);
  });

  it('shows only the active terminal while a pane is maximized', () => {
    expect(
      resolveVisibleTerminalIds(
        TERMINALS,
        'terminal-6',
        ['terminal-1', 'terminal-2', 'terminal-3', 'terminal-4'],
        'grid',
        true,
      ),
    ).toEqual(['terminal-6']);
  });

  it('reveals a hidden terminal within a custom grid capacity', () => {
    expect(
      revealTerminalInLayout(
        ['terminal-1', 'terminal-2', 'terminal-3', 'terminal-4', 'terminal-5', 'terminal-6'],
        'terminal-3',
        'terminal-8',
        'grid',
        3,
        2,
      ),
    ).toEqual(['terminal-1', 'terminal-2', 'terminal-8', 'terminal-4', 'terminal-5', 'terminal-6']);
  });
});
