import { KNOWN_AMENITIES, amenityIcon, amenityLabel, toAmenityKey } from './amenities';

describe('amenities', () => {
  it('has readable labels and icons with a fallback', () => {
    expect(amenityLabel('pets_allowed')).toBe('Pets allowed');
    expect(amenityLabel('wifi')).toBe('Wi-Fi');
    expect(amenityIcon('pool')).toBe('pool');
    expect(amenityIcon('hot_tub')).toBe('check_circle');
  });

  it('turns custom labels into stored keys', () => {
    expect(toAmenityKey('Hot tub!')).toBe('hot_tub');
    expect(toAmenityKey('  Sea-view terrace ')).toBe('sea_view_terrace');
    expect(toAmenityKey('***')).toBe('');
    expect(KNOWN_AMENITIES).toContain('wifi');
  });
});
