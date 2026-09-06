import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { DirectoryPickerService } from './directory-picker.service';

/**
 * Covers the path taken outside the Tauri window — the browser preview and, more importantly, a
 * phone on remote access, where this prompt is the only way to start a terminal at all.
 */
describe('DirectoryPickerService without a native dialog', () => {
  let service: DirectoryPickerService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DirectoryPickerService] });
    service = TestBed.inject(DirectoryPickerService);
  });

  it('waits for the in-app prompt and reports the folder that was entered', async () => {
    const selection = service.select('D:\\dev\\termexo');

    expect(service.prompt()?.initialDirectory).toBe('D:\\dev\\termexo');

    service.resolvePrompt('D:\\dev\\other');

    await expect(selection).resolves.toBe('D:\\dev\\other');
    expect(service.prompt()).toBeNull();
  });

  it('treats a cancelled or blank prompt as no selection', async () => {
    const cancelled = service.select('D:\\dev\\termexo');
    service.resolvePrompt(null);
    await expect(cancelled).resolves.toBeNull();

    const blank = service.select('D:\\dev\\termexo');
    service.resolvePrompt('   ');
    await expect(blank).resolves.toBeNull();
  });

  it('trims the folder before reporting it', async () => {
    const selection = service.select();
    service.resolvePrompt('  D:\\dev\\termexo  ');
    await expect(selection).resolves.toBe('D:\\dev\\termexo');
  });

  // Two callers racing would otherwise leave the first awaiting a promise nothing settles.
  it('cancels a prompt that a second request replaces', async () => {
    const first = service.select('D:\\first');
    const second = service.select('D:\\second');

    await expect(first).resolves.toBeNull();
    expect(service.prompt()?.initialDirectory).toBe('D:\\second');

    service.resolvePrompt('D:\\second');
    await expect(second).resolves.toBe('D:\\second');
  });
});
