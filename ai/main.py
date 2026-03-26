"""
=============================================================================
Hybrid LSTM + XGBoost Multi-Task Disaster Prediction System
=============================================================================
Predicts probability of Flash Floods, Landslides, and Cyclones in India
based on GPS coordinates and localized weather/terrain features.

Architecture:
  Part A – LSTM Temporal Encoder   → extracts temporal weather momentum
  Part B – XGBoost Multi-Output    → fuses static terrain + temporal vector
                                     → outputs risk scores [Flood, Landslide, Cyclone]

Author  : Disaster_AI_Project (Hackathon build)
Python  : 3.9+
Deps    : tensorflow, xgboost, scikit-learn, numpy, pandas, matplotlib, seaborn
=============================================================================
"""

# ─────────────────────────── IMPORTS ────────────────────────────────────────
import os
import warnings
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")                       # non-interactive backend (safe for scripts)
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, MinMaxScaler
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
N_SAMPLES          = 6000          # total synthetic training samples
SEQ_LEN            = 7             # LSTM input: 7-day rolling window
N_DYNAMIC_FEATURES = 6             # features fed to LSTM per time-step
N_STATIC_FEATURES  = 5             # scalar terrain features
LSTM_HIDDEN_UNITS  = 64            # size of LSTM hidden state  ← temporal vector dim
LSTM_EPOCHS        = 20
LSTM_BATCH         = 128
RESULTS_DIR        = "results"     # where plots are saved

DISASTER_NAMES     = ["Flood", "Landslide", "Cyclone"]

