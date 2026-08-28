import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
    expect(compiled.querySelector('.busy')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="run-stats"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="stat-seed"]')?.textContent?.trim()).toBe('1');
    expect(compiled.textContent).toContain('Seed');
  });

  it('shows a busy overlay while generating', () => {
    const store = TestBed.inject(LayoutStore);
    store.generating.set(true);
    fixture.detectChanges();
    const overlay = fixture.nativeElement.querySelector('.busy') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('Searching');
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

describe('Designer query params', () => {
  it('starts a seeded run from generate/seed/parking', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Designer],
      providers: [
        provideRouter([]),
        { provide: BrowserStorage, useValue: { read: () => null, write: () => undefined } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({ generate: '1', seed: '42', parking: '2' }) },
            queryParamMap: of(convertToParamMap({ generate: '1', seed: '42', parking: '2' })),
          },
        },
      ],
    }).compileComponents();

    const store = TestBed.inject(LayoutStore);
    const run = spyOn(store, 'runGeneration').and.resolveTo(store.agentReport());
    const fixture = TestBed.createComponent(Designer);
    fixture.detectChanges();
    expect(run).toHaveBeenCalledWith({ seed: 42, parking: 2 });
  });

  it('loads the eval room and collection before generating', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Designer],
      providers: [
        provideRouter([]),
        { provide: BrowserStorage, useValue: { read: () => null, write: () => undefined } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ generate: '1', seed: '90', parking: '2', scene: 'eval' }),
            },
            queryParamMap: of(
              convertToParamMap({ generate: '1', seed: '90', parking: '2', scene: 'eval' }),
            ),
          },
        },
      ],
    }).compileComponents();

    const store = TestBed.inject(LayoutStore);
    const run = spyOn(store, 'runGeneration').and.resolveTo(store.agentReport());
    const fixture = TestBed.createComponent(Designer);
    fixture.detectChanges();
    expect(run).toHaveBeenCalledWith({ seed: 90, parking: 2, scene: 'eval' });
  });
});

function pointer(type: 'pointerdown' | 'pointerup'): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 8, clientY: 8 });
}
