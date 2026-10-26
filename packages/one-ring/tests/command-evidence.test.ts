import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandEvidenceMatches } from '../src/command-evidence.js';

test('command evidence unwraps shell quoting without executing a command', () => {
  assert(commandEvidenceMatches('/bin/bash -lc "node --test"', 'node --test'));
  assert(commandEvidenceMatches(`/bin/bash -lc "rg --files --hidden -g '\"'!node_modules'\"' -g '\"'!.git'\"'"`, `rg --files --hidden -g '!node_modules' -g '!.git'`));
  assert(commandEvidenceMatches('/bin/bash -lc "node \'path with spaces/test.js\'"', 'node "path with spaces/test.js"'));
  assert(commandEvidenceMatches('node   --test', 'node --test'));
});
test('unrelated arguments, truncated commands and malformed quotes cannot satisfy evidence', () => {
  assert(!commandEvidenceMatches('node --test-hidden', 'node --test'));
  assert(!commandEvidenceMatches('node --test ; false', 'node --test'));
  assert(!commandEvidenceMatches('node --test', ''));
  assert(!commandEvidenceMatches('node "unterminated', 'node unterminated'));
  assert(!commandEvidenceMatches('node --test a.js', 'node --test b.js'));
  assert(!commandEvidenceMatches("echo '$SECRET'", 'echo "$SECRET"'));
  assert(!commandEvidenceMatches('echo $(cat /private)', 'echo $(cat /private)'));
});

test('Windows command evidence unwraps only a complete PowerShell command', () => {
  assert(commandEvidenceMatches('powershell.exe -NoProfile -Command "node --test"', 'node --test'));
  assert(commandEvidenceMatches('"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command "node --test"', 'node --test'));
  assert(!commandEvidenceMatches('pwsh -Command "node --test; exit 1"', 'node --test'));
  assert(!commandEvidenceMatches('pwsh -EncodedCommand abc', 'node --test'));
});

test('desktop literal argv evidence preserves JavaScript dollar anchors and backslashes', () => {
  const command = String.raw`node -e "const line=/[\t ]+$/;const slash=/\\/;console.log(line.test('clean'),slash.test('x'));"`;
  assert(!commandEvidenceMatches(command, command)); // Shell context remains ambiguous.
  assert(commandEvidenceMatches(command, command, 'literal-argv'));
  assert(!commandEvidenceMatches(command, command.replace("'clean'", "'changed'"), 'literal-argv'));
  assert(commandEvidenceMatches('node --check "C:\\a folder\\check.js"', "node --check 'C:\\a folder\\check.js'", 'literal-argv'));
  for (const value of ['node $(whoami)', 'node --test; echo PASS', 'node --test && true', 'node "unfinished', 'pwsh -Command "node --test"']) {
    assert(!commandEvidenceMatches(value, value, 'literal-argv'));
  }
});
