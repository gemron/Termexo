import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IconComponent } from './icon';

describe('IconComponent', () => {
  let fixture: ComponentFixture<IconComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'grid');
    fixture.componentRef.setInput('size', 14);
    fixture.detectChanges();
  });

  it('uses a fixed flex box without an inline SVG baseline gap', () => {
    const host = fixture.nativeElement as HTMLElement;
    const svg = host.querySelector('svg')!;

    expect(host.style.display).toBe('inline-flex');
    expect(host.style.alignItems).toBe('center');
    expect(host.style.justifyContent).toBe('center');
    expect(host.style.lineHeight).toBe('0');
    expect(host.style.width).toBe('14px');
    expect(host.style.height).toBe('14px');
    expect(svg.style.display).toBe('block');
    expect(svg.style.width).toBe('100%');
    expect(svg.style.height).toBe('100%');
  });
});
