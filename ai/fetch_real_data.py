"""
=============================================================================
fetch_real_data.py  –  Open-Meteo API Ingestion Engine
=============================================================================
Fetches real elevation, weather, and sensor data for 5 representative Indian
locations from free, no-auth Open-Meteo APIs and saves a baseline CSV that
main_updated.py will use for physics-informed augmented training.

Run:
    python fetch_real_data.py

Output:
    real_indian_baseline_data.csv  (35 rows: 5 locations × 7 days)
=============================================================================
"""

import time, math, warnings
import numpy as np
import pandas as pd
import requests

warnings.filterwarnings("ignore")

# ── Target locations (5 distinct Indian threat profiles) ─────────────────
LOCATIONS = [
    {
        "name": "Kochi, Kerala",
        "lat":  9.9312, "lon": 76.2673,
        "profile": "coastal_flood",
        "dist_river_km": 1.2,        # near Periyar river mouth
        "land_cover":    0,           # 0=urban
    },
    {
        "name": "Shimla, Himachal Pradesh",
        "lat":  31.1048, "lon": 77.1734,
        "profile": "mountain_landslide",
        "dist_river_km": 4.0,         # near Sutlej tributaries
        "land_cover":    1,           # 1=forest
    },
    {
        "name": "Mumbai, Maharashtra",
        "lat":  19.0760, "lon": 72.8777,
        "profile": "urban_coastal_flood",
        "dist_river_km": 5.5,         # Ulhas / Mithi river
        "land_cover":    0,           # urban
    },
    {
        "name": "Puri, Odisha",
        "lat":  19.8135, "lon": 85.8312,
        "profile": "cyclone_coastal",
        "dist_river_km": 2.8,         # near Mahanadi delta
        "land_cover":    2,           # 2=agriculture
    },
    {
        "name": "Bikaner, Rajasthan",
        "lat":  28.0229, "lon": 73.3119,
        "profile": "desert_safe",
        "dist_river_km": 42.0,        # far from any perennial river
        "land_cover":    2,           # sparse agriculture / scrubland
    },
]

# ── Open-Meteo endpoint URLs ──────────────────────────────────────────────
ELEV_URL  = "https://api.open-meteo.com/v1/elevation"
METEO_URL = "https://api.open-meteo.com/v1/forecast"

# ── Approximate India coastal control points (for dist-to-coast calc) ────
COAST_PTS = [
    (23.0,68.4),(22.0,68.9),(21.0,70.1),(20.2,72.8),(19.0,72.8),
    (18.0,73.4),(16.0,73.5),(15.0,73.8),(14.5,74.3),(13.0,74.8),
    (11.5,75.3),(10.5,75.9),(10.0,76.3),(9.0,76.7),(8.4,77.1),
    (8.1,77.6),(8.7,78.2),(9.5,79.1),(10.0,79.8),(11.0,79.8),
    (12.0,80.0),(13.0,80.3),(15.0,80.1),(17.0,82.2),(18.0,83.5),
    (19.0,84.8),(20.0,86.0),(20.5,86.7),(21.5,87.2),(22.5,88.2),
    (23.5,91.0),
]


