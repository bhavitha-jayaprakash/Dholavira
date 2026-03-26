"""
DisasterAI – Flask Web Application  (v3, live API)
====================================================
Fetches REAL weather + elevation from Open-Meteo for every clicked location.
No hardcoded zones.  Results vary naturally because real data varies.

Data pipeline per request:
  1. Open-Meteo /forecast  → elevation, 7-day precipitation, wind,
                              soil-moisture, surface-pressure
  2. build_features()      → maps API values to model input arrays
  3. LSTM encoder          → 64-dim temporal vector
  4. XGBoost multi-output  → [flood, landslide, cyclone] probabilities
  5. physics_calibrate()   → safety-net: corrects extreme LSTM mismatches
                             using the same physics rules the model was
                             trained on — no zone lookup needed.
"""

import os, math, warnings, requests
import numpy as np
import joblib
import tensorflow as tf
from flask import Flask, render_template, request, jsonify

warnings.filterwarnings("ignore")

MODELS_DIR         = "models"
SEQ_LEN            = 7
N_DYNAMIC_FEATURES = 6
METEO_URL          = "https://api.open-meteo.com/v1/forecast"

app = Flask(__name__)

lstm_model = lstm_encoder = xgb_clf = static_scaler = dynamic_scaler = None


def load_models():
    global lstm_model, lstm_encoder, xgb_clf, static_scaler, dynamic_scaler
    print("[APP] Loading model artifacts …")
    lstm_model    = tf.keras.models.load_model(
                        os.path.join(MODELS_DIR, "lstm_encoder.keras"))
    lstm_encoder  = tf.keras.Model(
                        inputs  = lstm_model.input,
                        outputs = lstm_model.get_layer("layer_norm").output,
                        name    = "encoder")
    xgb_clf        = joblib.load(os.path.join(MODELS_DIR, "xgb_multi_clf.pkl"))
    static_scaler  = joblib.load(os.path.join(MODELS_DIR, "static_scaler.pkl"))
    dynamic_scaler = joblib.load(os.path.join(MODELS_DIR, "dynamic_scaler.pkl"))
    print("[APP] Models ready ✓")


# ── Coastline helper (unchanged) ──────────────────────────────────────────
COAST_PTS = [
    (23.0,68.4),(22.0,68.9),(21.0,70.1),(20.2,72.8),(19.0,72.8),
    (18.0,73.4),(16.0,73.5),(15.0,73.8),(14.5,74.3),(13.0,74.8),
    (11.5,75.3),(10.5,75.9),(10.0,76.3),(9.0,76.7),(8.4,77.1),
    (8.1,77.6),(8.7,78.2),(9.5,79.1),(10.0,79.8),(11.0,79.8),
    (12.0,80.0),(13.0,80.3),(15.0,80.1),(17.0,82.2),(18.0,83.5),
    (19.0,84.8),(20.0,86.0),(20.5,86.7),(21.5,87.2),(22.5,88.2),
    (23.5,91.0),
]

def _hav(la1,lo1,la2,lo2):
    R=6371.; d=math.radians
    a=math.sin(d(la2-la1)/2)**2+math.cos(d(la1))*math.cos(d(la2))*math.sin(d(lo2-lo1)/2)**2
    return R*2*math.asin(math.sqrt(a))

def _dist_coast(lat, lon):
    return min(_hav(lat,lon,c[0],c[1]) for c in COAST_PTS)


# ── Step 1: Fetch real data ───────────────────────────────────────────────
def fetch_real_data(lat: float, lon: float) -> dict:
    """
    Calls Open-Meteo for the last 7 days + next 2 days of weather data.
    Returns the raw JSON response.
    Raises requests.RequestException on network failure.
    """
    params = {
        "latitude":     lat,
        "longitude":    lon,
        "daily":        ["precipitation_sum", "windspeed_10m_max"],
        "hourly":       ["soil_moisture_0_to_7cm", "surface_pressure"],
        "past_days":    7,
        "forecast_days": 2,
        "timezone":     "Asia/Kolkata",
    }
    r = requests.get(METEO_URL, params=params, timeout=12)
    r.raise_for_status()
    return r.json()


# ── Step 2: Build model input arrays ─────────────────────────────────────
def _safe_list(lst, n, default=0.0):
    """Returns first n values, padding with default if shorter."""
    out = [v if v is not None else default for v in (lst or [])]
    while len(out) < n:
        out.append(default)
    return out[:n]


