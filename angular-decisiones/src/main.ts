import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

const avisarAltura = () => window.parent !== window && window.parent.postMessage({ tipo: 'altura-decisiones', px: document.body.offsetHeight }, window.location.origin);
new ResizeObserver(avisarAltura).observe(document.body);
