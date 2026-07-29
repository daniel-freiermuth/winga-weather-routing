// Isochrone routing algorithm — time-optimal route search via frontier expansion.
// This is the hot loop that benefits from WASM: O(frontier × headings × steps) of
// trig, polar lookup, and candidate pruning.

use crate::geo::{bearing_to, destination_point, haversine_nm, wind_direction, wind_speed_knots};
use crate::polar::PolarData;

const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;

/// Route point returned to JS.
#[derive(Clone)]
pub struct RoutePoint {
    pub lat: f64,
    pub lon: f64,
    pub time_ms: f64,
    pub ctw: f64,
    pub twa: f64,
    pub boat_speed: f64, // knots, 0.0 for departure
    pub step_calc_ms: f64,
}

/// Internal frontier point with parent chain for backtracking.
struct IsoPoint {
    lat: f64,
    lon: f64,
    time_ms: f64,
    ctw: f64,
    twa: f64,
    boat_speed: f64,
    step_calc_ms: f64,
    parent: Option<usize>, // index into the points arena
}

/// Configuration for a single routing leg.
pub struct LegConfig {
    pub heading_step: f64,
    pub sector_size: f64,
    pub min_boat_speed: f64,
    pub max_wind_kn: f64,
    pub max_wave_m: f64,
    pub motor_speed_kn: f64,
    pub motor_below_kn: f64,
    pub wait_for_wind: bool,
    pub tack_penalty_sec: f64,
    pub tack_threshold_deg: f64,
    pub cone_half_angle: f64,
    pub cone_disable_lookahead_nm: f64,
    pub max_heading_change: f64,
    pub arrival_radius_nm: f64,
}

