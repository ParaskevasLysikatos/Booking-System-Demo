import { amenityIcon, amenityLabel } from './amenities';

describe('amenities', () => {
  it('has readable labels and icons with a fallback', () => {
    expect(amenityLabel('pets_allowed')).toBe('Pets allowed');
    expect(amenityLabel('wifi')).toBe('Wi-Fi');
    expect(amenityIcon('pool')).toBe('pool');
    expect(amenityIcon('hot_tub')).toBe('check_circle');
  });
});
