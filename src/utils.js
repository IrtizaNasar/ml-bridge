/**
 * Utility functions for ML Bridge
 * Provides common helpers for validation, sanitization, and formatting
 */

import { UI_CONSTANTS, FILE_LIMITS, VALIDATION, ERROR_MESSAGES } from './constants';

/**
 * Sanitizes user input to prevent XSS and injection attacks
 * @param {string} input - Raw user input
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
export const sanitizeInput = (input, maxLength = UI_CONSTANTS.MAX_CLASS_NAME_LENGTH) => {
    if (typeof input !== 'string') return '';

    // Trim whitespace
    let sanitized = input.trim();

    // Limit length
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    // Remove potentially dangerous characters
    sanitized = sanitized.replace(/[<>\"'`]/g, '');

    // Ensure it matches safe pattern
    if (!VALIDATION.SAFE_STRING_PATTERN.test(sanitized)) {
        // Remove any remaining unsafe characters
        sanitized = sanitized.replace(/[^a-zA-Z0-9_\s-.,!?()]/g, '');
    }

    return sanitized;
};

/**
 * Validates a class name
 * @param {string} name - Class name to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export const validateClassName = (name) => {
    if (!name || typeof name !== 'string') {
        return { valid: false, error: 'Class name is required' };
    }

    const trimmed = name.trim();

    if (trimmed.length === 0) {
        return { valid: false, error: 'Class name cannot be empty' };
    }

    if (trimmed.length > UI_CONSTANTS.MAX_CLASS_NAME_LENGTH) {
        return { valid: false, error: ERROR_MESSAGES.CLASS_NAME_TOO_LONG };
    }

    if (!VALIDATION.CLASS_NAME_PATTERN.test(trimmed)) {
        return { valid: false, error: ERROR_MESSAGES.CLASS_NAME_INVALID };
    }

    return { valid: true };
};

/**
 * Validates a file for upload
 * @param {File} file - File to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export const validateFile = (file) => {
    if (!file) {
        return { valid: false, error: 'No file provided' };
    }

    // Check file size
    if (file.size > FILE_LIMITS.MAX_FILE_SIZE_BYTES) {
        return { valid: false, error: ERROR_MESSAGES.FILE_TOO_LARGE };
    }

    // Check file type
    if (!FILE_LIMITS.ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return { valid: false, error: ERROR_MESSAGES.FILE_TYPE_INVALID };
    }

    return { valid: true };
};

/**
 * Formats a number to specified decimal places
 * @param {number} num - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string|number} Formatted number or original if not a number
 */
export const formatNumber = (num, decimals = 2) => {
    return typeof num === 'number' ? num.toFixed(decimals) : num;
};

/**
 * Clamps a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export const clamp = (value, min, max) => {
    return Math.min(Math.max(value, min), max);
};

/**
 * Debounces a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

/**
 * Checks if localStorage is available and has space
 * @param {string} key - Key to test
 * @param {string} value - Value to test
 * @returns {boolean} True if storage is available
 */
export const checkStorageAvailable = (key, value) => {
    try {
        localStorage.setItem(key, value);
        localStorage.removeItem(key);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.error('Storage quota exceeded');
            return false;
        }
        return false;
    }
};

/**
 * Safely parses JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed object or default value
 */
export const safeJSONParse = (jsonString, defaultValue = null) => {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.warn('Failed to parse JSON:', e);
        return defaultValue;
    }
};
