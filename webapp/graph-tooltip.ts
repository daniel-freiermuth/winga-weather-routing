// Conditions-graph tooltip: attaches mousemove/mouseleave handlers to the SVG.

import type { WaypointMeta, GraphLayout } from './types';
import { fmt } from './units';

export interface GraphTooltipState {
  graphMeta: WaypointMeta[] | null;
  graphLayout: GraphLayout | null;
  windSpeedMs: boolean;
}

export function setupGraphTooltip(
  svgEl: HTMLElement,
  tooltipEl: HTMLElement,
  getState: () => GraphTooltipState,
): void {
  svgEl.addEventListener('mousemove', (e) => {
    const { graphMeta, graphLayout, windSpeedMs } = getState();
    if (!graphMeta || !graphLayout || graphMeta.length < 2) return;
    const rect = svgEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { ml, pw } = graphLayout;
    const frac = (x - (ml * rect.width) / graphLayout.VW) / ((pw * rect.width) / graphLayout.VW);
    if (frac < 0 || frac > 1) { tooltipEl.style.display = 'none'; return; }
    const idx = Math.min(graphMeta.length - 1, Math.max(0, Math.round(frac * (graphMeta.length - 1))));
    const m = graphMeta[idx]!;
    const tw = fmt(m.tws ?? 0, 'speed', windSpeedMs);
    const bs = m.boatSpeed != null ? fmt(m.boatSpeed, 'speed') : null;
    const d = new Date(m.time);
    const timeStr = d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let text = `<b>${timeStr}</b><br>Wind: ${tw.num} ${tw.sym}, ${Math.round(m.windDir ?? 0)}°`;
    if (bs) text += `<br>Boat: ${bs.num} ${bs.sym}`;
    if (m.waveHeight != null) {
      const wf = fmt(m.waveHeight, 'depth');
      text += `<br>Wave: ${wf.num} ${wf.sym}`;
    }
    tooltipEl.innerHTML = text;
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = `${String(e.clientX + 12)}px`;
    tooltipEl.style.top = `${String(e.clientY - 20)}px`;
  });

  svgEl.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; });
}
