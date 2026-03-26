"""
=============================================================================
main_updated.py – Hybrid LSTM + XGBoost with Realistic Augmented Data
=============================================================================
Replaces the old purely random synthetic generator.
1. Ingests real_indian_baseline_data.csv (normal safe weather).
2. Generates 10,000 augmented sequences:
   - 70% normal: small variations around the baseline.
   - 30% extreme: injects mathematical spikes (rain, wind, soil) based
     on the location's threat profile.
3. Applies exact physics rules to create target labels.
4. Trains the LSTM + XGBoost pipeline and saves the artifacts.

Run:
    python main_updated.py
=============================================================================
"""

import os
import warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix, classification_report
)
from sklearn.multioutput import MultiOutputClassifier

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model

import xgboost as xgb
import joblib

warnings.filterwarnings("ignore")
np.random.seed(42)
tf.random.set_seed(42)

# ─────────────────────────── CONSTANTS ──────────────────────────────────────
N_AUGMENTED_SAMPLES = 10000
SEQ_LEN             = 7
N_DYNAMIC_FEATURES  = 6
N_STATIC_FEATURES   = 5
LSTM_HIDDEN_UNITS   = 64
LSTM_EPOCHS         = 20
LSTM_BATCH          = 128
RESULTS_DIR         = "results"
MODELS_DIR          = "models"

DISASTER_NAMES      = ["Flood", "Landslide", "Cyclone"]

os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 – REALISTIC DATA AUGMENTATION
# ═══════════════════════════════════════════════════════════════════════════

def load_baseline(csv_path="real_indian_baseline_data.csv"):
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"{csv_path} not found. Run fetch_real_data.py first.")
    df = pd.read_csv(csv_path)
    baselines = []
    # Group by location to extract the 7-day sequence base
    for loc, group in df.groupby("location_name"):
        group = group.sort_values("day_idx")
        # Ensure correct static order: elev, slope, dr, dc, land
        static = group[["elevation_m", "slope_deg", "dist_river_km", "dist_coast_km", "land_cover_idx"]].iloc[0].values
        # Ensure correct dynamic order: soil, rain_cum, rain_fcst, gauge, wind, baro
        dynamic = group[["soil_moisture_pct", "rain_cum_3d_mm", "rain_fcst_48h_mm", 
                         "river_gauge_m", "wind_speed_kmh", "baro_drop_hpa"]].values
        baselines.append({
            "name": loc,
            "profile": group["profile"].iloc[0],
            "static": static.astype(np.float32),
            "dynamic": dynamic.astype(np.float32)
        })
    return baselines

def calc_labels(static, dynamic_last):
    """
    Applies logical disaster thresholds based on physics.
    Matches the original training threshold of 0.45.
    """
    elev, slope, dr, dc, _ = static
    soil, rain, fcst, _, wind, baro = dynamic_last
    
    pf = 0.35 * (1 - elev / 3500) + 0.20 * (soil / 100) + 0.20 * (rain / 250) + 0.15 * (fcst / 180) + 0.10 * (1 - dr / 50)
    pl = 0.40 * (slope / 60) + 0.25 * (rain / 250) + 0.25 * (soil / 100) + 0.10 * (fcst / 180)
    pc = 0.40 * (wind / 220) + 0.35 * (baro / 30) + 0.25 * (1 - dc / 600)
    
    return [int(pf >= 0.45), int(pl >= 0.45), int(pc >= 0.45)]

