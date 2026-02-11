import React, { useState, useEffect, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import { inputManager } from './services/InputManager';
import { mlEngine } from './services/MLEngine';
import { webcamManager } from './services/WebcamManager';
import { FEATURE_DETECTION } from './constants';
import { logCompatibilityWarnings, checkFeatureSupport } from './browserCompat';
import { validateClassName, sanitizeInput } from './utils';


// Components
import { Sidebar } from './components/Sidebar';
import { InputCard } from './components/InputCard';
import { HubView } from './components/HubView';

import { SettingsModal } from './components/SettingsModal';
import { ConceptDashboard } from './components/ConceptDashboard';
import { ConfirmModal } from './components/ConfirmModal';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
    const [activeTab, setActiveTab] = useState('hub');
    const [isProMode, setIsProMode] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [inputSource, setInputSource] = useState('webcam'); // 'serial' | 'webcam' | 'osc'
    const [showSourceChangeModal, setShowSourceChangeModal] = useState(false);
    const [pendingSource, setPendingSource] = useState(null);
    // Generic confirmation modal (for mode/engine switches, destructive actions)
    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, confirmLabel: 'Continue', confirmColor: 'emerald' });
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
        confidenceThreshold: 0.65,
        smoothingWindow: 7,
        predictionCooldown: 200
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
    const lastDataTimeRef = useRef(0); // Track timestamp of last received data
    const inputSourceRef = useRef(inputSource);
    const classesRef = useRef(classes);

    // UI throttling: Only update display at 30fps, but keep refs real-time for predictions
    const lastUIUpdateRef = useRef(0);
    const uiUpdateIntervalMs = 33; // ~30fps for UI updates

    // Feature Selection
    const [selectedFeatures, setSelectedFeatures] = useState(new Set());
    const [dataRefreshKey, setDataRefreshKey] = useState(0); // Trigger for DataView refresh

    // Feature update tracking (for debouncing real-time detection)
    const lastSeenFeaturesRef = useRef(new Map()); // Map<featureName, lastSeenTimestamp>
    const featureUpdateTimerRef = useRef(null);

    // Deploy/Output Protocol Configuration
    const [protocol, setProtocol] = useState('osc'); // 'osc' | 'ws' | 'serial'
    const [targetDeviceId, setTargetDeviceId] = useState(''); // For Serial Bridge routing
    // Refs for protocol and deviceId to avoid stale closures in prediction callbacks
    const protocolRef = useRef(protocol);
    const targetDeviceIdRef = useRef(targetDeviceId);

    // Message Type Filter (for multi-stream devices like Muse 2)
    const [messageTypeFilter, setMessageTypeFilter] = useState(null); // null = no filter (default)
    const messageTypeFilterRef = useRef(messageTypeFilter);
    const [detectedMessageTypes, setDetectedMessageTypes] = useState(new Set()); // Auto-detect available types

    // Watchdog for Signal Health
    const [hasSignal, setHasSignal] = useState(false);

    // Sync refs
    useEffect(() => {
        classesRef.current = classes;
    }, [classes]);

    useEffect(() => {
        protocolRef.current = protocol;
        targetDeviceIdRef.current = targetDeviceId;
        messageTypeFilterRef.current = messageTypeFilter;
    }, [protocol, targetDeviceId, messageTypeFilter]);

    // Cleanup & Status Watchdog
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastDataTimeRef.current;

            // Mark as no signal if no data in 2s
            if (elapsed > 2000) {
                setHasSignal(false);

                // Clear stale data when signal is lost
                setIncomingData({});
                lastDataRef.current = {};

                // Reset detected message types when connection is lost
                setDetectedMessageTypes(new Set());
                setMessageTypeFilter(null); // Reset filter selection too
            } else {
                setHasSignal(true);
            }
        }, 500);

        return () => clearInterval(timer);
    }, []);

    const [serialFormat, setSerialFormat] = useState('json'); // 'json' | 'csv'
    const serialFormatRef = useRef(serialFormat);

    useEffect(() => {
        serialFormatRef.current = serialFormat;
    }, [serialFormat]);

    // Auto-reset filter when it becomes hidden (< 2 types)
    useEffect(() => {
        if (detectedMessageTypes.size < 2 && messageTypeFilter !== null) {
            setMessageTypeFilter(null); // Reset to "ALL" when filter disappears
        }
    }, [detectedMessageTypes.size, messageTypeFilter]);

    // Initialize TensorFlow.js with WebGL backend
    useEffect(() => {
        // Log browser compatibility warnings
        logCompatibilityWarnings();

        const initTensorFlow = async () => {
            try {
                // Check WebGL support before attempting to use it
                if (checkFeatureSupport('webgl')) {
                    await tf.setBackend('webgl');
                    await tf.ready();
                    console.log('[TensorFlow] Backend initialized:', tf.getBackend());
                    console.log('[TensorFlow] WebGL enabled - 5-10x faster inference');
                } else {
                    console.warn('[TensorFlow] WebGL not supported, using CPU backend');
                    await tf.setBackend('cpu');
                    await tf.ready();
                }
            } catch (e) {
                console.warn('[TensorFlow] Failed to initialize WebGL, falling back to CPU');
                console.warn('[TensorFlow] Error:', e.message);
                try {
                    await tf.setBackend('cpu');
                    await tf.ready();
                } catch (cpuError) {
                    console.error('[TensorFlow] Failed to initialize any backend:', cpuError);
                }
            }
        };
        initTensorFlow();
    }, []);

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

    /**
     * Performs a full reset when switching input sources.
     * Clears all training data, features, and resets UI state.
     */
    const performSourceSwitch = (source) => {
        setInputSource(source);
        inputManager.setSource(source);

        // Reset data state
        setIncomingData({});
        lastDataRef.current = {};
        setSelectedFeatures(new Set());
        selectedFeaturesRef.current = new Set();
        setHasSignal(false);

        // Reset message type filtering (for multi-stream devices)
        setDetectedMessageTypes(new Set());
        setMessageTypeFilter(null);

        // Clear ML engine and training data
        mlEngine.clearAll();
        setTrainingProgress(null);
        setPrediction(null);
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

        // Clear feature tracking timers
        lastSeenFeaturesRef.current.clear();
        if (featureUpdateTimerRef.current) {
            clearTimeout(featureUpdateTimerRef.current);
            featureUpdateTimerRef.current = null;
        }
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
                                const clsName = classesRef.current.find(c => c.id === result.label)?.name || result.label;
                                window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [result.label, clsName]);
                            }
                            // Broadcast via WebSocket
                            if (window.api && window.api.ws) {
                                window.api.ws.broadcast('prediction', {
                                    ...result,
                                    labelName: classesRef.current.find(c => c.id === result.label)?.name || result.label,
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
            // Detection phase: average absolute signal across selected features
            const activeFeatures = Array.from(selectedFeaturesRef.current);
            if (activeFeatures.length === 0) return;

            const sumAbs = activeFeatures.reduce((sum, key) => sum + Math.abs(data[key] || 0), 0);
            const signalStrength = sumAbs / activeFeatures.length;

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
            // Auto-detect message types for dynamic filtering (multi-stream devices like Muse 2)
            if (data.type) {
                setDetectedMessageTypes(prev => {
                    if (!prev.has(data.type)) {
                        return new Set([...prev, data.type]);
                    }
                    return prev;
                });
            }

            // Filter by message type if user has selected one
            if (messageTypeFilterRef.current && data.type && data.type !== messageTypeFilterRef.current) {
                return;
            }

            // Update refs immediately (real-time for predictions/training)
            lastDataRef.current = data;
            lastDataTimeRef.current = Date.now();

            // Throttle UI state updates to ~30fps to prevent lag
            const now = Date.now();
            if (now - lastUIUpdateRef.current >= uiUpdateIntervalMs) {
                lastUIUpdateRef.current = now;
                setIncomingData(data);
            }

            // Gesture Auto-Capture Logic
            if (trainingConfigRef.current.autoCapture && recordingClassIdRef.current) {
                handleAutoCapture(data);
            }

            // Track currently streaming features (for real-time detection)
            const featureCheckTime = Date.now();
            const numericKeys = Object.keys(data).filter(k => typeof data[k] === 'number');

            // Update last seen timestamp for each active feature
            numericKeys.forEach(key => {
                lastSeenFeaturesRef.current.set(key, featureCheckTime);
            });

            // Auto-populate features if empty (Startup or Source Switch)
            if (Object.keys(data).length > 0 && selectedFeaturesRef.current.size === 0) {
                if (numericKeys.length > 0) {
                    const newSet = new Set(numericKeys);
                    setSelectedFeatures(newSet);
                    selectedFeaturesRef.current = newSet;
                }
            }


            // Debounced feature cleanup: Remove inactive sensors after grace period
            // Only check every 2 seconds to avoid excessive updates
            if (featureUpdateTimerRef.current) {
                clearTimeout(featureUpdateTimerRef.current);
            }

            featureUpdateTimerRef.current = setTimeout(() => {
                if (selectedFeaturesRef.current.size > 0) {
                    const currentFeatures = Array.from(selectedFeaturesRef.current);
                    const checkTime = Date.now();

                    // Only keep features seen within grace period
                    const activeFeatures = currentFeatures.filter(f => {
                        const lastSeen = lastSeenFeaturesRef.current.get(f);
                        return lastSeen && (checkTime - lastSeen < FEATURE_DETECTION.GRACE_PERIOD_MS);
                    });

                    // Only update if features actually changed
                    if (activeFeatures.length !== currentFeatures.length && activeFeatures.length > 0) {
                        const updatedSet = new Set(activeFeatures);
                        setSelectedFeatures(updatedSet);
                        selectedFeaturesRef.current = updatedSet;
                    }
                }
            }, FEATURE_DETECTION.UPDATE_CHECK_INTERVAL_MS);


            // Predict (Only if Running)
            if (!isRunningRef.current) {
                if (prediction) setPrediction(null);
                return;
            }

            // Skip continuous prediction for gesture mode (IMU data only)
            // Webcam and image data continue predicting every frame
            const isGestureInput = inputSourceRef.current !== 'webcam' && inputSourceRef.current !== 'upload';
            if (trainingConfigRef.current.gesturePredictionMode && isGestureInput) {
                return; // Don't predict on every frame for IMU - only on gesture completion
            }

            const features = Array.from(selectedFeaturesRef.current);
            const currentMode = trainingModeRef.current;

            if (currentMode === 'classification') {
                try {
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
                        setLastError(null);
                        if (window.api && window.api.osc && result.label) {
                            const clsName = classesRef.current.find(c => c.id === result.label)?.name || result.label;
                            window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [result.label, clsName]);
                        }
                        if (window.api && window.api.ws) {
                            window.api.ws.broadcast('prediction', {
                                ...result,
                                labelName: classesRef.current.find(c => c.id === result.label)?.name || result.label,
                                protocol: protocolRef.current,
                                deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null,
                                serialFormat: protocolRef.current === 'serial' ? serialFormatRef.current : null
                            });
                        }
                    } else if (mlEngine.lastError) {
                        setLastError(mlEngine.lastError);
                    }
                } else {
                    // KNN Prediction
                    // Don't pre-check getNumClasses() here — the classifier may be
                    // lazily rebuilt inside predictClassification. Let the method handle it.
                    const result = await mlEngine.predictClassification(data, features);
                    if (result) {
                        setPrediction(result);
                        setLastError(null);

                        // Broadcast Classification (OSC)
                        if (window.api && window.api.osc && result.label) {
                            const clsName = classesRef.current.find(c => c.id === result.label)?.name || result.label;
                            window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [result.label, clsName]);
                        }
                        if (window.api && window.api.ws) {
                            window.api.ws.broadcast('prediction', {
                                ...result,
                                labelName: classesRef.current.find(c => c.id === result.label)?.name || result.label,
                                protocol: protocolRef.current,
                                deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null,
                                serialFormat: protocolRef.current === 'serial' ? serialFormatRef.current : null
                            });
                        }
                    }
                }
                } catch (err) {
                    console.error("Classification prediction error:", err);
                }
            } else {
                // Regression Prediction
                try {
                    // Use DNN prediction if model is trained and engine is dense, else KNN
                    const useDNN = engineTypeRef.current === 'dense' && mlEngine.denseModel && mlEngine.denseModelType === 'regression';
                    const result = useDNN
                        ? await mlEngine.predictDense(data, features)
                        : await mlEngine.predictRegression(data, features);

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
                                labelName: 'regression',
                                protocol: protocolRef.current,
                                deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null,
                                serialFormat: protocolRef.current === 'serial' ? serialFormatRef.current : null
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


        return () => {
            inputManager.disconnect();
            // Cleanup feature update timer
            if (featureUpdateTimerRef.current) {
                clearTimeout(featureUpdateTimerRef.current);
            }
        };
    }, []); // Stable listener, no re-binding needed

    const toggleFeature = (key) => {
        setSelectedFeatures(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // Handle Training
    const trainFrame = (id, targetValue = null) => {
        if (lastError) setLastError(null); // Clear error on new action

        // Check for stale data (older than 2 seconds)
        const isStale = (Date.now() - lastDataTimeRef.current) > 2000;

        // Exception: 'upload' source is static, never stale
        if (inputSource !== 'upload' && isStale) {
            console.warn('[App] trainFrame ignored: Data is stale (No signal)');
            return;
        }

        if (Object.keys(lastDataRef.current).length === 0) {
            console.warn('[App] trainFrame ignored: No incoming data in lastDataRef');
            return;
        }

        const features = Array.from(selectedFeatures);
        const thumbnail = inputSource === 'webcam' ? webcamManager.getScreenshot() : null;

        if (trainingMode === 'classification') {
            if (engineType === 'dense') {
                // Use gesture mode from training config, or auto-detect
                let dataType = 'auto';
                if (inputSource === 'webcam' || inputSource === 'upload') {
                    dataType = 'image';
                } else if (trainingConfig.gestureMode) {
                    dataType = 'imu'; // Gesture mode = IMU normalization
                }
                mlEngine.addDenseExample(lastDataRef.current, id, features, thumbnail, dataType);
                // Track counts manually for dense data (array-based storage)
                setClasses(prev => prev.map(c => c.id === id ? { ...c, count: c.count + 1 } : c));
            } else {
                mlEngine.addClassificationExample(lastDataRef.current, id, features, thumbnail);
                // Update counts from KNN classifier
                const counts = mlEngine.getClassCounts();
                setClasses(prev => prev.map(c => ({
                    ...c,
                    count: counts[c.id] || 0
                })));
            }
        } else if (trainingMode === 'regression') {
            // For regression, 'id' is the output ID and 'targetValue' is the float value
            if (targetValue === null) return;

            mlEngine.addRegressionExample(lastDataRef.current, id, targetValue, features, thumbnail);

            // Update counts
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
        const newClass = {
            id: `class_${Date.now()}`,
            name: `Class ${classes.length + 1}`,
            count: 0
        };
        setClasses(prev => [...prev, newClass]);
    };

    const removeClass = (id) => {
        // Remove from UI
        setClasses(prev => prev.filter(c => c.id !== id));

        // Remove all data for this class from MLEngine
        mlEngine.clearClassData(id);
    };

    const renameClass = (id, newName) => {
        // Validate class name
        const validation = validateClassName(newName);
        if (!validation.valid) {
            // Invalid name - component will revert to previous
            return;
        }

        // Sanitize input to prevent XSS
        const sanitized = sanitizeInput(newName);

        // Update UI state only - dataset uses IDs, not names
        setClasses(prev => prev.map(c =>
            c.id === id ? { ...c, name: sanitized } : c
        ));
        // No need to update MLEngine - dataset always uses class IDs
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

        // Remove all regression data for this output from MLEngine
        mlEngine.clearClassData(id);
    };

    const updateOutputTarget = (id, val) => {
        setOutputs(prev => prev.map(o => o.id === id ? { ...o, value: val } : o));
    };

    // --- Guarded Mode & Engine Switching ---
    // Switching classification<->regression is destructive: class data isn't meaningful
    // as regression data and vice versa. Warn and clear if data exists.
    const handleSetTrainingMode = (newMode) => {
        if (newMode === trainingMode) return;

        const hasData = classes.some(c => c.count > 0) || outputs.some(o => (o.samples || 0) > 0);
        const hasModel = trainingProgress !== null || mlEngine.denseModel !== null;

        if (hasData || hasModel) {
            const modeLabel = newMode === 'classification' ? 'Classification' : 'Regression';
            setConfirmModal({
                open: true,
                title: 'Switch Mode?',
                message: (
                    <>
                        <p className="text-sm text-zinc-400 leading-relaxed">
                            Switching to <span className="text-white font-medium">{modeLabel}</span> mode will <span className="text-amber-500 font-semibold">clear all training data</span> and models.
                        </p>
                        <p className="text-sm text-zinc-500 mt-3">
                            Any unsaved work will be lost.
                        </p>
                    </>
                ),
                confirmLabel: 'Switch Mode',
                confirmColor: 'amber',
                onConfirm: () => {
                    setConfirmModal({ open: false, title: '', message: '', onConfirm: null });
                    setTrainingMode(newMode);
                    clearModel();
                }
            });
            return;
        }
        setTrainingMode(newMode);
    };

    // Switching KNN<->Dense while running or with a trained DNN model needs care.
    const handleSetEngineType = (newEngine) => {
        if (newEngine === engineType) return;

        const hasTrainedDNN = mlEngine.denseModel !== null;

        if (hasTrainedDNN || isRunning) {
            setConfirmModal({
                open: true,
                title: 'Switch Engine?',
                message: newEngine === 'knn' ? (
                    <>
                        <p className="text-sm text-zinc-400 leading-relaxed">
                            Switching to KNN will <span className="text-amber-500 font-semibold">discard your trained neural network</span>.
                        </p>
                        <p className="text-sm text-zinc-500 mt-3">
                            Your recorded data will be kept for KNN prediction.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-sm text-zinc-400 leading-relaxed">
                            Switching to <span className="text-white font-medium">Dense Neural Network</span>.
                        </p>
                        <p className="text-sm text-zinc-500 mt-3">
                            You will need to <span className="text-white font-medium">train the model</span> before running inference.
                        </p>
                    </>
                ),
                confirmLabel: 'Switch Engine',
                confirmColor: 'amber',
                onConfirm: () => {
                    setConfirmModal({ open: false, title: '', message: '', onConfirm: null });
                    // Stop running when switching engines
                    if (isRunning) setIsRunning(false);
                    // Dispose the DNN model (data is kept in denseData)
                    if (mlEngine.denseModel) {
                        mlEngine.denseModel.dispose();
                        mlEngine.denseModel = null;
                    }
                    mlEngine.denseModelType = null;
                    setTrainingProgress(null);
                    setPrediction(null);
                    setEngineType(newEngine);
                    // For KNN: mark dirty so data gets properly rebuilt on next predict
                    if (newEngine === 'knn') {
                        mlEngine.knnDirty = true;
                    }
                }
            });
            return;
        }
        setEngineType(newEngine);
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

            // Update UI with features
            setIncomingData(features);
            lastDataRef.current = features;
            lastDataTimeRef.current = Date.now();

            // Run Prediction
            if (engineType === 'dense') {
                // Image upload - data is already normalized
                const res = await mlEngine.predictDense(features, Object.keys(features), 'image');

                if (res) {
                    setPrediction(res);
                    const labelName = res.label
                        ? (classes.find(c => c.id === res.label)?.name || res.label)
                        : null;

                    // Broadcast (OSC)
                    if (window.api && window.api.osc && res.label) {
                        window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [res.label, labelName]);
                    }

                    // Broadcast (WS/Serial)
                    if (window.api && window.api.ws) {
                        window.api.ws.broadcast('prediction', {
                            ...res,
                            labelName: labelName,
                            protocol: protocolRef.current,
                            deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null,
                            serialFormat: protocolRef.current === 'serial' ? serialFormatRef.current : null
                        });
                    }
                }
            } else {
                let res;
                const featureKeys = selectedFeatures.size > 0
                    ? Array.from(selectedFeatures)
                    : Object.keys(features);
                if (trainingMode === 'classification') {
                    res = await mlEngine.predictClassification(features, featureKeys);
                } else {
                    res = await mlEngine.predictRegression(features, featureKeys);
                }
                // Add labelName for Consistent Output
                if (res) {
                    setPrediction(res);
                    const labelName = trainingMode === 'classification' && res.label
                        ? (classes.find(c => c.id === res.label)?.name || res.label)
                        : null;

                    // Broadcast (OSC)
                    if (window.api && window.api.osc) {
                        if (res.label) {
                            window.api.osc.send('127.0.0.1', 12000, '/ml/classification', [res.label, labelName]);
                        } else if (res.regression) {
                            Object.entries(res.regression).forEach(([id, val]) => {
                                window.api.osc.send('127.0.0.1', 12000, '/ml/regression', [id, val]);
                            });
                        }
                    }

                    // Broadcast (WS/Serial)
                    if (window.api && window.api.ws) {
                        window.api.ws.broadcast('prediction', {
                            ...res,
                            labelName: labelName,
                            protocol: protocolRef.current,
                            deviceId: protocolRef.current === 'serial' ? targetDeviceIdRef.current : null,
                            serialFormat: protocolRef.current === 'serial' ? serialFormatRef.current : null
                        });
                    }
                }
            }

        } catch (e) {
            console.error("Test Prediction Failed:", e);
        }
    };

    // --- Dense Model Handlers ---
    const handleTrainModel = async () => {
        if (engineType !== 'dense') return;

        // Stop inference during training to prevent garbage predictions
        // from a partially-trained model (weights change every epoch)
        const wasRunning = isRunning;
        if (isRunning) setIsRunning(false);

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
            // Re-enable inference if it was running before training
            if (wasRunning) setIsRunning(true);
            // Keep trainingProgress if training succeeded to show "RETRAIN"
        }
    };

    // --- Data Import/Export Handlers ---
    const handleSaveData = async () => {
        try {
            // Create map for ID -> Name resolution
            const classNameMap = classes.reduce((acc, cls) => {
                acc[cls.id] = cls.name;
                return acc;
            }, {});

            const data = mlEngine.exportData(classNameMap);
            const jsonString = JSON.stringify(data, null, 2);

            if (window.api && window.api.file) {
                const result = await window.api.file.saveDataset(jsonString);
                if (result.success) {
                    console.log('[App] Dataset saved successfully:', result.filePath);
                    return { success: true, filePath: result.filePath };
                } else if (!result.canceled) {
                    console.error('[App] Failed to save dataset:', result.error);
                    setLastError('Failed to save dataset: ' + (result.error || 'Unknown error'));
                    return { success: false, error: result.error };
                }
                return { success: false, canceled: true };
            } else {
                const error = 'File API not available. Are you running in Electron?';
                console.error('[App]', error);
                setLastError(error);
                return { success: false, error };
            }
        } catch (e) {
            console.error('[App] Save error:', e);
            setLastError('Failed to save dataset: ' + e.message);
            return { success: false, error: e.message };
        }
    };

    // --- Arduino Export Handler ---
    const handleExportArduino = async () => {
        try {
            // Create map for ID -> Name resolution
            const classNameMap = classes.reduce((acc, cls) => {
                acc[cls.id] = cls.name;
                return acc;
            }, {});

            console.log('[App] Exporting for Arduino Check...');
            await mlEngine.exportModelArduino(classNameMap);
        } catch (e) {
            console.error('[App] Arduino export failed:', e);
            setLastError(e.message || "Arduino export failed");
        }
    };

    const handleLoadData = async () => {
        try {
            if (window.api && window.api.file) {
                const result = await window.api.file.loadDataset();

                if (result.canceled) {
                    return { success: false, canceled: true };
                }

                if (result.success && result.content) {
                    // Show loading state for large datasets
                    setIsTraining(true);

                    // Use setTimeout to allow UI to update before heavy processing
                    return new Promise((resolve) => {
                        setTimeout(() => {
                            try {
                                const data = JSON.parse(result.content);
                                const imported = mlEngine.importData(data);

                                if (imported) {
                                    const metadata = mlEngine.getImportedMetadata();
                                    const classNameMap = metadata.classNames || {};

                                    const classCounts = mlEngine.getClassCounts();
                                    const regCounts = mlEngine.getRegressionCounts();

                                    const loadedClassIds = Object.keys(classCounts);
                                    const newClasses = loadedClassIds.map(classId => ({
                                        id: classId,
                                        name: classNameMap[classId] || classId,
                                        count: classCounts[classId] || 0
                                    }));

                                    setClasses(newClasses.filter(c => c.count > 0));

                                    const loadedOutputIds = Object.keys(regCounts);
                                    const newOutputs = loadedOutputIds.map(outputId => {
                                        const existing = outputs.find(o => o.id === outputId);
                                        return {
                                            id: outputId,
                                            name: existing?.name || outputId,
                                            value: existing?.value || 0.5,
                                            samples: regCounts[outputId] || 0
                                        };
                                    });

                                    setOutputs(newOutputs.filter(o => o.samples > 0));

                                    // Auto-detect training mode from imported data
                                    const hasClassData = Object.keys(classCounts).length > 0;
                                    const hasRegData = Object.keys(regCounts).length > 0;
                                    if (hasRegData && !hasClassData) {
                                        setTrainingMode('regression');
                                    } else {
                                        setTrainingMode('classification');
                                    }

                                    setPrediction(null);
                                    setTrainingProgress(null);
                                    setIsRunning(false);
                                    setIsTraining(false);

                                    console.log('[App] Dataset loaded:', newClasses.length, 'classes');
                                    resolve({ success: true });
                                } else {
                                    setIsTraining(false);
                                    const error = 'Failed to import. File may be corrupted.';
                                    setLastError(error);
                                    resolve({ success: false, error });
                                }
                            } catch (parseError) {
                                setIsTraining(false);
                                console.error('[App] Parse error:', parseError);
                                const error = 'Failed to parse dataset file.';
                                setLastError(error);
                                resolve({ success: false, error });
                            }
                        }, 50);
                    });
                } else {
                    console.error('[App] Failed to load dataset:', result.error);
                    const error = 'Failed to load dataset: ' + (result.error || 'Unknown error');
                    setLastError(error);
                    return { success: false, error };
                }
            } else {
                const error = 'File API not available. Are you running in Electron?';
                setLastError(error);
                return { success: false, error };
            }
        } catch (e) {
            console.error('[App] Load error:', e);
            setLastError('Failed to load dataset: ' + e.message);
            return { success: false, error: e.message };
        }
    };


    return (
        <div className="h-screen w-screen overflow-hidden bg-[#050505]">
            <ErrorBoundary>
                <ConceptDashboard
                    hasSignal={hasSignal}
                    classes={classes}
                    setClasses={setClasses}
                    outputs={outputs}
                    setOutputs={setOutputs}
                    prediction={prediction}
                    isRunning={isRunning}
                    setIsRunning={setIsRunning}
                    trainingMode={trainingMode}
                    setTrainingMode={handleSetTrainingMode}
                    engineType={engineType}
                    setEngineType={handleSetEngineType}
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
                    messageTypeFilter={messageTypeFilter}
                    setMessageTypeFilter={setMessageTypeFilter}
                    detectedMessageTypes={detectedMessageTypes}
                    mlEngine={mlEngine} // Pass singleton to avoid import issues in children
                    connectionStatus={connectionStatus}
                    lastError={lastError}
                />
            </ErrorBoundary>

            {/* Source Change Confirmation Modal */}
            <ConfirmModal
                isOpen={showSourceChangeModal}
                title="Switch Input Source?"
                message={
                    <>
                        <p className="text-sm text-zinc-400 leading-relaxed">
                            Switching input source will <span className="text-amber-500 font-semibold">clear all training data</span> and models.
                        </p>
                        <p className="text-sm text-zinc-500 mt-3">
                            Any unsaved work will be lost.
                        </p>
                    </>
                }
                confirmLabel="Switch"
                confirmColor="amber"
                onConfirm={handleConfirmSourceChange}
                onCancel={handleCancelSourceChange}
            />

            {/* Generic Confirmation Modal (mode/engine switch, destructive actions) */}
            <ConfirmModal
                isOpen={confirmModal.open}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmLabel={confirmModal.confirmLabel}
                confirmColor={confirmModal.confirmColor}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal({ open: false, title: '', message: '', onConfirm: null })}
            />
        </div>
    );
}

export default App;
