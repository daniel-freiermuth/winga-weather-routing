// Loads config.json + SK unit preferences and build info on startup.

import type { UnitPref } from './types';
import { unitPrefsStore, windSpeedMsStore } from './units';
import { fmt } from './units';
import { waveOverlayMaxMStore, conditionsGraphHeight as conditionsGraphHeightStore } from './stores';

export interface ConfigState {
  get waveOverlayMaxM(): number;
  set waveOverlayMaxM(v: number);
  get windSpeedMs(): boolean;
  set windSpeedMs(v: boolean);
  get conditionsGraphHeight(): number;
  set conditionsGraphHeight(v: number);
  get forecastSkillHorizonHours(): number;
  set forecastSkillHorizonHours(v: number);
  get unitPrefs(): Record<string, UnitPref> | null;
  set unitPrefs(v: Record<string, UnitPref> | null);
}

export async function loadConfig(
  skFetch: (path: string, options?: RequestInit) => Promise<Response>,
  state: ConfigState,
): Promise<void> {
  try {
    const cfgRes = await fetch('./config.json');
    if (!cfgRes.ok) return;
    const cfg = (await cfgRes.json()) as Record<string, unknown>;
    if ((cfg['waveOverlayMaxM'] as number | undefined) != null) {
      state.waveOverlayMaxM = cfg['waveOverlayMaxM'] as number;
      waveOverlayMaxMStore.set(state.waveOverlayMaxM);
    }
    state.windSpeedMs = !!(cfg['windSpeedMs'] as boolean | undefined);
    windSpeedMsStore.set(state.windSpeedMs);
    if ((cfg['conditionsGraphHeight'] as number | undefined) != null) {
      state.conditionsGraphHeight = cfg['conditionsGraphHeight'] as number;
      conditionsGraphHeightStore.set(state.conditionsGraphHeight);
    }
    if ((cfg['forecastSkillHorizonHours'] as number | undefined) != null)
      state.forecastSkillHorizonHours = cfg['forecastSkillHorizonHours'] as number;
  } catch { /* no config file */ }

  try {
    const up = await skFetch('/signalk/v1/unitpreferences/active');
    if (up.ok) {
      state.unitPrefs = (await up.json() as { categories: Record<string, UnitPref> }).categories;
      unitPrefsStore.set(state.unitPrefs);
    }
  } catch { /* offline or not supported */ }

  const depthSym = fmt(0, 'depth').sym;
  const legendMax = document.getElementById('wave-legend-max');
  if (legendMax) legendMax.textContent = `${fmt(state.waveOverlayMaxM, 'depth').num} ${depthSym}`;
  const safetyDist = document.getElementById('safety-margin-dist');
  if (safetyDist) {
    const smFmt = fmt(0.5, 'distance');
    safetyDist.textContent = `${smFmt.num} ${smFmt.sym}`;
  }

  try {
    const bi = await fetch('./buildinfo.json');
    if (bi.ok) {
      const { version } = await bi.json() as { version: string };
      const el = document.getElementById('build-version');
      if (el) el.textContent = `v${version}`;
    }
  } catch { /* no buildinfo */ }
}
