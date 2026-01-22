import * as tf from '@tensorflow/tfjs';
import * as knn from '@tensorflow-models/knn-classifier';
import JSZip from 'jszip';

/**
 * MLEngine
 * Handles both Classification (using TFJS KNN) and Regression (Custom KNN).
 */
class MLEngine {
    constructor() {
        this.classifier = knn.create();
        this.regressionData = {};
        this.denseData = []; // Store { features, label } for Neural Network training
        this.classes = new Set();
        this.previousRegressionValues = {}; // For smoothing

        this.denseModel = null;
        this.isTraining = false;
        this.denseModelType = null; // 'classification' or 'regression'
        this.regressionOutputIds = null; // Array of output IDs in order for regression models

        // --- Temporal Support (Gestures) ---
        this.history = [];
        this.windowSize = 1; // Default: Single snapshot

        // --- Prediction Smoothing (for stable gesture recognition) ---
        // Based on Tiny Motion Trainer approach: majority voting + cooldown
        this.predictionHistory = []; // Store last N predictions for majority voting
        this.smoothingWindow = 7; // Number of predictions for majority vote (TMT uses 5-10)
        this.confidenceThreshold = 0.65; // Minimum confidence to show prediction (65% - TMT uses 60%)
        this.lastStablePrediction = null; // Last high-confidence prediction
        this.lastPredictionChangeTime = 0; // Timestamp of last prediction change
        this.predictionCooldown = 200; // Minimum ms between prediction changes (TMT uses 125-200ms)
    }

    setWindowSize(size) {
        this.windowSize = Math.max(1, size);
        this.history = []; // Flush on change
    }

    // --- Classification (KNN) ---
    // Kept for backward compatibility and fast prototyping
    addClassificationExample(inputData, classId, features, thumbnail = null) {
        if (!inputData) return;
        const tensor = this._toTensor(inputData, features);
        if (tensor) {
            // KNN Internal Storage
            this.classifier.addExample(tensor, classId);
            this.classes.add(classId);

            // Unified Hub Storage
            const vals = Array.from(tensor.dataSync());
            this.denseData.push({
                features: vals,
                label: classId,
                type: 'classification',
                thumbnail: thumbnail,
                timestamp: Date.now()
            });

            tensor.dispose();
        }
    }

    async predictClassification(inputData, features) {
        if (this.classifier.getNumClasses() === 0) return null;
        const tensor = this._toTensor(inputData, features);
        if (!tensor) return null;
        try {
            const result = await this.classifier.predictClass(tensor, 20);

            // Normalize output to match Dense Engine (add top-level confidence)
            if (result.confidences) {
                // Try direct lookup
                if (result.label && result.confidences[result.label] !== undefined) {
                    result.confidence = result.confidences[result.label];
                } else {
                    // Fallback: Find max confidence manually
                    const values = Object.values(result.confidences);
                    result.confidence = values.length > 0 ? Math.max(...values) : 0;
                }
            } else {
                result.confidence = 0;
            }

            // debug info available if needed
            // console.log('[MLEngine] KNN Prediction:', { label: result.label, confidence: result.confidence });

            tensor.dispose();
            return result;
        } catch (e) {
            tensor.dispose();
            return null;
        }
    }

    // --- Regression ---
    addRegressionExample(inputData, outputId, targetValue, features, thumbnail = null) {
        if (!this.regressionData[outputId]) {
            this.regressionData[outputId] = [];
        }
        const tensor = this._toTensor(inputData, features);
        if (tensor) {
            // KNN Regression Storage
            this.regressionData[outputId].push({ tensor, target: targetValue });

            // Unified Hub Storage
            const vals = Array.from(tensor.dataSync());
            this.denseData.push({
                features: vals,
                label: outputId,
                target: targetValue,
                type: 'regression',
                thumbnail: thumbnail,
                timestamp: Date.now()
            });
        }
    }

