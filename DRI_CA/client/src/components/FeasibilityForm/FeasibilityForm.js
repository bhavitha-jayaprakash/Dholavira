'use client';

// ============================================================
// FeasibilityForm Component
// ============================================================
// Captures GPS coordinates and building type for site risk
// assessment. Submits to POST /api/feasibility on the backend.
//
// Features:
// - "Get My Location" via browser Geolocation API
// - Building type dropdown
// - Input validation with visual feedback
// ============================================================

import { useState } from 'react';
import styles from './FeasibilityForm.module.css';

const BUILDING_TYPES = [
  { value: '',              label: 'Select building type...' },
  { value: 'residential',   label: '🏠 Residential' },
  { value: 'commercial',    label: '🏢 Commercial' },
  { value: 'industrial',    label: '🏭 Industrial' },
  { value: 'institutional', label: '🏛️ Institutional' },
  { value: 'agricultural',  label: '🌾 Agricultural' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function FeasibilityForm({ onResult }) {
  const [form, setForm] = useState({
    latitude: '',
    longitude: '',
    buildingType: '',
  });
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);

  // ── Handle input changes ──
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  // ── Get user's GPS location ──
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }

    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((prev) => ({
          ...prev,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      (err) => {
        setError(`Location error: ${err.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ── Submit the form ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      setError('Please enter a valid latitude (-90 to 90).');
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      setError('Please enter a valid longitude (-180 to 180).');
      return;
    }
    if (!form.buildingType) {
      setError('Please select a building type.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/feasibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: lat,
          longitude: lng,
          buildingType: form.buildingType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Server error');
      }

      // Pass result to parent component
      if (onResult) onResult(data.data);
    } catch (err) {
      setError(err.message || 'Failed to connect to the server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} id="feasibility-form">
      <div className={styles.formHeader}>
        <h3 className={styles.formTitle}>📍 Site Feasibility Check</h3>
        <p className={styles.formSubtitle}>
          Enter coordinates to check against KSDMA flood and NCESS landslide hazard zones.
        </p>
      </div>

      {/* ── Coordinate Inputs ── */}
      <div className={styles.coordRow}>
        <div className={styles.field}>
          <label htmlFor="latitude" className={styles.label}>Latitude</label>
          <input
            type="number"
            id="latitude"
            name="latitude"
            className={styles.input}
            placeholder="e.g. 10.0889"
            value={form.latitude}
            onChange={handleChange}
            step="any"
            min="-90"
            max="90"
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="longitude" className={styles.label}>Longitude</label>
          <input
            type="number"
            id="longitude"
            name="longitude"
            className={styles.input}
            placeholder="e.g. 76.3910"
            value={form.longitude}
            onChange={handleChange}
            step="any"
            min="-180"
            max="180"
            required
          />
        </div>
      </div>

      {/* ── Geolocation Button ── */}
      <button
        type="button"
        className={styles.locationBtn}
        onClick={handleGetLocation}
        disabled={locating}
        id="get-location-btn"
      >
        {locating ? (
          <>
            <span className={styles.spinner}></span>
            Locating...
          </>
        ) : (
          <>📡 Get My Location</>
        )}
      </button>

      {/* ── Building Type ── */}
      <div className={styles.field}>
        <label htmlFor="buildingType" className={styles.label}>Building Type</label>
        <select
          id="buildingType"
          name="buildingType"
          className={styles.select}
          value={form.buildingType}
          onChange={handleChange}
          required
        >
          {BUILDING_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* ── Error Message ── */}
      {error && (
        <div className={styles.error} role="alert" id="form-error">
          ⚠ {error}
        </div>
      )}

      {/* ── Submit ── */}
      <button
        type="submit"
        className={styles.submitBtn}
        disabled={loading}
        id="submit-feasibility"
      >
        {loading ? (
          <>
            <span className={styles.spinner}></span>
            Analyzing Site...
          </>
        ) : (
          <>🔍 Check Feasibility</>
        )}
      </button>
    </form>
  );
}
