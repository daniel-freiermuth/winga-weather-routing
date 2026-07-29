// Loads config.json + SK unit preferences and build info on startup.

import type { UnitPref } from './types';
import { unitPrefsStore, windSpeedMsStore } from './units';
import { fmt } from './units';
import { waveOverlayMaxMStore } from './stores';
import { configState } from './config-state.svelte';


export interface ConfigCallbacks {
  setBuildVersion: (v: string) => void;
  setWaveLegendMax: (text: string) => void;
  setSafetyMarginDist: (text: string) => void;
}

export async function loadConfig(
  skFetch: (path: string, options?: RequestInit) => Promise<Response>,
  callbacks: ConfigCallbacks,
): Promise<void> {
  try {
    const cfgRes = await fetch('./config.json');
    if (!cfgRes.ok) return;
    const cfg = (await cfgRes.json()) as Record<string, unknown>;
    if ((cfg['waveOverlayMaxM'] as number | undefined) != null) {
      configState.waveOverlayMaxM = cfg['waveOverlayMaxM'] as number;
      waveOverlayMaxMStore.set(configState.waveOverlayMaxM);
    }
    configState.windSpeedMs = !!(cfg['windSpeedMs'] as boolean | undefined);
    windSpeedMsStore.set(configState.windSpeedMs);
    if ((cfg['conditionsGraphHeight'] as number | undefined) != null) {
      configState.conditionsGraphHeight = cfg['conditionsGraphHeight'] as number;
    }
    if ((cfg['forecastSkillHorizonHours'] as number | undefined) != null)
      configState.forecastSkillHorizonHours = cfg['forecastSkillHorizonHours'] as number;
  } catch {
    /* no config file */
  }

  try {
    const up = await skFetch('/signalk/v1/unitpreferences/active');
    if (up.ok) {
      configState.unitPrefs = ((await up.json()) as { categories: Record<string, UnitPref> }).categories;
      unitPrefsStore.set(configState.unitPrefs);
    }
  } catch {
    /* offline or not supported */
  }

  const depthSym = fmt(0, 'depth').sym;
  callbacks.setWaveLegendMax(`${fmt(configState.waveOverlayMaxM, 'depth').num} ${depthSym}`);
  const smFmt = fmt(0.5, 'distance');
  callbacks.setSafetyMarginDist(`${smFmt.num} ${smFmt.sym}`);

  try {
    const bi = await fetch('./buildinfo.json');
    if (bi.ok) {
      const { version } = (await bi.json()) as { version: string };
      callbacks.setBuildVersion(`v${version}`);
    }
  } catch {
    /* no buildinfo */
  }
}