    async predictRegression(inputData, features) {
        const inputTensor = this._toTensor(inputData, features);
        if (!inputTensor) return null;

        const result = {};

        for (const [outId, examples] of Object.entries(this.regressionData)) {
            if (examples.length === 0) continue;

            const k = Math.min(5, examples.length);

            try {
                const predictedVal = tf.tidy(() => {
                    const firstEx = examples[0].tensor;
                    if (firstEx.shape[0] !== inputTensor.shape[0]) {
                        this.lastError = `Dimension Mismatch: Model expects ${firstEx.shape[0]}, Input has ${inputTensor.shape[0]}. Clear & Retrain.`;
                        return null;
                    }
                    this.lastError = null;

                    const exampleTensors = examples.map(ex => ex.tensor);
                    const exampleStack = tf.stack(exampleTensors);

                    const diff = tf.sub(exampleStack, inputTensor);
                    const squaredDiff = tf.square(diff);
                    const sumSquaredDiff = tf.sum(squaredDiff, 1);
                    const distances = tf.sqrt(sumSquaredDiff);

                    const distData = distances.dataSync();

                    const mapped = new Array(distData.length);
                    for (let i = 0; i < distData.length; i++) {
                        mapped[i] = { dist: distData[i], target: examples[i].target };
                    }

                    mapped.sort((a, b) => a.dist - b.dist);
                    const nearest = mapped.slice(0, k);

                    let totalWeight = 0;
                    let weightedSum = 0;

                    for (let i = 0; i < nearest.length; i++) {
                        const n = nearest[i];
                        const weight = 1 / (n.dist + 1e-4);
                        totalWeight += weight;
                        weightedSum += n.target * weight;
                    }

                    return weightedSum / totalWeight;
                });

                if (predictedVal !== null) {
                    // Exponential Moving Average (EMA) smoothing
                    // alpha = 0.15: 15% new value, 85% previous value for stability
                    const alpha = 0.15;
                    const previous = this.previousRegressionValues[outId] !== undefined
                        ? this.previousRegressionValues[outId]
                        : predictedVal;

                    const smoothed = (alpha * predictedVal) + ((1 - alpha) * previous);

                    this.previousRegressionValues[outId] = smoothed;
                    result[outId] = smoothed;
                }

            } catch (e) {
                console.warn(`Regression error for ${outId}:`, e);
            }
        }

        inputTensor.dispose();
        return Object.keys(result).length > 0 ? { regression: result } : null;
    }

    // --- Neural Network (Dense) ---

    // Add example to memory (not TF tensors immediately, to save memory before training)
    addDenseExample(inputData, classId, features, thumbnail = null, dataType = 'auto') {
        if (!inputData) return;

        // Check if inputData is an array of samples (gesture sequence) or single sample
        const isSequence = Array.isArray(inputData) && inputData.length > 0 && typeof inputData[0] === 'object';

        let featureVector;
        if (isSequence) {
            // Flatten sequence into single feature vector
            featureVector = this._normalizeSequence(inputData, features, dataType);
            if (!featureVector) return;
        } else {
            // Single sample - use existing logic
            const tensor = this._toTensor(inputData, features, dataType);
            if (!tensor) return;
            featureVector = Array.from(tensor.dataSync());
            tensor.dispose();
        }

        this.denseData.push({
            features: featureVector,
            label: classId,
            type: 'dense',
            thumbnail: thumbnail,
            timestamp: Date.now()
        });
        this.classes.add(classId);
    }

