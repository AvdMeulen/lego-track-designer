import { Routes } from '@angular/router';
import { Designer } from './features/designer/designer';
import { Home } from './features/home/home';
import { Inventory } from './features/inventory/inventory';
import { Room } from './features/room/room';

export const routes: Routes = [
  { path: '', component: Home, title: 'LEGO Track Designer' },
  { path: 'room', component: Room, title: 'Room · LEGO Track Designer' },
  { path: 'inventory', component: Inventory, title: 'Inventory · LEGO Track Designer' },
  { path: 'designer', component: Designer, title: 'Designer · LEGO Track Designer' },
  { path: '**', redirectTo: '' },
];
