import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { quoteShellArgument } from '../apps/desktop-ui/src/app/core/models/shell-command.ts';

test(
  'browser POSIX previews preserve literal arguments when actually executed by Bash',
  {
    skip: process.platform === 'win32',
  },
  () => {
    for (const value of [
      '',
      "directory's name",
      '$HOME; $(printf injected)',
      'hello!world',
      '空格 目录',
      'line\nbreak',
    ]) {
      const output = execFileSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-c', `printf '%s' ${quoteShellArgument(value, 'posix')}`],
        { encoding: 'utf8' },
      );
      assert.equal(output, value);
    }
  },
);