os.makedirs(RESULTS_DIR, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 – SYNTHETIC DATA GENERATION
# ═══════════════════════════════════════════════════════════════════════════

def generate_synthetic_data(n_samples: int = N_SAMPLES, seed: int = 42) -> dict:
    """
    Generates a physics-informed synthetic dataset.

    Returns a dictionary with:
      static_features  : (n_samples, N_STATIC_FEATURES) float array
      dynamic_features : (n_samples, SEQ_LEN, N_DYNAMIC_FEATURES) float array
      labels           : (n_samples, 3) binary array  [flood, landslide, cyclone]
    """
    rng = np.random.default_rng(seed)

    # ── STATIC TERRAIN FEATURES ──────────────────────────────────────────
    elevation             = rng.uniform(0, 3500, n_samples)       # metres
    slope_gradient        = rng.uniform(0, 60,   n_samples)       # degrees
    dist_river            = rng.uniform(0, 50,   n_samples)       # km
    dist_coast            = rng.uniform(0, 600,  n_samples)       # km
    land_cover_index      = rng.integers(0, 3,   n_samples)       # 0=urban,1=forest,2=agri

    static_features = np.column_stack([
        elevation,
        slope_gradient,
        dist_river,
        dist_coast,
        land_cover_index.astype(float),
    ])                                                             # (n, 5)

    # ── DYNAMIC WEATHER FEATURES  (7-day sequences) ───────────────────────
    # Each row is a 7-day sequence; columns within each day:
    #   0: soil_moisture_current (%)
    #   1: rain_past_3_days_cumulative (mm)
    #   2: rain_forecast_next_48h (mm)
    #   3: river_gauge_level_current (m)
    #   4: wind_speed_max_forecast (km/h)
    #   5: barometric_pressure_drop (hPa)

    soil_moisture_seq   = rng.uniform(5,  100, (n_samples, SEQ_LEN))
    rain_past_seq       = rng.uniform(0,  250, (n_samples, SEQ_LEN))
    rain_fcst_seq       = rng.uniform(0,  180, (n_samples, SEQ_LEN))
    river_gauge_seq     = rng.uniform(0.5, 15, (n_samples, SEQ_LEN))
    wind_speed_seq      = rng.uniform(0,  220, (n_samples, SEQ_LEN))
    baro_drop_seq       = rng.uniform(0,   30, (n_samples, SEQ_LEN))

    # Stack along feature axis → (n_samples, SEQ_LEN, N_DYNAMIC_FEATURES)
    dynamic_features = np.stack([
        soil_moisture_seq,
        rain_past_seq,
        rain_fcst_seq,
        river_gauge_seq,
        wind_speed_seq,
        baro_drop_seq,
    ], axis=-1)                                                    # (n, 7, 6)

    # ── LABEL GENERATION  (physics-informed rules) ────────────────────────
    # We use the LAST DAY values as the "current" state for label decisions
    soil_last   = dynamic_features[:, -1, 0]   # soil_moisture (last day)
    rain_last   = dynamic_features[:, -1, 1]   # cumul rain (last day)
    rain_fcst   = dynamic_features[:, -1, 2]   # forecast rain
    gauge_last  = dynamic_features[:, -1, 3]   # river gauge
    wind_last   = dynamic_features[:, -1, 4]   # wind speed
    baro_last   = dynamic_features[:, -1, 5]   # baro drop

    # --- Flood probability score (physics rules) ---
    flood_score = (
        0.35 * (1 - elevation / 3500) +       # lower elevation → higher risk
        0.20 * (soil_last   / 100)    +
        0.20 * (rain_last   / 250)    +
        0.15 * (rain_fcst   / 180)    +
        0.10 * (1 - dist_river / 50)
    )                                          # range ≈ [0, 1]
    flood_score = np.clip(flood_score + rng.normal(0, 0.06, n_samples), 0, 1)

    # --- Landslide probability score ---
    landslide_score = (
        0.40 * (slope_gradient / 60)  +
        0.25 * (rain_last      / 250) +
        0.25 * (soil_last      / 100) +
        0.10 * (rain_fcst      / 180)
    )
    landslide_score = np.clip(landslide_score + rng.normal(0, 0.06, n_samples), 0, 1)

    # --- Cyclone probability score ---
    cyclone_score = (
        0.40 * (wind_last  / 220)   +
        0.35 * (baro_last  / 30)    +
        0.25 * (1 - dist_coast / 600)
    )
    cyclone_score = np.clip(cyclone_score + rng.normal(0, 0.06, n_samples), 0, 1)

    # Binarise at threshold 0.45  → realistic class imbalance (~25-35% positive)
    THRESH = 0.45
    flood_labels     = (flood_score     > THRESH).astype(int)
    landslide_labels = (landslide_score > THRESH).astype(int)
    cyclone_labels   = (cyclone_score   > THRESH).astype(int)

    labels = np.column_stack([flood_labels, landslide_labels, cyclone_labels])  # (n, 3)

    print("\n[DATA] Label distribution (positive class %):")
    for i, name in enumerate(DISASTER_NAMES):
        pct = labels[:, i].mean() * 100
        print(f"       {name:10s}: {pct:.1f}%")

    return {
        "static":  static_features,    # (n, 5)
        "dynamic": dynamic_features,   # (n, 7, 6)
        "labels":  labels,             # (n, 3)
    }


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 – PREPROCESSING  (Scaling)
# ═══════════════════════════════════════════════════════════════════════════

def preprocess(data: dict, fit: bool = True,
               static_scaler=None, dynamic_scaler=None):
    """
    Scales static and dynamic features independently.
    If fit=True, fits new scalers; otherwise transforms using provided scalers.

    Tensor shapes:
      static  → (n, 5)
      dynamic → (n, 7, 6)   reshape to (n*7, 6) for scaler, then back to (n, 7, 6)
    """
    static_arr  = data["static"].copy().astype(np.float32)
    dynamic_arr = data["dynamic"].copy().astype(np.float32)
    n = static_arr.shape[0]

    if fit:
        static_scaler  = StandardScaler()
        dynamic_scaler = StandardScaler()
        static_arr = static_scaler.fit_transform(static_arr)
        # Flatten time dimension for scaling, then restore
        dynamic_flat = dynamic_scaler.fit_transform(
            dynamic_arr.reshape(-1, N_DYNAMIC_FEATURES)             # (n*7, 6)
        )
        dynamic_arr = dynamic_flat.reshape(n, SEQ_LEN, N_DYNAMIC_FEATURES)  # (n, 7, 6)
    else:
        static_arr   = static_scaler.transform(static_arr)
        dynamic_flat = dynamic_scaler.transform(
            dynamic_arr.reshape(-1, N_DYNAMIC_FEATURES)
        )
        dynamic_arr = dynamic_flat.reshape(n, SEQ_LEN, N_DYNAMIC_FEATURES)

    return static_arr, dynamic_arr, static_scaler, dynamic_scaler


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 – PART A: LSTM TEMPORAL ENCODER (TensorFlow / Keras)
# ═══════════════════════════════════════════════════════════════════════════

def build_lstm_encoder(seq_len: int = SEQ_LEN,
                       n_features: int = N_DYNAMIC_FEATURES,
                       hidden_units: int = LSTM_HIDDEN_UNITS) -> Model:
    """
    Builds an LSTM autoencoder that compresses a 7-day weather sequence into
    a fixed-size temporal feature vector of shape (hidden_units,).

    Input  shape : (batch, seq_len, n_features)  → (batch, 7, 6)
    Output shape : (batch, hidden_units)          → (batch, 64)

    We use return_sequences=False on the last LSTM so Keras automatically
    returns only the final hidden state h_T  — the "temporal momentum" vector.
    """
    inp = keras.Input(shape=(seq_len, n_features), name="dynamic_input")

    # First LSTM layer – captures short-term weather transitions
    x = layers.LSTM(hidden_units * 2, return_sequences=True,
                    name="lstm_1")(inp)
    x = layers.Dropout(0.2)(x)

    # Second LSTM layer – distils into a compact hidden state h_T
    # return_sequences=False → output is h_T  shape: (batch, hidden_units)
    temporal_vec = layers.LSTM(hidden_units, return_sequences=False,
                               name="lstm_2")(x)
    temporal_vec = layers.LayerNormalization(name="layer_norm")(temporal_vec)

    model = Model(inputs=inp, outputs=temporal_vec, name="LSTMEncoder")
    return model


def build_lstm_classifier(seq_len, n_features, hidden_units, n_classes=3) -> Model:
    """
    Full Keras model used ONLY to train the LSTM in a supervised manner
    (predicts disaster labels directly) so it learns meaningful representations.
    Weights are later extracted for the hybrid pipeline.
    """
    inp = keras.Input(shape=(seq_len, n_features), name="dynamic_input")
    x   = layers.LSTM(hidden_units * 2, return_sequences=True, name="lstm_1")(inp)
    x   = layers.Dropout(0.2)(x)
    temporal_vec = layers.LSTM(hidden_units, return_sequences=False, name="lstm_2")(x)
    temporal_vec = layers.LayerNormalization(name="layer_norm")(temporal_vec)
    x   = layers.Dense(32, activation="relu")(temporal_vec)
    out = layers.Dense(n_classes, activation="sigmoid", name="output")(x)

    model = Model(inputs=inp, outputs=out, name="LSTMClassifier")
    model.compile(
        optimizer=keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=["accuracy"]
    )
    return model


def train_lstm(dynamic_train, labels_train, dynamic_val, labels_val):
    """Trains the LSTM classifier and returns the trained model."""
    print("\n[LSTM] Building and training LSTM temporal encoder …")
    model = build_lstm_classifier(SEQ_LEN, N_DYNAMIC_FEATURES, LSTM_HIDDEN_UNITS)
    model.summary()

    # Compute class weights to handle imbalance
    # (simple approach: weight positive class by 1/positive_rate)
    pos_rates = labels_train.mean(axis=0)                        # (3,)
    neg_rates = 1 - pos_rates
    class_weights = {0: 1.0, 1: float(neg_rates.mean() / pos_rates.mean())}

    es = keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=4, restore_best_weights=True
    )
    history = model.fit(
        dynamic_train, labels_train,
        validation_data=(dynamic_val, labels_val),
        epochs=LSTM_EPOCHS,
        batch_size=LSTM_BATCH,
        class_weight=class_weights,
        callbacks=[es],
        verbose=1,
    )
    print(f"[LSTM] Training complete. Best val_loss: "
          f"{min(history.history['val_loss']):.4f}")
    return model


