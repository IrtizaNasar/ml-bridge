
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

                // If we successfully parsed any values, return
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

    _broadcastData(data) {
        if (data && typeof data === 'object') {
            // Flatten numeric arrays (e.g. [940] -> 940)
            const flattened = {};
            Object.keys(data).forEach(k => {
                const val = data[k];
                if (Array.isArray(val) && val.length === 1 && typeof val[0] === 'number') {
                    flattened[k] = val[0];
                } else {
                    flattened[k] = val;
                }
                this.activeInputs.add(k);
            });

            // Notify listeners safely
            this.dataCallbacks.forEach(cb => {
                try {
                    cb(flattened);
                } catch (cbError) {
                    console.error("[InputManager] Callback error:", cbError);
                }
            });
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
            const img = new Image();
            img.onload = () => {
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
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }
}

export const inputManager = new InputManager();
