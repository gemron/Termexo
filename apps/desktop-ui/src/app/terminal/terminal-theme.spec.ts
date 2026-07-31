import { createTerminalTheme } from './terminal-theme';

describe('terminal theme', () => {
  it('uses the workspace accent for the cursor and terminal surfaces', () => {
    const orange = createTerminalTheme('#e4a35a');
    const violet = createTerminalTheme('#a78bfa');

    expect(orange.cursor).toBe('#e4a35a');
    expect(violet.cursor).toBe('#a78bfa');
    expect(orange.background).not.toBe(violet.background);
    expect(orange.selectionBackground).not.toBe(violet.selectionBackground);
  });
});
