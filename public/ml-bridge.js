/**
 * ML Bridge Client Library
 * 
 * Simple wrapper for connecting to ML Bridge via WebSockets.
 * Uses Web Worker to prevent throttling when browser tab is hidden.
 * 
 * Usage:
 *   const ml = new MLBridge();
 * 
 *   ml.onPrediction((data) => {
 *     console.log(data.label, data.confidence);
 *   });
 */

class MLBridge {
    constructor(serverUrl) {
        // Auto-detect if not provided
        if (!serverUrl) {
            serverUrl = 'http://localhost:3100'; // Default ML Bridge port
        }

        this.serverUrl = serverUrl;
        this.worker = null;
        this.connected = false;

        // Event handlers
        this.predictionHandlers = [];
        this.statusHandlers = [];

        // Initialize
        this.connect();
    }

    connect() {
        // Check if Web Workers are supported
        if (typeof Worker === 'undefined') {
            console.warn('[MLBridge] Web Workers not supported, falling back to direct connection');
            this._connectDirect();
            return;
        }

        console.log(`[MLBridge] Starting worker connection to ${this.serverUrl}...`);

        // Create worker
        this.worker = new Worker('http://localhost:3100/ml-bridge-worker.js');

        // Listen for messages from worker
        this.worker.addEventListener('message', (event) => {
            const { type, status, data } = event.data;

            switch (type) {
                case 'STATUS':
                    if (status === 'connected') {
                        console.log('[MLBridge] Connected!');
                        this.connected = true;
                        this._notifyStatus('connected');
                    } else if (status === 'disconnected') {
                        console.log('[MLBridge] Disconnected');
                        this.connected = false;
                        this._notifyStatus('disconnected');
                    }
                    break;

                case 'PREDICTION':
                    this.predictionHandlers.forEach(handler => handler(data));
                    break;

                case 'SERVER_STATUS':
                    // Handle other status messages if needed
                    break;
            }
        });

        this.worker.addEventListener('error', (error) => {
            console.error('[MLBridge] Worker error:', error);
            console.log('[MLBridge] Falling back to direct connection');
            this._connectDirect();
        });

        // Start connection
        this.worker.postMessage({ type: 'CONNECT', data: { serverUrl: this.serverUrl } });
    }

    _connectDirect() {
        // Fallback: Direct Socket.IO connection (may be throttled)
        if (typeof io === 'undefined') {
            console.error('[MLBridge] Socket.IO not found. Please add <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>');
            return;
        }

        console.log(`[MLBridge] Connecting to ${this.serverUrl}...`);
        this.socket = io(this.serverUrl);

        this.socket.on('connect', () => {
            console.log('[MLBridge] Connected!');
            this.connected = true;
            this._notifyStatus('connected');
        });

        this.socket.on('disconnect', () => {
            console.log('[MLBridge] Disconnected');
            this.connected = false;
            this._notifyStatus('disconnected');
        });

        this.socket.on('prediction', (data) => {
            this.predictionHandlers.forEach(handler => handler(data));
        });
    }

    disconnect() {
        if (this.worker) {
            this.worker.postMessage({ type: 'DISCONNECT' });
            this.worker.terminate();
            this.worker = null;
        } else if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
    }

    // --- Public API (unchanged) ---

    /**
     * Listen for any prediction (Classification or Regression)
     * @param {function} callback - (data) => {}
     */
    onPrediction(callback) {
        this.predictionHandlers.push(callback);
    }

    /**
     * Listen for a specific Classification Class
     * @param {string} label - Class ID or Name (e.g. "class_1" or "Jump")
     * @param {function} callback - (confidence) => {}
     */
    onClassify(label, callback) {
        this.onPrediction((data) => {
            if (data.label === label) {
                callback(data.confidence);
            }
        });
    }

    /**
     * Listen for a specific Regression Output
     * @param {string} id - Output ID (e.g. "out_1")
     * @param {function} callback - (value) => {}
     */
    onRegression(id, callback) {
        this.onPrediction((data) => {
            if (data.regression && data.regression[id] !== undefined) {
                callback(data.regression[id]);
            }
        });
    }

    onStatus(callback) {
        this.statusHandlers.push(callback);
    }

    _notifyStatus(status) {
        this.statusHandlers.forEach(h => h(status));
    }
}
