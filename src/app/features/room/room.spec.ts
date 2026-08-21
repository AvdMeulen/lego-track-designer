import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
});
