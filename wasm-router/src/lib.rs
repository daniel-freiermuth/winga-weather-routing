// WASM isochrone routing — entry point for wasm-bindgen.
// The JS worker calls `calculate_route` with flat arrays and callbacks.

mod geo;
mod isochrone;
mod polar;

use isochrone::{DataProvider, LegConfig, RoutePoint, calculate_leg};
use polar::PolarData;
use wasm_bindgen::prelude::*;

// ── JS callbacks ─────────────────────────────────────────────────────────────
// These are implemented in the Web Worker and called by the Rust isochrone loop.

#[wasm_bindgen]
extern "C" {
    fn js_get_wind(lat: f64, lon: f64, time_ms: f64) -> js_sys::Float64Array;
    fn js_get_current(lat: f64, lon: f64, time_ms: f64) -> js_sys::Float64Array;
    fn js_crosses_land(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> bool;
    fn js_is_on_land(lat: f64, lon: f64) -> bool;
    fn js_get_wave(lat: f64, lon: f64, time_ms: f64) -> f64; // -1 = unavailable
    fn js_covers_point(lat: f64, lon: f64, time_ms: f64) -> bool;
    fn js_on_progress(pct: f64, frontier: &[f64]); // flat [lat1, lon1, lat2, lon2, ...]
    fn js_prefetch(time_ms: f64);
}

/// Adapter that routes DataProvider trait calls to JS callbacks.
struct JsDataProvider;

impl DataProvider for JsDataProvider {
    fn get_wind(&self, lat: f64, lon: f64, time_ms: f64) -> (f64, f64) {
        let arr = js_get_wind(lat, lon, time_ms);
        let mut buf = [0.0f64; 2];
        arr.copy_to(&mut buf);
        (buf[0], buf[1])
    }

    fn get_current(&self, lat: f64, lon: f64, time_ms: f64) -> (f64, f64) {
        let arr = js_get_current(lat, lon, time_ms);
        let mut buf = [0.0f64; 2];
        arr.copy_to(&mut buf);
        (buf[0], buf[1])
    }

    fn crosses_land(&self, lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> bool {
        js_crosses_land(lat1, lon1, lat2, lon2)
    }

    fn is_on_land(&self, lat: f64, lon: f64) -> bool {
        js_is_on_land(lat, lon)
    }

    fn get_wave(&self, lat: f64, lon: f64, time_ms: f64) -> Option<f64> {
        let v = js_get_wave(lat, lon, time_ms);
        if v < 0.0 { None } else { Some(v) }
    }

    fn covers_point(&self, lat: f64, lon: f64, time_ms: f64) -> bool {
        js_covers_point(lat, lon, time_ms)
    }

    fn on_progress(&self, pct: f64, frontier: &[(f64, f64)]) {
        let flat: Vec<f64> = frontier.iter().flat_map(|(a, b)| [*a, *b]).collect();
        js_on_progress(pct, &flat);
    }

    fn prefetch(&self, time_ms: f64) {
        js_prefetch(time_ms);
    }
}

/// Main entry point called from the Web Worker.
///
/// # Arguments
/// All arrays are flat Float64Arrays passed from JS:
/// - `polar_twa`: TWA values (degrees, ascending)
/// - `polar_tws`: TWS values (knots, ascending)
/// - `polar_speeds`: speed table (row-major, twa × tws)
/// - `legs`: flat [start_lat, start_lon, wp1_lat, wp1_lon, ..., end_lat, end_lon]
/// - `departure_ms`: departure timestamp
/// - `forecast_end_ms`: end of forecast coverage
/// - `options`: flat [heading_step, sector_size, min_boat_speed, max_wind_kn, max_wave_m,
///              motor_speed_kn, motor_below_kn, wait_for_wind, tack_penalty_sec,
///              tack_threshold_deg, cone_half_angle, cone_disable_lookahead_nm,
///              max_heading_change, arrival_radius_nm]
///
/// # Returns
/// Flat Float64Array: [n_points, lat, lon, time_ms, heading, twa, tws, boat_speed, wind_dir, ...]
/// 9 fields per point, prefixed with point count.
#[wasm_bindgen]
pub fn calculate_route(
    polar_twa: &[f64],
    polar_tws: &[f64],
    polar_speeds: &[f64],
    legs: &[f64], // flat [lat0, lon0, lat1, lon1, ...]
    departure_ms: f64,
    forecast_end_ms: f64,
    options: &[f64],
) -> Result<js_sys::Float64Array, JsValue> {
    let polar = PolarData::from_flat(polar_twa, polar_tws, polar_speeds);

    let config = LegConfig {
        heading_step: options.first().copied().unwrap_or(5.0),
        sector_size: options.get(1).copied().unwrap_or(1.0),
        min_boat_speed: options.get(2).copied().unwrap_or(0.3),
        max_wind_kn: options.get(3).copied().unwrap_or(0.0),
        max_wave_m: options.get(4).copied().unwrap_or(0.0),
        motor_speed_kn: options.get(5).copied().unwrap_or(0.0),
        motor_below_kn: options.get(6).copied().unwrap_or(0.0),
        wait_for_wind: options.get(7).copied().unwrap_or(0.0) > 0.5,
        tack_penalty_sec: options.get(8).copied().unwrap_or(30.0),
        tack_threshold_deg: options.get(9).copied().unwrap_or(60.0),
        cone_half_angle: options.get(10).copied().unwrap_or(100.0),
        cone_disable_lookahead_nm: options.get(11).copied().unwrap_or(100.0),
        max_heading_change: options.get(12).copied().unwrap_or(120.0),
        arrival_radius_nm: options.get(13).copied().unwrap_or(0.0), // 0 = dynamic
    };

    let data = JsDataProvider;

    // Build leg points from flat array
    let n_points = legs.len() / 2;
    if n_points < 2 {
        return Err(JsValue::from_str("Need at least start and end points"));
    }

    let mut full_route: Vec<RoutePoint> = Vec::new();
    let mut leg_departure_ms = departure_ms;
    let total_legs = n_points - 1;

    for leg_idx in 0..total_legs {
        let start_lat = legs[leg_idx * 2];
        let start_lon = legs[leg_idx * 2 + 1];
        let end_lat = legs[(leg_idx + 1) * 2];
        let end_lon = legs[(leg_idx + 1) * 2 + 1];

        let leg_result = calculate_leg(
            start_lat,
            start_lon,
            end_lat,
            end_lon,
            leg_departure_ms,
            forecast_end_ms,
            &polar,
            &config,
            &data,
        );

        match leg_result {
            Ok(route) => {
                if leg_idx == 0 {
                    full_route = route;
                } else if !route.is_empty() {
                    // Skip first point (duplicate of previous leg's end)
                    full_route.extend_from_slice(&route[1..]);
                }
                if let Some(last) = full_route.last() {
                    leg_departure_ms = last.time_ms;
                }
            }
            Err(e) => {
                if full_route.is_empty() {
                    return Err(JsValue::from_str(&e));
                }
                // Partial route — return what we have
                break;
            }
        }
    }

    // Flatten to Float64Array: [n_points, lat, lon, time_ms, heading, twa, tws, boat_speed, wind_dir, step_calc_ms, ...]
    let fields_per_point = 9;
    let mut flat = Vec::with_capacity(1 + full_route.len() * fields_per_point);
    flat.push(full_route.len() as f64);
    for p in &full_route {
        flat.push(p.lat);
        flat.push(p.lon);
        flat.push(p.time_ms);
        flat.push(p.heading);
        flat.push(p.twa);
        flat.push(p.tws);
        flat.push(p.boat_speed);
        flat.push(p.wind_dir);
        flat.push(p.step_calc_ms);
    }

    let arr = js_sys::Float64Array::new_with_length(flat.len() as u32);
    arr.copy_from(&flat);
    Ok(arr)
}
