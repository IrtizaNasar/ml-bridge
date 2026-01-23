import * as mobilenet from '@tensorflow-models/mobilenet';
import '@tensorflow/tfjs';

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
    }

    onStreamUpdate(cb) {
        this.streamCallbacks.add(cb);
        if (this.stream) cb(this.stream);
        return () => this.streamCallbacks.delete(cb);
    }

    _notifyStreamUpdate() {
        this.streamCallbacks.forEach(cb => cb(this.stream));
    }

    async start(callback) {
        // Always update callback, even if already running
        this.onDataCallback = callback;

        if (this.isActive) return;

        try {
            // STEP 1: Load MobileNet FIRST (before camera)
            // This ensures features are always available before user can record data
            if (!this.model && !this.isModelLoading) {
                this.isModelLoading = true;
                let attempts = 0;
                const maxAttempts = 5;

                console.log('[WebcamManager] Loading MobileNet before starting camera...');

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

            // Verify model loaded before proceeding
            if (!this.model) {
                throw new Error('MobileNet model failed to load. Cannot start webcam.');
            }

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
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 224, height: 224, facingMode: 'user' }
            });
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
        if (!this.isActive) return;
        this.isActive = false;
        if (this.frameId) cancelAnimationFrame(this.frameId);
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

        this.frameId = requestAnimationFrame(() => this.loop());
    }
}

export const webcamManager = new WebcamManager();
