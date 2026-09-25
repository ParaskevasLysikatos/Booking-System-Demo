/** Human labels + Material icons for the amenity keys the API uses. */

const LABELS: Record<string, string> = { wifi: 'Wi-Fi', tv: 'TV', air_conditioning: 'Air conditioning' };

const ICONS: Record<string, string> = {
  wifi: 'wifi',
  parking: 'local_parking',
  pool: 'pool',
  kitchen: 'kitchen',
  air_conditioning: 'ac_unit',
  heating: 'thermostat',
  washer: 'local_laundry_service',
  tv: 'tv',
  balcony: 'balcony',
  sea_view: 'water',
  pets_allowed: 'pets',
  gym: 'fitness_center',
  elevator: 'elevator',
};

/** "sea_view" -> "Sea view", "wifi" -> "Wi-Fi". */
export function amenityLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function amenityIcon(key: string): string {
  return ICONS[key] ?? 'check_circle';
}

/** The amenities the form offers as a checklist (in display order). Others can be added as custom keys. */
export const KNOWN_AMENITIES = Object.keys(ICONS);

/** "Hot tub!" -> "hot_tub" - custom amenities are stored like the built-in keys. */
export function toAmenityKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}
