/**
 * Data normalization utilities for ML Bridge.
 *
 * Known data types (image, imu, eeg) use fixed physical-range constants.
 * Generic sensors use per-feature min/max statistics computed from training data.
 */

import { NORMALIZATION_RANGES } from '../constants';

// Feature range tracker: learns min/max per feature key.
// Used for UI visualization and data inspection, NOT for ML normalization.
const featureRanges = {};

/**
 * Updates the tracked range for a feature key with a new observed value.
 * Called on every incoming data point. Used for UI/diagnostics only.
 * @param {string} key - Feature key name
 * @param {number} value - Observed value
 */
export function updateFeatureRange(key, value) {
    if (typeof value !== 'number' || !isFinite(value)) return;
    if (!featureRanges[key]) {
        featureRanges[key] = { min: value, max: value };
    } else {
        if (value < featureRanges[key].min) featureRanges[key].min = value;
        if (value > featureRanges[key].max) featureRanges[key].max = value;
    }
}

/**
 * Gets the current tracked range for a feature key (for UI/diagnostics).
 * @param {string} key - Feature key name
 * @returns {{ min: number, max: number } | null}
 */
export function getFeatureRange(key) {
    return featureRanges[key] || null;
}

/**
 * Resets all tracked feature ranges. Call when clearing all data.
 */
export function resetFeatureRanges() {
    Object.keys(featureRanges).forEach(k => delete featureRanges[k]);
}

/**
 * Detects data type from input data characteristics.
 * Used to select appropriate normalization strategy.
 * @param {Object} inputData - Raw input data object
 * @param {Array<string>} keys - Array of feature keys
 * @returns {string} Detected data type ('image', 'imu', 'eeg', 'sensor')
 */
export function detectDataType(inputData, keys) {
    // 1. Image features (MobileNet embeddings)
    if (keys.some(k => k.startsWith('px_') || (k.startsWith('f') && keys.length > 100))) {
        return 'image';
    }

    // 2. IMU patterns (accelerometer, gyroscope, magnetometer)
    const imuPatterns = ['ax', 'ay', 'az', 'gx', 'gy', 'gz', 'mx', 'my', 'mz', 'acc', 'gyro', 'mag'];
    if (imuPatterns.some(p => keys.some(k => k.toLowerCase() === p || k.toLowerCase().includes(p)))) {
        return 'imu';
    }

    // 3. EEG patterns
    if (keys.some(k => k.toLowerCase().includes('eeg') || k.toLowerCase().includes('electrode'))) {
        return 'eeg';
    }

    // 4. Everything else — generic sensor (normalized via training-data stats, not here)
    return 'sensor';
}

/**
 * Normalizes a single value based on data type.
 * 
 * For image/imu/eeg: applies known physical-range normalization (deterministic).
 * For generic sensors: returns raw value (normalization happens via feature stats).
 * 
 * @param {number} value - Value to normalize
 * @param {string} dataType - Data type from detectDataType()
 * @param {string} [_featureKey] - Unused, kept for API compat
 * @returns {number} Normalized value (or raw for 'sensor' type)
 */
export function normalizeValue(value, dataType, _featureKey) {
    switch (dataType) {
        case 'image':
            // MobileNet embeddings: already [0, 1]
            return Math.max(0, Math.min(1, value));

        case 'imu':
            // IMU data: accelerometer ±4g, gyroscope ±2000dps.
            // Divide by physical constant, clamp to [-1, 1].
            return Math.max(-1, Math.min(1, value / NORMALIZATION_RANGES.IMU_RAW[1]));

        case 'eeg':
            // EEG: typically ±200µV
            return Math.max(-1, Math.min(1, value / Math.abs(NORMALIZATION_RANGES.EEG_MICROVOLTS[1])));

        case 'sensor':
        default:
            // Generic sensor: return raw value.
            // Normalization is handled by computeFeatureStats + normalizeWithStats
            // at training/prediction time.
            return value;
    }
}

/**
 * Computes per-feature min/max statistics from an array of training samples.
 * Used to normalize features to [0, 1] range for ML.
 * 
 * 
 * @param {Array<{features: number[]}>} samples - Training samples with feature arrays
 * @returns {Array<{min: number, max: number, range: number}>|null} Per-feature stats, or null if empty
 */
export function computeFeatureStats(samples) {
    if (!samples || samples.length === 0) return null;

    const numFeatures = samples[0].features.length;
    const stats = [];

    for (let i = 0; i < numFeatures; i++) {
        let min = Infinity, max = -Infinity;
        for (let j = 0; j < samples.length; j++) {
            const v = samples[j].features[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        const range = max - min;
        // Guard against zero-range (constant feature): normalize to 0.5
        stats.push({ min, max, range: range < 1e-8 ? 1 : range });
    }

    return stats;
}

/**
 * Normalizes a feature vector using precomputed per-feature statistics.
 * Maps each feature from [min, max] → [0, 1].
 * Values outside the training range are NOT clamped — slight extrapolation
 * is acceptable and avoids losing information at boundaries.
 * 
 * @param {number[]} values - Feature vector to normalize
 * @param {Array<{min: number, max: number, range: number}>} stats - Per-feature stats
 * @returns {number[]} Normalized feature vector in approximately [0, 1]
 */
export function normalizeWithStats(values, stats) {
    if (!stats || !values) return values;
    return values.map((v, i) => {
        if (i >= stats.length) return v; // safety: more features than stats
        return (v - stats[i].min) / stats[i].range;
    });
}

/**
 * Normalizes a sequence of samples (for gesture capture)
 * @param {Array<Object>} samples - Array of sample objects
 * @param {Array<string>} selectedFeatures - Selected feature keys
 * @param {string} dataType - Data type for normalization
 * @returns {Array<Array<number>>} Normalized feature arrays
 */
export function normalizeSequence(samples, selectedFeatures, dataType = 'auto') {
    if (!samples || samples.length === 0) return [];

    let detectedType = dataType;
    if (dataType === 'auto' && samples.length > 0) {
        detectedType = detectDataType(samples[0], selectedFeatures);
    }

    return samples.map(sample => {
        return selectedFeatures.map(key => {
            const value = sample[key] || 0;
            return normalizeValue(value, detectedType, key);
        });
    });
}
