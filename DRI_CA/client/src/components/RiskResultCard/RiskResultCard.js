'use client';

// ============================================================
// RiskResultCard Component
// ============================================================
// Displays the risk assessment result returned from the
// /api/feasibility endpoint. Color-coded by risk level with
// animated reveal.
// ============================================================

import styles from './RiskResultCard.module.css';

const RISK_CONFIG = {
  none:      { emoji: '✅', label: 'No Risk Detected',   className: 'safe' },
  low:       { emoji: '🟢', label: 'Low Risk',           className: 'safe' },
  moderate:  { emoji: '🟡', label: 'Moderate Risk',      className: 'warning' },
  high:      { emoji: '🟠', label: 'High Risk',          className: 'danger' },
  very_high: { emoji: '🔴', label: 'Very High Risk',     className: 'critical' },
};

export default function RiskResultCard({ result }) {
  if (!result) return null;

  const { coordinates, buildingType, floodRisk, landslideRisk, overallRisk } = result;
  const config = RISK_CONFIG[overallRisk] || RISK_CONFIG.none;

  return (
    <div className={`${styles.card} ${styles[config.className]}`} id="risk-result-card">
      {/* ── Overall Risk Header ── */}
      <div className={styles.riskHeader}>
        <span className={styles.riskEmoji}>{config.emoji}</span>
        <div>
          <h3 className={styles.riskTitle}>{config.label}</h3>
          <p className={styles.riskMeta}>
            {buildingType} site at {coordinates.latitude.toFixed(4)}°N, {coordinates.longitude.toFixed(4)}°E
          </p>
        </div>
      </div>

      {/* ── Flood Risk Section ── */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          🌊 Flood Risk
          <span className={styles.badge}>
            {floodRisk.found ? `${floodRisk.zones.length} zone(s)` : 'Clear'}
          </span>
        </h4>

        {floodRisk.found ? (
          <ul className={styles.zoneList}>
            {floodRisk.zones.map((zone) => (
              <li key={zone.id} className={styles.zoneItem}>
                <strong>{zone.zone_name}</strong>
                <span className={styles.zoneDetail}>
                  {zone.district} · {zone.risk_level.replace('_', ' ')} ·{' '}
                  {zone.return_period}-year return period
                </span>
                {zone.description && (
                  <p className={styles.zoneDesc}>{zone.description}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.clearText}>
            No flood hazard zones intersect with this location.
          </p>
        )}
      </div>

      {/* ── Landslide Risk Section ── */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          ⛰️ Landslide Risk
          <span className={styles.badge}>
            {landslideRisk.found ? `${landslideRisk.zones.length} zone(s)` : 'Clear'}
          </span>
        </h4>

        {landslideRisk.found ? (
          <ul className={styles.zoneList}>
            {landslideRisk.zones.map((zone) => (
              <li key={zone.id} className={styles.zoneItem}>
                <strong>{zone.zone_name}</strong>
                <span className={styles.zoneDetail}>
                  {zone.district} · {zone.susceptibility_level.replace('_', ' ')} ·{' '}
                  {zone.soil_type} soil · {zone.slope_gradient}° slope
                </span>
                {zone.description && (
                  <p className={styles.zoneDesc}>{zone.description}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.clearText}>
            No landslide susceptibility zones intersect with this location.
          </p>
        )}
      </div>

      {/* ── Footer ── */}
      <div className={styles.footer}>
        <p className={styles.disclaimer}>
          Data sourced from KSDMA flood probability maps and NCESS landslide susceptibility zones.
          Always verify with local authorities before construction.
        </p>
      </div>
    </div>
  );
}