    async trainDenseModel(onEpochEnd, epochs = 50, learningRate = 0.001, batchSize = 16) {
        if (this.denseData.length === 0) return { success: false, error: "No data recorded." };

        const isClassification = this.denseData[0]?.type === 'classification' || this.denseData[0]?.type === 'dense';
        this.denseModelType = isClassification ? 'classification' : 'regression';

        if (isClassification && this.classes.size < 2) {
            return { success: false, error: "Need at least 2 classes to train." };
        }

        this.isTraining = true;

        const expectedType = isClassification ? ['classification', 'dense'] : ['regression'];
        const filteredData = this.denseData.filter(d => expectedType.includes(d.type));

        if (filteredData.length === 0) {
            this.isTraining = false;
            return { success: false, error: `No ${isClassification ? 'classification' : 'regression'} data found. Please record samples in correct mode.` };
        }

        if (isClassification) {
            const classCounts = {};
            filteredData.forEach(d => {
                classCounts[d.label] = (classCounts[d.label] || 0) + 1;
            });

            const minSamples = Math.min(...Object.values(classCounts));
            const maxSamples = Math.max(...Object.values(classCounts));

            if (minSamples < 10) {
                this.isTraining = false;
                const minClass = Object.keys(classCounts).find(k => classCounts[k] === minSamples);
                return { success: false, error: `Class "${minClass}" has only ${minSamples} samples. Need at least 10 samples per class for robust gesture recognition.` };
            }

            if (maxSamples / minSamples > 3) {
                console.warn(`⚠️ Class imbalance detected: max/min ratio is ${(maxSamples / minSamples).toFixed(1)}x. Consider collecting more samples for minority classes.`);
            }
        }

        const inputShape = filteredData[0].features.length;

        for (let i = 0; i < filteredData.length; i++) {
            const sample = filteredData[i];
            if (!Array.isArray(sample.features)) {
                this.isTraining = false;
                return { success: false, error: `Sample ${i} has invalid features: expected array, got ${typeof sample.features}` };
            }
            if (sample.features.length !== inputShape) {
                this.isTraining = false;
                return { success: false, error: `Sample ${i} has ${sample.features.length} features, but expected ${inputShape}. This may happen after changing window size. Clear data and re-record.` };
            }
            for (let j = 0; j < sample.features.length; j++) {
                const val = sample.features[j];
                if (typeof val !== 'number') {
                    this.isTraining = false;
                    return { success: false, error: `Sample ${i} feature ${j} is not a number: ${typeof val}` };
                }
                if (!isFinite(val)) {
                    this.isTraining = false;
                    return { success: false, error: `Sample ${i} feature ${j} is not finite: ${val}` };
                }
                if (isNaN(val)) {
                    this.isTraining = false;
                    return { success: false, error: `Sample ${i} feature ${j} is NaN: ${val}` };
                }
            }
        }

        const xs = tf.tensor2d(filteredData.map(d => d.features));

        let ys, outputUnits, outputActivation, lossFunction, metricsArray;

        if (isClassification) {
            // Classification mode
            const classArray = Array.from(this.classes).sort();
            const numClasses = classArray.length;

            // One-hot encode labels
            ys = tf.tidy(() => {
                const labelIndices = filteredData.map(d => classArray.indexOf(d.label));
                return tf.oneHot(tf.tensor1d(labelIndices, 'int32'), numClasses);
            });

            outputUnits = numClasses;
            outputActivation = 'softmax';
            lossFunction = 'categoricalCrossentropy';
            metricsArray = ['accuracy'];
        } else {
            // Regression mode - support multi-output
            // Group samples by timestamp to collect all output targets for each sample
            const samplesByTimestamp = {};
            const outputIds = new Set();

            filteredData.forEach(d => {
                const ts = d.timestamp;
                if (!samplesByTimestamp[ts]) {
                    samplesByTimestamp[ts] = {
                        features: d.features,
                        targets: {}
                    };
                }
                // d.label is the outputId (e.g., "param1")
                samplesByTimestamp[ts].targets[d.label] = parseFloat(d.target);
                outputIds.add(d.label);
            });

            // Convert to arrays
            const sortedOutputIds = Array.from(outputIds).sort();
            // Store output IDs for prediction mapping
            this.regressionOutputIds = sortedOutputIds;
            const samples = Object.values(samplesByTimestamp);

            // Build feature and target tensors
            const features = samples.map(s => s.features);
            const targets = samples.map(s => {
                // Create target vector with all outputs in consistent order
                return sortedOutputIds.map(id => s.targets[id] || 0);
            });

            // Update xs with grouped features
            xs.dispose();
            const xsGrouped = tf.tensor2d(features);

            ys = tf.tensor2d(targets);
            outputUnits = sortedOutputIds.length;
            outputActivation = 'linear';
            lossFunction = 'meanSquaredError';
            metricsArray = ['mse'];

            // Use grouped features
            return this._trainModel(xsGrouped, ys, outputUnits, outputActivation, lossFunction, metricsArray, inputShape, onEpochEnd, epochs, learningRate, batchSize);
        }

        // Continue with classification training
        return this._trainModel(xs, ys, outputUnits, outputActivation, lossFunction, metricsArray, inputShape, onEpochEnd, epochs, learningRate, batchSize);
    }

