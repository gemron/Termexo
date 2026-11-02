export type ShellSyntax = 'powershell' | 'posix';

/** Preview-only: connected desktops generate commands on the host backend. */
export function previewShellSyntax(userAgent = navigator.userAgent): ShellSyntax {
  return /Windows/i.test(userAgent) ? 'powershell' : 'posix';
}

export function quoteShellArgument(value: string, syntax = previewShellSyntax()): string {
  return `'${value.replaceAll("'", syntax === 'powershell' ? "''" : "'\\''")}'`;
}
