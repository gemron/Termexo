import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PtyBackendService } from './pty-backend.service';

/**
 * Covers the browser preview, which has no backend to ask. Reaching for one there would throw on
 * construction of the first terminal panel and take the whole preview down with it.
 */
describe('PtyBackendService without a backend', () => {
  let service: PtyBackendService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PtyBackendService] });
    service = TestBed.inject(PtyBackendService);
  });

  it('reports no pseudo console, leaving xterm on its own defaults', () => {
    expect(service.backend()).toBeNull();
  });
});
