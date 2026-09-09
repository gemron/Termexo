import { Component, inject, signal } from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { registerWebviewTranslations } from '../core/i18n/webview.i18n';
import { WebviewStatusService } from '../core/services/webview-status.service';
import { IconComponent } from '../shared/icon/icon';

/** The one-line install this page is the alternative to, kept verbatim for copying. */
const WINGET_COMMAND = 'winget install --id Microsoft.EdgeWebView2Runtime';

registerWebviewTranslations();

/**
 * Explains a WebView2 runtime too old to draw the interface, and how to replace it.
 *
 * The whole window is that runtime, so when it falls behind the app still opens — with its
 * colours silently dropped and parts of its layout wrong. Nothing on screen would connect that to
 * a runtime version, which is why this says so directly and carries both ways of installing a
 * newer one. The address stays visible as text so it is still usable when the browser cannot be
 * launched from here.
 */
@Component({
  selector: 'app-webview-upgrade-dialog',
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="webview.dismiss()">
      <section
        class="dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webview-upgrade-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="webview-upgrade-title">{{ 'webview.title' | t }}</h2>
            @if (status(); as runtime) {
              <p>
                {{
                  runtime.version
                    ? ('webview.lead'
                      | t: { version: runtime.version, minimum: runtime.minimumMajor })
                    : ('webview.leadUnknown' | t: { minimum: runtime.minimumMajor })
                }}
              </p>
            }
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            (click)="webview.dismiss()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <p class="impact">{{ 'webview.impact' | t }}</p>

        <section class="install">
          <h3>{{ 'webview.installHeading' | t }}</h3>
          <ol>
            <li>{{ 'webview.installDownload' | t }}</li>
            <li>
              {{ 'webview.installWinget' | t }}
              <code>{{ wingetCommand }}</code>
            </li>
            <li>{{ 'webview.installRestart' | t }}</li>
          </ol>
          @if (status(); as runtime) {
            <p class="address">
              <span>{{ 'webview.address' | t }}</span>
              <code>{{ runtime.downloadUrl }}</code>
            </p>
          }
        </section>

        @if (failure(); as message) {
          <p class="failure" role="alert">
            {{ 'webview.openFailed' | t: { message } }}
          </p>
        }

        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="webview.dismiss()">
            {{ 'webview.dismiss' | t }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            [disabled]="opening()"
            (click)="openDownloadPage()"
          >
            <app-icon name="external" [size]="14" />
            {{ (opening() ? 'webview.opening' : 'webview.openDownload') | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styles: `
    .impact {
      margin: 16px 0 0;
      color: var(--text-muted);
    }

    .install {
      display: grid;
      gap: 12px;
      margin-top: 20px;

      h3 {
        margin: 0;
        font-size: 0.8125rem;
        font-weight: 600;
      }

      ol {
        display: grid;
        // Tailwind's reset strips the markers, and unnumbered steps stop reading as an order.
        gap: 8px;
        margin: 0;
        padding-left: 20px;
        list-style: decimal;
      }

      code {
        display: inline-block;
        padding: 2px 6px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--surface-inset);
        font-size: 0.75rem;
        user-select: all;
      }
    }

    .address {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: var(--text-muted);

      code {
        overflow-wrap: anywhere;
      }
    }

    .failure {
      margin: 16px 0 0;
      color: var(--danger);
    }
  `,
  styleUrls: ['./dialog.scss'],
})
export class WebviewUpgradeDialogComponent {
  protected readonly webview = inject(WebviewStatusService);
  protected readonly status = this.webview.status;
  protected readonly wingetCommand = WINGET_COMMAND;
  protected readonly opening = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected async openDownloadPage(): Promise<void> {
    if (this.opening()) {
      return;
    }
    this.opening.set(true);
    this.failure.set(null);
    try {
      await this.webview.openDownloadPage();
    } catch (error) {
      // The address stays on screen above, so a failure here still leaves a way forward.
      this.failure.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.opening.set(false);
    }
  }
}
