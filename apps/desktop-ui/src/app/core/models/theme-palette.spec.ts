import { createAppThemePalette, mixThemeColor } from './theme-palette';

describe('theme palette', () => {
  it('creates tinted dark application surfaces from the workspace color', () => {
    const green = createAppThemePalette('#58c7a0');
    const blue = createAppThemePalette('#68a9e8');

    expect(green.accent).toBe('#58c7a0');
    expect(blue.accent).toBe('#68a9e8');
    expect(blue.surface0).not.toBe(green.surface0);
    expect(blue.sidebar).not.toBe(green.sidebar);
  });

  it('normalizes invalid colors and clamps mix ratios', () => {
    expect(createAppThemePalette('invalid').accent).toBe('#58c7a0');
    expect(mixThemeColor('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mixThemeColor('#000000', '#ffffff', 2)).toBe('#ffffff');
  });
});
