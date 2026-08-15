import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
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
      text: 'The planner searches for a network with parking, reversing, and flex only as a last-resort gap closer.',
    },
    {
      title: 'See which part goes where',
      text: 'Inspect numbered pieces, export a PNG, and reopen the saved design after refresh.',
    },
  ];
}
