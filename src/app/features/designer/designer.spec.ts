import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { emptyLayout } from '../../core/layout-engine/generate';
import { LayoutStore } from '../../core/layout-store/layout.store';
import { BrowserStorage } from '../../core/storage/browser-storage';
import { Designer } from './designer';

describe('Designer', () => {
  let fixture: ComponentFixture<Designer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Designer],
      providers: [
        provideRouter([]),
        { provide: BrowserStorage, useValue: { read: () => null, write: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Designer);
    fixture.detectChanges();
  });

  it('renders a compact designer menu', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Generate');
    expect(compiled.textContent).toContain('Rebuild');
    expect(compiled.textContent).toContain('PNG');
    expect(compiled.textContent).toContain('JSON');
    expect(compiled.textContent).toContain('Import');
    expect(compiled.textContent).not.toContain('Parking and reverse');
    expect(compiled.textContent).not.toContain('Proof fixtures');
    expect(compiled.textContent).not.toContain('Leftover');
    expect(compiled.querySelector('.rail .piece-list')).toBeTruthy();
    expect(compiled.querySelector('.io')).toBeTruthy();
    expect(compiled.querySelector('.unused')).toBeFalsy();
    expect(compiled.querySelector('.workspace')).toBeTruthy();
  });

  it('selects a circuit piece in the piece list', () => {
    const store = TestBed.inject(LayoutStore);
    store.show({
      ...emptyLayout(),
      parts: [
        {
          instanceId: 'p1',
          partId: 'straight-16',
          label: 4,
          x: 0,
          y: 0,
          rotation: 0,
        },
      ],
    });
    fixture.detectChanges();

    const part = fixture.nativeElement.querySelector('.part') as HTMLElement;
    expect(part).toBeTruthy();
    part.dispatchEvent(pointer('pointerdown'));
    part.dispatchEvent(pointer('pointerup'));
    fixture.detectChanges();

    expect(store.selectedLabel()).toBe(4);
    expect(fixture.nativeElement.querySelector('.piece-list li.active')?.textContent).toContain('4');
  });
});

function pointer(type: 'pointerdown' | 'pointerup'): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 8, clientY: 8 });
}
