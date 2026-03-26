"""
visualizations_updated.py
=========================
Recreates the test set from the augmented Open-Meteo baseline data,
evaluates the trained Hybrid LSTM+XGBoost model, and plots:
1. Confusion Matrices (1x3)
2. Feature Importance (horizontal bars)

Extracts exact metrics (TP/TN/FP/FN, Precision, Recall, Accuracy, Support)
and saves them to a JSON file for the upgrade report.
"""
import os, json, warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, accuracy_score, precision_score, recall_score, f1_score
from main_updated import load_baseline, generate_augmented_data, preprocess
import xgboost as xgb
import joblib
import tensorflow as tf

warnings.filterwarnings("ignore")
RESULTS_DIR = "results"
MODELS_DIR = "models"
os.makedirs(RESULTS_DIR, exist_ok=True)
DISASTER_NAMES = ["Flood", "Landslide", "Cyclone"]

# ── 1. Recreate Exact Test Set ───────────────────────────────────────
print("Loading baseline and regenerating data (seed=42 ensures exact match)...")
baselines = load_baseline("real_indian_baseline_data.csv")
data = generate_augmented_data(baselines, total_samples=10000)

st_sc, dyn_sc, labels, s_scaler, d_scaler = preprocess(data)

X_st_train, X_st_test, X_dyn_train, X_dyn_test, y_train, y_test = train_test_split(
    st_sc, dyn_sc, labels, test_size=0.2, random_state=42
)

total_overall = len(labels)
total_test = len(y_test)

# ── 2. Load Trained Models & Predict ────────────────────────────────
print("Loading Models...")
lstm_model = tf.keras.models.load_model(os.path.join(MODELS_DIR, "lstm_encoder.keras"))
lstm_encoder = tf.keras.Model(
    inputs=lstm_model.input, 
    outputs=lstm_model.get_layer("layer_norm").output
)
multi_xgb = joblib.load(os.path.join(MODELS_DIR, "xgb_multi_clf.pkl"))

print("Predicting on Test Set...")
lstm_vec_test = lstm_encoder.predict(X_dyn_test, batch_size=128, verbose=0)
X_test_fused = np.concatenate([X_st_test, lstm_vec_test], axis=1)

y_pred = multi_xgb.predict(X_test_fused)

# ── 3. Extract Exact Metrics & Save to JSON ─────────────────────────
metrics_dict = {
    "dataset": {
        "total_records": int(total_overall),
        "train_records": int(len(y_train)),
        "test_records": int(total_test),
        "split": "80/20",
        "baseline_origins": 35 # 5 locations x 7 days
    },
    "disasters": {}
}

fig, axes = plt.subplots(1, 3, figsize=(18, 5))
fig.suptitle("Confusion Matrices: Real Data + Physics Augmentation", fontsize=16, fontweight="bold", y=1.05)

for i, name in enumerate(DISASTER_NAMES):
    tn, fp, fn, tp = confusion_matrix(y_test[:, i], y_pred[:, i]).ravel()
    acc = accuracy_score(y_test[:, i], y_pred[:, i])
    prec = precision_score(y_test[:, i], y_pred[:, i], zero_division=0)
    rec = recall_score(y_test[:, i], y_pred[:, i], zero_division=0)
    f1 = f1_score(y_test[:, i], y_pred[:, i], zero_division=0)
    
    metrics_dict["disasters"][name] = {
        "True_Positive": int(tp),
        "True_Negative": int(tn),
        "False_Positive": int(fp),
        "False_Negative": int(fn),
        "Accuracy_Pct": round(acc * 100, 2),
        "Precision_Pct": round(prec * 100, 2),
        "Recall_Pct": round(rec * 100, 2),
        "F1_Score": round(f1, 3),
        "Support_Positive": int(tp + fn),
        "Support_Negative": int(tn + fp)
    }
    
    # Plot Confusion Matrix
    cm = np.array([[tn, fp], [fn, tp]])
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", ax=axes[i],
                cbar=False, annot_kws={"size": 14})
    axes[i].set_title(f"{name} (Test N={total_test})")
    axes[i].set_xlabel("Predicted Model Output")
    axes[i].set_ylabel("True Physics Label")
    axes[i].set_xticklabels(["Safe (0)", "Danger (1)"])
    axes[i].set_yticklabels(["Safe (0)", "Danger (1)"])

plt.tight_layout()
cm_path = os.path.join(RESULTS_DIR, "augmented_confusion_matrices.png")
plt.savefig(cm_path, dpi=300, bbox_inches="tight")
plt.close()

# Save metrics JSON
with open(os.path.join(RESULTS_DIR, "metrics_report.json"), "w") as f:
    json.dump(metrics_dict, f, indent=4)

print(f"Metrics saved to {RESULTS_DIR}/metrics_report.json")
print(f"Confusion Matrices saved to {cm_path}")

# ── 4. Feature Importance Plot (Simplified for MultiOutput) ─────────
# XGBoost MultiOutputClassifier holds a list of estimators in .estimators_
fig, axes = plt.subplots(1, 3, figsize=(18, 6))
fig.suptitle("XGBoost Feature Importance across Disaster Types", fontsize=16, fontweight="bold")

# Feature Names mapping (5 static + 64 temporal)
static_names = ["Elevation", "Slope", "Dist River", "Dist Coast", "Land Cover"]
temporal_names = [f"LSTM_T{i}" for i in range(64)]
feature_names = static_names + temporal_names

for i, name in enumerate(DISASTER_NAMES):
    est = multi_xgb.estimators_[i]
    importances = est.feature_importances_
    
    # Get top 10 features
    indices = np.argsort(importances)[-10:]
    
    names_top = [feature_names[j] for j in indices]
    imp_top = importances[indices]
    
    axes[i].barh(names_top, imp_top, color=["#3498db" if "LSTM" not in n else "#e74c3c" for n in names_top])
    axes[i].set_title(f"Top 10 Drivers: {name}")
    axes[i].set_xlabel("F-Score (Importance)")

# Custom Legend
from matplotlib.patches import Patch
legend_elements = [
    Patch(facecolor="#3498db", label="Static Terrain (Elevation, River, etc)"),
    Patch(facecolor="#e74c3c", label="Temporal Weather (LSTM 64-dim Output)")
]
fig.legend(handles=legend_elements, loc="lower center", ncol=2, bbox_to_anchor=(0.5, -0.05))

plt.tight_layout()
fi_path = os.path.join(RESULTS_DIR, "augmented_feature_importance.png")
plt.savefig(fi_path, dpi=300, bbox_inches="tight")
plt.close()

print(f"Feature Importance saved to {fi_path}")
