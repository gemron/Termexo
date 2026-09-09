import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { WebviewStatusService } from './webview-status.service';

/**
 * Covers the runtimes that are not a WebView2 at all — the browser preview and a phone on remote
 * access. Both would otherwise be told to install a runtime for a machine they are not running on.
 */
describe('WebviewStatusService outside the desktop window', () => {
  let service: WebviewStatusService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [WebviewStatusService] });
    service = TestBed.inject(WebviewStatusService);
  });

  it('reports no runtime and raises no notice', () => {
    expect(service.status()).toBeNull();
    expect(service.upgradeNeeded()).toBe(false);
  });

  it('stays quiet once the notice has been put aside', () => {
    service.dismiss();

    expect(service.upgradeNeeded()).toBe(false);
  });
});
