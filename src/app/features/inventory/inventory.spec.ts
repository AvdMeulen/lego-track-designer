import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BrowserStorage } from '../../core/storage/browser-storage';
import { Inventory } from './inventory';

describe('Inventory', () => {
  let fixture: ComponentFixture<Inventory>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Inventory],
      providers: [
        provideRouter([]),
        {
          provide: BrowserStorage,
          useValue: { read: () => null, write: () => undefined },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Inventory);
    fixture.detectChanges();
  });

  it('lists catalog parts', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Straight 16');
    expect(compiled.textContent).toContain('Flexible track');
    expect(compiled.textContent).not.toContain('Buffer stop');
    expect(compiled.textContent).toContain('Reset collection');
    expect(compiled.textContent).toContain('pieces in the collection');
  });
});