def generate_augmented_data(baselines, total_samples=N_AUGMENTED_SAMPLES):
    """
    Generates realistic augmented dataset from baseline Open-Meteo data.
    70% normal data, 30% extreme event spikes based on profiles.
    """
    static_list = []
    dynamic_list = []
    labels_list = []
    
    n_normal = int(total_samples * 0.7)
    n_extreme = total_samples - n_normal
    
    rng = np.random.default_rng(42)
    
    # ── GENERATE NORMAL (SAFE) SAMPLES ──
    for _ in range(n_normal):
        base = rng.choice(baselines)
        st = base["static"].copy()
        dy = base["dynamic"].copy()
        
        # Add small natural noise (±10%)
        st[0] *= rng.uniform(0.9, 1.1)
        st[1] *= rng.uniform(0.9, 1.1)
        st[2] *= rng.uniform(0.9, 1.1)
        
        dy *= rng.uniform(0.8, 1.2, size=dy.shape)
        
        dy[..., 0] = np.clip(dy[..., 0], 5, 100)  # soil
        dy[..., 1] = np.clip(dy[..., 1], 0, 250)  # rain 3d
        dy[..., 2] = np.clip(dy[..., 2], 0, 180)  # rain fcst
        dy[..., 4] = np.clip(dy[..., 4], 0, 220)  # wind
        dy[..., 5] = np.clip(dy[..., 5], 0, 30)   # baro drop
        
        static_list.append(st)
        dynamic_list.append(dy)
        labels_list.append(calc_labels(st, dy[-1]))
        
    # ── GENERATE EXTREME (DISASTER) SAMPLES ──
    extreme_counts = {"Flood": 0, "Landslide": 0, "Cyclone": 0}
    
    for _ in range(n_extreme):
        base = rng.choice(baselines)
        st = base["static"].copy()
        dy = base["dynamic"].copy()
        profile = base["profile"]
        
        # Choose spike type based on location profile
        if profile in ["coastal_flood", "urban_coastal_flood"]:
            spike_type = rng.choice(["flood", "cyclone"], p=[0.7, 0.3])
        elif profile == "mountain_landslide":
            spike_type = rng.choice(["landslide", "flood"], p=[0.8, 0.2])
        elif profile == "cyclone_coastal":
            spike_type = rng.choice(["cyclone", "flood"], p=[0.8, 0.2])
        else: # desert_safe
            spike_type = "safe" # Rarity: desert doesn't easily spike, mostly normal
            
        trend = np.linspace(1.0, 3.0, SEQ_LEN) # escalating multiplier over 7 days
        
        if spike_type == "flood":
            dy[:, 0] = np.clip(dy[:, 0] * trend * 3.0 + 30, 5, 100)            # saturated soil
            dy[:, 1] = np.clip((dy[:, 1] + 20) * trend * 5.0 + 80, 0, 250)     # huge rain
            dy[:, 2] = np.clip((dy[:, 2] + 20) * trend * 3.0 + 60, 0, 180)     # heavy forecast
            dy[:, 3] = np.clip((dy[:, 3] + 1) * trend * 2.5, 0.5, 15)          # rising river
            extreme_counts["Flood"] += 1
            
        elif spike_type == "landslide":
            dy[:, 0] = np.clip(dy[:, 0] * trend * 4.0 + 40, 5, 100)            # extremely wet soil
            dy[:, 1] = np.clip((dy[:, 1] + 10) * trend * 4.0 + 60, 0, 250)     # steady heavy rain
            st[1]    = np.clip(st[1] * rng.uniform(1.2, 1.8), 25, 60)          # steeper slope variation
            extreme_counts["Landslide"] += 1
            
        elif spike_type == "cyclone":
            dy[:, 4] = np.clip((dy[:, 4] + 15) * trend * 4.0 + 100, 0, 220)    # severe wind
            dy[:, 5] = np.clip((dy[:, 5] + 2) * trend * 5.0 + 15, 0, 30)       # massive pressure drop
            dy[:, 1] = np.clip((dy[:, 1] + 10) * trend * 4.0 + 50, 0, 250)     # cyclonic rain
            extreme_counts["Cyclone"] += 1
            
        static_list.append(st)
        dynamic_list.append(dy)
        labels_list.append(calc_labels(st, dy[-1]))
        
    print("=" * 62)
    print(f"[AUGMENT] Generated {n_normal} normal real-weather variations.")
    print(f"[AUGMENT] Injected extreme scenarios: {extreme_counts['Flood']} Flood, "
          f"{extreme_counts['Landslide']} Landslide, {extreme_counts['Cyclone']} Cyclone.")
    print("=" * 62)
    
    static_arr = np.array(static_list, dtype=np.float32)
    dynamic_arr = np.array(dynamic_list, dtype=np.float32)
    labels_arr = np.array(labels_list, dtype=np.int32)
    
    print("\n[DATA] Label distribution (positive class %):")
    for i, name in enumerate(DISASTER_NAMES):
        pct = labels_arr[:, i].mean() * 100
        print(f"       {name:10s}: {pct:.1f}%")
        
    return {"static": static_arr, "dynamic": dynamic_arr, "labels": labels_arr}

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 – PREPROCESSING
# ═══════════════════════════════════════════════════════════════════════════

