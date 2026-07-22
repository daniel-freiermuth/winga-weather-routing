// Shared type definitions for the weather routing webapp.

export interface WaypointMeta {
  name: string; time: string;
  windDir: number; heading: number; twa: number; tws: number;
  boatSpeed?: number; waveHeight?: number; gribFile?: string;
}

export interface GraphLayout {
  VW: number; ml: number; pw: number; mt: number; ph: number;
  hasWave: boolean; hasGrib: boolean;
  maxLeft: number; maxBoatSpeed: number; maxWave: number;
}

export interface RouteData {
  feature: {
    type: string;
    geometry: { type: string; coordinates: number[][] };
    properties: { coordinatesMeta: WaypointMeta[] };
  };
}

export interface UnitPref {
  formula?: string; inverseFormula?: string;
  displayFormat?: string; symbol?: string;
}

export type UnitCategory = 'speed' | 'depth' | 'distance';

export interface GribFileMeta {
  path: string; type?: string;
  latMin: number; latMax: number; lonMin: number; lonMax: number;
  timeStart: string; timeEnd: string; nTimes: number;
  referenceTime?: string;
}
