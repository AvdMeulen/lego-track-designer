import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
});