def extract_temporal_features(lstm_model: Model, dynamic_data: np.ndarray) -> np.ndarray:
    """
    Strips the final Dense+output layers and uses the LSTM body as an encoder
    to extract the temporal feature vector h_T for each sample.

    Steps:
      1. Build a new Keras model that shares the same LSTM weights but
         outputs at the LayerNorm layer (the temporal vector, shape: (batch, 64)).
      2. Run inference → shape: (n_samples, LSTM_HIDDEN_UNITS)
    """
    encoder = Model(
        inputs=lstm_model.input,
        outputs=lstm_model.get_layer("layer_norm").output,   # h_T shape: (batch, 64)
        name="LSTMEncoder_inference"
    )
    # Inference-only; no training required here
    temporal_vecs = encoder.predict(dynamic_data, batch_size=256, verbose=0)  # (n, 64)
    print(f"[LSTM] Temporal feature vectors extracted → shape: {temporal_vecs.shape}")
    return temporal_vecs


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 – PART B: FEATURE CONCATENATION + XGBoost MULTI-OUTPUT CLASSIFIER
# ═══════════════════════════════════════════════════════════════════════════

def concatenate_features(static_arr: np.ndarray,
                          temporal_vecs: np.ndarray) -> np.ndarray:
    """
    Fuses static terrain features with LSTM temporal vectors.

    Concatenation:
      static_arr    : (n, 5)          ← elevation, slope, rivers, coast, land_cover
      temporal_vecs : (n, 64)         ← h_T from LSTM (weather momentum)
      ─────────────────────────────
      combined      : (n, 69)         ← full feature matrix for XGBoost
    """
    combined = np.concatenate([static_arr, temporal_vecs], axis=-1)  # (n, 5+64=69)
    print(f"[CONCAT] Combined feature matrix shape: {combined.shape}")
    return combined


