/**
 * ML Bridge Client Library
 * 
 * Simple wrapper for connecting to ML Bridge via WebSockets.
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
        this.socket = null;
        this.connected = false;

        // Event handlers
        this.predictionHandlers = [];
        this.statusHandlers = [];

        // Initialize
        this.connect();
    }

    connect() {
        if (typeof io === 'undefined') {
            console.error('MLBridge: Socket.IO not found. Please add <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>');
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

        // Main Event: 'prediction'
        // Payload: { label: "class_1", confidence: 0.99, ... } OR { regression: { "out_1": 0.5 } }
        this.socket.on('prediction', (data) => {
            this.predictionHandlers.forEach(handler => handler(data));
        });
    }

    // --- Public API ---

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