def _daily_avg_hourly(hourly_vals, day_idx: int, default=0.0):
    """Average 24 hourly values for the given day index (0 = oldest)."""
    vals = [v for v in hourly_vals[day_idx*24:(day_idx+1)*24]
            if v is not None]
    return float(np.mean(vals)) if vals else default


def build_features(lat: float, lon: float, meteo: dict):
    """
    Maps Open-Meteo API response → (static_arr (5,), dynamic_arr (7,6)).

    Training feature ranges (so we stay in-distribution):
      soil_moisture     : 5 – 100  %
      rain_past_3d_cum  : 0 – 250  mm   (3-day rolling sum of daily precip)
      rain_fcst_48h     : 0 – 180  mm   (48-h forecast total)
      river_gauge       : 0.5 – 15 m    (derived from cumulative rain)
      wind_speed        : 0 – 220  km/h
      baro_drop         : 0 – 30   hPa  (daily pressure drop)
    """
    dc        = _dist_coast(lat, lon)
    elevation = float(meteo.get("elevation", 200.0))

    # ── Slope: estimated from DEM elevation ──────────────────────────────
    # Calibrated to training range 0–60 °:
    #   coastal / plains (elev < 100 m): 0.5 – 5 °
    #   plateau / hills  (100–1000 m)  : 5 – 25 °
    #   Himalayas        (>1000 m)     : 25 – 55 °
    if elevation < 100:
        slope = np.clip(0.5 + elevation * 0.05, 0.5, 5.0)
    elif elevation < 1000:
        slope = np.clip(5.0 + (elevation - 100) / 45, 5.0, 25.0)
    else:
        slope = np.clip(25.0 + (elevation - 1000) / 60, 25.0, 55.0)

    # ── Distance to nearest river (heuristic) ────────────────────────────
    # Low-elevation alluvial areas are close to rivers;
    # high mountains have streams; arid plateaus are far.
    if elevation < 80:
        dr = max(0.5, elevation * 0.08)          # 0–6 km for deltas/coasts
    elif elevation > 1500:
        dr = np.clip(elevation / 200, 5.0, 20.0) # 7-17 km for high terrain
    else:
        dr = np.clip(elevation / 30, 3.0, 50.0)  # 3-50 km for mid zones

    # ── Land cover (rough) ───────────────────────────────────────────────
    if elevation > 600:     land = 1   # forest / highland
    elif elevation < 50:    land = 0   # urban / coastal lowland
    else:                   land = 2   # agricultural

    static_arr = np.array([elevation, slope, dr, dc, float(land)],
                           dtype=np.float32)

    # ── Daily weather (7 historical days + 2 forecast) ───────────────────
    daily     = meteo.get("daily", {})
    # Open-Meteo with past_days=7, forecast_days=2 returns 9 daily rows
    all_precip = _safe_list(daily.get("precipitation_sum", []), 9, 0.0)
    all_wind   = _safe_list(daily.get("windspeed_10m_max",  []), 9, 10.0)

    precip_7d  = all_precip[:7]           # historical
    precip_f   = sum(all_precip[7:9])     # 48-h forecast total

    # 3-day rolling cumulative precipitation (matching training semantics)
    rain_cum = [
        float(sum(precip_7d[max(0, i-2):i+1]))
        for i in range(SEQ_LEN)
    ]

    # Clamp to training scales
    rain_cum  = [min(r, 250.0) for r in rain_cum]
    rain_fcst = min(precip_f, 180.0)
    wind_7d   = [min(w, 220.0) for w in _safe_list(all_wind[:7], 7, 10.0)]

    # ── Hourly → daily-averaged soil moisture & pressure ─────────────────
    hourly    = meteo.get("hourly", {})
    # Default 0.05 m³/m³ (5%) so missing data doesn't inflate soil moisture
    sm_hrly   = _safe_list(hourly.get("soil_moisture_0_to_7cm", []), 9*24, 0.05)
    pr_hrly   = _safe_list(hourly.get("surface_pressure",        []), 9*24, 1013.0)

    soil_7d = []
    baro_7d = []
    for d in range(SEQ_LEN):
        # Soil moisture: API returns m³/m³; × 100 → %
        sm = _daily_avg_hourly(sm_hrly, d, 0.05) * 100.0
        soil_7d.append(float(np.clip(sm, 5.0, 95.0)))

        # Barometric drop per day (hPa): first hour minus last in that day
        day_press = [v for v in pr_hrly[d*24:(d+1)*24] if v is not None]
        drop = max(0.0, day_press[0] - day_press[-1]) if len(day_press) >= 2 else 0.0
        baro_7d.append(float(min(drop, 30.0)))

    # Aridity guard (runs AFTER loop so soil_7d is populated):
    # If total recent rain is tiny, cap soil moisture — prevents missing/stale
    # API data from inflating the physics flood score above the 0.45 threshold.
    total_rain = sum(precip_7d)
    if total_rain < 10:
        soil_7d = [min(s, 18.0) for s in soil_7d]   # very dry: cap at 18%
    elif total_rain < 30:
        soil_7d = [min(s, 40.0) for s in soil_7d]   # semi-dry: cap at 40%

    # River gauge (m): proportional to 3-day rain cumulative
    gauge_7d = [float(np.clip(0.5 + r / 16.7, 0.5, 15.0)) for r in rain_cum]

    # ── Stack into (7, 6) ─────────────────────────────────────────────────
    dynamic_arr = np.array([
        soil_7d,                       # soil_moisture (%)
        rain_cum,                      # rain_past_3d (mm)
        [rain_fcst] * SEQ_LEN,         # rain_fcst_48h (mm)
        gauge_7d,                      # river_gauge (m)
        wind_7d,                       # wind_speed (km/h)
        baro_7d,                       # baro_drop (hPa)
    ], dtype=np.float32).T             # → (7, 6)

    return static_arr, dynamic_arr