def build_and_train_xgboost(X_train: np.ndarray, y_train: np.ndarray,
                             X_val: np.ndarray,   y_val: np.ndarray):
    """
    Trains a MultiOutputClassifier wrapping XGBoost for simultaneous
    Flood, Landslide, and Cyclone prediction.

    Class imbalance handled via `scale_pos_weight` in XGBClassifier.
    """
    print("\n[XGB] Training XGBoost multi-output classifier …")

    # Compute average positive rate across all labels → drive scale_pos_weight
    pos_rate = y_train.mean()
    spw = (1 - pos_rate) / (pos_rate + 1e-8)

    base_xgb = xgb.XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=spw,         # handles class imbalance implicitly
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
    )

    # MultiOutputClassifier fits one XGBClassifier per label (3 total)
    multi_clf = MultiOutputClassifier(base_xgb, n_jobs=1)
    multi_clf.fit(X_train, y_train)
    print("[XGB] Training complete.")
    return multi_clf


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 – EVALUATION & VISUALISATION
# ═══════════════════════════════════════════════════════════════════════════

def evaluate_model(clf, X_test: np.ndarray, y_test: np.ndarray):
    """Produces per-disaster metrics and confusion matrix plots."""
    y_pred      = clf.predict(X_test)
    y_prob      = np.column_stack([
        est.predict_proba(X_test)[:, 1]
        for est in clf.estimators_
    ])                                           # (n_test, 3)  probability scores

    print("\n" + "=" * 60)
    print("  EVALUATION RESULTS")
    print("=" * 60)

    metrics_table = []
    for i, name in enumerate(DISASTER_NAMES):
        acc  = accuracy_score(y_test[:, i],  y_pred[:, i])
        prec = precision_score(y_test[:, i], y_pred[:, i], zero_division=0)
        rec  = recall_score(y_test[:, i],    y_pred[:, i], zero_division=0)
        f1   = f1_score(y_test[:, i],        y_pred[:, i], zero_division=0)
        metrics_table.append([name, acc, prec, rec, f1])

        print(f"\n  [{name}]")
        print(f"    Accuracy : {acc:.4f}")
        print(f"    Precision: {prec:.4f}")
        print(f"    Recall   : {rec:.4f}")
        print(f"    F1-Score : {f1:.4f}")
        print(classification_report(y_test[:, i], y_pred[:, i],
                                    target_names=["No Event", name]))

    print("=" * 60)

    # ── Confusion Matrices ──────────────────────────────────────────────
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    fig.suptitle("Confusion Matrices – Disaster Prediction Model",
                 fontsize=15, fontweight="bold")

    for i, (name, ax) in enumerate(zip(DISASTER_NAMES, axes)):
        cm = confusion_matrix(y_test[:, i], y_pred[:, i])
        sns.heatmap(
            cm, annot=True, fmt="d", cmap="Blues", ax=ax,
            xticklabels=["No Event", name],
            yticklabels=["No Event", name]
        )
        ax.set_title(f"{name} Confusion Matrix", fontsize=12, fontweight="bold")
        ax.set_xlabel("Predicted")
        ax.set_ylabel("Actual")

    plt.tight_layout()
    cm_path = os.path.join(RESULTS_DIR, "confusion_matrices.png")
    plt.savefig(cm_path, dpi=150)
    plt.close()
    print(f"\n[PLOT] Confusion matrices saved → {cm_path}")

    return y_prob, metrics_table


