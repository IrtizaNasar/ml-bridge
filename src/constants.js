/**
 * Application-wide constants for ML Bridge
 * Centralizes configuration values for easier maintenance
 */

// Training Configuration
export const TRAINING_DEFAULTS = {
    EPOCHS: 50,
    LEARNING_RATE: 0.001,
    BATCH_SIZE: 16,
    MIN_SAMPLES_PER_CLASS: 10,
    CONFIDENCE_THRESHOLD: 0.5,
    SMOOTHING_FACTOR: 0.7
};

// UI Constants
export const UI_CONSTANTS = {
    MAX_CLASS_NAME_LENGTH: 50,
    MAX_OUTPUT_NAME_LENGTH: 50,
    DEBOUNCE_MS: 300,
    DATAVIEW_HEADER_HEIGHT: 350,
    VIRTUAL_SCROLL_ROW_HEIGHT: 88
};

// Feature Detection
export const FEATURE_DETECTION = {
    GRACE_PERIOD_MS: 2000,
    UPDATE_CHECK_INTERVAL_MS: 2000
};

// File Upload Limits
export const FILE_LIMITS = {
    MAX_FILE_SIZE_MB: 10,
    MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
};

// MobileNet Loading
export const MOBILENET_CONFIG = {
    MAX_RETRY_ATTEMPTS: 5,
    RETRY_DELAYS_MS: [1000, 2000, 4000, 8000, 16000],
    LOAD_TIMEOUT_MS: 30000
};

// Data Normalization Ranges
export const NORMALIZATION_RANGES = {
    IMAGE: [0, 1],
    IMU: [-1, 1],
    IMU_RAW: [-4, 4],
    EEG_MICROVOLTS: [-200, 200],
    SENSOR_DEFAULT: [-10, 10]
};

// Confidence and Prediction
export const PREDICTION_CONFIG = {
    MIN_CONFIDENCE: 0.1,
    MAX_CONFIDENCE: 1.0,
    DEFAULT_CONFIDENCE_THRESHOLD: 0.5
};

// Rate Limiting
export const RATE_LIMITS = {
    MIN_MESSAGE_INTERVAL_MS: 10, // Max 100 messages/sec
    MAX_MESSAGES_PER_SECOND: 100
};

// Validation Patterns
export const VALIDATION = {
    CLASS_NAME_PATTERN: /^[a-zA-Z0-9_\s-]+$/,
    SAFE_STRING_PATTERN: /^[a-zA-Z0-9_\s-.,!?()]+$/,
    NUMERIC_KEY_PATTERN: /^[a-zA-Z_][a-zA-Z0-9_]*$/
};

// Error Messages
export const ERROR_MESSAGES = {
    CLASS_NAME_TOO_LONG: `Class name must be ${UI_CONSTANTS.MAX_CLASS_NAME_LENGTH} characters or less`,
    CLASS_NAME_INVALID: 'Class name contains invalid characters',
    FILE_TOO_LARGE: `File size must be ${FILE_LIMITS.MAX_FILE_SIZE_MB}MB or less`,
    FILE_TYPE_INVALID: 'Invalid file type. Please upload an image file',
    NO_DATA_RECORDED: 'No data recorded. Please record some training samples first',
    INSUFFICIENT_SAMPLES: 'Need at least 10 samples per class for robust training',
    SHAPE_MISMATCH: 'Inconsistent feature dimensions detected. Please clear data and re-record'
};
