import * as mobilenet from '@tensorflow-models/mobilenet';
import * as tf from '@tensorflow/tfjs';

class WebcamManager {
    constructor() {
        this.video = null;
        this.canvas = null;
        this.stream = null;
        this.isActive = false;
        this.onDataCallback = null;
        this.frameId = null;

        // MobileNet
        this.model = null;
        this.isModelLoading = false;
        this.streamCallbacks = new Set();
        this.currentDeviceId = null;
    }

    onStreamUpdate(cb) {
        this.streamCallbacks.add(cb);
        if (this.stream) cb(this.stream);
        return () => this.streamCallbacks.delete(cb);
    }

    _notifyStreamUpdate() {
        this.streamCallbacks.forEach(cb => cb(this.stream));
    }

    async ensureModelLoaded() {
        // If model exists and is valid, return immediately
        if (this.model) {
            // Verify model is still functional by checking a property
            try {
                if (this.model.model) return; // Model looks valid
            } catch (e) {
                console.warn('[WebcamManager] Model reference stale, reloading...');
                this.model = null;
            }
        }
        
        if (this.isModelLoading) {
            // Wait for existing load
            let waitAttempts = 0;
            while (this.isModelLoading && waitAttempts < 100) { // Max 10 seconds wait
                await new Promise(r => setTimeout(r, 100));
                waitAttempts++;
            }
            if (this.model) return;
            // If still loading after 10s, something is wrong - proceed to reload
            if (this.isModelLoading) {
                console.warn('[WebcamManager] Model loading stuck, forcing reload...');
                this.isModelLoading = false;
            }
        }

        this.isModelLoading = true;
        let attempts = 0;
        const maxAttempts = 5;

        console.log('[WebcamManager] Initializing TensorFlow backend...');
        try {
            // Ensure TensorFlow is ready - this helps after source switches
            await tf.ready();
            
            const currentBackend = tf.getBackend();
            console.log(`[WebcamManager] Current backend: ${currentBackend}`);
            
            // Try WebGL if not already set
            if (currentBackend !== 'webgl') {
                try {
                    await tf.setBackend('webgl');
                    await tf.ready();
                    console.log('[WebcamManager] Backend set to WebGL');
                } catch (e) {
                    console.warn('[WebcamManager] WebGL failed, using:', tf.getBackend());
                }
            }
        } catch (e) {
            console.warn('[WebcamManager] Backend initialization issue:', e.message);
            // Continue anyway - TF might still work
        }

        console.log('[WebcamManager] Loading MobileNet...');

        while (attempts < maxAttempts && !this.model) {
            try {
                const attemptNum = attempts + 1;
                console.log(`[WebcamManager] Loading MobileNet (attempt ${attemptNum}/${maxAttempts})...`);

                // Load local model with timeout
                this.model = await Promise.race([
                    mobilenet.load({
                        version: 2,
                        alpha: 1.0,
                        modelUrl: './models/mobilenet/model.json'
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout')), 30000) // 30s timeout
                    )
                ]);

                console.log('[WebcamManager] ✓ MobileNet loaded successfully');
                break; // Success!

            } catch (err) {
                attempts++;
                const isLastAttempt = attempts >= maxAttempts;

                console.error(`[WebcamManager] ✗ MobileNet load failed (attempt ${attempts}/${maxAttempts}):`, err.message);

                if (!isLastAttempt) {
                    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
                    const delay = Math.min(1000 * Math.pow(2, attempts - 1), 16000);
                    console.log(`[WebcamManager] Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    this.isModelLoading = false;
                    throw new Error(
                        `Failed to load MobileNet after ${maxAttempts} attempts. ` +
                        `Please check your internet connection and refresh the page.`
                    );
                }
            }
        }
        this.isModelLoading = false;
    }

    async start(callback) {
        // Always update callback, even if already running
        this.onDataCallback = callback;

        if (this.isActive) return;

        try {
            // STEP 1: Load MobileNet FIRST (before camera)
            await this.ensureModelLoaded();

            console.log('[WebcamManager] MobileNet ready, initializing camera...');

            // STEP 2: Initialize Camera (only after MobileNet is loaded)
            this.video = document.createElement('video');
            this.video.width = 224; // MobileNet expects 224x224
            this.video.height = 224;
            this.video.autoplay = true;
            this.video.playsInline = true;
            this.video.muted = true;
            this.video.style.display = 'none';
            document.body.appendChild(this.video);

            // Access Webcam
            const constraints = {
                video: {
                    width: 224,
                    height: 224,
                    facingMode: this.currentDeviceId ? undefined : 'user', // Default to user if no ID
                    deviceId: this.currentDeviceId ? { exact: this.currentDeviceId } : undefined
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = stream;
            this.stream = stream;

            // Generate Thumbnails
            this.canvas = document.createElement('canvas');
            this.canvas.width = 224;
            this.canvas.height = 224;

            this.isActive = true;
            this._notifyStreamUpdate();

            // Start feature extraction loop when video is ready
            const tryStartLoop = () => {
                if (this.video && this.video.readyState >= 2 && this.model && !this.frameId) {
                    console.log('[WebcamManager] ✓ Camera ready, starting feature extraction');
                    this.loop();
                }
            };

            // Try immediately
            tryStartLoop();

            // Also try when video loads
            this.video.onloadeddata = () => {
                tryStartLoop();
            };

        } catch (e) {
            console.error("Webcam/Model Error:", e);
            this.isModelLoading = false;
            throw e;
        }
    }

    getLoadingState() {
        return {
            isLoading: this.isModelLoading,
            isLoaded: !!this.model
        };
    }

    getStream() {
        return this.stream;
    }

    getScreenshot() {
        if (!this.isActive || !this.video || this.video.readyState < 2) return null;

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 120;
        thumbCanvas.height = 120;
        const ctx = thumbCanvas.getContext('2d');

        // Center crop
        const minDim = Math.min(this.video.videoWidth, this.video.videoHeight);
        const sx = (this.video.videoWidth - minDim) / 2;
        const sy = (this.video.videoHeight - minDim) / 2;

        ctx.drawImage(this.video, sx, sy, minDim, minDim, 0, 0, 120, 120);
        return thumbCanvas.toDataURL('image/jpeg', 0.8);
    }

    stop() {
        // Always try to stop stream/tracks even if flag says inactive
        // if (!this.isActive) return; 

        this.isActive = false;
        if (this.frameId) {
            clearTimeout(this.frameId);
            this.frameId = null;
        }
        this.onDataCallback = null;

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.video) {
            // Remove event listener to prevent memory leak
            this.video.onloadeddata = null;
            this.video.srcObject = null;
            this.video.remove();
            this.video = null;
        }
        this._notifyStreamUpdate();
    }

    async loop() {
        if (!this.isActive || !this.video) return;

        if (this.video.readyState === 4 && this.model) {
            try {
                // Infer embeddings (Transfer Learning)
                const embedding = this.model.infer(this.video, true);
                const featuresData = embedding.dataSync();
                embedding.dispose();

                // Convert to labeled object format
                const features = {};
                for (let i = 0; i < featuresData.length; i++) {
                    features[`f${i}`] = featuresData[i];
                }

                // Debug log occasionally
                // if (Math.random() < 0.02) {
                //    console.log("[WebcamManager] Emitting features:", Object.keys(features).length);
                // }

                if (this.onDataCallback) {
                    this.onDataCallback(features);
                }
            } catch (err) {
                console.warn("Inference error:", err);
            }
        }

        // Use setTimeout instead of requestAnimationFrame for background stability
        // ~30fps = 33ms
        this.frameId = setTimeout(() => this.loop(), 33);
    }


    async infer(imageElement) {
        // Ensure model is loaded with retry logic
        await this.ensureModelLoaded();

        // Infer embeddings
        const embedding = this.model.infer(imageElement, true);
        const featuresData = embedding.dataSync();
        embedding.dispose();

        // Convert to labeled object format
        const features = {};
        for (let i = 0; i < featuresData.length; i++) {
            features[`f${i}`] = featuresData[i];
        }
        return features;
    }
    async getDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(device => device.kind === 'videoinput');
        } catch (e) {
            console.error('[WebcamManager] Error getting devices:', e);
            return [];
        }
    }

    async setDevice(deviceId) {
        if (this.currentDeviceId === deviceId) return;

        console.log(`[WebcamManager] Switching to device: ${deviceId}`);
        this.currentDeviceId = deviceId;

        // Restart if active
        if (this.isActive) {
            const currentCallback = this.onDataCallback; // Capture logic before stop wipes it
            this.stop();
            await this.start(currentCallback);
        }
    }

    getCurrentDevice() {
        return this.currentDeviceId;
    }
}

export const webcamManager = new WebcamManager();