def plot_feature_importance(clf, n_static: int = N_STATIC_FEATURES,
                             lstm_dim: int = LSTM_HIDDEN_UNITS):
    """
    Extracts and plots XGBoost feature importances for each disaster head.
    The feature vector is [5 static | 64 LSTM temporal] = 69 features total.
    """
    static_names  = [
        "Elevation", "Slope Gradient", "Dist. River",
        "Dist. Coast", "Land Cover"
    ]
    temporal_names = [f"LSTM_h{i}" for i in range(lstm_dim)]
    feature_names  = static_names + temporal_names   # 69 features

    fig, axes = plt.subplots(1, 3, figsize=(21, 6))
    fig.suptitle("XGBoost Feature Importances (Top 20) per Disaster Head",
                 fontsize=14, fontweight="bold")

    for i, (name, ax) in enumerate(zip(DISASTER_NAMES, axes)):
        importances = clf.estimators_[i].feature_importances_  # (69,)
        df_imp = pd.DataFrame({
            "Feature":    feature_names,
            "Importance": importances
        }).sort_values("Importance", ascending=False).head(20)

        # Colour-code: static features in coral, LSTM neurons in steelblue
        colors = [
            "#e05c5c" if f in static_names else "#4a90d9"
            for f in df_imp["Feature"]
        ]
        sns.barplot(
            data=df_imp, x="Importance", y="Feature",
            palette=colors, ax=ax, orient="h"
        )
        ax.set_title(f"{name} – Feature Importances", fontweight="bold")
        ax.set_xlabel("Importance Score")
        ax.set_ylabel("")

    plt.tight_layout()
    fi_path = os.path.join(RESULTS_DIR, "feature_importance.png")
    plt.savefig(fi_path, dpi=150)
    plt.close()
    print(f"[PLOT] Feature importance chart saved → {fi_path}")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 – TEST LOCATIONS CSV  (simulated user payloads from app)
# ═══════════════════════════════════════════════════════════════════════════

