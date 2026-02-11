/**
 * Data normalization utilities for ML Bridge
 * Handles detection and normalization of different data types (IMU, EEG, images, sensors)
 */

import { NORMALIZATION_RANGES } from '../constants';

/**
 * Detects data type from input data characteristics
 * @param {Object} inputData - Raw input data object
 * @param {Array<string>} keys - Array of feature keys
 * @returns {string} Detected data type ('image', 'imu', 'eeg', 'sensor')
 */
export function detectDataType(inputData, keys) {
    // 1. Check for image features (Priority: HIGHEST)
    // Strictly require 'px_' prefix or high-dimensional 'f' keys (webcam embeddings)
    if (keys.some(k => k.startsWith('px_') || (k.startsWith('f') && keys.length > 100))) {
        return 'image';
    }

    // 2. Check feature names for IMU patterns (Priority: HIGH)
    // Named sensors are always trusted
    const imuPatterns = ['ax', 'ay', 'az', 'gx', 'gy', 'gz', 'mx', 'my', 'mz', 'acc', 'gyro', 'mag'];
    const hasIMUPatterns = imuPatterns.some(pattern =>
        keys.some(k => k.toLowerCase() === pattern || k.toLowerCase().includes(pattern))
    );
    if (hasIMUPatterns) {
        return 'imu';
    }

    // 3. Check for EEG-specific patterns (Priority: HIGH)
    if (keys.some(k => k.toLowerCase().includes('eeg') || k.toLowerCase().includes('electrode'))) {
        return 'eeg';
    }

    // 4. Generic/Unknown Keys (e.g. ch_0, val_1) (Priority: LOW - Fallback)
    // Here we must guess based on values, but SAFELY.

    // Check if data is already normalized (most common case for Serial Bridge)
    const sampleValues = keys.slice(0, Math.min(20, keys.length)).map(k => Math.abs(inputData[k] || 0));
    const maxAbs = Math.max(...sampleValues);

    // If ANY value is > 1.2, assume it is RAW SENSOR data (needs scaling).
    // This prevents "splitting" a sample where some values are kept and others scaled.
    if (maxAbs > 1.2) {
        return 'raw_sensor'; // New type: specific for 0-1024 or 0-4096 ranges
    }

    // Otherwise, it's likely already normalized (or small raw values). Pass through.
    return 'sensor';
}

/**
 * Normalizes a single value based on data type
 * @param {number} value - Value to normalize
 * @param {string} dataType - Data type ('image', 'imu', 'eeg', 'sensor', 'raw_sensor')
 * @returns {number} Normalized value in appropriate range
 */
export function normalizeValue(value, dataType) {
    switch (dataType) {
        case 'image':
            // Images are normalized to [0, 1] range
            return Math.max(NORMALIZATION_RANGES.IMAGE[0], Math.min(NORMALIZATION_RANGES.IMAGE[1], value));

        case 'eeg':
            // EEG data normalized to typical microvolts range
            const eegNormalized = value / Math.abs(NORMALIZATION_RANGES.EEG_MICROVOLTS[1]);
            return Math.max(-1, Math.min(1, eegNormalized));

        case 'raw_sensor':
            // Explicitly RAW data (detected via > 1.2 values).
            // Always divide by large range. Do NOT check for "already normalized".
            const rawNormalized = value / Math.abs(NORMALIZATION_RANGES.SENSOR_DEFAULT[1]);
            return Math.max(-1, Math.min(1, rawNormalized));

        case 'sensor':
        default:
            // Generic sensor data (likely already normalized or small values)
            // Just clamp to safe range
            return Math.max(-1, Math.min(1, value));
    }
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

    // Auto-detect data type if needed
    let detectedType = dataType;
    if (dataType === 'auto' && samples.length > 0) {
        detectedType = detectDataType(samples[0], selectedFeatures);
    }

    // Normalize each sample
    return samples.map(sample => {
        return selectedFeatures.map(key => {
            const value = sample[key] || 0;
            return normalizeValue(value, detectedType);
        });
    });
}
