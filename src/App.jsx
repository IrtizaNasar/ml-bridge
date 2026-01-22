import React, { useState, useEffect, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import { inputManager } from './services/InputManager';
import { mlEngine } from './services/MLEngine';
import { webcamManager } from './services/WebcamManager';

import ErrorBoundary from './components/ErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { InputCard } from './components/InputCard';
import { TrainingCard } from './components/TrainingCard';
import { DataCard } from './components/DataCard';
import { HubView } from './components/HubView';

import { SettingsModal } from './components/SettingsModal';
import { ConceptDashboard } from './components/ConceptDashboard';
import { ConfirmModal } from './components/ConfirmModal';

function App() {
    // Set TensorFlow backend on mount
    useEffect(() => {
        async function initBackend() {
            try {
                await tf.setBackend('webgl');
                console.log('[App] TensorFlow.js backend: WebGL');
            } catch (err) {
                console.warn('[App] WebGL not available, falling back to CPU:', err);
                await tf.setBackend('cpu');
                console.log('[App] TensorFlow.js backend: CPU');
            }
        }

        initBackend();
    }, []);

    const [activeTab, setActiveTab] = useState('hub');
    const [isProMode, setIsProMode] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [inputSource, setInputSource] = useState('webcam'); // 'serial' | 'webcam' | 'osc'
    const [showSourceChangeModal, setShowSourceChangeModal] = useState(false);
    const [pendingSource, setPendingSource] = useState(null);
    const [connectionStatus, setConnectionStatus] = useState({ connected: false, source: 'None' });

    const [incomingData, setIncomingData] = useState({});
    const [prediction, setPrediction] = useState(null);
    // Training Config State
    const [trainingConfig, setTrainingConfig] = useState({
        epochs: 150,
        learningRate: 0.01,
        batchSize: 16,
        autoCapture: false,
        threshold: 0.167,
        gestureMode: false, // When true, applies IMU normalization for gesture recognition
        gesturePredictionMode: false, // When true, only predict on gesture completion (not every frame)
        confidenceThreshold: 0.65, // Minimum confidence to show prediction (65% - TMT uses 60%)
        smoothingWindow: 7, // Number of predictions for majority voting (TMT uses 5-10)
        predictionCooldown: 200 // Minimum ms between prediction changes (TMT uses 125-200ms)
    });

    // Data Management
    const [lastError, setLastError] = useState(null);

    // Training State
    const [trainingMode, setTrainingMode] = useState('classification'); // 'classification' | 'regression'
    const [engineType, setEngineType] = useState('knn'); // 'knn' | 'dense'
    const [isTraining, setIsTraining] = useState(false);
    const [trainingProgress, setTrainingProgress] = useState(null); // { epoch, loss, accuracy }

    // Classification Classes
    const [classes, setClasses] = useState([
        { id: 'class_1', name: 'Class 1', count: 0 },
        { id: 'class_2', name: 'Class 2', count: 0 },
    ]);
    const [recordingClassId, setRecordingClassId] = useState('class_1');
    const [isCapturingAuto, setIsCapturingAuto] = useState(false);

    const [outputs, setOutputs] = useState([
        { id: 'out_1', name: 'Parameter 1', value: 0.5, samples: 0 }
    ]);

    // Gestures / Temporal Support
    const [windowSize, setWindowSizeState] = useState(1);
    const setWindowSize = (size) => {
        setWindowSizeState(size);
        mlEngine.setWindowSize(size);
    };

    const lastDataRef = useRef({});
    const inputSourceRef = useRef(inputSource);

    // Feature Selection
    const [selectedFeatures, setSelectedFeatures] = useState(new Set());
    const [dataRefreshKey, setDataRefreshKey] = useState(0); // Trigger for DataView refresh

    // Deploy/Output Protocol Configuration
    const [protocol, setProtocol] = useState('osc'); // 'osc' | 'ws' | 'serial'
    const [targetDeviceId, setTargetDeviceId] = useState(''); // For Serial Bridge routing
    // Refs for protocol and deviceId to avoid stale closures in prediction callbacks
    const protocolRef = useRef(protocol);
    const targetDeviceIdRef = useRef(targetDeviceId);

    // Sync refs with state
    useEffect(() => {
        protocolRef.current = protocol;
    }, [protocol]);

    useEffect(() => {
        targetDeviceIdRef.current = targetDeviceId;
    }, [targetDeviceId]);

    const [serialFormat, setSerialFormat] = useState('json'); // 'json' | 'csv'
    const serialFormatRef = useRef(serialFormat);

    useEffect(() => {
        serialFormatRef.current = serialFormat;
    }, [serialFormat]);


    // Connect/disconnect Serial Bridge based on protocol selection
    useEffect(() => {
        if (protocol === 'serial') {
            console.log('[App] Connecting to Serial Bridge...');
            if (window.api && window.api.serialBridge) {
                window.api.serialBridge.connect();
            }
        } else {
            // Disconnect when switching away from serial protocol
            if (window.api && window.api.serialBridge) {
                window.api.serialBridge.disconnect();
            }
        }
    }, [protocol]);



    const handleSelectInputSource = (source) => {
        // Don't confirm if switching to the same source
        if (source === inputSource) return;

        // Check if there's data or a trained model
        const hasData = classes.some(c => c.count > 0) || outputs.some(o => (o.samples || 0) > 0);
        const hasModel = trainingProgress !== null || mlEngine.denseModel !== null;

        // Warn user if they have unsaved work
        if (hasData || hasModel) {
            setPendingSource(source);
            setShowSourceChangeModal(true);
            return;
        }

        // No data/model, switch immediately
        performSourceSwitch(source);
    };

    const performSourceSwitch = (source) => {
        setInputSource(source);
        inputManager.setSource(source);

        // Full Reset on Source Switch/Refresh
        clearModel();
        setIncomingData({});
        setSelectedFeatures(new Set());
        selectedFeaturesRef.current = new Set();
        setPrediction(null);
        setTrainingProgress(null);
        setIsRunning(false);
        setIsTraining(false);

        // Reset classes to default
        setClasses([
            { id: 'class_1', name: 'Class 1', count: 0 },
            { id: 'class_2', name: 'Class 2', count: 0 },
        ]);

        // Reset outputs to default
        setOutputs([
            { id: 'out_1', name: 'Parameter 1', value: 0.5, samples: 0 }
        ]);
    };

    const handleConfirmSourceChange = () => {
        setShowSourceChangeModal(false);
        if (pendingSource) {
            performSourceSwitch(pendingSource);
            setPendingSource(null);
        }
    };

    const handleCancelSourceChange = () => {
        setShowSourceChangeModal(false);
        setPendingSource(null);
    };

    // Keep sync for external changes or initialization
    useEffect(() => {
        inputManager.setSource(inputSource);
    }, []);



    const selectedFeaturesRef = useRef(new Set());

    // Sync state to ref for access in listeners
    useEffect(() => {
        selectedFeaturesRef.current = selectedFeatures;
    }, [selectedFeatures]);

    // Prediction Loop State
    const [isRunning, setIsRunning] = useState(false);

    // Refs for safe access within event loops
    const trainingModeRef = useRef(trainingMode);
    const isRunningRef = useRef(isRunning);
    const engineTypeRef = useRef(engineType);

    useEffect(() => {
        trainingModeRef.current = trainingMode;
    }, [trainingMode]);

    useEffect(() => {
        engineTypeRef.current = engineType;
    }, [engineType]);



    const trainingConfigRef = useRef(trainingConfig);
    const recordingClassIdRef = useRef(recordingClassId);
    const isCapturingAutoRef = useRef(isCapturingAuto);
    const windowSizeRef = useRef(windowSize);
    const autoCaptureBufferRef = useRef([]);
    const preRollBufferRef = useRef([]); // Circular buffer for pre-roll
    const autoCaptureCooldownRef = useRef(0);


    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    useEffect(() => {
        windowSizeRef.current = windowSize;
    }, [windowSize]);

    useEffect(() => {
        trainingConfigRef.current = trainingConfig;
    }, [trainingConfig]);

    useEffect(() => {
        recordingClassIdRef.current = recordingClassId;
    }, [recordingClassId]);

    useEffect(() => {
        isCapturingAutoRef.current = isCapturingAuto;
    }, [isCapturingAuto]);

    // Update ML Engine smoothing settings when config changes
    useEffect(() => {
        mlEngine.setConfidenceThreshold(trainingConfig.confidenceThreshold || 0.65);
        mlEngine.setSmoothingWindow(trainingConfig.smoothingWindow || 7);
        mlEngine.setPredictionCooldown(trainingConfig.predictionCooldown || 200);
    }, [trainingConfig.confidenceThreshold, trainingConfig.smoothingWindow, trainingConfig.predictionCooldown]);

    // Auto-disable auto-capture when starting inference
    useEffect(() => {
        if (isRunning && trainingConfig.autoCapture) {
            setTrainingConfig(prev => ({ ...prev, autoCapture: false }));
            setTrainingConfig(prev => ({ ...prev, autoCapture: false }));
        }
    }, [isRunning]);

    const handleAutoCapture = (data) => {
        // Always add to pre-roll buffer (keep last 20 frames)
        if (!isCapturingAutoRef.current) {
            preRollBufferRef.current.push(data);
            if (preRollBufferRef.current.length > 20) {
                preRollBufferRef.current.shift();
            }
        }

        // Cooldown mechanism
        if (autoCaptureCooldownRef.current > 0) {
            autoCaptureCooldownRef.current--;
            return;
        }

        if (isCapturingAutoRef.current) {
            // Collecting samples
            autoCaptureBufferRef.current.push(data);

            // Check if finished (capture exactly windowSize samples)
            if (autoCaptureBufferRef.current.length >= windowSizeRef.current) {
                const samples = [...autoCaptureBufferRef.current];
                const classId = recordingClassIdRef.current;

                // TRAINING MODE: Add samples when NOT running
                if (!isRunningRef.current && trainingModeRef.current === 'classification') {
                    // Pass the entire sequence array - addDenseExample will flatten it
                    // Use gesture mode from training config, or auto-detect
                    let dataType = 'auto';
                    if (inputSourceRef.current === 'webcam' || inputSourceRef.current === 'upload') {
                        dataType = 'image';
                    } else if (trainingConfigRef.current.gestureMode) {
                        dataType = 'imu'; // Gesture mode = IMU normalization
                    }
                    mlEngine.addDenseExample(samples, classId, Array.from(selectedFeaturesRef.current), null, dataType);

                    // Update UI count
                    setClasses(prev => prev.map(c =>
                        c.id === classId ? { ...c, count: c.count + 1 } : c
                    ));

                }

                // INFERENCE MODE: Predict when running with gesture prediction mode
                if (isRunningRef.current && trainingConfigRef.current.gesturePredictionMode && engineTypeRef.current === 'dense') {
                    const features = Array.from(selectedFeaturesRef.current);
                    let dataType = 'auto';
                    if (inputSourceRef.current === 'webcam' || inputSourceRef.current === 'upload') {
                        dataType = 'image';
                    } else if (trainingConfigRef.current.gestureMode) {
                        dataType = 'imu';
                    }

                    // Predict on the complete gesture
                    mlEngine.predictDenseGesture(samples, features, dataType).then(result => {
                        if (result) {
                            setPrediction(result);
                            // Broadcast classification via OSC
                            if (window.api && window.api.osc && result.label) {
                                const clsName = classes.find(c => c.id === result.label)?.name || result.label;
                                window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [result.label, clsName]);
                            }
                            // Broadcast via WebSocket
                            if (window.api && window.api.ws) {
                                window.api.ws.broadcast('prediction', {
                                    ...result,
                                    protocol: protocolRef.current,
                                    deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null,
                                    serialFormat: protocolRef.current === 'serial' ? serialFormatRef.current : null
                                });
                            }
                        }
                    });
                }

                // Clean up
                setIsCapturingAuto(false);
                autoCaptureBufferRef.current = [];
                preRollBufferRef.current = []; // Clear pre-roll
                autoCaptureCooldownRef.current = 40; // ~0.8s cooldown
            }
        } else {
            // Detection phase - TMT Formula: sum(abs(all_6_axes)) / 6
            const sumAbs =
                (Math.abs(data.ch_0 || 0) +
                    Math.abs(data.ch_1 || 0) +
                    Math.abs(data.ch_2 || 0) +
                    Math.abs(data.ch_3 || 0) +
                    Math.abs(data.ch_4 || 0) +
                    Math.abs(data.ch_5 || 0));

            const signalStrength = sumAbs / 6.0;

            if (signalStrength > trainingConfigRef.current.threshold) {
                setIsCapturingAuto(true);
                // Prepend pre-roll buffer to start of capture
                autoCaptureBufferRef.current = [...(preRollBufferRef.current || []), data];
            }
        }
    };

    // Keep inputSourceRef in sync
    useEffect(() => {
        inputSourceRef.current = inputSource;
    }, [inputSource]);

    useEffect(() => {
        inputManager.onStatus(setConnectionStatus);

        inputManager.onData(async (data) => {
            setIncomingData(data);
            lastDataRef.current = data;

            // Gesture Auto-Capture Logic
            if (trainingConfigRef.current.autoCapture && recordingClassIdRef.current) {
                handleAutoCapture(data);
            }

            // Auto-populate features if empty (Startup or Source Switch)
            if (Object.keys(data).length > 0 && selectedFeaturesRef.current.size === 0) {
                const numericKeys = Object.keys(data).filter(k => typeof data[k] === 'number');
                // For MobileNet (f0..f1023), select all. For Serial, select all numbers.
                if (numericKeys.length > 0) {
                    const newSet = new Set(numericKeys);
                    setSelectedFeatures(newSet);
                    selectedFeaturesRef.current = newSet;
                }
            }

            // Predict (Only if Running)
            if (!isRunningRef.current) {
                if (prediction) setPrediction(null);
                return;
            }

            // Skip continuous prediction if gesture prediction mode is active FOR IMU DATA
            // Webcam/image data should still predict continuously
            // Gesture prediction works independently - doesn't require auto-capture
            const isGestureInput = inputSourceRef.current !== 'webcam' && inputSourceRef.current !== 'upload';
            if (trainingConfigRef.current.gesturePredictionMode && isGestureInput) {
                return; // Don't predict on every frame for IMU - only on gesture completion
            }

            const features = Array.from(selectedFeaturesRef.current);
            const currentMode = trainingModeRef.current;

            if (currentMode === 'classification') {
                if (engineTypeRef.current === 'dense') {
                    // Dense Model Prediction
                    // Use gesture mode from training config, or auto-detect
                    let dataType = 'auto';
                    if (inputSourceRef.current === 'webcam' || inputSourceRef.current === 'upload') {
                        dataType = 'image';
                    } else if (trainingConfigRef.current.gestureMode) {
                        dataType = 'imu'; // Gesture mode = IMU normalization
                    }
                    const result = await mlEngine.predictDense(data, features, dataType);
                    if (result) {
                        setPrediction(result);
                        if (window.api && window.api.osc && result.label) {
                            const clsName = classes.find(c => c.id === result.label)?.name || result.label;
                            window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [result.label, clsName]);
                        }
                        if (window.api && window.api.ws) {
                            window.api.ws.broadcast('prediction', {
                                ...result,
                                protocol: protocolRef.current,
                                deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null
                            });
                        }
                    }
                } else {
                    // KNN Prediction
                    const numClasses = mlEngine.classifier.getNumClasses();
                    if (numClasses > 0) {
                        const result = await mlEngine.predictClassification(data, features);
                        if (result) {
                            setPrediction(result);

                            // Broadcast Classification (OSC)
                            if (window.api && window.api.osc && result.label) {
                                const clsName = classes.find(c => c.id === result.label)?.name || result.label;
                                window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [result.label, clsName]);
                            }
                            if (window.api && window.api.ws) {
                                window.api.ws.broadcast('prediction', {
                                    ...result,
                                    protocol: protocolRef.current,
                                    deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null
                                });
                            }
                        }
                    }
                }
            } else {
                // Regression Prediction
                try {
                    const result = await mlEngine.predictRegression(data, features);

                    if (result) {
                        setPrediction(result);
                        setLastError(null);

                        // Broadcast Regression Outputs (OSC)
                        if (window.api && window.api.osc) {
                            Object.entries(result.regression).forEach(([id, val]) => {
                                window.api.osc.send('127.0.0.1', 12000, '/ml/regression', [id, val]);
                            });
                        }
                        if (window.api && window.api.ws) {
                            window.api.ws.broadcast('prediction', {
                                ...result,
                                protocol: protocolRef.current,
                                deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null
                            });
                        }

                    } else {
                        if (mlEngine.lastError) {
                            setLastError(mlEngine.lastError);
                        }
                    }
                } catch (err) {
                    console.error("Prediction error:", err);
                }
            }
        });


        return () => inputManager.disconnect();
    }, []); // Stable listener, no re-binding needed

    const toggleFeature = (key) => {
        setSelectedFeatures(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const validateSensorData = (data) => {
        if (!data || typeof data !== 'object') {
            return { valid: false, error: 'Invalid data: not an object' };
        }

        for (const [key, value] of Object.entries(data)) {
            if (typeof value !== 'number') {
                return { valid: false, error: `Invalid data for "${key}": not a number (got ${typeof value})` };
            }
            if (!isFinite(value)) {
                return { valid: false, error: `Invalid data for "${key}": not finite (${value})` };
            }
            if (isNaN(value)) {
                return { valid: false, error: `Invalid data for "${key}": NaN` };
            }
            if (Math.abs(value) > 1e6) {
                return { valid: false, error: `Invalid data for "${key}": value too large (${value})` };
            }
        }

        return { valid: true };
    };

    const trainFrame = (id, targetValue = null) => {
        if (lastError) setLastError(null);

        if (lastError) setLastError(null);

        if (Object.keys(lastDataRef.current).length === 0) {
            console.warn('[App] trainFrame ignored: No incoming data in lastDataRef');
            return;
        }

        const validation = validateSensorData(lastDataRef.current);
        if (!validation.valid) {
            console.warn('[App] trainFrame ignored:', validation.error);
            return;
        }

        const features = Array.from(selectedFeatures);
        const thumbnail = inputSource === 'webcam' ? webcamManager.getScreenshot() : null;

        if (trainingMode === 'classification') {
            if (engineType === 'dense') {
                let dataType = 'auto';
                if (inputSource === 'webcam' || inputSource === 'upload') {
                    dataType = 'image';
                } else if (trainingConfig.gestureMode) {
                    dataType = 'imu';
                }
                mlEngine.addDenseExample(lastDataRef.current, id, features, thumbnail, dataType);
                setClasses(prev => prev.map(c => c.id === id ? { ...c, count: c.count + 1 } : c));
            } else {
                mlEngine.addClassificationExample(lastDataRef.current, id, features, thumbnail);
                const counts = mlEngine.getClassCounts();
                setClasses(prev => prev.map(c => ({
                    ...c,
                    count: counts[c.id] || 0
                })));
            }
        } else if (trainingMode === 'regression') {
            if (targetValue === null) return;

            mlEngine.addRegressionExample(lastDataRef.current, id, targetValue, features, thumbnail);

            const regCounts = mlEngine.getRegressionCounts();
            setOutputs(prev => prev.map(o => ({
                ...o,
                samples: regCounts[o.id] || 0
            })));
        }
    };


    const clearModel = () => {
        try {
            mlEngine.clearAll();
        } catch (e) {
            console.error("Error clearing model:", e);
        }

        // Reset to default classes and outputs with empty thumbnails
        setClasses([
            { id: 'class_1', name: 'Class 1', count: 0, thumbnails: [] },
            { id: 'class_2', name: 'Class 2', count: 0, thumbnails: [] },
        ]);
        setOutputs([
            { id: 'out_1', name: 'Parameter 1', value: 0.5, samples: 0, thumbnails: [] }
        ]);

        // Clear all prediction and training state
        setPrediction(null);
        setTrainingProgress(null);
        setIsRunning(false);
        setIsTraining(false);
        setLastError(null);

        // Clear auto-capture state
        setIsCapturingAuto(false);
        setRecordingClassId('class_1');

        // Force DataView refresh
        setDataRefreshKey(prev => prev + 1);

        console.log('[App] Model cleared successfully');
    };

    const deleteSample = (index) => {
        mlEngine.removeSample(index);

        // Sync Counts
        if (trainingMode === 'classification') {
            const counts = mlEngine.getClassCounts();
            setClasses(prev => prev.map(c => ({
                ...c,
                count: counts[c.id] || 0
            })));
        } else {
            const regCounts = mlEngine.getRegressionCounts();
            setOutputs(prev => prev.map(o => ({
                ...o,
                samples: regCounts[o.id] || 0
            })));
        }
    };

    // Dynamic Class Management
    const addClass = () => {
        if (lastError) setLastError(null);
        const nextId = classes.length + 1;
        const newClass = {
            id: `class_${classes.length + 1}`, // Simple unique ID
            name: `Class ${classes.length + 1}`,
            count: 0
        };
        setClasses(prev => [...prev, newClass]);
    };

    const removeClass = (id) => {
        setClasses(prev => prev.filter(c => c.id !== id));
    };

    const renameClass = (id, newName) => {
        setClasses(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));
        // Update stored training data labels in MLEngine
        mlEngine.renameClass(id, newName);
    };

    // Dynamic Output Management (Regression)
    const addOutput = () => {
        const nextId = outputs.length + 1;
        setOutputs(prev => [...prev, {
            id: `out_${Date.now()}`, // Unique ID
            name: `Parameter ${prev.length + 1}`,
            value: 0.5,
            samples: 0,
            thumbnails: [] // Initialize thumbnails
        }]);
    };

    const removeOutput = (id) => {
        setOutputs(prev => prev.filter(o => o.id !== id));
    };

    const updateOutputTarget = (id, val) => {
        setOutputs(prev => prev.map(o => o.id === id ? { ...o, value: val } : o));
    };

    // --- Image Upload Handler ---
    const handleUpload = async (classId, file, targetValue = null) => {
        try {
            const { features, thumbnail } = await inputManager.convertImageToFeatures(file);

            // Auto-select features if first time
            if (selectedFeaturesRef.current.size === 0) {
                const keys = Object.keys(features).sort();
                const newSet = new Set(keys);
                setSelectedFeatures(newSet);
                selectedFeaturesRef.current = newSet;
            }

            const featureKeys = Array.from(selectedFeaturesRef.current);

            // Add to Engine
            if (trainingMode === 'classification') {
                if (engineType === 'dense') {
                    mlEngine.addDenseExample(features, classId, featureKeys, thumbnail);
                    setClasses(prev => prev.map(c => c.id === classId ? {
                        ...c,
                        count: c.count + 1,
                        thumbnails: [...(c.thumbnails || []), thumbnail]
                    } : c));
                } else {
                    mlEngine.addClassificationExample(features, classId, featureKeys, thumbnail);
                    const counts = mlEngine.getClassCounts();
                    setClasses(prev => prev.map(c => ({
                        ...c,
                        count: counts[c.id] || 0,
                        thumbnails: c.id === classId ? [...(c.thumbnails || []), thumbnail] : (c.thumbnails || [])
                    })));
                }
            } else {
                // REGRESSION MODE
                if (targetValue !== undefined && targetValue !== null) {
                    mlEngine.addRegressionExample(features, classId, targetValue, featureKeys, thumbnail);

                    const regCounts = mlEngine.getRegressionCounts();
                    setOutputs(prev => prev.map(o => o.id === classId ? {
                        ...o,
                        samples: regCounts[o.id] || 0,
                        thumbnails: [...(o.thumbnails || []), { src: thumbnail, value: targetValue }]
                    } : o));
                }
            }

        } catch (e) {
            console.error("Upload Failed:", e);
            setLastError("File processing failed. Try valid JPG/PNG.");
        }
    };

    const handleTestUpload = async (file) => {
        try {
            const { features, thumbnail } = await inputManager.convertImageToFeatures(file);

            // Run Prediction
            if (engineType === 'dense') {
                // Image upload - data is already normalized
                const res = await mlEngine.predictDense(features, Object.keys(features), 'image');
                setPrediction(res);
            } else {
                let res;
                if (trainingMode === 'classification') {
                    res = await mlEngine.predictClassification(features);
                } else {
                    res = await mlEngine.predictRegression(features);
                }
                setPrediction(res);
            }

        } catch (e) {
            console.error("Test Prediction Failed:", e);
        }
    };

    // --- Dense Model Handlers ---
    const handleTrainModel = async () => {
        if (engineType !== 'dense') return;

        setIsTraining(true);
        setLastError(null); // Clear any previous errors
        // Don't set trainingProgress yet - wait for first epoch

        try {
            const res = await mlEngine.trainDenseModel((epoch, logs, modelType) => {
                // TensorFlow.js uses 'acc' for accuracy metric (not 'accuracy')
                // For regression, it uses 'mse' metric
                let metricValue = 0;
                if (modelType === 'regression') {
                    // Regression mode: use MSE metric
                    metricValue = logs.mse || logs.loss || 0;
                } else {
                    // Classification mode: use accuracy metric
                    metricValue = logs.acc || 0;
                }

                setTrainingProgress({
                    epoch: epoch + 1,
                    loss: logs.loss || 0,
                    accuracy: metricValue,
                    modelType: modelType // Store for display purposes
                });
            }, trainingConfig.epochs, trainingConfig.learningRate, trainingConfig.batchSize);

            if (!res.success) {
                console.error("Training failed:", res.error);
                setLastError(res.error);
                setTrainingProgress(null); // Clear progress on failure
            } else {
                // Training completed successfully
                // trainingProgress is already set by the callback
            }
        } catch (e) {
            console.error("Training Error:", e);
            setLastError(e.message || "Training failed. Check console for details.");
            setTrainingProgress(null); // Clear progress on error
        } finally {
            setIsTraining(false);
            // Keep trainingProgress if training succeeded to show "RETRAIN"
        }
    };

    // --- Data Import/Export Handlers ---
    const handleSaveData = async () => {
        try {
            const data = mlEngine.exportData();
            const jsonString = JSON.stringify(data, null, 2);

            if (window.api && window.api.file) {
                const result = await window.api.file.saveDataset(jsonString);
                if (result.success) {
                    console.log('[App] Dataset saved successfully:', result.filePath);
                } else if (!result.canceled) {
                    console.error('[App] Failed to save dataset:', result.error);
                    setLastError('Failed to save dataset: ' + (result.error || 'Unknown error'));
                }
            } else {
                console.error('[App] File API not available');
                setLastError('File API not available. Are you running in Electron?');
            }
        } catch (e) {
            console.error('[App] Save error:', e);
            setLastError('Failed to save dataset: ' + e.message);
        }
    };

    const handleLoadData = async () => {
        try {
            if (window.api && window.api.file) {
                const result = await window.api.file.loadDataset();

                if (result.canceled) {
                    return; // User canceled
                }

                if (result.success && result.content) {
                    const data = JSON.parse(result.content);
                    const imported = mlEngine.importData(data);

                    if (imported) {
                        // Rebuild UI state from loaded data
                        const classCounts = mlEngine.getClassCounts();
                        const regCounts = mlEngine.getRegressionCounts();

                        // Update classes state
                        setClasses(prev => prev.map(c => ({
                            ...c,
                            count: classCounts[c.id] || 0
                        })));

                        // Update outputs state
                        setOutputs(prev => prev.map(o => ({
                            ...o,
                            samples: regCounts[o.id] || 0
                        })));

                        // Clear prediction and training state
                        setPrediction(null);
                        setTrainingProgress(null);
                        setIsRunning(false);

                        console.log('[App] Dataset loaded successfully');
                    } else {
                        setLastError('Failed to import dataset. File may be corrupted.');
                    }
                } else {
                    console.error('[App] Failed to load dataset:', result.error);
                    setLastError('Failed to load dataset: ' + (result.error || 'Unknown error'));
                }
            } else {
                console.error('[App] File API not available');
                setLastError('File API not available. Are you running in Electron?');
            }
        } catch (e) {
            console.error('[App] Load error:', e);
            setLastError('Failed to load dataset: ' + e.message);
        }
    };


    return (
        <div className="h-screen w-screen overflow-hidden bg-[#050505]">
            <ErrorBoundary>
                <ConceptDashboard
                classes={classes}
                setClasses={setClasses}
                outputs={outputs}
                setOutputs={setOutputs}
                prediction={prediction}
                isRunning={isRunning}
                setIsRunning={setIsRunning}
                trainingMode={trainingMode}
                setTrainingMode={setTrainingMode}
                engineType={engineType}
                setEngineType={setEngineType}
                trainFrame={trainFrame}
                onRemoveClass={removeClass}
                onRenameClass={renameClass}
                onAddClass={addClass}
                onRemoveOutput={removeOutput}
                onUpdateOutputTarget={updateOutputTarget}
                onAddOutput={addOutput}
                handleTrainModel={handleTrainModel}
                isModelTraining={isTraining}
                trainingProgress={trainingProgress}
                trainingConfig={trainingConfig}
                setTrainingConfig={setTrainingConfig}
                isCapturingAuto={isCapturingAuto}
                recordingClassId={recordingClassId}
                setRecordingClassId={setRecordingClassId}
                windowSize={windowSize}
                setWindowSize={setWindowSize}
                incomingData={incomingData}
                selectedFeatures={selectedFeatures}
                toggleFeature={toggleFeature}
                clearModel={clearModel}
                inputSource={inputSource}
                setInputSource={handleSelectInputSource}
                onDeleteSample={deleteSample}
                onUpload={handleUpload}
                onTestUpload={handleTestUpload}
                onSave={handleSaveData}
                onLoad={handleLoadData}
                dataRefreshKey={dataRefreshKey}
                protocol={protocol}
                setProtocol={setProtocol}
                targetDeviceId={targetDeviceId}
                setTargetDeviceId={setTargetDeviceId}
                serialFormat={serialFormat}
                setSerialFormat={setSerialFormat}
                />
            </ErrorBoundary>

            {/* Source Change Confirmation Modal */}
            <ConfirmModal
                isOpen={showSourceChangeModal}
                title="Switch Input Source?"
                message="Switching input source will clear all training data and models.\n\nAny unsaved work will be lost. Continue?"
                onConfirm={handleConfirmSourceChange}
                onCancel={handleCancelSourceChange}
            />
        </div>
    );
}

export default App;