def generate_test_locations_csv(output_path: str = "test_locations.csv"):
    """
    Creates 5 realistic Indian locations with static + dynamic weather data
    to simulate the frontend sending GPS + API payloads.
    """
    # Each location is a dict matching the feature schema
    # Dynamic features provided as comma-separated 7-day sequences (last 7 days)
    locations = [
        {
            # 1. Kerala coastal town – high flood + cyclone risk
            "location_name": "Kochi, Kerala",
            "lat": 9.9312, "lon": 76.2673,
            "elevation": 3.0,
            "slope_gradient": 2.5,
            "distance_to_nearest_river": 0.8,
            "distance_to_coastline": 1.2,
            "land_cover_index": 0,                  # urban
            "soil_moisture_7d": "78,82,85,88,90,92,95",
            "rain_past_3d_7d":  "45,60,80,95,120,150,180",
            "rain_fcst_48h_7d": "20,30,40,50,60,70,90",
            "river_gauge_7d":   "3.2,3.8,4.5,5.2,6.1,7.0,8.5",
            "wind_speed_7d":    "55,62,70,78,90,105,130",
            "baro_drop_7d":     "2,4,6,8,10,13,17",
        },
        {
            # 2. Himachal Pradesh hillside – high landslide risk
            "location_name": "Manali, Himachal Pradesh",
            "lat": 32.2432, "lon": 77.1892,
            "elevation": 2050.0,
            "slope_gradient": 45.0,
            "distance_to_nearest_river": 1.5,
            "distance_to_coastline": 580.0,
            "land_cover_index": 1,                  # forest
            "soil_moisture_7d": "60,65,70,75,80,85,90",
            "rain_past_3d_7d":  "20,35,55,80,110,145,185",
            "rain_fcst_48h_7d": "15,25,40,55,70,85,100",
            "river_gauge_7d":   "1.2,1.5,1.8,2.2,2.7,3.1,3.9",
            "wind_speed_7d":    "20,22,25,28,32,38,45",
            "baro_drop_7d":     "1,2,3,5,7,9,12",
        },
        {
            # 3. Odisha coastal plain – high cyclone risk
            "location_name": "Puri, Odisha",
            "lat": 19.8135, "lon": 85.8312,
            "elevation": 7.0,
            "slope_gradient": 1.0,
            "distance_to_nearest_river": 3.0,
            "distance_to_coastline": 0.5,
            "land_cover_index": 2,                  # agriculture
            "soil_moisture_7d": "50,55,58,62,65,68,72",
            "rain_past_3d_7d":  "10,15,20,25,35,50,70",
            "rain_fcst_48h_7d": "20,30,45,60,80,100,130",
            "river_gauge_7d":   "2.0,2.3,2.6,3.0,3.4,3.9,4.5",
            "wind_speed_7d":    "80,95,110,130,155,175,200",
            "baro_drop_7d":     "5,8,12,16,20,24,28",
        },
        {
            # 4. Rajasthan desert – very low disaster risk
            "location_name": "Jaisalmer, Rajasthan",
            "lat": 26.9157, "lon": 70.9083,
            "elevation": 225.0,
            "slope_gradient": 3.0,
            "distance_to_nearest_river": 35.0,
            "distance_to_coastline": 420.0,
            "land_cover_index": 2,                  # sparse agriculture
            "soil_moisture_7d": "5,5,6,6,7,7,8",
            "rain_past_3d_7d":  "0,0,0,1,1,2,2",
            "rain_fcst_48h_7d": "0,0,0,0,1,1,2",
            "river_gauge_7d":   "0.3,0.3,0.3,0.3,0.4,0.4,0.4",
            "wind_speed_7d":    "15,18,20,22,25,28,30",
            "baro_drop_7d":     "0,0,1,1,1,2,2",
        },
        {
            # 5. Mumbai suburb – moderate flood + mild cyclone
            "location_name": "Thane, Maharashtra",
            "lat": 19.2183, "lon": 72.9781,
            "elevation": 14.0,
            "slope_gradient": 5.0,
            "distance_to_nearest_river": 1.5,
            "distance_to_coastline": 12.0,
            "land_cover_index": 0,                  # urban
            "soil_moisture_7d": "55,60,65,70,75,78,82",
            "rain_past_3d_7d":  "30,50,70,90,110,130,155",
            "rain_fcst_48h_7d": "25,35,50,65,80,95,110",
            "river_gauge_7d":   "2.5,3.0,3.6,4.2,5.0,5.8,6.8",
            "wind_speed_7d":    "30,35,40,45,52,60,72",
            "baro_drop_7d":     "1,2,3,5,7,9,11",
        },
    ]

    df = pd.DataFrame(locations)
    df.to_csv(output_path, index=False)
    print(f"\n[CSV] test_locations.csv saved → {output_path}  ({len(df)} locations)")
    return df


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 – PREDICT ON TEST LOCATIONS (Terminal Formatted Output)
# ═══════════════════════════════════════════════════════════════════════════

def parse_seq(seq_str: str) -> np.ndarray:
    """Parses a comma-separated 7-value string into a float array (7,)."""
    return np.array([float(v) for v in seq_str.split(",")])


