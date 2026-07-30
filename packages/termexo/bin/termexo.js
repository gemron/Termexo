#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RELEASES_URL,
  findExecutable,
  launchExecutable,
  openDownloadPage,
} from '../lib/launcher.js';

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const command = process.argv[2]?.toLowerCase() ?? 'start';

function printHelp() {
  console.log(`Termexo ${packageJson.version}

Usage:
  termexo              Start the bundled Termexo desktop app
  termexo start        Start the bundled Termexo desktop app
  termexo download     Open the latest Termexo release page
  termexo --version    Print the launcher version
  termexo --help       Show this help

Set TERMEXO_PATH to the full path of termexo.exe when using a custom
installation directory.`);
}

if (command === '--help' || command === '-h' || command === 'help') {
  printHelp();
} else if (command === '--version' || command === '-v' || command === 'version') {
  console.log(packageJson.version);
} else if (command === 'download') {
  openDownloadPage();
  console.log(`Opened ${RELEASES_URL}`);
} else if (command === 'start') {
  const executable = findExecutable();
  if (!executable) {
    console.error(`The Termexo executable is missing from this npm package.

Reinstall the package or download the Windows installer:
  npm install --global termexo@latest
  termexo download
  ${RELEASES_URL}

For a custom installation, set TERMEXO_PATH to the full path of termexo.exe.`);
    process.exitCode = 1;
  } else {
    launchExecutable(executable);
    console.log(`Started Termexo from ${executable}`);
  }
} else {
  console.error(`Unknown command: ${process.argv[2]}`);
  printHelp();
  process.exitCode = 1;
}
