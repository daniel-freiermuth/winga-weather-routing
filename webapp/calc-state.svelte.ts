// Shared reactive state for the calculation module.
// Both App.svelte and calculation.ts import from here — no getter/setter bridges needed.

import type { WaypointMeta, GraphLayout, RouteData } from './types';
import type maplibregl from 'maplibre-gl';

export const calcState = $state({
  routeScrubberRange: null as { i0: number; iN: number } | null,
  scrubberLockedToRoute: false,
  routeLayer: null as { sourceId: string; layerId: string } | null,
  windBarbLayer: [] as maplibregl.Marker[],
  legLabelLayer: [] as maplibregl.Marker[],
  highlightLegLayer: null as { sourceId: string; layerId: string } | null,
  windBarbMarkers: [] as (maplibregl.Marker | null)[],
  routeLegCoords: [] as [number, number][][],
  prevHighlightWpIdx: -1,
  graphMeta: null as WaypointMeta[] | null,
  graphLayout: null as GraphLayout | null,
  calcStream: null as { close(): void } | null,
  pendingRouteData: null as RouteData | null,
});