def predict_test_locations(csv_path: str,
                           clf,
                           static_scaler,
                           dynamic_scaler,
                           lstm_model: Model):
    """
    Loads test_locations.csv, preprocesses, runs the hybrid pipeline,
    and prints a clean risk report with action recommendations.
    """
    df = pd.read_csv(csv_path)
    n  = len(df)

    # Build static array  (n, 5)
    static_raw = df[[
        "elevation", "slope_gradient",
        "distance_to_nearest_river", "distance_to_coastline",
        "land_cover_index"
    ]].values.astype(np.float32)

    # Build dynamic array  (n, 7, 6)
    dynamic_raw = np.zeros((n, SEQ_LEN, N_DYNAMIC_FEATURES), dtype=np.float32)
    seq_cols = [
        "soil_moisture_7d", "rain_past_3d_7d", "rain_fcst_48h_7d",
        "river_gauge_7d",   "wind_speed_7d",   "baro_drop_7d"
    ]
    for fi, col in enumerate(seq_cols):
        for si in range(n):
            dynamic_raw[si, :, fi] = parse_seq(df[col].iloc[si])

    # Scale
    static_scaled  = static_scaler.transform(static_raw)
    dynamic_flat   = dynamic_scaler.transform(
        dynamic_raw.reshape(-1, N_DYNAMIC_FEATURES)
    )
    dynamic_scaled = dynamic_flat.reshape(n, SEQ_LEN, N_DYNAMIC_FEATURES)

    # LSTM → temporal vectors  (n, 64)
    temporal_vecs = extract_temporal_features(lstm_model, dynamic_scaled)

    # Concatenate → (n, 69)
    X_test_locs = concatenate_features(static_scaled, temporal_vecs)

    # XGBoost → probabilities  (n, 3)
    probs = np.column_stack([
        est.predict_proba(X_test_locs)[:, 1]
        for est in clf.estimators_
    ])

    # ── Terminal Report ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("  DISASTER RISK PREDICTIONS – TEST LOCATIONS")
    print("=" * 70)

    THRESHOLDS = {"Flood": 0.55, "Landslide": 0.55, "Cyclone": 0.50}

    result_rows = []
    for i in range(n):
        flood_p, ls_p, cyc_p = probs[i]
        loc_name = df["location_name"].iloc[i]

        # Determine action
        max_risk  = max(flood_p, ls_p, cyc_p)
        if max_risk >= 0.75:
            action = "🚨 EVACUATE IMMEDIATELY"
        elif max_risk >= 0.55:
            action = "⚠️  HIGH ALERT – Prepare"
        elif max_risk >= 0.35:
            action = "🟡 MONITOR CLOSELY"
        else:
            action = "✅ LOW RISK – Safe"

        # Active hazards
        hazards = []
        if flood_p  >= THRESHOLDS["Flood"]:     hazards.append("FLOOD")
        if ls_p     >= THRESHOLDS["Landslide"]: hazards.append("LANDSLIDE")
        if cyc_p    >= THRESHOLDS["Cyclone"]:   hazards.append("CYCLONE")
        hazard_str = ", ".join(hazards) if hazards else "None"

        print(f"\n  Location {i+1}: {loc_name}")
        print(f"  ─────────────────────────────────────────────────")
        print(f"    Flood Probability     : {flood_p:.3f}  {'▓▓▓▓' if flood_p > 0.6 else '░░░░'}")
        print(f"    Landslide Probability : {ls_p:.3f}  {'▓▓▓▓' if ls_p > 0.6 else '░░░░'}")
        print(f"    Cyclone Probability   : {cyc_p:.3f}  {'▓▓▓▓' if cyc_p > 0.6 else '░░░░'}")
        print(f"    Active Hazards        : {hazard_str}")
        print(f"    → ACTION              : {action}")

        result_rows.append({
            "Location": loc_name,
            "Flood":     round(float(flood_p), 3),
            "Landslide": round(float(ls_p),    3),
            "Cyclone":   round(float(cyc_p),   3),
            "Action":    action,
        })

    print("\n" + "=" * 70)

    # Save results to JSON
    out_json = os.path.join(RESULTS_DIR, "predictions.json")
    with open(out_json, "w") as f:
        json.dump(result_rows, f, indent=2)
    print(f"[JSON] Predictions saved → {out_json}")

    return probs


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7b – SAVE TRAINED MODELS
# ═══════════════════════════════════════════════════════════════════════════

