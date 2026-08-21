import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FloorPlanStore } from '../../core/floor-plan/floor-plan.store';
import { BrowserStorage } from '../../core/storage/browser-storage';
import { Room } from './room';

describe('Room', () => {
  let fixture: ComponentFixture<Room>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Room],
      providers: [
        provideRouter([]),
        { provide: BrowserStorage, useValue: { read: () => null, write: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Room);
    fixture.detectChanges();
  });

  it('starts with a rectangular outer wall and an add control', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Available space');
    expect(compiled.textContent).toContain('+ Add');
    expect(compiled.textContent).toContain('Next: collection');
    expect(compiled.querySelectorAll('.handle').length).toBe(4);
  });

  it('keeps the camera still when a wall corner moves', () => {
    const room = fixture.componentInstance;
    const store = TestBed.inject(FloorPlanStore);
    const before = room.view().box;
    const plan = store.plan();
    store.replaceActive({
      ...plan,
      outer: {
        ...plan.outer,
        points: plan.outer.points.map((point, index) =>
          index === 0 ? { x: point.x - 80, y: point.y - 80 } : point,
        ),
      },
    });
    fixture.detectChanges();
    expect(room.view().box).toBe(before);
  });
});
