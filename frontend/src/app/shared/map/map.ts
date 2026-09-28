import {
  Component,
  DestroyRef,
  ElementRef,
  EmbeddedViewRef,
  TemplateRef,
  ViewContainerRef,
  ViewEncapsulation,
  afterNextRender,
  contentChild,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type * as Leaflet from 'leaflet';

import { LeafletApi, MapLoader } from './map-loader';
import {
  DEFAULT_MAX_FIT_ZOOM,
  GREECE_VIEW,
  LatLng,
  MapMarker,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  TILE_URL,
  clusterHtml,
  clusterTitle,
  markerHtml,
  withPosition,
} from './map-markers';

type MarkerId = MapMarker['id'];
export type MapStatus = 'loading' | 'ready' | 'error';

/**
 * The one map used across the app (TICKET-034): the listings split view,
 * the property page and the admin form. Leaflet with softened OpenStreetMap tiles,
 * loaded lazily (MapLoader).
 *
 * - `markers`: price tags / round pins, or shaded circles (`areaRadiusM`)
 *   for approximate locations. Nearby markers merge into numbered bubbles
 *   (`cluster`, leaflet.markercluster).
 * - The view fits all markers (`fitToMarkers`), or shows Greece when empty.
 * - `highlightedId` lifts one marker (e.g. while its card is hovered) - or
 *   its cluster bubble when it's inside one.
 * - Clicking a marker emits `markerSelect` and, if the page gives an
 *   `<ng-template>`, opens a pop-up with it (context: the marker).
 * - Clicking the map itself emits `mapClick`, and dropping a `draggable`
 *   marker emits `markerDragEnd` (the admin form places its pin with both).
 *
 * Give the host element a height (e.g. `app-map { height: 400px }`).
 */
@Component({
  selector: 'app-map',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div #mapEl class="app-map-canvas" role="region" [attr.aria-label]="ariaLabel()"></div>
    @switch (status()) {
      @case ('loading') {
        <div class="app-map-overlay" aria-hidden="true"><mat-spinner diameter="32" /></div>
      }
      @case ('error') {
        <div class="app-map-overlay" role="alert">
          <mat-icon>map</mat-icon>
          <p>The map couldn't load.</p>
          <button mat-stroked-button type="button" (click)="retry()">Try again</button>
        </div>
      }
    }
  `,
  styleUrl: './map.scss',
  // Leaflet builds its markers/pop-ups outside Angular's templates, so these
  // styles can't be scoped; every class is prefixed app-map- instead.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'app-map' },
})
export class MapComponent<T = unknown> {
  readonly markers = input<readonly MapMarker<T>[]>([]);
  readonly highlightedId = input<MarkerId | null>(null);
  /** Merge nearby markers into numbered bubbles. */
  readonly cluster = input(true);
  /** Refit the view whenever `markers` changes. */
  readonly fitToMarkers = input(true);
  readonly maxFitZoom = input(DEFAULT_MAX_FIT_ZOOM);
  /** Off for small embedded maps, so scrolling the page doesn't zoom the map. */
  readonly scrollWheelZoom = input(true);
  readonly ariaLabel = input('Map');

  readonly markerSelect = output<MapMarker<T>>();
  readonly mapClick = output<LatLng>();
  /** A `draggable` marker was dropped at a new point. */
  readonly markerDragEnd = output<{ marker: MapMarker<T> } & LatLng>();

  /** Optional pop-up content: `<ng-template let-marker>…</ng-template>`. */
  readonly popupTemplate = contentChild<TemplateRef<{ $implicit: MapMarker<T> }>>(TemplateRef);

  readonly status = signal<MapStatus>('loading');

  private readonly loader = inject(MapLoader);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');

  private L?: LeafletApi;
  private map?: Leaflet.Map;
  private markerLayer?: Leaflet.FeatureGroup;
  private areaLayer?: Leaflet.FeatureGroup;
  private readonly leafletMarkers = new Map<MarkerId, Leaflet.Marker>();
  private lastHighlighted: HTMLElement[] = [];
  private popupView?: EmbeddedViewRef<unknown>;
  private resizeObserver?: ResizeObserver;
  private destroyed = false;

  constructor() {
    afterNextRender(() => void this.init());

    // Redraw when the markers (or clustering) change, once the map exists.
    effect(() => {
      const markers = this.markers();
      const cluster = this.cluster();
      if (this.status() !== 'ready') return;
      untracked(() => this.render(markers, cluster));
    });

    effect(() => {
      const id = this.highlightedId();
      if (this.status() !== 'ready') return;
      untracked(() => this.highlight(id));
    });

    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  retry(): void {
    this.status.set('loading');
    void this.init();
  }

  /** The Leaflet map, for tests and advanced callers. */
  get leafletMap(): Leaflet.Map | undefined {
    return this.map;
  }

  private async init(): Promise<void> {
    try {
      this.L = await this.loader.load();
    } catch {
      if (!this.destroyed) this.status.set('error');
      return;
    }
    if (this.destroyed || this.map) return;
    const L = this.L;

    this.map = L.map(this.mapEl().nativeElement, {
      center: [GREECE_VIEW.center.lat, GREECE_VIEW.center.lng],
      zoom: GREECE_VIEW.zoom,
      scrollWheelZoom: this.scrollWheelZoom(),
      zoomControl: true,
      worldCopyJump: false,
    });
    L.tileLayer(TILE_URL, {
      maxZoom: TILE_MAX_ZOOM,
      attribution: TILE_ATTRIBUTION,
      className: 'app-map-tiles',
    }).addTo(this.map);
    this.map.on('click', (e: Leaflet.LeafletMouseEvent) => this.mapClick.emit({ lat: e.latlng.lat, lng: e.latlng.lng }));
    this.map.on('popupclose', () => this.destroyPopupView());
    // Zooming/panning re-creates cluster bubbles and markers: re-label and
    // re-highlight once the cluster plugin has redrawn (it listens too).
    this.map.on('zoomend moveend', () => setTimeout(() => this.refreshDecorations()));

    if (typeof ResizeObserver !== 'undefined') {
      // Split view / List-Map toggle change the size without a window resize.
      this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
      this.resizeObserver.observe(this.host.nativeElement);
    }

    this.status.set('ready'); // the effects above now draw markers + highlight
  }

  private render(markers: readonly MapMarker<T>[], cluster: boolean): void {
    const L = this.L!;
    const map = this.map!;
    map.closePopup();
    this.markerLayer?.remove();
    this.areaLayer?.remove();
    this.leafletMarkers.clear();
    this.lastHighlighted = [];

    this.markerLayer = cluster
      ? L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 48,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: (group: Leaflet.MarkerCluster) => {
            const count = group.getChildCount();
            return L.divIcon({ html: clusterHtml(count), className: 'app-map-cluster-icon', iconSize: L.point(40, 40) });
          },
        })
      : L.featureGroup();
    this.areaLayer = L.featureGroup();

    const bounds: Leaflet.LatLng[] = [];
    for (const m of withPosition(markers)) {
      const at = L.latLng(m.lat, m.lng);
      if (m.areaRadiusM) {
        L.circle(at, {
          radius: m.areaRadiusM,
          className: 'app-map-area',
          interactive: false,
        }).addTo(this.areaLayer);
        const box = at.toBounds(m.areaRadiusM * 2);
        bounds.push(box.getSouthWest(), box.getNorthEast());
        continue;
      }
      const marker = L.marker(at, {
        icon: L.divIcon({ html: markerHtml(m), className: 'app-map-marker', iconSize: L.point(0, 0) }),
        title: m.title,
        keyboard: true,
        riseOnHover: true,
        draggable: !!m.draggable,
        autoPan: !!m.draggable, // dragging to the edge pans the map
      });
      if (m.draggable) {
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          this.markerDragEnd.emit({ marker: m, lat, lng });
        });
      }
      // Leaflet re-creates the element whenever the marker comes back into
      // view (e.g. out of a cluster), so name it on every 'add'.
      marker.on('add', () => marker.getElement()?.setAttribute('aria-label', m.title));
      marker.on('click', () => this.select(m, marker));
      marker.addTo(this.markerLayer);
      this.leafletMarkers.set(m.id, marker);
      bounds.push(at);
    }

    this.areaLayer.addTo(map);
    this.markerLayer.addTo(map);
    if (cluster) this.markerLayer.on('animationend', () => this.refreshDecorations());

    if (this.fitToMarkers()) this.fit(bounds);
    this.refreshDecorations();
  }

  private refreshDecorations(): void {
    if (!this.map || this.destroyed) return;
    this.labelClusters();
    this.highlight(this.highlightedId());
  }

  private fit(points: Leaflet.LatLng[]): void {
    const map = this.map!;
    const maxZoom = this.maxFitZoom();
    if (points.length === 0) {
      map.setView([GREECE_VIEW.center.lat, GREECE_VIEW.center.lng], GREECE_VIEW.zoom);
    } else if (points.length === 1) {
      map.setView(points[0], maxZoom);
    } else {
      map.fitBounds(this.L!.latLngBounds(points), { padding: [32, 32], maxZoom });
    }
  }

  /** Cluster bubbles get an accessible name ("5 stays here - zoom in"). */
  private labelClusters(): void {
    const host = this.mapEl().nativeElement;
    host.querySelectorAll<HTMLElement>('.app-map-cluster-icon').forEach((icon) => {
      const count = icon.textContent?.trim() ?? '';
      const title = clusterTitle(Number(count));
      icon.setAttribute('aria-label', title);
      icon.setAttribute('title', title);
      icon.setAttribute('role', 'button');
      if (icon.tabIndex < 0) icon.tabIndex = 0;
    });
  }

  private highlight(id: MarkerId | null): void {
    for (const el of this.lastHighlighted) el.classList.remove('is-highlighted');
    this.lastHighlighted = [];
    for (const marker of this.leafletMarkers.values()) marker.setZIndexOffset(0);
    if (id === null || id === undefined) return;

    const marker = this.leafletMarkers.get(id);
    if (!marker) return;
    marker.setZIndexOffset(1000);
    // Inside a cluster bubble? Highlight the bubble instead.
    const group = this.markerLayer as unknown as Partial<Leaflet.MarkerClusterGroup> | undefined;
    const visible = group?.getVisibleParent?.(marker) ?? marker;
    const el = (visible as Leaflet.Marker).getElement?.();
    if (el) {
      el.classList.add('is-highlighted');
      this.lastHighlighted.push(el);
    }
  }

  private select(m: MapMarker<T>, marker: Leaflet.Marker): void {
    this.markerSelect.emit(m);
    const template = this.popupTemplate();
    if (!template || !this.map) return;

    this.destroyPopupView();
    const view = this.vcr.createEmbeddedView(template, { $implicit: m });
    view.detectChanges();
    const content = this.mapEl().nativeElement.ownerDocument.createElement('div');
    content.className = 'app-map-popup-content';
    for (const node of view.rootNodes) content.appendChild(node);
    this.popupView = view;

    this.L!.popup({
      className: 'app-map-popup',
      minWidth: 220,
      maxWidth: 280,
      autoPanPadding: this.L!.point(24, 24),
      offset: this.L!.point(0, -34),
    })
      .setLatLng(marker.getLatLng())
      .setContent(content)
      .openOn(this.map);
  }

  private destroyPopupView(): void {
    this.popupView?.destroy();
    this.popupView = undefined;
  }

  private teardown(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.destroyPopupView();
    this.map?.remove();
    this.map = undefined;
  }
}
