// Shared reactive state for the calculation module.
// Both App.svelte and calculation.ts import from here — no getter/setter bridges needed.
//
// RESET RULE: adding a field here? Add it to freshCalcState() too — that's the
// single source of defaults. `resetCalcState()` bulk-assigns from it.

import type { WaypointMeta, GraphLayout, RouteData } from './types';
import type maplibregl from 'maplibre-gl';

interface CalcState {
  routeScrubberRange: { i0: number; iN: number } | null;
  scrubberLockedToRoute: boolean;
  routeLayer: { sourceId: string; layerId: string } | null;
  windBarbLayer: maplibregl.Marker[];
  legLabelLayer: { sourceId: string; layerId: string } | null;
  highlightLegLayer: { sourceId: string; layerId: string } | null;
  windBarbMarkers: (maplibregl.Marker | null)[];
  routeLegCoords: [number, number][][];
  prevHighlightWpIdx: number;
  graphMeta: WaypointMeta[] | null;
  graphLayout: GraphLayout | null;
  calcStream: { close(): void } | null;
  pendingRouteData: RouteData | null;
}

function freshCalcState(): CalcState {
  return {
    routeScrubberRange: null,
    scrubberLockedToRoute: false,
    routeLayer: null,
    windBarbLayer: [],
    legLabelLayer: null,
    highlightLegLayer: null,
    windBarbMarkers: [],
    routeLegCoords: [],
    prevHighlightWpIdx: -1,
    graphMeta: null,
    graphLayout: null,
    calcStream: null,
    pendingRouteData: null,
  };
}

export const calcState: CalcState = $state(freshCalcState());

/** Reset all calculation state to defaults. Caller must clean up map objects first. */
export function resetCalcState(): void {
  Object.assign(calcState, freshCalcState());
}
