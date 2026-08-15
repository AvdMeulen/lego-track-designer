import { Component } from '@angular/core';

@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly steps = [
    {
      title: 'Record your collection',
      text: 'Tell the app which LEGO City train track parts you own, and how many of each.',
    },
    {
      title: 'Generate a layout',
      text: 'The planner will search for a valid track arrangement that uses your pieces.',
    },
    {
      title: 'Review the design',
      text: 'Inspect a visual suggestion, then tweak inventory or regenerate for another idea.',
    },
  ];
}
