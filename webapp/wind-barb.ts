// Wind barb SVG generation — shared between overlay and route display.

export function windBarbSvg(tws: number, windDir: number, color = '#333', polarMinTws = 0): string {
  if (tws < polarMinTws) {
    return (
      `<div style="width:30px;height:36px;overflow:visible">` +
      `<svg width="30" height="36" viewBox="-6 0 18 36" style="overflow:visible">` +
      `<circle cx="0" cy="22" r="5" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `<circle cx="0" cy="22" r="2" fill="${color}"/>` +
      `</svg></div>`
    );
  }

  let remaining = Math.round(tws);
  const pennants = Math.floor(remaining / 50);
  remaining %= 50;
  const fulls = Math.floor(remaining / 10);
  remaining %= 10;
  const halfs = Math.floor(remaining / 5);

  let y = 2;
  let barbs = '';
  for (let i = 0; i < pennants; i++) {
    barbs += `<polygon points="0,${String(y)} 8,${String(y + 4)} 0,${String(y + 8)}" fill="${color}"/>`;
    y += 10;
  }
  for (let i = 0; i < fulls; i++) {
    barbs += `<line x1="0" y1="${String(y)}" x2="8" y2="${String(y + 4)}" stroke="${color}" stroke-width="1.5"/>`;
    y += 5;
  }
  if (halfs) {
    barbs += `<line x1="0" y1="${String(y)}" x2="4" y2="${String(y + 2)}" stroke="${color}" stroke-width="1.5"/>`;
  }
  const staff = `<line x1="0" y1="2" x2="0" y2="22" stroke="${color}" stroke-width="1.5"/>`;
  const arrowhead = `<polygon points="-3,19 3,19 0,26" fill="${color}"/>`;

  return (
    `<div style="transform:rotate(${String(windDir)}deg);transform-origin:15px 33px;width:30px;height:36px;overflow:visible">` +
    `<svg width="30" height="36" viewBox="-6 0 18 36" style="overflow:visible">` +
    `${staff}${barbs}${arrowhead}` +
    `</svg></div>`
  );
}
