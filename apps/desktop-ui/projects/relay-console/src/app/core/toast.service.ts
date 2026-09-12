import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

/** Long enough to read a sentence, short enough not to pile up during a batch of edits. */
const TOAST_LIFETIME_MS = 4_000;

/** Confirms that an action landed, so no click ends without an answer. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly items = signal<Toast[]>([]);
  private nextId = 1;

  readonly toasts = this.items.asReadonly();

  success(message: string): void {
    this.push('success', message);
  }

  error(message: string): void {
    this.push('error', message);
  }

  dismiss(id: number): void {
    this.items.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }

  private push(tone: ToastTone, message: string): void {
    const id = this.nextId++;
    this.items.update((toasts) => [...toasts, { id, tone, message }]);
    setTimeout(() => this.dismiss(id), TOAST_LIFETIME_MS);
  }
}
