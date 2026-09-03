import { TestBed } from '@angular/core/testing';

import { WindowControlsService } from './window-controls.service';

describe('WindowControlsService', () => {
  it('stays inert outside the desktop runtime so the browser preview keeps working', async () => {
    const service = TestBed.inject(WindowControlsService);

    expect(service.available).toBe(false);
    expect(service.maximized()).toBe(false);
    // The topbar hides the buttons here, but a stray call must not reject either.
    await expect(service.minimize()).resolves.toBeUndefined();
    await expect(service.toggleMaximize()).resolves.toBeUndefined();
    await expect(service.close()).resolves.toBeUndefined();
  });
});
