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

  it('updates the rendered Lucide icon when its inputs change', () => {
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    const gridMarkup = svg.innerHTML;

    fixture.componentRef.setInput('name', 'maximize');
    fixture.componentRef.setInput('size', 18);
    fixture.componentRef.setInput('strokeWidth', 2.25);
    fixture.detectChanges();

    expect(svg.innerHTML).not.toBe(gridMarkup);
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('height')).toBe('18');
    expect(svg.getAttribute('stroke-width')).toBe('2.25');
    expect((fixture.nativeElement as HTMLElement).style.width).toBe('18px');
  });
});