def save_trained_models(lstm_model, xgb_clf, static_scaler, dynamic_scaler,
                        models_dir: str = "models"):
    """Persists trained artifacts so app.py can load them without re-training."""
    os.makedirs(models_dir, exist_ok=True)
    lstm_model.save(os.path.join(models_dir, "lstm_encoder.keras"))
    joblib.dump(xgb_clf,       os.path.join(models_dir, "xgb_multi_clf.pkl"))
    joblib.dump(static_scaler, os.path.join(models_dir, "static_scaler.pkl"))
    joblib.dump(dynamic_scaler,os.path.join(models_dir, "dynamic_scaler.pkl"))
    print(f"[SAVE] Model artifacts persisted to ./{models_dir}/")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8 – MAIN PIPELINE
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("  Hybrid LSTM + XGBoost Disaster Prediction System")
    print("  Disasters: Flash Flood | Landslide | Cyclone")
    print("  Region   : India")
    print("=" * 60)

    # ── Step 1: Generate synthetic training data ───────────────────────────
    print("\n[STEP 1] Generating synthetic training data …")
    data = generate_synthetic_data(n_samples=N_SAMPLES)

    # ── Step 2: Train / Val / Test split ──────────────────────────────────
    print("\n[STEP 2] Splitting dataset …")
    static_all  = data["static"]    # (N, 5)
    dynamic_all = data["dynamic"]   # (N, 7, 6)
    labels_all  = data["labels"]    # (N, 3)

    # 70 / 15 / 15 split
    (static_tv,  static_test,
     dynamic_tv, dynamic_test,
     labels_tv,  labels_test) = train_test_split(
        static_all, dynamic_all, labels_all,
        test_size=0.15, random_state=42, stratify=labels_all[:, 0]
    )
    (static_train,  static_val,
     dynamic_train, dynamic_val,
     labels_train,  labels_val) = train_test_split(
        static_tv, dynamic_tv, labels_tv,
        test_size=0.15 / 0.85, random_state=42, stratify=labels_tv[:, 0]
    )
    print(f"  Train: {len(static_train)} | Val: {len(static_val)} | "
          f"Test: {len(static_test)}")

    # ── Step 3: Scale features ─────────────────────────────────────────────
    print("\n[STEP 3] Scaling features …")
    train_data = {"static": static_train, "dynamic": dynamic_train, "labels": labels_train}
    static_train_sc, dynamic_train_sc, static_scaler, dynamic_scaler = preprocess(
        train_data, fit=True
    )
    val_data  = {"static": static_val,  "dynamic": dynamic_val}
    static_val_sc,  dynamic_val_sc,  _, _ = preprocess(val_data,  fit=False,
                                                         static_scaler=static_scaler,
                                                         dynamic_scaler=dynamic_scaler)
    test_data = {"static": static_test, "dynamic": dynamic_test}
    static_test_sc, dynamic_test_sc, _, _ = preprocess(test_data, fit=False,
                                                         static_scaler=static_scaler,
                                                         dynamic_scaler=dynamic_scaler)

    # ── Step 4: Train LSTM Temporal Encoder ───────────────────────────────
    print("\n[STEP 4] Training LSTM temporal encoder …")
    lstm_model = train_lstm(dynamic_train_sc, labels_train,
                            dynamic_val_sc,   labels_val)

    # ── Step 5: Extract temporal feature vectors from LSTM ─────────────────
    print("\n[STEP 5] Extracting temporal feature vectors …")
    # Reshape note: dynamic arrays are (n, 7, 6) — each row is a 7-day sequence
    # extract_temporal_features passes this through the LSTM body to get h_T: (n, 64)
    temporal_train = extract_temporal_features(lstm_model, dynamic_train_sc)
    temporal_val   = extract_temporal_features(lstm_model, dynamic_val_sc)
    temporal_test  = extract_temporal_features(lstm_model, dynamic_test_sc)

    # ── Step 6: Concatenate static + temporal → XGBoost input ─────────────
    print("\n[STEP 6] Concatenating static + temporal features …")
    X_train = concatenate_features(static_train_sc, temporal_train)   # (n, 69)
    X_val   = concatenate_features(static_val_sc,   temporal_val)
    X_test  = concatenate_features(static_test_sc,  temporal_test)

    # ── Step 7: Train XGBoost multi-output classifier ──────────────────────
    print("\n[STEP 7] Training XGBoost classifier …")
    xgb_clf = build_and_train_xgboost(X_train, labels_train, X_val, labels_val)

    # ── Step 8: Evaluate on test set ───────────────────────────────────────
    print("\n[STEP 8] Evaluating on held-out test set …")
    y_prob_test, metrics = evaluate_model(xgb_clf, X_test, labels_test)

    # ── Step 9: Feature Importance plots ───────────────────────────────────
    print("\n[STEP 9] Generating feature importance plots …")
    plot_feature_importance(xgb_clf)

    # ── Step 10: Generate test_locations.csv & run predictions ─────────────
    print("\n[STEP 10] Generating test locations and running predictions …")
    generate_test_locations_csv("test_locations.csv")
    predict_test_locations(
        "test_locations.csv", xgb_clf,
        static_scaler, dynamic_scaler, lstm_model
    )

    # ── Step 11: Save model artifacts for Flask web app ───────────────────
    print("\n[STEP 11] Saving model artifacts for web interface …")
    save_trained_models(lstm_model, xgb_clf, static_scaler, dynamic_scaler)

    # ── Done ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  Pipeline complete. Results saved to ./results/")
    print("  Files generated:")
    print("    • test_locations.csv")
    print("    • results/confusion_matrices.png")
    print("    • results/feature_importance.png")
    print("    • results/predictions.json")
    print("    • models/  (LSTM + XGBoost + scalers for web app)")
    print("=" * 60)


# ─────────────────────────── ENTRY POINT ────────────────────────────────────
if __name__ == "__main__":
    main()