# ── Step 3: Physics-based calibration (no zones needed) ──────────────────
def _physics_flood(elev, soil_pct, rain_mm, fcst_mm, dr):
    """Reproduces the training-time flood_score formula."""
    return (  0.35 * (1 - elev    / 3500)
            + 0.20 * (soil_pct    / 100)
            + 0.20 * (rain_mm     / 250)
            + 0.15 * (fcst_mm     / 180)
            + 0.10 * (1 - dr      /  50))

def _physics_landslide(slope, rain_mm, soil_pct, fcst_mm):
    return (  0.40 * (slope    /  60)
            + 0.25 * (rain_mm  / 250)
            + 0.25 * (soil_pct / 100)
            + 0.10 * (fcst_mm  / 180))

def _physics_cyclone(wind_kmh, baro_hpa, dc):
    return (  0.40 * (wind_kmh /  220)
            + 0.35 * (baro_hpa /   30)
            + 0.25 * (1 - dc   / 600))

def physics_calibrate(static_arr, dynamic_arr, fp, lp, cp):
    """
    When physics score and XGBoost output disagree across the decision
    boundary, fully defer to the physics score.

    Physics  says SAFE  (<0.45) but model says DANGER (>0.5)?
        → Return physics score:  XGBoost is biased by elevation alone.
    Physics  says DANGER (>=0.45) but model says SAFE (<0.5)?
        → Return average: both signals carry information.
    Both agree?
        → Return model score (it has richer features).
    """
    elev, slope, dr, dc, _ = [float(v) for v in static_arr]
    last = dynamic_arr[-1]          # shape (6,): soil, rain, fcst, gauge, wind, baro
    soil_pct = float(last[0])
    rain_mm  = float(last[1])
    fcst_mm  = float(last[2])
    wind_kmh = float(last[4])
    baro_hpa = float(last[5])

    pf = float(np.clip(_physics_flood    (elev, soil_pct, rain_mm, fcst_mm, dr), 0, 1))
    pl = float(np.clip(_physics_landslide(slope, rain_mm, soil_pct, fcst_mm),   0, 1))
    pc = float(np.clip(_physics_cyclone  (wind_kmh, baro_hpa, dc),              0, 1))

    def resolve(phy, mdl, thr=0.45):
        phy_danger = phy >= thr
        mdl_danger = mdl >= 0.5
        if phy_danger == mdl_danger:
            return mdl                        # agree → trust model (richer signal)
        if not phy_danger and mdl_danger:
            return phy                        # physics says safe, model over-fires → use physics
        return float((phy + mdl) / 2.0)      # physics alarmed, model calm → split

    return resolve(pf, fp), resolve(pl, lp), resolve(pc, cp)


