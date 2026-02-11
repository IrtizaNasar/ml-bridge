
import { io } from "socket.io-client";
import { updateFeatureRange } from "./normalization";
import { webcamManager } from "./WebcamManager";

/**
 * InputManager
 * Handles input sources: Serial Bridge, Webcam, OSC, and file uploads.
 * Provides unified data broadcasting to subscribers.
 */
class InputManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.dataCallbacks = [];
        this.statusCallbacks = [];
        this.activeInputs = new Set();
        this.serialBridgeRetryTimer = null;
        this.serialBridgeRetryCount = 0;
        this.maxSerialBridgeRetries = 10;

        // WebSocket port configuration (from main process or default)
        this.wsPort = (window.api && window.api.getWsPort) ? window.api.getWsPort() : 3100;

        this.currentSource = 'serial'; // 'serial' | 'webcam' | 'upload'

        // Listen for Serial Bridge discovery
        if (window.api) {
            window.api.on('serial-bridge-found', (data) => {
                console.log('[InputManager] Serial Bridge found at:', data.url);
                this.serialBridgeUrl = data.url;
                if (this.currentSource === 'serial') {
                    this._notifyStatus({ connected: true, source: `Serial Bridge (${data.port})` });
                }
            });

            window.api.on('serial-bridge-status', (status) => {
                if (status.connected) {
                    this.serialBridgeUrl = status.url;
                    if (this.currentSource === 'serial') {
                        this._notifyStatus({ connected: true, source: 'Serial Bridge (Connected)' });
                    }
                } else {
                    if (this.currentSource === 'serial') {
                        this._notifyStatus({ connected: false, source: 'Searching for Serial Bridge...' });
                    }
                }
            });

            // Query initial Serial Bridge connection status
            window.api.serialBridge.status().then(status => {
                if (status.connected) {
                    this.serialBridgeUrl = status.url;
                }
            });
        }
    }

    setSource(source) {
        // Teardown previous
        if (this.currentSource === 'serial') this.disconnectSocket();
        if (this.currentSource === 'webcam') webcamManager.stop();
        if (this.currentSource === 'osc') this.disconnectOsc();

        this.currentSource = source;

        // Setup new
        if (source === 'serial') this.connectSocket();
        if (source === 'webcam') this.connectWebcam();
        if (source === 'osc') this.connectOsc();
        if (source === 'upload') this._notifyStatus({ connected: true, source: 'Image Upload Mode' });

        // Notify status
        if (source === 'serial') {
            this._notifyStatus({ connected: false, source: 'Connecting to ML Bridge...' });
        } else {
            this._notifyStatus({ connected: false, source: 'Initializing...' });
        }
    }

    // --- Serial Logic ---
    async connectSocket() {
        // Clear any existing retry timer
        if (this.serialBridgeRetryTimer) {
            clearTimeout(this.serialBridgeRetryTimer);
            this.serialBridgeRetryTimer = null;
        }

        if (this.socket) {
            if (this.socket.connected) return;
            this.socket.connect();
            return;
        }

        // 1. Check if we know where Serial Bridge is
        if (!this.serialBridgeUrl) {
            this._notifyStatus({ connected: false, source: 'Scanning for Serial Bridge...' });

            if (window.api && window.api.scanSerialBridge) {
                const foundUrl = await window.api.scanSerialBridge();
                if (foundUrl) {
                    this.serialBridgeUrl = foundUrl;
                    this.serialBridgeRetryCount = 0;
                } else {
                    // Not found - schedule a retry if we haven't exceeded max retries
                    this.serialBridgeRetryCount++;
                    if (this.serialBridgeRetryCount < this.maxSerialBridgeRetries && this.currentSource === 'serial') {
                        const retryDelay = Math.min(2000 * this.serialBridgeRetryCount, 10000);
                        this._notifyStatus({ connected: false, source: `Serial Bridge Not Found (retry ${this.serialBridgeRetryCount}/${this.maxSerialBridgeRetries})...` });
                        
                        this.serialBridgeRetryTimer = setTimeout(() => {
                            if (this.currentSource === 'serial') {
                                this.connectSocket();
                            }
                        }, retryDelay);
                        return; // Don't create socket yet - wait for retry
                    } else {
                        this._notifyStatus({ connected: false, source: 'Serial Bridge Not Found. Please launch Serial Bridge app.' });
                        return; // Don't create socket - give up
                    }
                }
            } else {
                // Browser dev mode only - no Electron API available
                this.serialBridgeUrl = "http://localhost:3000";
            }
        }

        // 2. Only create socket if we have a valid URL
        if (!this.serialBridgeUrl) {
            return; // Safety check
        }

        // 3. Connect to Serial Bridge
        this.socket = io(this.serialBridgeUrl, {
            reconnection: true,
            reconnectionAttempts: 5, // Limit retries since we handle retry logic ourselves
            reconnectionDelay: 1000,
            timeout: 5000
        });

        this.socket.on("connect", () => {
            this.isConnected = true;
            this.serialBridgeRetryCount = 0; // Reset on successful connection
            this._notifyStatus({ connected: true, source: 'Serial Bridge (Connected)' });
        });

        this.socket.on("connect_error", (err) => {
            // Only log once, not on every retry
            if (this.serialBridgeRetryCount === 0) {
                console.warn("[InputManager] Serial Bridge connection failed, will retry...");
            }
            this._notifyStatus({ connected: false, source: 'Connecting to Serial Bridge...' });
        });

        this.socket.on("disconnect", (reason) => {
            this.isConnected = false;
            this._notifyStatus({ connected: false, source: 'Serial Bridge Disconnected' });
        });

        this.socket.on("serial-data", (payload) => {
            if (!payload || !payload.data) return;

            this._processData(payload.data);
        });
    }

    disconnectSocket() {
        // Clear any pending retry
        if (this.serialBridgeRetryTimer) {
            clearTimeout(this.serialBridgeRetryTimer);
            this.serialBridgeRetryTimer = null;
        }
        this.serialBridgeRetryCount = 0;
        
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }

    // --- Webcam Logic ---
    async connectWebcam() {
        this._notifyStatus({ connected: true, source: 'Webcam (Starting...)' });
        try {
            await webcamManager.start((features) => {
                if (this.currentSource === 'webcam') {
                    this._broadcastData(features);
                }
            });
            if (webcamManager.isActive) {
                this._notifyStatus({ connected: true, source: 'Webcam API' });
            } else {
                this._notifyStatus({ connected: false, source: 'Webcam Error' });
            }
        } catch (e) {
            this._notifyStatus({ connected: false, source: 'Webcam Access Denied' });
        }
    }

    // --- OSC Logic ---
    async connectOsc() {
        if (!window.api || !window.api.osc) {
            console.error("OSC API not available");
            this._notifyStatus({ connected: false, source: 'OSC Error (No API)' });
            return;
        }

        this._notifyStatus({ connected: true, source: 'OSC Server (Starting...)' });

        try {
            // Start Server
            const res = await window.api.osc.start(12000);
            if (res.success) {
                this._notifyStatus({ connected: true, source: 'OSC (Port 12000)' });

                // Listen
                window.api.osc.onData((data) => {
                    this._broadcastData(data);
                });
            } else {
                this._notifyStatus({ connected: false, source: `OSC Error: ${res.error}` });
            }
        } catch (e) {
            console.error("OSC Connection Failed", e);
            this._notifyStatus({ connected: false, source: 'OSC Failure' });
        }
    }

    async disconnectOsc() {
        if (window.api && window.api.osc) {
            await window.api.osc.stop();
        }
    }

    // --- Unified Processing ---
    // Legacy support for direct init
    connect() {
        if (this.currentSource === 'serial') this.connectSocket();
    }

    _processData(raw) {
        let processed = {};

        try {
            // 1. If it's already an object, use it directly.
            if (typeof raw === 'object' && raw !== null) {
                processed = raw;
            }
            // 2. Try JSON string
            else if (typeof raw === 'string' && (raw.trim().startsWith('{') || raw.trim().startsWith('['))) {
                try {
                    processed = JSON.parse(raw);
                } catch (e) {
                    // Fallback to loose parsing if JSON fails
                    this._looseParse(raw, processed);
                }
            }
            // 3. Loose parsing for other string formats
            else if (typeof raw === 'string') {
                this._looseParse(raw, processed);
            }

            if (Object.keys(processed).length > 0) {
                this._broadcastData(processed);
            }
        } catch (e) {
            console.warn("[InputManager] Parse Loop Error:", e);
            console.warn("Raw Payload:", raw);
        }
    }

    _looseParse(raw, out) {
        // Safe parsing for loose object format (e.g., x:1.5,y:2.3 or {x:1.5,y:2.3})
        if (raw.includes(':')) {
            try {
                // Remove curly braces if present
                const cleaned = raw.replace(/[{}]/g, '').trim();

                // Split by comma to get key:value pairs
                const pairs = cleaned.split(',');

                pairs.forEach(pair => {
                    // Safe regex: only allows alphanumeric keys and numeric values
                    // Pattern: optional whitespace, key (letters/numbers/_), colon, number (with optional sign and decimal)
                    const match = pair.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(-?[\d.]+)\s*$/);

                    if (match) {
                        const [, key, value] = match;
                        const numValue = parseFloat(value);

                        if (!isNaN(numValue) && isFinite(numValue)) {
                            out[key] = numValue;
                        }
                    }
                });

                // Return if any values were successfully parsed
                if (Object.keys(out).length > 0) {
                    return;
                }
            } catch (e) {
                console.warn('[InputManager] Failed to parse loose format:', e);
            }
        }

        // Fallback: Split by comma or space and treat as numeric channels
        const parts = raw.split(/[,\s]+/).filter(p => p.trim() !== "");
        parts.forEach((part, index) => {
            if (part.includes(':')) {
                const [key, val] = part.split(':');
                const num = parseFloat(val);
                if (!isNaN(num) && isFinite(num)) out[key.trim()] = num;
            } else {
                const num = parseFloat(part);
                if (!isNaN(num) && isFinite(num)) out[`ch_${index}`] = num;
            }
        });
    }

    /**
     * Broadcasts data to all registered callbacks.
     * Always emits immediately - throttling moved to UI layer for responsiveness.
     * High-rate sensors (100Hz+) are handled; React will batch state updates.
     */
    _broadcastData(data) {
        if (!data || typeof data !== 'object') return;

        // Flatten nested objects/arrays
        const flattened = this._flattenObject(data);

        // Track active inputs and update adaptive normalization ranges
        Object.entries(flattened).forEach(([k, v]) => {
            this.activeInputs.add(k);
            if (typeof v === 'number') {
                updateFeatureRange(k, v);
            }
        });

        // Emit to all callbacks immediately (no throttling here)
        // Throttling is handled in the UI layer to keep predictions real-time
        this.dataCallbacks.forEach(cb => {
            try {
                cb(flattened);
            } catch (cbError) {
                console.error("[InputManager] Callback error:", cbError);
            }
        });
    }

    _flattenObject(obj, prefix = '') {
        const flattened = {};

        Object.keys(obj).forEach(key => {
            const value = obj[key];

            // Skip timestamp and index metadata
            if (key === 'timestamp' || key === 'index') {
                return;
            }

            // Preserve 'type' field as-is for filtering
            if (key === 'type' && typeof value === 'string') {
                flattened.type = value;
                return;
            }

            const newKey = prefix ? `${prefix}_${key}` : key;

            if (value === null || value === undefined) {
                // Skip null/undefined values
                return;
            }
            else if (typeof value === 'number') {
                // Direct numeric value
                flattened[newKey] = value;
            }
            else if (Array.isArray(value)) {
                if (value.length === 1 && typeof value[0] === 'number') {
                    // Single-element numeric array -> flatten to scalar
                    flattened[newKey] = value[0];
                } else if (value.every(v => typeof v === 'number')) {
                    // Multi-element numeric array -> index each element
                    value.forEach((v, i) => {
                        flattened[`${newKey}_${i}`] = v;
                    });
                }
                // Skip non-numeric arrays
            }
            else if (typeof value === 'object') {
                // Nested object -> recursively flatten
                const nested = this._flattenObject(value, newKey);
                Object.assign(flattened, nested);
            }
            else if (typeof value === 'string') {
                // Try to parse string as number
                const num = parseFloat(value);
                if (!isNaN(num) && isFinite(num)) {
                    flattened[newKey] = num;
                }
                // Otherwise skip non-numeric strings
            }
            // Skip other types (booleans, functions, etc.)
        });

        return flattened;
    }

    disconnect() {
        this.disconnectSocket();
        webcamManager.stop();
        this.disconnectOsc();
    }

    onData(callback) {
        this.dataCallbacks.push(callback);
    }

    onStatus(callback) {
        this.statusCallbacks.push(callback);
    }

    _notifyStatus(status) {
        this.statusCallbacks.forEach(cb => cb(status));
    }

    // --- Image Upload Logic ---
    async convertImageToFeatures(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);
            img.onload = () => {
                // Revoke object URL to free memory
                URL.revokeObjectURL(objectUrl);

                // Resize to Match Webcam (64x64)
                const canvas = document.createElement('canvas');
                canvas.width = 64;
                canvas.height = 64;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 64, 64);

                // Grayscale Processing
                const imageData = ctx.getImageData(0, 0, 64, 64);
                const data = imageData.data;
                const features = {};

                for (let i = 0; i < data.length; i += 4) {
                    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                    features[`px_${i / 4}`] = avg / 255.0; // Normalize 0-1
                }

                resolve({ features, thumbnail: canvas.toDataURL() });
            };
            img.onerror = (err) => {
                URL.revokeObjectURL(objectUrl);
                reject(err);
            };
            img.src = objectUrl;
        });
    }
}

export const inputManager = new InputManager();
