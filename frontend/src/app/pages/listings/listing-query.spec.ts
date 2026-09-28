import { convertToParamMap } from '@angular/router';

import { listKey, parseListingQuery, pinsKey, toQueryParams } from './listing-query';

describe('listing query <-> URL', () => {
  it('round-trips a full search', () => {
    const params = {
      location: 'chania', guests: '2', min_price: '50', max_price: '200',
      check_in: '2026-11-02', check_out: '2026-11-07', ordering: '-price', page: '3', page_size: '24',
    };
    const query = parseListingQuery(convertToParamMap(params));
    expect(query.filters.guests).toBe(2);
    expect(query.filters.checkIn?.getDate()).toBe(2);
    expect(query.page).toEqual({ page: 3, pageSize: 24 });
    expect(toQueryParams(query)).toEqual({
      location: 'chania', guests: 2, min_price: 50, max_price: 200,
      check_in: '2026-11-02', check_out: '2026-11-07', ordering: '-price', page: 3, page_size: 24,
    });
  });

  it('drops garbage instead of sending it to the API', () => {
    const query = parseListingQuery(
      convertToParamMap({
        guests: 'lots', min_price: '-5', check_in: '2026-11-02', // lone date
        ordering: 'title', page: '0', page_size: '1000',
      }),
    );
    expect(query.filters).toEqual({
      location: undefined, guests: undefined, minPrice: undefined, maxPrice: undefined,
      checkIn: undefined, checkOut: undefined, ordering: undefined,
    });
    expect(query.page).toEqual({ page: 1, pageSize: 12 });
    expect(toQueryParams(query)).toEqual({});
  });
});

describe('listing query: map view (TICKET-034)', () => {
  it('reads and writes ?view=map, ignoring anything else', () => {
    expect(parseListingQuery(convertToParamMap({ view: 'map' })).view).toBe('map');
    expect(parseListingQuery(convertToParamMap({ view: 'list' })).view).toBeUndefined();
    const q = parseListingQuery(convertToParamMap({ location: 'volos', view: 'map' }));
    expect(toQueryParams(q)).toEqual({ location: 'volos', view: 'map' });
  });

  it('the list key ignores the view; the pins key also ignores the page', () => {
    const a = parseListingQuery(convertToParamMap({ location: 'volos', page: '2' }));
    const b = parseListingQuery(convertToParamMap({ location: 'volos', page: '2', view: 'map' }));
    const c = parseListingQuery(convertToParamMap({ location: 'volos', page: '3' }));
    const d = parseListingQuery(convertToParamMap({ location: 'corfu' }));
    expect(listKey(a)).toBe(listKey(b));
    expect(listKey(a)).not.toBe(listKey(c));
    expect(pinsKey(a)).toBe(pinsKey(c));
    expect(pinsKey(a)).not.toBe(pinsKey(d));
  });
});