# ── Step 4: Human-readable risk factors ──────────────────────────────────
def risk_factors(static_arr, dynamic_arr, fp, lp, cp):
    elev, slope, dr, dc, _ = static_arr
    rain_mm = float(dynamic_arr[-1, 1])
    wind    = float(dynamic_arr[-1, 4])
    baro    = float(dynamic_arr[-1, 5])
    soil    = float(dynamic_arr[-1, 0])

    # Flood
    if elev < 50 and rain_mm > 60:
        f_why = "Low-lying terrain + heavy rainfall accumulation"
    elif elev < 100:
        f_why = "Coastal/alluvial low elevation increases runoff risk"
    elif rain_mm > 120:
        f_why = "High cumulative rainfall despite moderate terrain"
    elif rain_mm < 20 and elev > 800:
        f_why = "High elevation + dry conditions — minimal flood risk"
    else:
        f_why = f"Moderate elevation ({elev:.0f} m) with current rainfall"

    # Landslide
    if slope > 30 and soil > 55:
        l_why = "Steep terrain with saturated soil — high slide risk"
    elif slope > 20 and rain_mm > 80:
        l_why = "Hilly slopes + heavy rain — elevated slide potential"
    elif slope < 5:
        l_why = "Flat terrain — negligible landslide risk"
    else:
        l_why = f"Moderate gradient ({slope:.1f}°) — low-moderate risk"

    # Cyclone
    if dc < 80 and wind > 70:
        c_why = f"Exposed coastline ({dc:.0f} km) with elevated wind speeds"
    elif dc < 150 and baro > 8:
        c_why = "Coastal proximity + pressure drop detected"
    elif dc > 400:
        c_why = "Deep inland location — no cyclone pathway"
    else:
        c_why = f"Moderate coastal distance ({dc:.0f} km) — low risk"

    return {"flood": f_why, "landslide": l_why, "cyclone": c_why}


# ── Full prediction pipeline ──────────────────────────────────────────────
def run_prediction(lat: float, lon: float):
    meteo = fetch_real_data(lat, lon)

    static_raw, dynamic_raw = build_features(lat, lon, meteo)

    # Scale
    static_sc = static_scaler.transform(static_raw.reshape(1, -1))
    dyn_flat  = dynamic_scaler.transform(
                    dynamic_raw.reshape(-1, N_DYNAMIC_FEATURES))
    dyn_sc    = dyn_flat.reshape(1, SEQ_LEN, N_DYNAMIC_FEATURES)

    # LSTM → temporal vector (1, 64)
    temp_vec  = lstm_encoder.predict(dyn_sc, verbose=0)

    # XGBoost → raw probabilities
    X    = np.concatenate([static_sc, temp_vec], axis=-1)
    probs = [float(est.predict_proba(X)[0, 1]) for est in xgb_clf.estimators_]

    # Calibrate
    fp, lp, cp = physics_calibrate(static_raw, dynamic_raw,
                                   probs[0], probs[1], probs[2])

    factors = risk_factors(static_raw, dynamic_raw, fp, lp, cp)

    return round(fp, 3), round(lp, 3), round(cp, 3), factors, {
        "elevation_m": round(float(static_raw[0]), 1),
        "slope_deg":   round(float(static_raw[1]), 1),
        "dist_coast_km": round(float(static_raw[3]), 1),
        "rain_7day_mm":  round(float(sum(dynamic_raw[:, 1])), 1),
        "wind_max_kmh":  round(float(max(dynamic_raw[:, 4])), 1),
    }


# ── Flask routes ──────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json()
    lat  = float(data["lat"])
    lon  = float(data["lon"])
    name = data.get("name", "Selected Location")

    if not (6.5 <= lat <= 37.5 and 67.0 <= lon <= 98.0):
        return jsonify({"error": "Please select a location within India."}), 400

    try:
        fp, lp, cp, factors, meta = run_prediction(lat, lon)
    except requests.RequestException as e:
        return jsonify({"error": f"Weather API unavailable: {str(e)[:80]}"}), 503
    except Exception as e:
        return jsonify({"error": f"Prediction failed: {str(e)[:80]}"}), 500

    return jsonify({
        "name":      name,
        "lat":       round(lat, 4),
        "lon":       round(lon, 4),
        "flood":     fp,
        "landslide": lp,
        "cyclone":   cp,
        "factors":   factors,
        "meta":      meta,
    })


# ── Entry ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not os.path.exists(os.path.join(MODELS_DIR, "xgb_multi_clf.pkl")):
        print("[APP] No saved models found. Run  python main.py  first.")
        exit(1)
    load_models()
    print("[APP] Starting DisasterAI on http://127.0.0.1:5001")
    app.run(debug=False, host="127.0.0.1", port=5001)
