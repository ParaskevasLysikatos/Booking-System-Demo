import { formatPrice } from './money';

describe('formatPrice', () => {
  it('shows euros, dropping .00 but keeping real cents', () => {
    expect(formatPrice('91.00')).toBe('€91');
    expect(formatPrice('95.50')).toBe('€95.50');
    expect(formatPrice(1234)).toBe('€1,234');
    expect(formatPrice('abc')).toBe('');
  });
});
