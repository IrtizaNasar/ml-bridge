import * as tf from '@tensorflow/tfjs';
import * as knn from '@tensorflow-models/knn-classifier';
import JSZip from 'jszip';
import { detectDataType, normalizeValue, resetFeatureRanges, computeFeatureStats, normalizeWithStats } from './normalization';

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

        // --- Feature Stats (per-feature min/max from training data) ---
        // Computed from denseData at rebuild/training time, used for prediction.
        this.featureStats = null;
        this.knnDirty = false; // Flag: KNN needs rebuild before next prediction

        // --- Temporal Support (Gestures) ---
        this.history = [];
        this.windowSize = 1; // Default: Single snapshot

        // --- Prediction Smoothing (for stable gesture recognition) ---
        this.predictionHistory = [];
        this.smoothingWindow = 7;
        this.confidenceThreshold = 0.65;
        this.lastStablePrediction = null;
        this.lastPredictionChangeTime = 0;
        this.predictionCooldown = 200;
    }

    /**
     * Sets the smoothing window size for sensor data
     * @param {number} size - Window size (number of samples)
     */
    setWindowSize(size) {
        this.windowSize = Math.max(1, size);
        this.history = []; // Flush on change
    }

    // --- Classification (KNN) ---
    /**
     * Adds a classification example to the KNN classifier
     * @param {Object} inputData - Raw input data
     * @param {string} classId - Target class ID
     * @param {Object} features - Feature map
     * @param {string|null} [thumbnail=null] - Optional base64 thumbnail
     */
    addClassificationExample(inputData, classId, features, thumbnail = null) {
        if (!inputData) return;

        // Get features (raw for sensor type, type-normalized for image/imu/eeg)
        const baseTensor = this._toTensor(inputData, features, 'auto', false);
        if (!baseTensor) return;

        const baseVals = Array.from(baseTensor.dataSync());
        baseTensor.dispose();

        // Store in unified data (raw for sensors, type-normalized for image/imu/eeg)
        this.denseData.push({
            features: baseVals,
            label: classId,
            type: 'classification',
            thumbnail: thumbnail,
            timestamp: Date.now()
        });
        this.classes.add(classId);

        // Mark KNN as needing rebuild (lazy: rebuilt before next prediction)
        this.knnDirty = true;
    }

    /**
     * Predicts class using KNN classifier
     * @param {Object} inputData - Raw input data
     * @param {Object} features - Feature map
     * @returns {Promise<Object>} Prediction result { label, confidence, confidences }
     */
    async predictClassification(inputData, features) {
        // Lazy rebuild: ensure KNN is in sync with latest denseData + stats
        this._ensureKnnRebuilt();

        if (this.classifier.getNumClasses() === 0) return null;

        // Normalize using training-data stats, then pad for KNN
        const tensor = this._toTensor(inputData, features, 'auto', true, this.featureStats);
        if (!tensor) return null;
        try {
            const result = await this.classifier.predictClass(tensor, 20);

            // Normalize output to match Dense Engine (add top-level confidence)
            if (result.confidences) {
                if (result.label && result.confidences[result.label] !== undefined) {
                    result.confidence = result.confidences[result.label];
                } else {
                    const values = Object.values(result.confidences || {});
                    result.confidence = values.length > 0 ? Math.max(...values) : 0;
                }
            } else {
                result.confidence = 0;
            }

            tensor.dispose();

            // Apply prediction smoothing
            const classArray = Array.from(this.classes).sort();
            const rawPrediction = {
                label: result.label,
                confidence: result.confidence,
                confidences: result.confidences || {},
                timestamp: Date.now()
            };
            return this._smoothPrediction(rawPrediction, classArray);
        } catch (e) {
            tensor.dispose();
            return null;
        }
    }

    // --- Regression ---
    /**
     * Adds a regression example (custom KNN implementation)
     * @param {Object} inputData - Raw input data
     * @param {string} outputId - Target output ID
     * @param {number} targetValue - Target value (0.0 to 1.0)
     * @param {Object} features - Feature map
     * @param {string|null} [thumbnail=null] - Optional base64 thumbnail
     */
    addRegressionExample(inputData, outputId, targetValue, features, thumbnail = null) {
        if (!this.regressionData[outputId]) {
            this.regressionData[outputId] = [];
        }

        // Get features (raw for sensor type, type-normalized for image/imu/eeg)
        const baseTensor = this._toTensor(inputData, features, 'auto', false);
        if (!baseTensor) return;

        const vals = Array.from(baseTensor.dataSync());
        baseTensor.dispose();

        // Store raw/type-normalized features
        this.denseData.push({
            features: vals,
            label: outputId,
            target: targetValue,
            type: 'regression',
            thumbnail: thumbnail,
            timestamp: Date.now()
        });

        // Mark KNN as needing rebuild (lazy: rebuilt before next prediction)
        this.knnDirty = true;
    }

    /**
     * Predicts regression values using custom KNN
     * @param {Object} inputData - Raw input data
     * @param {Object} features - Feature map
     * @returns {Promise<Object>} Prediction result map { outputId: value }
     */
    async predictRegression(inputData, features) {
        // Lazy rebuild: ensure KNN regression data is in sync with latest denseData + stats
        this._ensureKnnRebuilt();

        // Normalize using training-data stats, then pad for KNN
        const inputTensor = this._toTensor(inputData, features, 'auto', true, this.featureStats);
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

    /**
     * Adds a dense neural network example (stores in memory, trained later)
     * @param {Object} inputData - Raw input data
     * @param {string} classId - Target class ID
     * @param {Object} features - Feature map
     * @param {string|null} [thumbnail=null] - Optional thumbnail
     * @param {string} [dataType='auto'] - Data type ('auto', 'image', 'imu', 'eeg')
     */
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
            // Single sample - don't pad 1D vectors (DNN uses Euclidean distance, not cosine)
            const tensor = this._toTensor(inputData, features, dataType, false);
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

    /**
     * Trains a dense neural network model
     * @param {Function} onEpochEnd - Callback for training progress
     * @param {number} [epochs=50] - Number of epochs
     * @param {number} [learningRate=0.001] - Learning rate
     * @param {number} [batchSize=16] - Batch size
     * @returns {Promise<{success: boolean, error?: string, model?: Object}>} Training result
     */
    async trainDenseModel(onEpochEnd, epochs = 50, learningRate = 0.001, batchSize = 16) {
        if (this.denseData.length === 0) return { success: false, error: "No data recorded." };

        // Check if this is classification or regression
        // Dense type indicates classification using neural networks
        const isClassification = this.denseData[0]?.type === 'classification' || this.denseData[0]?.type === 'dense';

        // Store model type for prediction
        this.denseModelType = isClassification ? 'classification' : 'regression';

        // Only check for minimum classes in classification mode
        if (isClassification && this.classes.size < 2) {
            return { success: false, error: "Need at least 2 classes to train." };
        }

        this.isTraining = true;

        // 1. Prepare Data - filter by type to ensure consistency
        const expectedType = isClassification ? ['classification', 'dense'] : ['regression'];
        const filteredData = this.denseData.filter(d => expectedType.includes(d.type));

        if (filteredData.length === 0) {
            this.isTraining = false;
            return { success: false, error: `No ${isClassification ? 'classification' : 'regression'} data found. Please record samples in the correct mode.` };
        }

        // Validate minimum samples per class for robust training
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
                return { success: false, error: `Class "${minClass}" has only ${minSamples} samples. Need at least 10 samples per class for reliable training.` };
            }

            // Warn about class imbalance (but don't block training)
            if (maxSamples / minSamples > 3) {
                console.warn(`[MLEngine] Class imbalance detected: max/min ratio is ${(maxSamples / minSamples).toFixed(1)}x. Consider collecting more samples for minority classes.`);
            }
        }


        // Validate all samples have consistent feature dimensions
        const firstShape = filteredData[0].features.length;
        const shapeMismatch = filteredData.find(d => d.features.length !== firstShape);

        if (shapeMismatch) {
            this.isTraining = false;
            return {
                success: false,
                error: `Inconsistent feature dimensions detected: expected ${firstShape} features, but found ${shapeMismatch.features.length}. This usually happens after changing the temporal window size. Please clear all data and re-record samples with the current settings.`
            };
        }

        const inputShape = filteredData[0].features.length;

        // Compute per-feature min/max stats from training data.
        // These stats are stored and used for prediction normalization too.
        this.featureStats = computeFeatureStats(filteredData);

        // Normalize all training features using the computed stats
        const normalizedFeatures = filteredData.map(d =>
            this.featureStats ? normalizeWithStats(d.features, this.featureStats) : d.features
        );

        const xs = tf.tensor2d(normalizedFeatures);

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
            // Regression mode - support single and multi-output
            const outputIds = new Set(filteredData.map(d => d.label));
            const sortedOutputIds = Array.from(outputIds).sort();
            this.regressionOutputIds = sortedOutputIds;
            const numOutputs = sortedOutputIds.length;

            let regFeatures, regTargets;

            if (numOutputs === 1) {
                // Single output: each sample → one target value (most common case)
                regFeatures = normalizedFeatures;
                regTargets = filteredData.map(d => [parseFloat(d.target)]);
            } else {
                // Multi-output: each sample was captured for one output independently.
                // Fill non-targeted outputs with their mean value to avoid pulling toward 0.
                const outputMeans = {};
                sortedOutputIds.forEach(id => {
                    const vals = filteredData.filter(d => d.label === id).map(d => parseFloat(d.target));
                    outputMeans[id] = vals.length > 0
                        ? vals.reduce((a, b) => a + b, 0) / vals.length
                        : 0;
                });

                regFeatures = normalizedFeatures;
                regTargets = filteredData.map(d => {
                    return sortedOutputIds.map(id =>
                        id === d.label ? parseFloat(d.target) : outputMeans[id]
                    );
                });
            }

            // Dispose the original xs (built from all filteredData) and rebuild
            xs.dispose();
            const xsReg = tf.tensor2d(regFeatures);
            ys = tf.tensor2d(regTargets);
            outputUnits = numOutputs;
            outputActivation = 'linear';
            lossFunction = 'meanSquaredError';
            metricsArray = ['mse'];

            return this._trainModel(xsReg, ys, outputUnits, outputActivation, lossFunction, metricsArray, inputShape, onEpochEnd, epochs, learningRate, batchSize);
        }

        // Continue with classification training
        return this._trainModel(xs, ys, outputUnits, outputActivation, lossFunction, metricsArray, inputShape, onEpochEnd, epochs, learningRate, batchSize);
    }

    async _trainModel(xs, ys, outputUnits, outputActivation, lossFunction, metricsArray, inputShape, onEpochEnd, epochs = 50, learningRate = 0.001, batchSize = 16) {

        // Dispose previous model to prevent GPU memory leak on retrain
        if (this.denseModel) {
            this.denseModel.dispose();
            this.denseModel = null;
        }

        // 2. Create Model
        const model = tf.sequential();

        // Hidden Layer 1
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

        // Hidden Layer 2
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

        // Don't pad 1D - DNN was trained without the KNN cosine-similarity pad
        // Use featureStats for consistent normalization with training data
        const tensor = this._toTensor(inputData, features, dataType, false, this.featureStats);
        if (!tensor) return null;

        let input, prediction, data;
        try {
            // Shape [1, N]
            input = tensor.expandDims(0);
            prediction = this.denseModel.predict(input);
            data = await prediction.data();
        } catch (e) {
            // Guard against model disposal during prediction
            tensor.dispose();
            if (input) input.dispose();
            if (prediction) prediction.dispose();
            console.warn('Dense prediction error:', e);
            return null;
        }

        tensor.dispose();
        input.dispose();
        prediction.dispose();

        // Handle regression mode
        if (this.denseModelType === 'regression') {
            // For regression, map outputs back to their IDs
            const regression = {};
            if (this.regressionOutputIds && this.regressionOutputIds.length === data.length) {
                this.regressionOutputIds.forEach((id, idx) => {
                    // Apply EMA smoothing
                    const alpha = 0.15; // 15% new value, 85% previous value for stability
                    const rawValue = data[idx];
                    const previous = this.previousRegressionValues[id] !== undefined
                        ? this.previousRegressionValues[id]
                        : rawValue;

                    const smoothed = (alpha * rawValue) + ((1 - alpha) * previous);
                    this.previousRegressionValues[id] = smoothed;
                    regression[id] = smoothed;
                });
            } else {
                // Fallback: return as array if IDs not available
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

        // Apply smoothing for stable predictions
        const rawPrediction = {
            label: classArray[maxIdx],
            confidence: maxVal,
            confidences: confidences,
            timestamp: Date.now()
        };

        return this._smoothPrediction(rawPrediction, classArray);
    }

    // Predict on a complete gesture sequence
    async predictDenseGesture(gestureSequence, features, dataType = 'auto') {
        if (!this.denseModel) return null;
        if (!gestureSequence || gestureSequence.length === 0) return null;

        // Flatten and normalize the gesture sequence (normalizeValue per element)
        let featureVector = this._normalizeSequence(gestureSequence, features, dataType);
        if (!featureVector) return null;

        // Apply training-data statistics normalization
        if (this.featureStats) {
            featureVector = normalizeWithStats(featureVector, this.featureStats);
        }

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
        // Gestures are infrequent events, no cooldown needed
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

    /**
     * Clears all training data, models, and resets state.
     * Properly disposes TensorFlow resources to prevent memory leaks.
     */
    clearAll() {
        // Dispose KNN classifier and recreate (clears shape memory)
        this.classifier.dispose();
        this.classifier = knn.create();

        // Dispose Dense model if exists (prevents GPU memory leak)
        if (this.denseModel) {
            this.denseModel.dispose();
            this.denseModel = null;
        }

        // Dispose regression tensors
        Object.values(this.regressionData).forEach(examples => {
            examples.forEach(ex => {
                if (ex.tensor) ex.tensor.dispose();
            });
        });

        // Reset all state
        this.regressionData = {};
        this.denseData = [];
        this.classes.clear();
        this.previousRegressionValues = {};
        this.history = [];
        this.predictionHistory = [];
        this.lastStablePrediction = null;
        this.denseModelType = null;
        this.regressionOutputIds = null;

        // Reset normalization state
        this.featureStats = null;
        this.knnDirty = false;

        // Reset adaptive normalization ranges (UI tracking only)
        resetFeatureRanges();
    }

    // --- Utils ---
    /**
     * Converts raw input data into a normalized tensor for ML operations.
     * @param {Object} inputData - Raw key-value data from sensor
     * @param {Array<string>} selectedFeatures - Feature keys to include
     * @param {string} dataType - Data type for normalization
     * @param {boolean} padSingleDim - Whether to pad 1D vectors (for KNN cosine similarity)
     * @param {Array|null} featureStats - Per-feature min/max stats for normalization (null = no stats normalization)
     * @returns {tf.Tensor1D|null} Normalized tensor or null if no valid data
     */
    _toTensor(inputData, selectedFeatures, dataType = 'auto', padSingleDim = true, featureStats = null) {
        let keys = [];
        if (selectedFeatures && selectedFeatures.length > 0) {
            keys = selectedFeatures.sort();
        } else {
            keys = Object.keys(inputData).filter(k => typeof inputData[k] === 'number').sort();
        }

        if (keys.length === 0) return null;

        // Detect data type if auto
        if (dataType === 'auto') {
            dataType = detectDataType(inputData, keys);
        }

        // Step 1: Type-specific normalization (image/imu/eeg get physical-range normalization,
        // generic sensors pass through raw)
        let currentValues = keys.map(k => {
            const value = inputData[k] || 0;
            return normalizeValue(value, dataType, k);
        });

        // Step 2: KNN Cosine Similarity fix for 1D scalar vectors.
        // Only pad when: KNN path requested (padSingleDim), single feature, AND
        // no temporal windowing (windowed vectors are already multi-dimensional).
        if (padSingleDim && currentValues.length === 1 && this.windowSize <= 1) {
            currentValues.push(0.5);
        }

        // Flush history if dimension changes (e.g., switching between KNN padded and DNN unpadded)
        if (this.history.length > 0 && this.history[0].length !== currentValues.length) {
            this.history = [];
        }

        // Update history
        this.history.push(currentValues);
        if (this.history.length > this.windowSize) {
            this.history.shift();
        }

        // Build final feature vector (flatten history if windowed)
        let finalValues;
        if (this.windowSize > 1) {
            // Fill with zeros if history is not full yet
            finalValues = [];
            for (let i = 0; i < this.windowSize; i++) {
                const snapshot = this.history[this.history.length - 1 - i] || new Array(currentValues.length).fill(0);
                finalValues = [...snapshot, ...finalValues]; // Maintain temporal order
            }
        } else {
            finalValues = currentValues;
        }

        // Step 3: Apply training-data statistics normalization after windowing.
        // The safety guard in normalizeWithStats (i >= stats.length → passthrough)
        // handles the padded 0.5 dimension correctly.
        if (featureStats) {
            finalValues = normalizeWithStats(finalValues, featureStats);
        }

        return tf.tensor1d(finalValues);
    }



    /**
     * Normalizes a gesture sequence into a single flat feature vector.
     * Used for temporal/gesture DNN training and prediction.
     * @param {Array<Object>} samples - Array of data snapshots
     * @param {Array<string>} selectedFeatures - Feature keys to include
     * @param {string} dataType - Data type for normalization
     * @returns {Array<number>|null} Flat feature vector or null
     */
    _normalizeSequence(samples, selectedFeatures, dataType = 'auto') {
        let keys = [];
        if (selectedFeatures && selectedFeatures.length > 0) {
            keys = selectedFeatures.sort();
        } else if (samples.length > 0) {
            keys = Object.keys(samples[0]).filter(k => typeof samples[0][k] === 'number').sort();
        }

        if (keys.length === 0) return null;

        // Detect data type from first sample using imported utility
        if (dataType === 'auto' && samples.length > 0) {
            dataType = detectDataType(samples[0], keys);
        }

        // Flatten sequence: [sample1, sample2, ...] -> [sample1_features..., sample2_features...]
        const flattened = [];
        samples.forEach(sample => {
            keys.forEach(k => {
                const value = sample[k] || 0;
                flattened.push(normalizeValue(value, dataType, k));
            });
        });

        return flattened;
    }

    // Smooth predictions using majority voting + cooldown
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
            bypassCooldown ||
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

    clearClassData(classId) {
        this.denseData = this.denseData.filter(sample => sample.label !== classId);

        // Recompute stats and rebuild KNN from remaining data
        this.featureStats = this.denseData.length > 0
            ? computeFeatureStats(this.denseData)
            : null;
        this._rebuildKnnState();
    }

    getClassCounts() {
        const counts = {};
        this.denseData.forEach(d => {
            if (d.type === 'classification' || d.type === 'dense') {
                counts[d.label] = (counts[d.label] || 0) + 1;
            }
        });
        return counts;
    }

    getRegressionCounts() {
        const counts = {};
        this.denseData.forEach(d => {
            if (d.type === 'regression') {
                counts[d.label] = (counts[d.label] || 0) + 1;
            }
        });
        return counts;
    }

    /**
     * Removes a single sample by index and rebuilds internal state.
     * @param {number} index - Index in denseData array
     * @returns {boolean} True if removed
     */
    removeSample(index) {
        if (index < 0 || index >= this.denseData.length) return false;

        this.denseData.splice(index, 1);

        // Recompute stats and rebuild KNN from remaining data
        this.featureStats = this.denseData.length > 0
            ? computeFeatureStats(this.denseData)
            : null;
        this._rebuildKnnState();
        return true;
    }

    /**
     * Lazily ensures KNN state is in sync with denseData.
     * Called before any KNN prediction. Computes per-feature statistics from
     * all training data and rebuilds the KNN classifier with consistently-normalized features.
     */
    _ensureKnnRebuilt() {
        if (!this.knnDirty) return;
        if (this.denseData.length === 0) {
            this.knnDirty = false;
            return;
        }

        // Compute per-feature min/max from all collected samples.
        this.featureStats = computeFeatureStats(this.denseData);

        // Rebuild entire KNN from denseData using the new stats
        this._rebuildKnnState();
        this.knnDirty = false;
    }

    _rebuildKnnState() {
        // 1. Clear and recreate KNN classifier (resets shape memory)
        this.classifier.dispose();
        this.classifier = knn.create();

        // Dispose existing regression tensors before rebuilding
        Object.values(this.regressionData).forEach(examples => {
            examples.forEach(ex => { if (ex.tensor) ex.tensor.dispose(); });
        });
        this.regressionData = {};
        this.classes.clear();

        // 2. Re-populate from current denseData
        // denseData stores raw/type-normalized features (unpadded).
        // Apply featureStats normalization → [0, 1], then pad 1D for KNN cosine similarity.
        this.denseData.forEach(sample => {
            tf.tidy(() => {
                let features = sample.features;

                // Normalize using training-data statistics
                if (this.featureStats) {
                    features = normalizeWithStats(features, this.featureStats);
                }

                // Pad 1D features for KNN cosine similarity
                const needsPad = features.length === 1;
                const knnFeatures = needsPad ? [...features, 0.5] : features;
                const tensor = tf.tensor1d(knnFeatures);

                if (sample.type === 'classification' || sample.type === 'dense') {
                    this.classifier.addExample(tensor, sample.label);
                    this.classes.add(sample.label);
                } else if (sample.type === 'regression') {
                    if (!this.regressionData[sample.label]) {
                        this.regressionData[sample.label] = [];
                    }
                    // tf.keep() prevents tf.tidy from disposing this tensor
                    const clonedTensor = tf.keep(tensor.clone());
                    this.regressionData[sample.label].push({
                        tensor: clonedTensor,
                        target: sample.target
                    });
                }
            });
        });
    }

    exportData(classNameMap = {}) {
        const data = {
            classification: {},
            regression: {},
            unifiedDataset: this.denseData, // Persist the hub data
            featureStats: this.featureStats, // Per-feature normalization stats
            metadata: {
                classNames: classNameMap, // Save class ID -> Name mapping
                exportedAt: new Date().toISOString(),
                version: '1.1'
            }
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

            // Store imported metadata for UI reconstruction
            this.importedMetadata = data.metadata || {};

            if (data.unifiedDataset) {
                // Rebuild from unified dataset.
                // Do NOT also load data.classification/data.regression — that would
                // duplicate every KNN example (once from serialized tensors, once from rebuild).
                this.denseData = data.unifiedDataset;

                // Restore or recompute feature stats for normalization
                if (data.featureStats) {
                    this.featureStats = data.featureStats;
                } else {
                    // Legacy export without featureStats: recompute from data
                    this.featureStats = computeFeatureStats(this.denseData);
                }

                // Rebuild KNN with stats-normalized features (consistent with prediction path)
                this.denseData.forEach(sample => {
                    let features = sample.features;

                    // Apply training-data statistics normalization
                    if (this.featureStats) {
                        features = normalizeWithStats(features, this.featureStats);
                    }

                    const needsPad = features.length === 1;
                    const knnFeatures = needsPad ? [...features, 0.5] : features;
                    const tensor = tf.tensor1d(knnFeatures);

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
                // Legacy path: no unifiedDataset — load from serialized KNN tensors.
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

                // Rebuild denseData from internal KNN structures.
                // KNN tensors are PADDED (1D→2D with 0.5 appended).
                // Strip the padding constant before storing in denseData so DNN
                // training gets correct unpadded features.
                this.denseData = [];

                // From Classification
                const classifierDataset = this.classifier.getClassifierDataset();
                Object.entries(classifierDataset).forEach(([label, dataset]) => {
                    const dataArray = dataset.dataSync();
                    const shape = dataset.shape; // [numExamples, valSize]
                    const valSize = shape[1];
                    for (let i = 0; i < shape[0]; i++) {
                        let slice = Array.from(dataArray.slice(i * valSize, (i + 1) * valSize));
                        // Strip 1D padding: if last element is 0.5 and length is 2,
                        // this was a padded single-feature vector
                        if (slice.length === 2 && slice[1] === 0.5) {
                            slice = [slice[0]];
                        }
                        this.denseData.push({
                            features: slice,
                            label: label,
                            type: 'classification',
                            timestamp: Date.now()
                        });
                    }
                });

                // From Regression
                Object.entries(this.regressionData).forEach(([label, examples]) => {
                    examples.forEach(ex => {
                        let features = Array.from(ex.tensor.dataSync());
                        // Strip 1D padding
                        if (features.length === 2 && features[1] === 0.5) {
                            features = [features[0]];
                        }
                        this.denseData.push({
                            features: features,
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

    // Get imported metadata (e.g., class names)
    getImportedMetadata() {
        return this.importedMetadata || {};
    }


    async exportModelArduino(classNameMap = {}) {
        // Placeholder for Arduino Export
        // Ideally this would generate TFLite Tensors or C Header
        console.warn("Arduino Export logic not implemented based on TFLite/Micro.");
        throw new Error("Arduino Export is currently unavailable. Requires TFLite Micro implementation.");
    }

    async exportModelWeb(classNameMap = {}) {
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

            // 3. Add metadata (ml5.js + Teachable Machine compatible)
            const classesAList = Array.from(this.classes).sort();
            // Use mapped names for classes in metadata.json
            const labels = classesAList.map(id => classNameMap[id] || id);

            const metadata = {
                // Teachable Machine standard fields
                tfjsVersion: "1.3.1",
                tmVersion: "2.4.4",
                packageVersion: "0.8.4",
                packageName: "@teachablemachine/image",
                timeStamp: new Date().toISOString(),
                userMetadata: {
                    labels: labels
                },
                modelName: "ml-bridge-model",
                labels: labels,
                imageSize: 224,

                // ml5.js explicit fields (Required for decoding labels)
                outputs: [{
                    uniqueValues: labels,
                    units: labels.length,
                    activation: 'softmax'
                }]
            };
            zip.file('model/metadata.json', JSON.stringify(metadata, null, 2));

            // 4. Bundle MobileNet for standalone deployment
            // Fetch MobileNet files from public folder for bundling
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
                // Export continues even if MobileNet bundling fails
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
