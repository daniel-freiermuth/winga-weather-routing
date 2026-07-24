// Geodesic math — haversine distance, bearing, destination point.
// Mirrors src/lib/geo.ts but in Rust for the WASM routing loop.

use std::f64::consts::PI;

const DEG_TO_RAD: f64 = PI / 180.0;
const RAD_TO_DEG: f64 = 180.0 / PI;
const NM_PER_RAD: f64 = 3440.065; // nautical miles per radian of Earth

/// Great-circle distance in nautical miles.
pub fn haversine_nm(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let d_lat = (lat2 - lat1) * DEG_TO_RAD;
    let d_lon = (lon2 - lon1) * DEG_TO_RAD;
    let lat1r = lat1 * DEG_TO_RAD;
    let lat2r = lat2 * DEG_TO_RAD;
    let a = (d_lat / 2.0).sin().powi(2) + lat1r.cos() * lat2r.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * a.sqrt().atan2((1.0 - a).sqrt()) * NM_PER_RAD
}

/// Initial bearing from (lat1, lon1) to (lat2, lon2), in degrees 0–360.
pub fn bearing_to(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let lat1r = lat1 * DEG_TO_RAD;
    let lat2r = lat2 * DEG_TO_RAD;
    let d_lon = (lon2 - lon1) * DEG_TO_RAD;
    let y = d_lon.sin() * lat2r.cos();
    let x = lat1r.cos() * lat2r.sin() - lat1r.sin() * lat2r.cos() * d_lon.cos();
    (y.atan2(x) * RAD_TO_DEG + 360.0) % 360.0
}

/// Destination point given start, distance (nm), and bearing (degrees).
pub fn destination_point(lat: f64, lon: f64, dist_nm: f64, bearing_deg: f64) -> (f64, f64) {
    let d = dist_nm / NM_PER_RAD; // angular distance in radians
    let brng = bearing_deg * DEG_TO_RAD;
    let lat1 = lat * DEG_TO_RAD;
    let lon1 = lon * DEG_TO_RAD;
    let new_lat = (lat1.sin() * d.cos() + lat1.cos() * d.sin() * brng.cos()).asin();
    let new_lon =
        lon1 + (brng.sin() * d.sin() * lat1.cos()).atan2(d.cos() - lat1.sin() * new_lat.sin());
    (new_lat * RAD_TO_DEG, new_lon * RAD_TO_DEG)
}

/// Wind speed in knots from u/v components (m/s).
pub fn wind_speed_knots(u: f64, v: f64) -> f64 {
    (u * u + v * v).sqrt() * 1.94384
}

/// Meteorological wind direction (FROM, degrees 0–360) from u/v components.
pub fn wind_direction(u: f64, v: f64) -> f64 {
    // atan2(-u, -v) gives the direction wind blows FROM
    ((-u).atan2(-v) * RAD_TO_DEG + 360.0) % 360.0
}
