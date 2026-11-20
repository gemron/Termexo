import { Component, computed, inject, input } from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  UpdateService,
  type UpdateSourcePreference,
} from '../core/services/update.service';
import { renderMarkdown } from '../preview/markdown-preview';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-update-panel',
  imports: [TranslatePipe, IconComponent],
  templateUrl: './app-update-panel.html',
  styleUrl: './app-update-panel.scss',
})
export class AppUpdatePanelComponent {
  readonly installedVersion = input('');
  protected readonly updates = inject(UpdateService);
  protected readonly notes = computed(() => renderMarkdown(this.updates.result()?.releaseNotes ?? ''));
  protected readonly busy = computed(() =>
    this.updates.checking() || this.updates.downloading() || this.updates.installing(),
  );
  protected readonly percent = computed(() => {
    const progress = this.updates.progress();
    return progress?.total ? Math.floor(progress.received / progress.total * 100) : null;
  });

  protected async check(): Promise<void> {
    // The service exposes the error next to the button that initiated the check.
    await this.updates.check().catch(() => undefined);
  }

  protected setSource(event: Event): void {
    this.updates.setSource((event.target as HTMLSelectElement).value as UpdateSourcePreference);
  }
}