def _haversine(la1, lo1, la2, lo2):
    R = 6371.0
    d = math.radians
    a = (math.sin(d(la2 - la1) / 2) ** 2
         + math.cos(d(la1)) * math.cos(d(la2)) * math.sin(d(lo2 - lo1) / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def _dist_coast(lat, lon):
    return round(min(_haversine(lat, lon, c[0], c[1]) for c in COAST_PTS), 2)


# ── API helpers ───────────────────────────────────────────────────────────

def fetch_elevation_and_slope(lat: float, lon: float) -> dict:
    """
    Calls Open-Meteo Elevation API for the primary point AND a nearby
    point (lat+0.05, lon) to estimate slope from the DEM gradient.
    """
    resp = requests.get(
        ELEV_URL,
        params={
            "latitude":  f"{lat},{lat + 0.05}",
            "longitude": f"{lon},{lon}",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    elevations = data.get("elevation", [0, 0])
    elev_center = float(elevations[0])
    elev_north  = float(elevations[1])

    # Slope from finite difference:  delta_elev / distance (5.55 km ≈ 0.05 deg * 111 km/deg)
    delta_elev = abs(elev_north - elev_center)      # m
    horiz_dist = 0.05 * 111_000                      # metres
    slope_deg  = round(math.degrees(math.atan(delta_elev / horiz_dist)), 2)
    slope_deg  = float(np.clip(slope_deg, 0.5, 60.0))

    return {"elevation_m": elev_center, "slope_deg": slope_deg}


def fetch_weather(lat: float, lon: float) -> dict:
    """
    Calls Open-Meteo Forecast API for last 7 days + next 2 days.
    Returns daily and hourly arrays.
    """
    resp = requests.get(
        METEO_URL,
        params={
            "latitude":     lat,
            "longitude":    lon,
            "daily":        ["precipitation_sum", "windspeed_10m_max"],
            "hourly":       ["soil_moisture_3_9cm", "surface_pressure"],
            "past_days":    7,
            "forecast_days": 2,
            "timezone":     "Asia/Kolkata",
        },
        timeout=12,
    )
    resp.raise_for_status()
    return resp.json()


def _daily_avg(hourly_vals, day_idx: int, default: float = 0.0) -> float:
    """Average 24 hourly values for the given day slot."""
    window = [v for v in hourly_vals[day_idx * 24:(day_idx + 1) * 24]
              if v is not None]
    return float(np.mean(window)) if window else default


def build_rows(loc: dict, elev_data: dict, weather: dict) -> list:
    """
    Converts raw API response into 7 tidy rows (one per historical day).

    Feature columns:
      Static  : elevation_m, slope_deg, dist_coast_km, dist_river_km, land_cover_idx
      Dynamic : soil_moisture_pct, rain_cum_3d_mm, rain_fcst_48h_mm,
                river_gauge_m, wind_speed_kmh, baro_drop_hpa
    """
    daily  = weather.get("daily",  {})
    hourly = weather.get("hourly", {})

    all_precip = (daily.get("precipitation_sum",  []) or [])
    all_wind   = (daily.get("windspeed_10m_max",  []) or [])
    sm_hrly    = (hourly.get("soil_moisture_3_9cm", []) or [])
    pr_hrly    = (hourly.get("surface_pressure",    []) or [])

    # Pad / trim to ensure we have at least 9 values (7 hist + 2 fcst)
    def _safe(lst, n, fill=0.0):
        lst = [v if v is not None else fill for v in lst]
        return (lst + [fill] * n)[:n]

    precip_9d = _safe(all_precip, 9, 0.0)
    wind_9d   = _safe(all_wind,   9, 10.0)

    precip_7d  = precip_9d[:7]
    fcst_48h   = sum(precip_9d[7:9])

    # 3-day rolling cumulative (training feature convention)
    rain_cum_7d = [
        float(sum(precip_7d[max(0, i - 2):i + 1]))
        for i in range(7)
    ]

    dc = _dist_coast(loc["lat"], loc["lon"])

    rows = []
    for day_idx in range(7):
        # Soil moisture at 3–9 cm depth (m³/m³ → %)
        sm_raw = _daily_avg(sm_hrly, day_idx, default=0.05)
        soil_pct = float(np.clip(sm_raw * 100.0, 5.0, 95.0))

        # Barometric drop = first-hour pressure minus last-hour pressure that day
        day_press = [v for v in pr_hrly[day_idx * 24:(day_idx + 1) * 24]
                     if v is not None]
        baro_drop = 0.0
        if len(day_press) >= 2:
            baro_drop = float(max(0.0, day_press[0] - day_press[-1]))
        baro_drop = min(baro_drop, 30.0)

        # River gauge derived from 3-day rain accumulation
        rain_cum = rain_cum_7d[day_idx]
        gauge_m  = float(np.clip(0.5 + rain_cum / 16.7, 0.5, 15.0))

        wind_kmh = float(min(wind_9d[day_idx], 220.0))

        rows.append({
            # Identity
            "location_name":   loc["name"],
            "profile":         loc["profile"],
            "lat":             loc["lat"],
            "lon":             loc["lon"],
            "day_idx":         day_idx,
            # Static terrain (constant per location)
            "elevation_m":     elev_data["elevation_m"],
            "slope_deg":       elev_data["slope_deg"],
            "dist_coast_km":   dc,
            "dist_river_km":   loc["dist_river_km"],
            "land_cover_idx":  loc["land_cover"],
            # Dynamic (weather)
            "soil_moisture_pct":  round(soil_pct, 2),
            "rain_cum_3d_mm":     round(rain_cum, 2),
            "rain_fcst_48h_mm":   round(fcst_48h, 2),
            "river_gauge_m":      round(gauge_m, 3),
            "wind_speed_kmh":     round(wind_kmh, 2),
            "baro_drop_hpa":      round(baro_drop, 3),
        })

    return rows


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    print("=" * 62)
    print("  DisasterAI – Real-World Baseline Data Fetcher")
    print("  Source: Open-Meteo (no auth required)")
    print("=" * 62)

    all_rows = []

    for loc in LOCATIONS:
        print(f"\n[FETCH] {loc['name']}  ({loc['lat']}°N, {loc['lon']}°E)")

        # --- Step A: Elevation + slope ----------------------------------
        try:
            elev_data = fetch_elevation_and_slope(loc["lat"], loc["lon"])
            print(f"        Elevation : {elev_data['elevation_m']} m  "
                  f"| Slope : {elev_data['slope_deg']}°")
        except requests.RequestException as e:
            print(f"  [WARN] Elevation API failed ({e}). Using fallback.")
            # Sensible fallback: elevation from profile, slope from elev
            fallback_elev = {"coastal_flood": 5, "mountain_landslide": 2200,
                             "urban_coastal_flood": 14, "cyclone_coastal": 7,
                             "desert_safe": 230}.get(loc["profile"], 200)
            elev_data = {
                "elevation_m": fallback_elev,
                "slope_deg":   round(max(0.5, min(55, fallback_elev / 60)), 2),
            }

        time.sleep(1)  # rate-limit courtesy

        # --- Step B: Weather (7-day history + 2-day forecast) ----------
        try:
            weather = fetch_weather(loc["lat"], loc["lon"])
            rows = build_rows(loc, elev_data, weather)
            all_rows.extend(rows)
            rain_sums = [r["rain_cum_3d_mm"] for r in rows]
            wind_maxes = [r["wind_speed_kmh"] for r in rows]
            print(f"        Rain 3d avg: {np.mean(rain_sums):.1f} mm  "
                  f"| Wind max: {max(wind_maxes):.1f} km/h  "
                  f"| Rows added: 7")
        except requests.RequestException as e:
            print(f"  [ERROR] Weather API failed for {loc['name']}: {e}")

        time.sleep(1)  # rate-limit courtesy

    if not all_rows:
        print("\n[ERROR] No data fetched. Check your internet connection.")
        return

    df = pd.DataFrame(all_rows)
    out_path = "real_indian_baseline_data.csv"
    df.to_csv(out_path, index=False)

    print("\n" + "=" * 62)
    print(f"  Baseline CSV saved → {out_path}")
    print(f"  Total rows  : {len(df)}  ({len(LOCATIONS)} locations × 7 days)")
    print(f"  Columns     : {list(df.columns)}")
    print("\n  Location Summary:")
    summary = df.groupby("location_name").agg(
        elev=("elevation_m", "first"),
        rain_avg=("rain_cum_3d_mm", "mean"),
        soil_avg=("soil_moisture_pct", "mean"),
        wind_max=("wind_speed_kmh", "max"),
    )
    print(summary.to_string())
    print("=" * 62)


if __name__ == "__main__":
    main()
