// RoutingAlgorithm interface — the contract all routing algorithm implementations must satisfy.

import type {
  CurrentProvider,
  WindProvider,
  LandEdgeIndex,
  RegionIndex,
  PolarData,
  CalculationRequest,
  RoutePoint,
} from '../../types';

export interface RoutingAlgorithm {
  readonly id: string;
  readonly name: string;
  calculate(
    wind: WindProvider,
    current: CurrentProvider | null,
    polar: PolarData,
    edgeIndex: LandEdgeIndex | null,
    regionIndex: RegionIndex | null,
    request: CalculationRequest,
    onProgress: (pct: number, frontier: [number, number][]) => void,
    options?: Record<string, unknown>,
  ): Promise<{ route: RoutePoint[]; warning?: string }>;
}
