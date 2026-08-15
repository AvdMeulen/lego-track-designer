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

  it('renders generate and export actions', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Generate');
    expect(compiled.textContent).toContain('Rebuild');
    expect(compiled.textContent).toContain('Export PNG');
    expect(compiled.textContent).toContain('Export JSON');
    expect(compiled.textContent).toContain('Import JSON');
    expect(compiled.querySelector('.piece-list')).toBeTruthy();
    expect(compiled.querySelector('.workspace')).toBeTruthy();
  });
});