    async _trainModel(xs, ys, outputUnits, outputActivation, lossFunction, metricsArray, inputShape, onEpochEnd, epochs = 50, learningRate = 0.001, batchSize = 16) {

        // 2. Create Model
        const model = tf.sequential();

        // Hidden Layer 1 - Standard architecture for gesture recognition
        // This architecture is proven for gesture recognition
        model.add(tf.layers.dense({
            units: 50,
            activation: 'relu',
            inputShape: [inputShape],
            kernelInitializer: 'heNormal'
        }));

        // Dropout for regularization
        model.add(tf.layers.dropout({
            rate: 0.2
        }));

        // Hidden Layer 2 - Match Tiny Motion Trainer architecture (15 units)
        model.add(tf.layers.dense({
            units: 15,
            activation: 'relu',
            kernelInitializer: 'heNormal'
        }));

        // Output Layer
        model.add(tf.layers.dense({
            units: outputUnits,
            activation: outputActivation
        }));

        model.compile({
            optimizer: tf.train.adam(learningRate),
            loss: lossFunction,
            metrics: metricsArray
        });

        this.denseModel = model;

        // 3. Train
        try {
            await model.fit(xs, ys, {
                epochs: epochs,
                batchSize: batchSize,
                shuffle: true,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        // Pass model type to callback so it can extract correct metrics
                        if (onEpochEnd) onEpochEnd(epoch, logs, this.denseModelType);
                        if (!this.isTraining) model.stopTraining = true;
                    }
                }
            });
        } catch (e) {
            console.error("Training Interrupted:", e);
        }

        xs.dispose();
        ys.dispose();
        this.isTraining = false;

        return { success: true, model: this.denseModel };
    }

    async predictDense(inputData, features, dataType = 'auto') {
        if (!this.denseModel) return null;

        return tf.tidy(() => {
            const tensor = this._toTensor(inputData, features, dataType);
            if (!tensor) return null;

            const input = tensor.expandDims(0);
            const prediction = this.denseModel.predict(input);
            const data = prediction.data();

            if (this.denseModelType === 'regression') {
                const regression = {};
                const regressionOutputIds = this.regressionOutputIds;
                if (regressionOutputIds && regressionOutputIds.length === data.length) {
                    regressionOutputIds.forEach((id, idx) => {
                        regression[id] = data[idx];
                    });
                } else {
                    Object.assign(regression, Array.from(data));
                }

                const raw = { regression };
                if (this.trainingConfig.confidenceThreshold) {
                    const smoothed = this._applyPredictionSmoothing(raw, 'regression');
                    return smoothed;
                }
                return raw;

            } else {
                const classArray = Array.from(this.classes).sort();
                const confidences = {};

                for (let i = 0; i < data.length; i++) {
                    confidences[classArray[i]] = data[i];
                }

                const maxIdx = this._applyPredictionSmoothing({ confidences }, 'classification');
                const rawPrediction = { label: classArray[maxIdx], confidences };

                if (this.trainingConfig.confidenceThreshold) {
                    const maxConf = Math.max(...Object.values(confidences));
                    if (maxConf >= (this.trainingConfig.confidenceThreshold || 0.65)) {
                        if (!this.lastPrediction || this.lastPrediction.timestamp + (this.trainingConfig.predictionCooldown || 200) < Date.now()) {
                            this.lastPrediction = {
                                timestamp: Date.now(),
                                ...rawPrediction
                            };
                            return rawPrediction;
                        }
                    }
                    return { label: null, confidences: {} };
                }

                return rawPrediction;
            }
        });
    }

    // Predict on a complete gesture sequence (Tiny Trainer approach)
    async predictDenseGesture(gestureSequence, features, dataType = 'auto') {
        if (!this.denseModel) return null;
        if (!gestureSequence || gestureSequence.length === 0) return null;

        // Flatten and normalize the gesture sequence
        const featureVector = this._normalizeSequence(gestureSequence, features, dataType);
        if (!featureVector) return null;

        // Create tensor and predict
        const tensor = tf.tensor1d(featureVector);
        const input = tensor.expandDims(0);
        const prediction = this.denseModel.predict(input);
        const data = await prediction.data();

        // Cleanup
        tensor.dispose();
        input.dispose();
        prediction.dispose();

        // Handle regression mode
        if (this.denseModelType === 'regression') {
            const regression = {};
            if (this.regressionOutputIds && this.regressionOutputIds.length === data.length) {
                this.regressionOutputIds.forEach((id, idx) => {
                    regression[id] = data[idx];
                });
            } else {
                return {
                    regression: Array.from(data),
                    raw: Array.from(data)
                };
            }
            return {
                regression: regression
            };
        }

        // Classification mode
        const classArray = Array.from(this.classes).sort();

        // Find max
        let maxIdx = 0;
        let maxVal = data[0];
        const confidences = {};

        for (let i = 0; i < data.length; i++) {
            confidences[classArray[i]] = data[i];
            if (data[i] > maxVal) {
                maxVal = data[i];
                maxIdx = i;
            }
        }

        // Apply smoothing with bypassed cooldown for gesture predictions
        // Since gestures are infrequent, we don't need cooldown between them
        const rawPrediction = {
            label: classArray[maxIdx],
            confidence: maxVal,
            confidences: confidences,
            timestamp: Date.now()
        };

        return this._smoothPrediction(rawPrediction, classArray, true); // bypassCooldown = true
    }

    stopTraining() {
        this.isTraining = false;
    }

    // --- Utils ---
    _toTensor(inputData, selectedFeatures, dataType = 'auto') {
        let keys = [];
        if (selectedFeatures && selectedFeatures.length > 0) {
            keys = selectedFeatures.sort();
        } else {
            keys = Object.keys(inputData).filter(k => typeof inputData[k] === 'number').sort();
        }

        if (keys.length === 0) return null;

        // Detect data type if auto
        if (dataType === 'auto') {
            dataType = this._detectDataType(inputData, keys);
        }

        // Current snapshot - normalize based on data type
        const currentValues = keys.map(k => {
            const value = inputData[k] || 0;
            return this._normalizeValue(value, dataType);
        });

        // Update history
        this.history.push(currentValues);
        if (this.history.length > this.windowSize) {
            this.history.shift();
        }

        // If windowing is enabled, flatten history
        if (this.windowSize > 1) {
            // Fill with zeros if history is not full yet
            let flattened = [];
            for (let i = 0; i < this.windowSize; i++) {
                const snapshot = this.history[this.history.length - 1 - i] || new Array(keys.length).fill(0);
                flattened = [...snapshot, ...flattened]; // Maintain temporal order
            }
            return tf.tensor1d(flattened);
        }

        return tf.tensor1d(currentValues);
    }

    // Detect data type from input data characteristics
    _detectDataType(inputData, keys) {
        // 0. First check if data is already normalized (most common case for Serial Bridge)
        const sampleValues = keys.slice(0, Math.min(20, keys.length)).map(k => Math.abs(inputData[k] || 0));
        const maxAbs = Math.max(...sampleValues);
        const minAbs = Math.min(...sampleValues.filter(v => v > 0));

        // If values are already in [-1, 1] range, assume already normalized
        // Allow slight overflow (up to 1.2) for edge cases
        if (maxAbs <= 1.2 && (minAbs === 0 || minAbs >= 0)) {
            // Check if it's image data (0-1 range) or sensor data (-1 to 1 range)
            const hasNegative = keys.some(k => (inputData[k] || 0) < 0);
            if (!hasNegative && maxAbs <= 1.0) {
                return 'image'; // Already normalized 0-1 (images/color)
            }
            // Has negative values or slightly over 1.0 = already normalized sensor data
            return 'sensor'; // Already normalized, pass through
        }

        // 1. Check for image features (pixel data, already normalized 0-1)
        if (keys.some(k => k.startsWith('px_') || (k.startsWith('f') && keys.length > 100))) {
            // Check if values are in [0, 1] range (images/webcam embeddings)
            const imgSampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => inputData[k] || 0);
            const maxVal = Math.max(...imgSampleValues);
            const minVal = Math.min(...imgSampleValues);
            if (minVal >= 0 && maxVal <= 1.1) {
                return 'image'; // Already normalized
            }
        }

        // 2. Check feature names for IMU patterns (ax, ay, az, gx, gy, gz, mx, my, mz)
        const imuPatterns = ['ax', 'ay', 'az', 'gx', 'gy', 'gz', 'mx', 'my', 'mz'];
        const hasIMUPatterns = imuPatterns.some(pattern =>
            keys.some(k => k.toLowerCase() === pattern || k.toLowerCase().includes(pattern))
        );

        if (hasIMUPatterns) {
            // IMU data - check value ranges
            const sampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => Math.abs(inputData[k] || 0));
            const maxAbs = Math.max(...sampleValues);
            // IMU typically ranges from -4 to +4 (accelerometer/gyro) or -50 to +50 (magnetometer)
            if (maxAbs > 0.1 && maxAbs < 100) {
                return 'imu';
            }
        }

        // 3. Check for generic channel names (ch_0, ch_1, etc.) - could be IMU, EEG, or other
        const hasChannelPattern = keys.some(k => /^ch[_\s]?\d+$/i.test(k) || /^channel[_\s]?\d+$/i.test(k));

        if (hasChannelPattern) {
            // Check value ranges to guess type
            const sampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => Math.abs(inputData[k] || 0));
            const maxAbs = Math.max(...sampleValues);
            const minAbs = Math.min(...sampleValues.filter(v => v > 0));

            // EEG typically has larger values (microvolts: 10-200+)
            if (maxAbs > 50) {
                return 'eeg';
            }
            // IMU typically in [-4, 4] range
            if (maxAbs > 0.1 && maxAbs < 20) {
                return 'imu';
            }
            // Color sensors typically in [0, 1] after normalization
            if (maxAbs <= 1.1 && minAbs >= 0) {
                return 'image'; // Color data normalized
            }
        }

        // 4. Check for EEG-specific patterns
        if (keys.some(k => k.toLowerCase().includes('eeg') || k.toLowerCase().includes('electrode'))) {
            return 'eeg';
        }

        // 5. Check for color sensor patterns (r, g, b, c, proximity)
        const colorPatterns = ['r', 'g', 'b', 'red', 'green', 'blue', 'clear', 'proximity'];
        const hasColorPatterns = colorPatterns.some(pattern =>
            keys.some(k => k.toLowerCase() === pattern || k.toLowerCase().includes(pattern))
        );
        if (hasColorPatterns) {
            const sampleValues = keys.slice(0, Math.min(10, keys.length)).map(k => inputData[k] || 0);
            const maxVal = Math.max(...sampleValues);
            const minVal = Math.min(...sampleValues);
            // Color data is usually normalized to [0, 1]
            if (minVal >= 0 && maxVal <= 1.1) {
                return 'image'; // Color normalized
            }
        }

        // 6. Check value ranges for generic sensor data (if not already normalized)
        // If values are in IMU-like range, assume IMU
        if (maxAbs > 0.1 && maxAbs < 20) {
            return 'imu'; // Default to IMU for gesture recognition
        }

        // If values are large, assume EEG or unnormalized sensor
        if (maxAbs > 50) {
            return 'eeg';
        }

        // Default: conservative normalization for unknown sensor types
        return 'sensor';
    }

    // Normalize a single value based on data type
    _normalizeValue(value, dataType) {
        switch (dataType) {
            case 'image':
                // Images are already normalized 0-1, just clamp
                return Math.max(0, Math.min(1, value));

            case 'imu':
                // IMU sensor data (accelerometer/gyroscope): normalize to [-1, 1]
                // Check if already normalized first (Serial Bridge often sends pre-normalized data)
                if (Math.abs(value) <= 1.2) {
                    // Already normalized, just clamp to safe range [-1, 1]
                    return Math.max(-1, Math.min(1, value));
                }
                // Otherwise, normalize from typical raw IMU range: -4 to +4
                return Math.max(-1, Math.min(1, value / 4.0));

            case 'eeg':
                // EEG data: normalize based on typical range (adjust as needed)
                // Typical EEG range: -200 to +200 microvolts, but can vary
                // Use adaptive normalization: divide by max observed or use fixed scale
                return Math.max(-1, Math.min(1, value / 200.0));

            case 'sensor':
            default:
                // Generic sensor data: try to detect if already normalized
                // If value is in [-1, 1] range, assume already normalized
                if (Math.abs(value) <= 1.1) {
                    return value; // Already normalized
                }
                // Otherwise, apply conservative normalization
                // Assume values might be in [-10, 10] range
                return Math.max(-1, Math.min(1, value / 10.0));
        }
    }

    // Normalize a sequence of samples (for gesture capture)
    _normalizeSequence(samples, selectedFeatures, dataType = 'auto') {
        let keys = [];
        if (selectedFeatures && selectedFeatures.length > 0) {
            keys = selectedFeatures.sort();
        } else if (samples.length > 0) {
            keys = Object.keys(samples[0]).filter(k => typeof samples[0][k] === 'number').sort();
        }

        if (keys.length === 0) return null;

        // Detect data type from first sample
        if (dataType === 'auto' && samples.length > 0) {
            dataType = this._detectDataType(samples[0], keys);
        }

        // Flatten sequence: [sample1, sample2, ...] -> [sample1_features..., sample2_features..., ...]
        const flattened = [];
        samples.forEach(sample => {
            keys.forEach(k => {
                const value = sample[k] || 0;
                flattened.push(this._normalizeValue(value, dataType));
            });
        });

        return flattened;
    }

    // Smooth predictions using majority voting + cooldown (Tiny Motion Trainer approach)
    // bypassCooldown: for gesture-triggered predictions, skip cooldown since predictions are already infrequent
    _smoothPrediction(rawPrediction, classArray, bypassCooldown = false) {
        const now = Date.now();

        // Add to history
        this.predictionHistory.push(rawPrediction);
        if (this.predictionHistory.length > this.smoothingWindow) {
            this.predictionHistory.shift();
        }

        // If confidence is too low, return last stable prediction or null
        if (rawPrediction.confidence < this.confidenceThreshold) {
            if (this.lastStablePrediction) {
                return {
                    ...this.lastStablePrediction,
                    lowConfidence: true
                };
            }
            return null;
        }

        // Majority voting: count how many times each class was predicted
        const voteCounts = {};
        classArray.forEach(cls => {
            voteCounts[cls] = 0;
        });

        // Count votes (only from high-confidence predictions)
        this.predictionHistory.forEach(pred => {
            if (pred.confidence >= this.confidenceThreshold) {
                voteCounts[pred.label] = (voteCounts[pred.label] || 0) + 1;
            }
        });

        // Find class with most votes
        let majorityLabel = classArray[0];
        let maxVotes = voteCounts[majorityLabel];
        classArray.forEach(cls => {
            if (voteCounts[cls] > maxVotes) {
                maxVotes = voteCounts[cls];
                majorityLabel = cls;
            }
        });

        // Calculate average confidence for majority class
        const majorityPredictions = this.predictionHistory.filter(
            p => p.label === majorityLabel && p.confidence >= this.confidenceThreshold
        );
        const avgConfidence = majorityPredictions.length > 0
            ? majorityPredictions.reduce((sum, p) => sum + p.confidence, 0) / majorityPredictions.length
            : rawPrediction.confidence;

        // Calculate smoothed confidences (weighted average of recent predictions)
        const smoothedConfidences = {};
        classArray.forEach(cls => {
            smoothedConfidences[cls] = 0;
        });

        // Weighted average: more recent = more weight
        let totalWeight = 0;
        this.predictionHistory.forEach((pred, idx) => {
            const weight = (idx + 1) / this.predictionHistory.length;
            classArray.forEach(cls => {
                smoothedConfidences[cls] += (pred.confidences[cls] || 0) * weight;
            });
            totalWeight += weight;
        });

        classArray.forEach(cls => {
            smoothedConfidences[cls] /= totalWeight;
        });

        // Cooldown: only change prediction if enough time has passed
        // For gesture-triggered predictions, bypass cooldown since predictions are already infrequent
        const timeSinceLastChange = now - this.lastPredictionChangeTime;
        const currentLabel = this.lastStablePrediction ? this.lastStablePrediction.label : null;
        const shouldUpdate = !currentLabel ||
            majorityLabel === currentLabel ||
            bypassCooldown || // NEW: bypass cooldown for gesture predictions
            timeSinceLastChange >= this.predictionCooldown;

        if (shouldUpdate && avgConfidence >= this.confidenceThreshold) {
            const predictionChanged = currentLabel && majorityLabel !== currentLabel;

            this.lastStablePrediction = {
                label: majorityLabel,
                confidence: avgConfidence,
                confidences: smoothedConfidences
            };

            // Only update timestamp if prediction actually changed
            if (predictionChanged) {
                this.lastPredictionChangeTime = now;
            }
        }

        // Return last stable prediction (with updated confidences)
        if (this.lastStablePrediction) {
            return {
                ...this.lastStablePrediction,
                confidences: smoothedConfidences // Update confidences even if label doesn't change
            };
        }

        return {
            label: majorityLabel,
            confidence: avgConfidence,
            confidences: smoothedConfidences
        };
    }

    // Set confidence threshold (0.0 to 1.0)
    setConfidenceThreshold(threshold) {
        this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
    }

    // Set smoothing window size
    setSmoothingWindow(size) {
        this.smoothingWindow = Math.max(1, Math.min(20, size));
    }

    // Set prediction cooldown (ms between prediction changes)
    setPredictionCooldown(ms) {
        this.predictionCooldown = Math.max(0, Math.min(1000, ms));
    }

    clearAll() {
        this.classifier.clearAllClasses();
        this.classes.clear();
        this.denseData = [];
        this.denseModel = null;
        this.denseModelType = null;
        this.regressionOutputIds = null;

        Object.values(this.regressionData).forEach(examples => {
            examples.forEach(ex => ex.tensor.dispose());
        });
        this.regressionData = {};
        this.previousRegressionValues = {};
        this.history = []; // Clear history
        this.predictionHistory = []; // Clear prediction history
        this.lastStablePrediction = null; // Clear stable prediction
    }

    renameClass(oldId, newId) {
        // Update all stored training data labels
        this.denseData.forEach(sample => {
            if (sample.label === oldId) {
                sample.label = newId;
            }
        });

        // Update classes set
        if (this.classes.has(oldId)) {
            this.classes.delete(oldId);
            this.classes.add(newId);
        }
    }

    getClassCounts() {
        return this.classifier.getClassExampleCount();
    }

    getRegressionCounts() {
        const counts = {};
        Object.entries(this.regressionData).forEach(([id, list]) => {
            counts[id] = list.length;
        });
        return counts;
    }

    // --- Data Management ---
    removeSample(index) {
        if (index < 0 || index >= this.denseData.length) return;

        // Remove from unified dataset
        const removed = this.denseData.splice(index, 1)[0];

        // Synchronize internal KNN states (if applicable)
        this._rebuildKnnState();
        return true;
    }

    _rebuildKnnState() {
        // 1. Clear KNN Classifiers
        this.classifier.clearAllClasses();
        this.regressionData = {};
        this.classes.clear();

        // 2. Re-populate from current denseData
        this.denseData.forEach(sample => {
            const tensor = tf.tensor(sample.features);

            if (sample.type === 'classification' || sample.type === 'dense') {
                this.classifier.addExample(tensor, sample.label);
                this.classes.add(sample.label);
            } else if (sample.type === 'regression') {
                if (!this.regressionData[sample.label]) {
                    this.regressionData[sample.label] = [];
                }
                this.regressionData[sample.label].push({
                    tensor: tensor.clone(), // Clone since we might dispose or store
                    target: sample.target
                });
            }
            tensor.dispose();
        });
    }

    exportData() {
        const data = {
            classification: {},
            regression: {},
            unifiedDataset: this.denseData // Persist the hub data
        };

        if (this.classifier.getNumClasses() > 0) {
            const dataset = this.classifier.getClassifierDataset();
            Object.keys(dataset).forEach(classId => {
                const tensor = dataset[classId];
                data.classification[classId] = {
                    shape: tensor.shape,
                    values: Array.from(tensor.dataSync())
                };
            });
        }

        Object.entries(this.regressionData).forEach(([outId, examples]) => {
            data.regression[outId] = examples.map(ex => ({
                shape: ex.tensor.shape,
                values: Array.from(ex.tensor.dataSync()),
                target: ex.target
            }));
        });

        return data;
    }

    importData(data) {
        if (!data) return false;

        try {
            this.clearAll();

            if (data.classification) {
                const dataset = {};
                Object.keys(data.classification).forEach(classId => {
                    const { shape, values } = data.classification[classId];
                    dataset[classId] = tf.tensor(values, shape);
                });
                this.classifier.setClassifierDataset(dataset);
                Object.keys(dataset).forEach(k => this.classes.add(k));
            }

            if (data.regression) {
                Object.entries(data.regression).forEach(([outId, examples]) => {
                    this.regressionData[outId] = examples.map(ex => ({
                        tensor: tf.tensor(ex.values, ex.shape),
                        target: ex.target
                    }));
                });
            }

            if (data.unifiedDataset) {
                this.denseData = data.unifiedDataset;

                // CRITICAL: Rebuild internal KNN structures from unified dataset for prediction
                this.denseData.forEach(sample => {
                    const tensor = tf.tensor1d(sample.features);
                    if (sample.type === 'classification' || sample.type === 'dense') {
                        this.classifier.addExample(tensor, sample.label);
                        this.classes.add(sample.label);
                    } else if (sample.type === 'regression') {
                        if (!this.regressionData[sample.label]) {
                            this.regressionData[sample.label] = [];
                        }
                        this.regressionData[sample.label].push({
                            tensor: tensor.clone(),
                            target: sample.target
                        });
                    }
                    tensor.dispose();
                });
            } else {
                // Backward compatibility: Rebuild denseData from internal structures
                this.denseData = [];

                // From Classification
                const classifierDataset = this.classifier.getClassifierDataset();
                Object.entries(classifierDataset).forEach(([label, dataset]) => {
                    const dataArray = dataset.dataSync();
                    const shape = dataset.shape; // [numExamples, valSize]
                    const valSize = shape[1];
                    for (let i = 0; i < shape[0]; i++) {
                        const slice = dataArray.slice(i * valSize, (i + 1) * valSize);
                        this.denseData.push({
                            features: Array.from(slice),
                            label: label,
                            type: 'classification',
                            timestamp: Date.now()
                        });
                    }
                });

                // From Regression
                Object.entries(this.regressionData).forEach(([label, examples]) => {
                    examples.forEach(ex => {
                        this.denseData.push({
                            features: Array.from(ex.tensor.dataSync()),
                            label: label,
                            target: ex.target,
                            type: 'regression',
                            timestamp: Date.now()
                        });
                    });
                });
            }

            return true;
        } catch (e) {
            console.error("Failed to import data:", e);
            return false;
        }
    }



    async exportModelWeb() {
        if (!this.denseModel) {
            throw new Error("No trained model to export.");
        }

        console.log("[Web Export] Model Input Shape:", this.denseModel.inputs[0].shape);

        const zip = new JSZip();

        // Use custom save handler to intercept artifacts
        await this.denseModel.save(tf.io.withSaveHandler(async (artifacts) => {
            // 1. Create proper model.json structure matching TF.js requirements
            const modelJSON = {
                modelTopology: artifacts.modelTopology,
                format: artifacts.format,
                generatedBy: artifacts.generatedBy,
                convertedBy: artifacts.convertedBy,
                weightsManifest: [{
                    paths: ['./weights.bin'], // Point to the file in the zip
                    weights: artifacts.weightSpecs
                }]
            };

            zip.file("model/model.json", JSON.stringify(modelJSON));

            // 2. Save weights.bin
            if (artifacts.weightData) {
                zip.file("model/weights.bin", artifacts.weightData);
            }

            // 3. Add metadata (Hybrid: Compatible with BOTH ml5.js and Teachable Machine)
            const classesAList = Array.from(this.classes).sort();
            const metadata = {
                // Teachable Machine standard fields
                tfjsVersion: "1.3.1",
                tmVersion: "2.4.4",
                packageVersion: "0.8.4",
                packageName: "@teachablemachine/image",
                timeStamp: new Date().toISOString(),
                userMetadata: {
                    labels: classesAList
                },
                modelName: "ml-bridge-model",
                labels: classesAList,
                imageSize: 224,

                // ml5.js explicit fields (Required for decoding labels)
                outputs: [{
                    uniqueValues: classesAList,
                    units: classesAList.length,
                    activation: 'softmax'
                }]
            };
            zip.file('model/metadata.json', JSON.stringify(metadata, null, 2));

            // 4. Bundle MobileNet (Vision Model) to ensure 100% Parity
            // We fetch the EXACT files used by the app from the public folder
            try {
                const mobilenetFiles = [
                    'model.json',
                    'group1-shard1of4',
                    'group1-shard2of4',
                    'group1-shard3of4',
                    'group1-shard4of4'
                ];

                for (const file of mobilenetFiles) {
                    const response = await fetch(`./models/mobilenet/${file}`);
                    if (!response.ok) throw new Error(`Failed to fetch ${file}`);
                    const blob = await response.blob();
                    zip.file(`models/mobilenet/${file}`, blob);
                }
                console.log("[Web Export] Bundled MobileNet successfully.");
            } catch (e) {
                console.error("[Web Export] Failed to bundle MobileNet:", e);
                // We don't block export, but user will need to copy manually if this fails
            }

            console.log("[Web Export] Created metadata.json with labels:", classesAList);

            return {
                modelArtifactsInfo: {
                    dateSaved: new Date(),
                    modelTopologyType: 'JSON',
                }
            };
        }));

        // Generate Zip Blob
        const blob = await zip.generateAsync({ type: "blob" });

        // Trigger Download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ml-bridge-model-web.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);

        return true;
    }
}

export const mlEngine = new MLEngine();
