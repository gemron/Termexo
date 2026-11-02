import { describe, expect, it } from 'vitest';
import { previewShellSyntax, quoteShellArgument } from './shell-command';

describe('shell command previews', () => {
  it('uses POSIX quoting on Linux and macOS and PowerShell quoting on Windows', () => {
    expect(previewShellSyntax('X11; Linux x86_64')).toBe('posix');
    expect(previewShellSyntax('Macintosh; Intel Mac OS X')).toBe('posix');
    expect(previewShellSyntax('Windows NT 10.0')).toBe('powershell');
    expect(quoteShellArgument("it's $HOME", 'posix')).toBe("'it'\\''s $HOME'");
    expect(quoteShellArgument("it's $HOME", 'powershell')).toBe("'it''s $HOME'");
  });
});
