import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import markerClusterScriptUrl from "leaflet.markercluster/dist/leaflet.markercluster.js?url";
import { DHAKA_CENTER, categoryById, type Incident } from "@/lib/incidents";
import { cn } from "@/lib/utils";

/*
 * Leaflet is imported dynamically inside effects so it never runs during SSR.
 */

let markerClusterLoader: Promise<void> | null = null;

function loadMarkerCluster(L: typeof Leaflet) {
  if (typeof L.markerClusterGroup === "function") return Promise.resolve();
  if (markerClusterLoader) return markerClusterLoader;

  (globalThis as typeof globalThis & { L: typeof Leaflet }).L = L;
  markerClusterLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = markerClusterScriptUrl;
    script.dataset["mamlaMarkerCluster"] = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      markerClusterLoader = null;
      reject(new Error("Failed to load Leaflet marker clustering"));
    };
    document.head.append(script);
  });
  return markerClusterLoader;
}

function pinHtml(colorVar: string, selected: boolean, fresh: boolean) {
  const s = selected ? 46 : 34;
  return `
  <div style="--c: var(${colorVar}); width:${s}px; height:${s * 1.25}px; position:relative; transition:transform .2s;">
    ${fresh ? `<span style="position:absolute;left:50%;bottom:2px;width:14px;height:14px;margin-left:-7px;border-radius:999px;background:var(--c);" class="animate-ping-slow"></span>` : ""}
    <svg viewBox="0 0 40 50" width="${s}" height="${s * 1.25}" style="filter: drop-shadow(0 6px 8px oklch(0 0 0 / .6)); position:relative">
      <path d="M20 1 C9.5 1 1.5 9 1.5 19.5 C1.5 33 20 49 20 49 C20 49 38.5 33 38.5 19.5 C38.5 9 30.5 1 20 1 Z" fill="var(--c)" stroke="var(--primary-foreground)" stroke-width="2.5"/>
      <circle cx="20" cy="19" r="7.5" fill="var(--primary-foreground)"/>
      <circle cx="20" cy="19" r="3" fill="${selected ? "var(--primary)" : "var(--paint)"}"/>
    </svg>
  </div>`;
}

function pickHtml() {
  return `
  <div style="width:48px;height:60px;position:relative">
    <span class="animate-ping-slow" style="position:absolute;left:50%;bottom:0;width:18px;height:18px;margin-left:-9px;border-radius:999px;background:var(--primary)"></span>
    <svg viewBox="0 0 40 50" width="48" height="60" style="position:relative;filter: drop-shadow(0 8px 10px oklch(0 0 0 / .6))">
      <path d="M20 1 C9.5 1 1.5 9 1.5 19.5 C1.5 33 20 49 20 49 C20 49 38.5 33 38.5 19.5 C38.5 9 30.5 1 20 1 Z" fill="var(--primary)" stroke="var(--primary-foreground)" stroke-width="2.5"/>
      <circle cx="20" cy="19" r="6" fill="var(--primary-foreground)"/>
    </svg>
  </div>`;
}

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

