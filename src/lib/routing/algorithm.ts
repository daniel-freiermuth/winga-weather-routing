// RoutingAlgorithm interface — the contract all routing algorithm implementations must satisfy.

import { WindProvider, LandEdgeIndex, PolarData, CalculationRequest, RoutePoint } from '../../types';

export interface RoutingAlgorithm {
  readonly id: string;
  readonly name: string;
  calculate(
    wind: WindProvider,
    polar: PolarData,
    edgeIndex: LandEdgeIndex | null,
    request: CalculationRequest,
    onProgress: (pct: number, frontier: Array<[number, number]>) => void,
    options?: Record<string, unknown>,
  ): Promise<{ route: RoutePoint[]; warning?: string }>;
}
