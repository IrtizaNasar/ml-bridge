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
    // First check if data is already normalized (most common case for Serial Bridge)
    const sampleValues = keys.slice(0, Math.min(20, keys.length)).map(k => Math.abs(inputData[k] || 0));
    const maxAbs = Math.max(...sampleValues);
    const minAbs = Math.min(...sampleValues.filter(v => v > 0));

    // If values are already in [-1, 1] range, assume already normalized
    if (maxAbs <= 1.2 && (minAbs === 0 || minAbs >= 0)) {
        const hasNegative = keys.some(k => (inputData[k] || 0) < 0);
        if (!hasNegative && maxAbs <= 1.0) {
            return 'image'; // Already normalized 0-1 (images/color)
        }
        return 'sensor'; // Already normalized, pass through
    }

    // Check for image features (pixel data, already normalized 0-1)
    if (keys.some(k => k.startsWith('px_') || (k.startsWith('f') && keys.length > 100))) {
        const imgSampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => inputData[k] || 0);
        const maxVal = Math.max(...imgSampleValues);
        const minVal = Math.min(...imgSampleValues);
        if (minVal >= 0 && maxVal <= 1.1) {
            return 'image';
        }
    }

    // Check feature names for IMU patterns
    const imuPatterns = ['ax', 'ay', 'az', 'gx', 'gy', 'gz', 'mx', 'my', 'mz'];
    const hasIMUPatterns = imuPatterns.some(pattern =>
        keys.some(k => k.toLowerCase() === pattern || k.toLowerCase().includes(pattern))
    );

    if (hasIMUPatterns) {
        const sampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => Math.abs(inputData[k] || 0));
        const maxAbs = Math.max(...sampleValues);
        if (maxAbs > 0.1 && maxAbs < 100) {
            return 'imu';
        }
    }

    // Check for generic channel names
    const hasChannelPattern = keys.some(k => /^ch[_\s]?\d+$/i.test(k) || /^channel[_\s]?\d+$/i.test(k));

    if (hasChannelPattern) {
        const sampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => Math.abs(inputData[k] || 0));
        const maxAbs = Math.max(...sampleValues);
        const minAbs = Math.min(...sampleValues.filter(v => v > 0));

        if (maxAbs > 50) return 'eeg';
        if (maxAbs > 0.1 && maxAbs < 20) return 'imu';
        if (maxAbs <= 1.1 && minAbs >= 0) return 'image';
    }

    // Check for EEG-specific patterns
    if (keys.some(k => k.toLowerCase().includes('eeg') || k.toLowerCase().includes('electrode'))) {
        return 'eeg';
    }

    // Check for color sensor patterns
    const colorPatterns = ['r', 'g', 'b', 'red', 'green', 'blue', 'clear', 'proximity'];
    const hasColorPatterns = colorPatterns.some(pattern =>
        keys.some(k => k.toLowerCase() === pattern || k.toLowerCase().includes(pattern))
    );
    if (hasColorPatterns) {
        const sampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => inputData[k] || 0);
        const maxVal = Math.max(...sampleValues);
        const minVal = Math.min(...sampleValues);
        if (minVal >= 0 && maxVal <= 1.1) {
            return 'image';
        }
    }

    // Check value ranges for generic sensor data
    if (maxAbs > 0.1 && maxAbs < 20) return 'imu';
    if (maxAbs > 50) return 'eeg';

    return 'sensor';
}

/**
 * Normalizes a single value based on data type
 * @param {number} value - Value to normalize
 * @param {string} dataType - Data type ('image', 'imu', 'eeg', 'sensor')
 * @returns {number} Normalized value in appropriate range
 */
export function normalizeValue(value, dataType) {
    switch (dataType) {
        case 'image':
            // Images are normalized to [0, 1] range
            return Math.max(NORMALIZATION_RANGES.IMAGE[0], Math.min(NORMALIZATION_RANGES.IMAGE[1], value));

        case 'imu':
            // IMU sensor data: normalize to [-1, 1]
            // Check if already normalized first
            if (Math.abs(value) <= 1.2) {
                return Math.max(NORMALIZATION_RANGES.IMU[0], Math.min(NORMALIZATION_RANGES.IMU[1], value));
            }
            // Otherwise, normalize from typical raw IMU range
            const imuNormalized = value / Math.abs(NORMALIZATION_RANGES.IMU_RAW[1]);
            return Math.max(NORMALIZATION_RANGES.IMU[0], Math.min(NORMALIZATION_RANGES.IMU[1], imuNormalized));

        case 'eeg':
            // EEG data normalized to typical microvolts range
            const eegNormalized = value / Math.abs(NORMALIZATION_RANGES.EEG_MICROVOLTS[1]);
            return Math.max(-1, Math.min(1, eegNormalized));

        case 'sensor':
        default:
            // Generic sensor data: detect if already normalized
            if (Math.abs(value) <= 1.1) {
                return value;
            }
            // Otherwise, apply conservative normalization
            const sensorNormalized = value / Math.abs(NORMALIZATION_RANGES.SENSOR_DEFAULT[1]);
            return Math.max(-1, Math.min(1, sensorNormalized));
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