interface Props {
  incidents?: Incident[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Called after the initial map load and whenever panning/zooming ends. */
  onBoundsChange?: (bounds: MapBounds) => void;
  /** pick mode: clicking the map places a pin */
  picked?: { lat: number; lng: number } | null;
  onPick?: (p: { lat: number; lng: number }) => void;
  center?: [number, number];
  zoom?: number;
  interactive?: boolean;
  className?: string;
}

export function IncidentMap({
  incidents = [],
  selectedId,
  onSelect,
  onBoundsChange,
  picked,
  onPick,
  center = DHAKA_CENTER,
  zoom = 12,
  interactive = true,
  className,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const pickRef = useRef<Leaflet.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const onSelectRef = useRef(onSelect);
  const onBoundsChangeRef = useRef(onBoundsChange);
  onPickRef.current = onPick;
  onSelectRef.current = onSelect;
  onBoundsChangeRef.current = onBoundsChange;

  // init
  useEffect(() => {
    let cancelled = false;
    import("leaflet")
      .then(async (mod) => {
        const L =
          (mod as unknown as { default?: typeof Leaflet }).default ??
          (mod as unknown as typeof Leaflet);

        // markercluster is a legacy browser plugin. Loading its local UMD asset
        // as a classic script preserves the global `L` contract that Vite's ESM
        // dependency pre-bundling cannot provide.
        await loadMarkerCluster(L);
        return L;
      })
      .then((L) => {
        if (cancelled || !el.current || mapRef.current) return;
        LRef.current = L;
        const map = L.map(el.current, {
          center,
          zoom,
          zoomControl: interactive,
          dragging: interactive,
          scrollWheelZoom: interactive,
          doubleClickZoom: interactive,
          touchZoom: interactive,
          keyboard: interactive,
          attributionControl: true,
          maxBounds: [
            [20.2, 87.6],
            [26.9, 93.0],
          ],
          minZoom: 7,
        });
        // Demo tiles. Production needs a dedicated tile provider (SRS 4.2), not the public OSM server.
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
          className: "mamla-tiles",
        }).addTo(map);
        layerRef.current = L.markerClusterGroup({
          chunkedLoading: true,
          maxClusterRadius: 55,
          removeOutsideVisibleBounds: true,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: (cluster) =>
            L.divIcon({
              className: "mamla-cluster",
              html: `<span class="mamla-cluster__count">${cluster.getChildCount()}</span>`,
              iconSize: [48, 48],
            }),
        }).addTo(map);
        map.on("click", (e: Leaflet.LeafletMouseEvent) =>
          onPickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }),
        );
        const emitBounds = () => {
          const bounds = map.getBounds();
          onBoundsChangeRef.current?.({
            minLat: bounds.getSouth(),
            minLng: bounds.getWest(),
            maxLat: bounds.getNorth(),
            maxLng: bounds.getEast(),
          });
        };
        map.on("moveend", emitBounds);
        mapRef.current = map;
        map.whenReady(emitBounds);
        // trigger render of markers
        el.current.dispatchEvent(new Event("mamla:ready"));
      })
      .catch((error: unknown) => {
        console.error("Failed to initialize incident map", error);
      });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // markers
  useEffect(() => {
    const draw = () => {
      const L = LRef.current;
      const layer = layerRef.current;
      if (!L || !layer) return;
      layer.clearLayers();
      const now = Date.now();
      incidents.forEach((i) => {
        const sel = i.id === selectedId;
        const icon = L.divIcon({
          className: "mamla-pin",
          html: pinHtml(categoryById(i.category).colorVar, sel, now - i.createdAt < 60 * 60_000),
          iconSize: [sel ? 46 : 34, (sel ? 46 : 34) * 1.25],
          iconAnchor: [(sel ? 46 : 34) / 2, (sel ? 46 : 34) * 1.25],
        });
        const m = L.marker([i.lat, i.lng], {
          icon,
          zIndexOffset: sel ? 1000 : 0,
          title: i.title,
          keyboard: true,
        });
        m.on("click", () => onSelectRef.current?.(i.id));
        m.addTo(layer);
      });
    };
    draw();
    const node = el.current;
    node?.addEventListener("mamla:ready", draw);
    return () => node?.removeEventListener("mamla:ready", draw);
  }, [incidents, selectedId]);

  // fly to selection
  useEffect(() => {
    const map = mapRef.current;
    const sel = incidents.find((i) => i.id === selectedId);
    if (map && sel) map.flyTo([sel.lat, sel.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [selectedId, incidents]);

  // picked pin
  useEffect(() => {
    const draw = () => {
      const L = LRef.current;
      const map = mapRef.current;
      if (!L || !map) return;
      if (!picked) {
        pickRef.current?.remove();
        pickRef.current = null;
        return;
      }
      if (!pickRef.current) {
        pickRef.current = L.marker([picked.lat, picked.lng], {
          icon: L.divIcon({
            className: "mamla-pin",
            html: pickHtml(),
            iconSize: [48, 60],
            iconAnchor: [24, 60],
          }),
          draggable: true,
        }).addTo(map);
        pickRef.current.on("dragend", () => {
          const p = pickRef.current!.getLatLng();
          onPickRef.current?.({ lat: p.lat, lng: p.lng });
        });
      } else {
        pickRef.current.setLatLng([picked.lat, picked.lng]);
      }
      if (!map.getBounds().contains([picked.lat, picked.lng])) map.panTo([picked.lat, picked.lng]);
    };
    draw();
    const node = el.current;
    node?.addEventListener("mamla:ready", draw);
    return () => node?.removeEventListener("mamla:ready", draw);
  }, [picked]);

  return (
    <div
      ref={el}
      className={cn("relative z-0 h-full w-full", onPick && "cursor-crosshair", className)}
    />
  );
}
