import { accessSync, constants, statSync } from 'node:fs';
import { chromium } from 'playwright-core';

const isExecutable = (file) => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Browser preview checks use Chromium; native Linux desktop checks use WebKitWebDriver. */
export function resolveBrowserExecutable({
  environment = process.env,
  platform = process.platform,
  executable = isExecutable,
  bundled = chromium.executablePath(),
} = {}) {
  const override = environment.BROWSER_PATH ?? environment.EDGE_PATH;
  if (override) {
    if (executable(override)) return override;
    throw new Error(`Browser executable is not runnable: ${override}`);
  }
  const candidates =
    platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/opt/google/chrome/chrome',
            '/opt/microsoft/msedge/msedge',
          ];
  const found = [...candidates, bundled].find(executable);
  if (!found)
    throw new Error(
      'No Chromium browser found. Install Chromium/Chrome or set BROWSER_PATH (EDGE_PATH also works).',
    );
  return found;
}
