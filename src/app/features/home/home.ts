import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TPipe } from '../../core/i18n/t.pipe';

@Component({
  selector: 'app-home',
  imports: [RouterLink, TPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly steps = ['1', '2', '3'];
}
