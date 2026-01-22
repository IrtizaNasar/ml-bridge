
import { io } from "socket.io-client";
import { webcamManager } from "./WebcamManager";

class InputManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.dataCallbacks = [];
        this.statusCallbacks = [];
        this.serialBridgeUrl = "http://localhost:3000";
        this.activeInputs = new Set();

        this.currentSource = 'serial'; // 'serial' | 'webcam' | 'upload'
    }

    setSource(source) {
        // console.log(`[InputManager] Switching/Refreshing source to: ${source}`);

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
        this._notifyStatus({ connected: false, source: source === 'serial' ? 'Connecting...' : 'Initializing...' });
    }

    // --- Serial Logic ---
    connectSocket() {
        if (this.socket) {
            if (this.socket.connected) return;
            // If exists but disconnected, try to force it
            this.socket.connect();
            return;
        }

        // console.log(`[InputManager] Connecting to Serial Bridge at ${this.serialBridgeUrl}...`);
        this.socket = io(this.serialBridgeUrl, {
            reconnection: true,
            reconnectionAttempts: Infinity, // Keep trying
            reconnectionDelay: 1000,
            timeout: 5000
        });

        this.socket.on("connect", () => {
            // console.log("[InputManager] Socket Connected!");
            this.isConnected = true;
            this._notifyStatus({ connected: true, source: 'Serial Bridge' });
        });

        this.socket.on("connect_error", (err) => {
            console.error("[InputManager] Socket Connect Error:", err.message);
            this._notifyStatus({ connected: false, source: `Error: ${err.message}` });
        });

        this.socket.on("disconnect", (reason) => {
            // console.log("[InputManager] Socket Disconnected:", reason);
            this.isConnected = false;
            this._notifyStatus({ connected: false, source: 'Serial Bridge (Disconnected)' });
        });

        this.socket.on("serial-data", (payload) => {
            if (!payload || !payload.data) return;
            // console.log("[InputManager] Data Arrival:", payload.data);
            this._processData(payload.data);
        });
    }

    disconnectSocket() {
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

    _safeParseObject(raw) {
        const result = {};
        let clean = raw.trim().replace(/^\{|\}$/g, '');
        const pairs = clean.split(',').map(p => p.trim()).filter(p => p);

        for (const pair of pairs) {
            const colonIndex = pair.indexOf(':');
            if (colonIndex === -1) continue;

            const key = pair.slice(0, colonIndex).trim();
            const valStr = pair.slice(colonIndex + 1).trim();

            if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;

            const num = parseFloat(valStr);
            if (!isNaN(num)) {
                result[key] = num;
            } else if (valStr === 'true') {
                result[key] = true;
            } else if (valStr === 'false') {
                result[key] = false;
            } else if (valStr === 'null') {
                result[key] = null;
            }
        }

        return result;
    }

    _looseParse(raw, out) {
        if (raw.includes(':')) {
            try {
                const parsed = this._safeParseObject(raw);
                if (Object.keys(parsed).length > 0) {
                    Object.assign(out, parsed);
                    return;
                }
            } catch (e) {
                console.warn("[InputManager] Safe parse failed:", e);
            }
        }

        const parts = raw.split(/[,\s]+/).filter(p => p.trim() !== "");
        parts.forEach((part, index) => {
            if (part.includes(':')) {
                const [key, val] = part.split(':');
                const safeKey = key.trim();
                if (/^[a-zA-Z0-9_-]+$/.test(safeKey)) {
                    const num = parseFloat(val);
                    if (!isNaN(num) && isFinite(num)) {
                        out[safeKey] = num;
                    }
                }
            } else {
                const num = parseFloat(part);
                if (!isNaN(num) && isFinite(num)) {
                    out[`ch_${index}`] = num;
                }
            }
        });
    }

    _isValidValue(val) {
        if (val === null || val === undefined) return false;
        if (typeof val === 'number') {
            return isFinite(val) && !isNaN(val);
        }
        if (Array.isArray(val)) {
            return val.length > 0 && val.every(v => typeof v === 'number' && isFinite(v) && !isNaN(v));
        }
        return false;
    }

    _sanitizeKey(key) {
        if (typeof key !== 'string') return String(key);
        return key.replace(/[^a-zA-Z0-9_-]/g, '');
    }

    _broadcastData(data) {
        if (data && typeof data === 'object') {
            const sanitized = {};

            Object.keys(data).forEach(k => {
                const val = data[k];
                const safeKey = this._sanitizeKey(k);

                if (!safeKey) return;

                if (Array.isArray(val) && val.length === 1 && this._isValidValue(val[0])) {
                    sanitized[safeKey] = val[0];
                    this.activeInputs.add(safeKey);
                } else if (this._isValidValue(val)) {
                    sanitized[safeKey] = val;
                    this.activeInputs.add(safeKey);
                }
            });

            if (Object.keys(sanitized).length > 0) {
                this.dataCallbacks.forEach(cb => {
                    try {
                        cb(sanitized);
                    } catch (cbError) {
                        console.error("[InputManager] Callback error:", cbError);
                    }
                });
            }
        }
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
            if (!file || typeof file !== 'object') {
                reject(new Error('Invalid file object'));
                return;
            }

            if (!file.type || !file.type.startsWith('image/')) {
                reject(new Error('Invalid file type. Only images are allowed.'));
                return;
            }

            const MAX_FILE_SIZE = 10 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                reject(new Error('File too large. Maximum size is 10MB.'));
                return;
            }

            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 64;
                    canvas.height = 64;
                    const ctx = canvas.getContext('2d');

                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    ctx.drawImage(img, 0, 0, 64, 64);

                    const imageData = ctx.getImageData(0, 0, 64, 64);
                    const data = imageData.data;
                    const features = {};

                    for (let i = 0; i < data.length; i += 4) {
                        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                        const normalized = avg / 255.0;
                        features[`px_${i / 4}`] = isFinite(normalized) ? normalized : 0;
                    }

                    resolve({ features, thumbnail: canvas.toDataURL('image/jpeg', 0.8) });
                } catch (err) {
                    reject(new Error(`Image processing failed: ${err.message}`));
                }
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(file);
        });
    }
}

export const inputManager = new InputManager();
