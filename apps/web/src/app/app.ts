import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DialogHost } from './components/dialog-host';
import { I18n } from './core/i18n';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DialogHost],
  template: '<router-outlet /><app-dialog-host />',
})
export class App {
  constructor() {
    inject(I18n).start();
  }
}