/// Callbacks into JS for data that lives in browser memory.
pub trait DataProvider {
    /// Get wind u/v (m/s) at a position and time.
    fn get_wind(&self, lat: f64, lon: f64, time_ms: f64) -> (f64, f64);
    /// Get current u/v (m/s) at a position and time. Returns (0,0) if unavailable.
    fn get_current(&self, lat: f64, lon: f64, time_ms: f64) -> (f64, f64);
    /// Check if a segment crosses land.
    fn crosses_land(&self, lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> bool;
    /// Check if a point is on land.
    fn is_on_land(&self, lat: f64, lon: f64) -> bool;
    /// Get wave height (m) at a position and time. Returns None if unavailable.
    fn get_wave(&self, lat: f64, lon: f64, time_ms: f64) -> Option<f64>;
    /// Check if wind data covers a point at a time.
    fn covers_point(&self, lat: f64, lon: f64, time_ms: f64) -> bool;
    /// Report progress (pct 0–100, frontier as flat [lat, lon, ...]).
    fn on_progress(&self, pct: f64, frontier: &[(f64, f64)]);
    /// Prefetch tiles for a time step.
    fn prefetch(&self, time_ms: f64);
}

/// Calculate a single routing leg from start to end.
#[allow(clippy::too_many_arguments)]
pub fn calculate_leg(
    start_lat: f64,
    start_lon: f64,
    end_lat: f64,
    end_lon: f64,
    departure_ms: f64,
    forecast_end_ms: f64,
    polar: &PolarData,
    config: &LegConfig,
    data: &dyn DataProvider,
) -> Result<Vec<RoutePoint>, String> {
    // ── Adaptive timestep ──────────────────────────────────────────────
    let direct_dist = haversine_nm(start_lat, start_lon, end_lat, end_lon);
    let est_speed = 5.0; // reasonable sailing average
    let forecast_h = (forecast_end_ms - departure_ms) / 3_600_000.0;
    let est_h = (direct_dist / est_speed).min(forecast_h);
    let step_h = (est_h / 100.0).max(0.25); // at least 15 min
    let step_ms = step_h * 3_600_000.0;
    let est_total_steps = (est_h / step_h).ceil() as u32;

    // Dynamic arrival radius
    let arrival_r = if config.arrival_radius_nm > 0.0 {
        config.arrival_radius_nm
    } else {
        (direct_dist / 100.0).clamp(0.1, 2.0)
    };

    // ── Arena for all points (parent references by index) ──────────────
    let mut arena: Vec<IsoPoint> = Vec::with_capacity(est_total_steps as usize * 500);

    // Seed
    arena.push(IsoPoint {
        lat: start_lat,
        lon: start_lon,
        time_ms: departure_ms,
        ctw: 0.0,
        twa: 0.0,
        boat_speed: 0.0,
        step_calc_ms: 0.0,
        parent: None,
    });

    let mut frontier: Vec<usize> = vec![0]; // indices into arena
    let mut arrived: Option<usize> = None;
    let mut steps_completed: u32 = 0;
    let mut current_time_ms = departure_ms;

    for _step in 0..500 {
        let next_time_ms = current_time_ms + step_ms;
        if next_time_ms > forecast_end_ms {
            break;
        }

        data.prefetch(current_time_ms);

        let dt_hours = step_h;
        let mut candidates: Vec<usize> = Vec::with_capacity(frontier.len() * 72);

        for &pt_idx in &frontier {
            // Copy fields from the frontier point to avoid borrow conflict with arena.push
            let pt_lat = arena[pt_idx].lat;
            let pt_lon = arena[pt_idx].lon;
            let pt_ctw = arena[pt_idx].ctw;
            let pt_twa = arena[pt_idx].twa;
            let pt_has_parent = arena[pt_idx].parent.is_some();

            if data.is_on_land(pt_lat, pt_lon) {
                continue;
            }

            let pt_to_dest = bearing_to(pt_lat, pt_lon, end_lat, end_lon);
            let wind_vec = data.get_wind(pt_lat, pt_lon, current_time_ms);

            // Wind over water
            let cur = data.get_current(pt_lat, pt_lon, current_time_ms);
            let wow_u = wind_vec.0 - cur.0;
            let wow_v = wind_vec.1 - cur.1;
            let wow_speed = wind_speed_knots(wow_u, wow_v);
            let wow_dir = wind_direction(wow_u, wow_v);

            // Max wind check (true wind)
            if config.max_wind_kn > 0.0
                && wind_speed_knots(wind_vec.0, wind_vec.1) > config.max_wind_kn
            {
                continue;
            }

            // Max wave check
            if config.max_wave_m > 0.0
                && data
                    .get_wave(pt_lat, pt_lon, current_time_ms)
                    .is_some_and(|wh| wh > config.max_wave_m)
            {
                continue;
            }

            // Cone check
            let dist_to_dest = haversine_nm(pt_lat, pt_lon, end_lat, end_lon);
            let cone_end = if dist_to_dest <= config.cone_disable_lookahead_nm {
                (end_lat, end_lon)
            } else {
                destination_point(pt_lat, pt_lon, config.cone_disable_lookahead_nm, pt_to_dest)
            };
            let direct_blocked = data.crosses_land(pt_lat, pt_lon, cone_end.0, cone_end.1);
            let cone_half = if direct_blocked {
                180.0
            } else {
                config.cone_half_angle
            };

            let mut wait_added = false;
            let mut ctw = 0.0f64;
            while ctw < 360.0 {
                let deviation = ((ctw - pt_to_dest + 180.0 + 360.0) % 360.0 - 180.0).abs();
                if deviation > cone_half {
                    ctw += config.heading_step;
                    continue;
                }

                // CTW change constraint (skip for seed points)
                if pt_has_parent {
                    let delta = ((ctw - pt_ctw + 180.0 + 360.0) % 360.0 - 180.0).abs();
                    if delta > config.max_heading_change {
                        ctw += config.heading_step;
                        continue;
                    }
                }

                let mut twa = (ctw - wow_dir + 360.0) % 360.0;
                if twa > 180.0 {
                    twa = 360.0 - twa;
                }

                let polar_speed = polar.interpolate(twa, wow_speed);
                let effective_speed = if config.motor_below_kn > 0.0
                    && config.motor_speed_kn > 0.0
                    && polar_speed < config.motor_below_kn
                {
                    config.motor_speed_kn
                } else {
                    polar_speed
                };

                if effective_speed < config.min_boat_speed {
                    if config.wait_for_wind && !wait_added {
                        let wait_idx = arena.len();
                        arena.push(IsoPoint {
                            lat: pt_lat,
                            lon: pt_lon,
                            time_ms: next_time_ms,
                            ctw: pt_ctw,
                            twa: pt_twa,
                            boat_speed: 0.0,
                            step_calc_ms: 0.0,
                            parent: Some(pt_idx),
                        });
                        candidates.push(wait_idx);
                        wait_added = true;
                    }
                    ctw += config.heading_step;
                    continue;
                }

                // Tack penalty
                let mut penalty_h = 0.0;
                if config.tack_penalty_sec > 0.0 && pt_has_parent {
                    let ctw_change = ((ctw - pt_ctw + 180.0 + 360.0) % 360.0 - 180.0).abs();
                    if ctw_change > config.tack_threshold_deg {
                        penalty_h = config.tack_penalty_sec / 3600.0;
                    }
                }

                let dist_nm = effective_speed * (dt_hours - penalty_h).max(0.0);
                let (mut new_lat, mut new_lon) = destination_point(pt_lat, pt_lon, dist_nm, ctw);

                // Current drift
                if cur.0 != 0.0 || cur.1 != 0.0 {
                    let dt_s = dt_hours * 3600.0;
                    new_lat += (cur.1 * dt_s) / (1852.0 * 60.0);
                    new_lon += (cur.0 * dt_s) / (1852.0 * 60.0 * (pt_lat * DEG_TO_RAD).cos());
                }

                // Coverage check
                if !data.covers_point(new_lat, new_lon, next_time_ms) {
                    ctw += config.heading_step;
                    continue;
                }

                // Land check
                if data.crosses_land(pt_lat, pt_lon, new_lat, new_lon) {
                    ctw += config.heading_step;
                    continue;
                }

                let new_idx = arena.len();
                arena.push(IsoPoint {
                    lat: new_lat,
                    lon: new_lon,
                    time_ms: next_time_ms,
                    ctw,
                    twa,
                    boat_speed: effective_speed,
                    step_calc_ms: 0.0,
                    parent: Some(pt_idx),
                });
                candidates.push(new_idx);

                ctw += config.heading_step;
            }
        }

        // Check for arrival
        let mut best_arrival: Option<(usize, f64)> = None;
        for &idx in &candidates {
            let p = &arena[idx];
            let d = haversine_nm(p.lat, p.lon, end_lat, end_lon);
            if d <= arrival_r && (best_arrival.is_none() || d < best_arrival.unwrap().1) {
                best_arrival = Some((idx, d));
            }
        }
        if let Some((idx, _)) = best_arrival {
            arrived = Some(idx);
            break;
        }

        // Prune to frontier
        frontier = prune_to_frontier(
            &arena,
            &candidates,
            start_lat,
            start_lon,
            config.sector_size,
        );

        if frontier.is_empty() {
            return Err(format!(
                "No reachable positions at step {}",
                steps_completed + 1
            ));
        }

        steps_completed += 1;
        let pct = ((steps_completed as f64 + 1.0) / est_total_steps as f64 * 100.0).min(99.0);
        let frontier_pts: Vec<(f64, f64)> = frontier
            .iter()
            .map(|&i| (arena[i].lat, arena[i].lon))
            .collect();
        data.on_progress(pct, &frontier_pts);

        current_time_ms = next_time_ms;
    }

    // Backtrack from arrival or closest frontier point
    let backtrack_idx = if let Some(idx) = arrived {
        idx
    } else if !frontier.is_empty() {
        // Partial route: find frontier point closest to destination
        let mut best_idx = frontier[0];
        let mut best_dist =
            haversine_nm(arena[best_idx].lat, arena[best_idx].lon, end_lat, end_lon);
        for &idx in &frontier[1..] {
            let d = haversine_nm(arena[idx].lat, arena[idx].lon, end_lat, end_lon);
            if d < best_dist {
                best_dist = d;
                best_idx = idx;
            }
        }
        best_idx
    } else {
        return Err(format!(
            "No reachable positions after {} steps",
            steps_completed
        ));
    };

    let mut route = Vec::new();

    // Walk parent chain — skip the arrival point when we snap to the exact destination
    let start_idx = if arrived.is_some() {
        arena[backtrack_idx].parent
    } else {
        Some(backtrack_idx)
    };
    let mut cur_idx = start_idx;
    while let Some(i) = cur_idx {
        let p = &arena[i];
        route.push(RoutePoint {
            lat: p.lat,
            lon: p.lon,
            time_ms: p.time_ms,
            ctw: p.ctw,
            twa: p.twa,
            boat_speed: p.boat_speed,
            step_calc_ms: p.step_calc_ms,
        });
        cur_idx = p.parent;
    }
    route.reverse();

    // Snap to exact destination with estimated extra travel time
    if arrived.is_some() {
        let arr = &arena[backtrack_idx];
        let extra_dist = haversine_nm(arr.lat, arr.lon, end_lat, end_lon);
        let extra_h = if arr.boat_speed > 0.1 { extra_dist / arr.boat_speed } else { 0.0 };
        route.push(RoutePoint {
            lat: end_lat,
            lon: end_lon,
            time_ms: arr.time_ms + extra_h * 3_600_000.0,
            ctw: arr.ctw,
            twa: arr.twa,
            boat_speed: arr.boat_speed,
            step_calc_ms: 0.0,
        });
    }

    Ok(route)
}

/// Sector-based frontier pruning: keep the two farthest-from-start candidates per bearing sector.
fn prune_to_frontier(
    arena: &[IsoPoint],
    candidates: &[usize],
    start_lat: f64,
    start_lon: f64,
    sector_size: f64,
) -> Vec<usize> {
    let n_sectors = (360.0 / sector_size).ceil() as usize;
    // Two slots per sector: (index, distance)
    let mut sectors: Vec<[(Option<usize>, f64); 2]> = vec![[(None, 0.0); 2]; n_sectors];

    for &idx in candidates {
        let p = &arena[idx];
        let dist = haversine_nm(start_lat, start_lon, p.lat, p.lon);
        let bearing = bearing_to(start_lat, start_lon, p.lat, p.lon);
        let sector = ((bearing / sector_size).floor() as usize).min(n_sectors - 1);

        let slot = &mut sectors[sector];
        if slot[0].0.is_none() || dist > slot[0].1 {
            slot[1] = slot[0];
            slot[0] = (Some(idx), dist);
        } else if slot[1].0.is_none() || dist > slot[1].1 {
            slot[1] = (Some(idx), dist);
        }
    }

    let mut result = Vec::with_capacity(n_sectors * 2);
    for slot in &sectors {
        if let Some(idx) = slot[0].0 {
            result.push(idx);
        }
        if let Some(idx) = slot[1].0 {
            result.push(idx);
        }
    }
    result
}
