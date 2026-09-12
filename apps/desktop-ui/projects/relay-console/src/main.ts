import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { consoleAppConfig } from './app/app.config';

bootstrapApplication(App, consoleAppConfig).catch((error: unknown) => console.error(error));
