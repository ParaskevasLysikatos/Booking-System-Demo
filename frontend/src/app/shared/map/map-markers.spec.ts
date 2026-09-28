import { clusterHtml, clusterTitle, escapeHtml, markerHtml, withPosition } from './map-markers';

describe('map-markers helpers', () => {
  it('escapes HTML in labels', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
    expect(markerHtml({ label: '<img src=x>' })).toBe('<span class="app-map-price">&lt;img src=x&gt;</span>');
  });

  it('draws a price tag with a label and a round pin without', () => {
    expect(markerHtml({ label: '€126' })).toBe('<span class="app-map-price">€126</span>');
    expect(markerHtml({})).toBe('<span class="app-map-pin"></span>');
  });

  it('labels clusters', () => {
    expect(clusterHtml(12)).toBe('<span class="app-map-cluster">12</span>');
    expect(clusterTitle(3)).toBe('3 stays here - zoom in');
  });

  it('keeps only markers with usable coordinates', () => {
    const ok = { id: 1, lat: 40.6, lng: 22.9, title: 'ok' };
    const bad = [
      { id: 2, lat: null as unknown as number, lng: 22.9, title: 'null' },
      { id: 3, lat: NaN, lng: 22.9, title: 'nan' },
      { id: 4, lat: 95, lng: 22.9, title: 'range' },
      { id: 5, lat: 40, lng: -181, title: 'range' },
    ];
    expect(withPosition([ok, ...bad])).toEqual([ok]);
  });
});
