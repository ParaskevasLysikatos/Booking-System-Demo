import { Params, ParamMap } from '@angular/router';

import { parseIsoDate, toIsoDate } from '../../core/dates';
import { DEFAULT_PAGE_SIZE, PageRequest, PropertyFilters, PropertyOrdering } from '../../core/properties/property.models';

/**
 * The listings search lives in the URL (agreed for TICKET-018), using the
 * same names as the API: /listings?location=chania&guests=2&check_in=...
 * That makes searches shareable, reload-safe, and the Back button works.
 */
export interface ListingQuery {
  filters: PropertyFilters;
  page: PageRequest;
  /**
   * `?view=map` - phones/tablets show the map instead of the list
   * (TICKET-034). In the URL so Back returns to the list; wide screens show
   * both side by side and ignore it.
   */
  view?: 'map';
}

const ORDERINGS: PropertyOrdering[] = ['newest', 'price', '-price', 'capacity', '-capacity'];
export const PAGE_SIZES = [12, 24, 48];

function positiveInt(value: string | null): number | undefined {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n > 0 ? n : undefined;
}

function nonNegative(value: string | null): number | undefined {
  const n = Number(value);
  return value !== null && value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** URL -> query. Garbage values are dropped rather than sent to the API. */
export function parseListingQuery(params: ParamMap): ListingQuery {
  const ordering = params.get('ordering') as PropertyOrdering | null;
  const checkIn = parseIsoDate(params.get('check_in'));
  const checkOut = parseIsoDate(params.get('check_out'));
  const pageSize = positiveInt(params.get('page_size'));
  return {
    filters: {
      location: params.get('location')?.trim() || undefined,
      guests: positiveInt(params.get('guests')),
      minPrice: nonNegative(params.get('min_price')),
      maxPrice: nonNegative(params.get('max_price')),
      // Dates only count as a pair.
      checkIn: checkIn && checkOut ? checkIn : undefined,
      checkOut: checkIn && checkOut ? checkOut : undefined,
      ordering: ordering && ORDERINGS.includes(ordering) ? ordering : undefined,
    },
    page: {
      page: positiveInt(params.get('page')) ?? 1,
      pageSize: pageSize && PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    },
    view: params.get('view') === 'map' ? 'map' : undefined,
  };
}

/** Query -> URL params. Defaults are left out to keep URLs short. */
export function toQueryParams({ filters, page, view }: ListingQuery): Params {
  const params: Params = {};
  if (filters.location) params['location'] = filters.location;
  if (filters.guests) params['guests'] = filters.guests;
  if (filters.minPrice !== undefined) params['min_price'] = filters.minPrice;
  if (filters.maxPrice !== undefined) params['max_price'] = filters.maxPrice;
  if (filters.checkIn && filters.checkOut) {
    params['check_in'] = toIsoDate(filters.checkIn);
    params['check_out'] = toIsoDate(filters.checkOut);
  }
  if (filters.ordering && filters.ordering !== 'newest') params['ordering'] = filters.ordering;
  if (page.page > 1) params['page'] = page.page;
  if (page.pageSize !== DEFAULT_PAGE_SIZE) params['page_size'] = page.pageSize;
  if (view === 'map') params['view'] = 'map';
  return params;
}

/** The part of the query the list depends on (not the view) - as a comparable key. */
export function listKey({ filters, page }: ListingQuery): string {
  return JSON.stringify(toQueryParams({ filters, page }));
}

/** The part the map pins depend on: filters only (pins aren't paged). */
export function pinsKey({ filters }: ListingQuery): string {
  return JSON.stringify(toQueryParams({ filters, page: { page: 1, pageSize: DEFAULT_PAGE_SIZE } }));
}