def preprocess(data: dict):
    from sklearn.preprocessing import StandardScaler
    static_sc = StandardScaler()
    dynamic_sc = StandardScaler()
    
    st_scaled = static_sc.fit_transform(data["static"])
    
    dyn_flat = data["dynamic"].reshape(-1, N_DYNAMIC_FEATURES)
    dyn_scaled_flat = dynamic_sc.fit_transform(dyn_flat)
    dyn_scaled = dyn_scaled_flat.reshape(-1, SEQ_LEN, N_DYNAMIC_FEATURES)
    
    # Save scalers for production web app
    joblib.dump(static_sc, os.path.join(MODELS_DIR, "static_scaler.pkl"))
    joblib.dump(dynamic_sc, os.path.join(MODELS_DIR, "dynamic_scaler.pkl"))
    
    return st_scaled, dyn_scaled, data["labels"], static_sc, dynamic_sc

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 – MODEL ARCHITECTURE & TRAINING
# ═══════════════════════════════════════════════════════════════════════════

def build_lstm_classifier():
    dyn_in = layers.Input(shape=(SEQ_LEN, N_DYNAMIC_FEATURES), name="dynamic_input")
    x = layers.LSTM(LSTM_HIDDEN_UNITS, return_sequences=True)(dyn_in)
    x = layers.Dropout(0.3)(x)
    x = layers.LSTM(LSTM_HIDDEN_UNITS)(x)
    temporal_out = layers.LayerNormalization(name="layer_norm")(x)
    
    outputs = layers.Dense(3, activation="sigmoid", name="predictions")(temporal_out)
    
    model = Model(inputs=dyn_in, outputs=outputs, name="LSTM_PreTrainer")
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    return model

def extract_temporal_features(lstm_model, X_dynamic):
    encoder = Model(
        inputs=lstm_model.input,
        outputs=lstm_model.get_layer("layer_norm").output,
        name="lstm_encoder"
    )
    return encoder.predict(X_dynamic, batch_size=LSTM_BATCH, verbose=0)

def build_xgboost():
    base_xgb = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        eval_metric="logloss",
        use_label_encoder=False,
        tree_method="hist",
        n_jobs=-1,
        random_state=42,
    )
    return MultiOutputClassifier(base_xgb, n_jobs=1)

# ═══════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Loading Real Indian Baseline Data...")
    baselines = load_baseline()
    
    print("Generating Augmented Dataset...")
    data = generate_augmented_data(baselines)
    
    print("\nPreprocessing...")
    st_sc, dyn_sc, labels, s_scaler, d_scaler = preprocess(data)
    
    X_st_train, X_st_test, X_dyn_train, X_dyn_test, y_train, y_test = train_test_split(
        st_sc, dyn_sc, labels, test_size=0.2, random_state=42
    )
    
    print("\nPhase 1: Pre-training LSTM Temporal Encoder...")
    lstm_model = build_lstm_classifier()
    lstm_model.fit(
        X_dyn_train, y_train,
        validation_split=0.1,
        epochs=LSTM_EPOCHS,
        batch_size=LSTM_BATCH,
        verbose=1,
    )
    
    # Save LSTM model
    lstm_model.save(os.path.join(MODELS_DIR, "lstm_encoder.keras"))
    
    print("\nExtracting 64-dim Temporal Vectors...")
    lstm_vec_train = extract_temporal_features(lstm_model, X_dyn_train)
    lstm_vec_test  = extract_temporal_features(lstm_model, X_dyn_test)
    
    print("Fusing Static + Temporal Features...")
    X_train_fused = np.concatenate([X_st_train, lstm_vec_train], axis=1)
    X_test_fused  = np.concatenate([X_st_test, lstm_vec_test], axis=1)
    
    print("\nPhase 2: Training Multi-Task XGBoost...")
    multi_xgb = build_xgboost()
    multi_xgb.fit(X_train_fused, y_train)
    
    # Save XGBoost
    joblib.dump(multi_xgb, os.path.join(MODELS_DIR, "xgb_multi_clf.pkl"))
    print(f"Artifacts saved to {MODELS_DIR}/")
    
    print("\nEvaluation:")
    y_pred = multi_xgb.predict(X_test_fused)
    for i, name in enumerate(DISASTER_NAMES):
        print(f"\n--- {name} Performance ---")
        print(classification_report(y_test[:, i], y_pred[:, i], zero_division=0))
        
    print("\n[SUCCESS] Realistic augmented training pipeline complete.")
