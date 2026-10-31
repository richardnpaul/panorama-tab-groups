import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '../../support/contrast.js';

describe('tests/support/contrast.ts', () => {
  it('reads the three ways a colour is written', () => {
    expect(parseColor('#0a84ff')).toEqual([10, 132, 255]);
    expect(parseColor('#fa0')).toEqual([255, 170, 0]);
    expect(parseColor(' RGB(10, 132, 255) ')).toEqual([10, 132, 255]);
  });

  it('refuses a colour that is not opaque or not a colour', () => {
    expect(() => parseColor('rgba(0, 0, 0, 0.5)')).toThrow('opaque');
    expect(() => parseColor('transparent')).toThrow('opaque');
  });

  it('gives 21 for black on white, in either order, and 1 for the same colour', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#8f8f9d', '#8f8f9d')).toBeCloseTo(1, 5);
  });

  it('gives the published ratio for a known pair', () => {
    // #767676 on white is the usual smallest grey that passes AA for text
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
