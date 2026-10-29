import path from 'node:path';

// Literal argv used by the desktop replay adapter. No shell expansion or unescaping:
// quoted JavaScript, regular expressions and Windows paths must remain unchanged.
export function verificationArgv(command: string): string[] {
  if (!command.trim() || /[\0\r\n]/.test(command) || command.length > 65536) throw new Error('Verification command must be a bounded single-line literal argv.');
  const argv: string[] = [];
  let index = 0;
  while (index < command.length) {
    while (index < command.length && /\s/.test(command[index]!)) index++;
    if (index === command.length) break;
    const quote = command[index] === '"' || command[index] === "'" ? command[index++] : undefined;
    let argument = '';
    if (quote) {
      while (index < command.length && command[index] !== quote) argument += command[index++];
      if (index === command.length) throw new Error('Verification command has an unterminated quoted argument.');
      index++;
      if (index < command.length && !/\s/.test(command[index]!)) throw new Error('Quoted verification arguments must be separated by whitespace; use a check file for complex quoting.');
    } else {
      while (index < command.length && !/\s/.test(command[index]!)) {
        if (!/[\w./:@=+,\\-]/.test(command[index]!)) throw new Error('Verification command needs literal arguments without shell operators; quote a complete argument or use a check file.');
        argument += command[index++];
      }
    }
    argv.push(argument);
  }
  if (!['node', 'git', 'python', 'python3', 'pytest', 'cargo', 'go', 'dotnet'].includes(argv[0]!)) throw new Error(`Verification executable not supported by the interactive adapter yet: ${argv[0]}`);
  return argv;
}

// Parse quoting only. Never expand environment variables, execute substitutions,
// or invoke a shell to interpret a reported command.
function words(command: string): string[] | undefined {
  const result: string[] = [];
  let value = '', started = false, quote: 'single' | 'double' | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (quote === 'single') { if (char === "'") quote = null; else value += char; continue; }
    if (quote === 'double') {
      if (char === '"') { quote = null; continue; }
      if (char === '$' || char === '`') return undefined;
      if (char === '\\' && i + 1 < command.length && ['$', '`', '"', '\\', '\n'].includes(command[i + 1]!)) { const next = command[++i]!; if (next !== '\n') value += next; }
      else value += char;
      continue;
    }
    if (/\s/.test(char)) { if (started) { result.push(value); value = ''; started = false; } continue; }
    started = true;
    if (char === '$' || char === '`') return undefined;
    if (char === "'") { quote = 'single'; continue; }
    if (char === '"') { quote = 'double'; continue; }
    if (char === '\\') { if (i + 1 === command.length) return undefined; const next = command[++i]!; if (next !== '\n') value += next; }
    else value += char;
  }
  if (quote) return undefined;
  if (started) result.push(value);
  return result;
}
function canonical(command: string): string[] | undefined {
  let parts = words(command);
  if (parts && /(?:^|[\\/])(powershell|pwsh)(?:\.exe)?$/i.test(parts[0] || '')) {
    const commandIndex = parts.findIndex(word => /^-command$/i.test(word));
    if (commandIndex > 0 && commandIndex === parts.length - 2 && parts.slice(1, commandIndex).every(word => /^-(noprofile|noninteractive|nologo)$/i.test(word))) parts = words(parts[commandIndex + 1]!);
  }
  for (let depth = 0; depth < 2 && parts?.length === 3; depth += 1) {
    if (!['bash', 'sh', 'zsh'].includes(path.basename(parts[0]!)) || !['-lc', '-c'].includes(parts[1]!)) break;
    parts = words(parts[2]!);
  }
  return parts?.length ? parts : undefined;
}
export function commandEvidenceMatches(actual: string, reported: string, execution: 'shell' | 'literal-argv' = 'shell'): boolean {
  if (execution === 'literal-argv') {
    try { return JSON.stringify(verificationArgv(actual)) === JSON.stringify(verificationArgv(reported)); }
    catch { return false; }
  }
  const a = canonical(actual), b = canonical(reported);
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}
