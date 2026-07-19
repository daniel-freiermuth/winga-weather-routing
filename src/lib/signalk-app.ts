// Minimal SignalK plugin app interface — subset of methods used by signalk-weather-routing.

/** Minimal GeoJSON geometry union covering the polygon types used by region avoidance. */
export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface SignalKResourceEntry {
  id?: string;
  name?: string;
  feature?: { geometry?: GeoJsonGeometry };
  [key: string]: unknown;
}

export interface SignalKResourcesApi {
  listResources(category: string): Promise<SignalKResourceEntry[] | Record<string, SignalKResourceEntry>>;
  setResource(category: string, id: string, resource: unknown): Promise<void>;
}

export interface SignalKApp {
  setPluginStatus(status: string): void;
  setPluginError(error: string): void;
  debug(message: string): void;
  savePluginConfig?(): Promise<void> | void;
  savePluginOptions?(configuration: object, callback?: (err?: Error) => void): void;
  resourcesApi?: SignalKResourcesApi;
  config?: { configPath?: string };
}
