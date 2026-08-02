import { inject, Pipe, PipeTransform } from '@angular/core';

import { I18nService } from './i18n.service';

@Pipe({
  name: 't',
  standalone: true,
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string, params?: Readonly<Record<string, string | number>>): string {
    return this.i18n.t(key, params);
  }
}
