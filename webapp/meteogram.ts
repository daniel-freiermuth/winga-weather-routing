import type { WaypointWeather } from './route-weather';

// Meteogram — canvas-based timeline chart for route weather analysis results.
//
// Draws wind speed, wind direction arrows, wave height, and boat speed
// along the route timeline. X-axis is time (ETAs), Y-axis is speed/height.

/**
 * Render a meteogram from route weather analysis results.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<import('./route-weather.js').WaypointWeather>} data
 */
export function drawMeteogram(canvas: HTMLCanvasElement, data: WaypointWeather[]) {
  if (data.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width * dpr;
  const H = rect.height * dpr;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  // Layout
  const ml = 40; // left margin (y-axis labels)
  const mr = 10; // right margin
  const mt = 24; // top margin (wind arrows)
  const mb = 36; // bottom margin (x-axis labels)
  const plotW = w - ml - mr;
  const plotH = h - mt - mb;

  // Data ranges
  const times = data.map((d) => d.etaMs);
  const tMin = times[0]!;
  const tMax = times[times.length - 1]!;
  const tRange = tMax - tMin || 1;

  const winds = data.map((d) => d.twsKn ?? 0);
  const waves = data.map((d) => d.waveHeightM ?? 0);
  const gusts = data.map((d) => d.gustKn ?? 0);
  const speeds = data.map((d) => d.boatSpeedKn ?? 0);

  const maxWind = Math.max(5, ...winds, ...gusts) * 1.15;
  const maxWave = Math.max(1, ...waves) * 1.3;
  const maxSpeed = Math.max(maxWind, Math.max(5, ...speeds) * 1.15);

  function tx(ms: number) {
    return ml + ((ms - tMin) / tRange) * plotW;
  }
  function tyWind(kn: number) {
    return mt + plotH - (kn / maxWind) * plotH;
  }
  function tyWave(m: number) {
    return mt + plotH - (m / maxWave) * (plotH * 0.3);
  } // waves use bottom 30%
  function tySpeed(kn: number) {
    return mt + plotH - (kn / maxSpeed) * plotH;
  }

  // Background
  ctx.fillStyle = '#1e2230';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = '#313244';
  ctx.lineWidth = 0.5;
  for (let v = 0; v <= maxWind; v += 5) {
    const y = tyWind(v);
    ctx.beginPath();
    ctx.moveTo(ml, y);
    ctx.lineTo(w - mr, y);
    ctx.stroke();
  }

  // Wave area (blue, bottom 30%)
  if (waves.some((v) => v > 0)) {
    ctx.fillStyle = 'rgba(116, 199, 236, 0.25)';
    ctx.beginPath();
    ctx.moveTo(tx(times[0]!), mt + plotH);
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(tx(times[i]!), tyWave(waves[i]!));
    }
    ctx.lineTo(tx(times[times.length - 1]!), mt + plotH);
    ctx.closePath();
    ctx.fill();

    // Wave line
    ctx.strokeStyle = 'rgba(116, 199, 236, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = tx(times[i]!),
        y = tyWave(waves[i]!);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Wind speed area
  ctx.fillStyle = 'rgba(137, 180, 250, 0.2)';
  ctx.beginPath();
  ctx.moveTo(tx(times[0]!), mt + plotH);
  for (let i = 0; i < data.length; i++) {
    ctx.lineTo(tx(times[i]!), tyWind(winds[i]!));
  }
  ctx.lineTo(tx(times[times.length - 1]!), mt + plotH);
  ctx.closePath();
  ctx.fill();

  // Wind speed line
  ctx.strokeStyle = '#89b4fa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = tx(times[i]!),
      y = tyWind(winds[i]!);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }

  // Gust area (red between wind and gust)
  if (gusts.some((v) => v > 0)) {
    ctx.fillStyle = 'rgba(243, 139, 168, 0.15)';
    ctx.beginPath();
    // Upper edge: gust line (top)
    for (let i = 0; i < data.length; i++) {
      const x = tx(times[i]!),
        y = tyWind(gusts[i]!);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    // Lower edge: wind line (bottom), reversed
    for (let i = data.length - 1; i >= 0; i--) {
      ctx.lineTo(tx(times[i]!), tyWind(winds[i]!));
    }
    ctx.closePath();
    ctx.fill();

    // Gust line
    ctx.strokeStyle = 'rgba(243, 139, 168, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = tx(times[i]!),
        y = tyWind(gusts[i]!);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.stroke();

  // Boat speed line (dashed green)
  if (speeds.some((v) => v > 0)) {
    ctx.strokeStyle = '#a6e3a1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = tx(times[i]!),
        y = tyWind(speeds[i]!);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Wind direction arrows along the top
  ctx.fillStyle = '#cdd6f4';
  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    if (d.twdDeg == null) continue;
    const x = tx(times[i]!);
    const y = mt - 4;
    const rad = ((d.twdDeg + 180) * Math.PI) / 180; // arrow points in the direction wind blows TO
    const len = 7;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rad);
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(-2.5, len * 0.4);
    ctx.lineTo(2.5, len * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Waypoint markers — vertical dashed lines
  ctx.strokeStyle = '#585b70';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  for (const d of data) {
    const x = tx(d.etaMs);
    ctx.beginPath();
    ctx.moveTo(x, mt);
    ctx.lineTo(x, mt + plotH);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // X-axis: ETA labels at waypoints (skip intermediate ones if too dense)
  ctx.fillStyle = '#a6adc8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  let lastLabelX = -Infinity;
  for (const d of data) {
    const x = tx(d.etaMs);
    if (x - lastLabelX < 50 && d.idx > 0 && d.idx < data.length - 1) continue;
    lastLabelX = x;
    const dt = new Date(d.etaMs);
    const label = dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    ctx.fillText(label, x, mt + plotH + 14);
    // WP number
    ctx.fillStyle = '#89b4fa';
    ctx.fillText(`WP${d.idx + 1}`, x, mt + plotH + 26);
    ctx.fillStyle = '#a6adc8';
  }

  // Y-axis: wind speed labels (left)
  ctx.fillStyle = '#89b4fa';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let v = 0; v <= maxWind; v += 5) {
    ctx.fillText(`${v}`, ml - 4, tyWind(v) + 3);
  }
  ctx.fillText('kn', ml - 4, mt - 2);

  // Legend
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const legendY = mt + plotH + 30;
  const legendItems = [
    { color: '#89b4fa', label: 'Wind' },
    { color: 'rgba(243, 139, 168, 0.6)', label: 'Gust', dash: true },
    { color: '#a6e3a1', label: 'SOG', dash: true },
    { color: 'rgba(116, 199, 236, 0.7)', label: 'Wave' },
  ];
  let legendX = ml;
  for (const item of legendItems) {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    if (item.dash) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(legendX, legendY);
    ctx.lineTo(legendX + 14, legendY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#a6adc8';
    ctx.fillText(item.label, legendX + 18, legendY + 3);
    legendX += ctx.measureText(item.label).width + 30;
  }
}

/**
 * Set up hover tooltip on the meteogram canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} tooltip
 * @param {Array<import('./route-weather.js').WaypointWeather>} data
 */
export function setupMeteogramTooltip(canvas: HTMLCanvasElement, tooltip: HTMLElement, data: WaypointWeather[]) {
  if (data.length < 2) return;

  const times = data.map((d) => d.etaMs);
  const tMin = times[0]!;
  const tMax = times[times.length - 1]!;
  const tRange = tMax - tMin || 1;

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const ml = 40,
      mr = 10;
    const plotW = rect.width - ml - mr;
    const t = ((mx - ml) / plotW) * tRange + tMin;

    // Find closest waypoint
    let closest = data[0]!;
    let minDiff = Infinity;
    for (const d of data) {
      const diff = Math.abs(d.etaMs - t);
      if (diff < minDiff) {
        minDiff = diff;
        closest = d;
      }
    }

    const dt = new Date(closest.etaMs);
    const eta = dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const lines = [
      `<b>WP ${closest.idx + 1}</b> — ${eta}`,
      `Wind: ${closest.twsKn ?? '—'} kn ${closest.twdDeg != null ? closest.twdDeg + '°' : ''}`,
      `Gust: ${closest.gustKn ?? '—'} kn`,
      `SOG: ${closest.boatSpeedKn ?? '—'} kn`,
      `TWA: ${closest.twaAbs != null ? closest.twaAbs + '°' : '—'}`,
      `Wave: ${closest.waveHeightM != null ? closest.waveHeightM + ' m' : '—'}`,
      `Dist: ${closest.cumDistNm} nm`,
    ];
    tooltip.innerHTML = lines.join('<br>');
    tooltip.style.display = 'block';
    tooltip.style.left = Math.min(mx + 12, rect.width - 160) + 'px';
    tooltip.style.top = e.clientY - rect.top - 80 + 'px';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}
