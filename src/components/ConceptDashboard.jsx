import React, { useState, useEffect, useRef } from 'react';
import {
    Activity, Network, Zap, Layout, LayoutGrid,
    Terminal, Play, Square,
    ChevronDown, Box, Download, Target,
    Cable, Plus, Trash2, Settings,
    Cpu, Layers, Search, Keyboard,
    Save, FolderOpen, RotateCcw,
    Wifi, Video, Monitor,
    Database, Send, History, Image // Imported new icons
} from 'lucide-react';
import { Visualizer } from './Visualizer'; // Import reusable Visualizer
import { WebcamPreview } from './WebcamPreview';
import { DataView } from './DataView'; // Import new Data Tab View

import { DeployView } from './DeployView'; // Import Deploy/Monitor View

/* --- UTILITIES --- */

function ConnectionBadge({ status }) {
    const isConnected = status?.connected;
    return (
        <div className={`px-2 py-1 rounded border flex items-center gap-2 transition-colors ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
            <span className={`text-[10px] font-mono uppercase ${isConnected ? 'text-emerald-500' : 'text-red-500'}`}>
                {isConnected ? 'LINKED' : 'OFFLINE'}
            </span>
        </div>
    )
}

function StatMetric({ label, value, unit, active }) {
    return (
        <div className="flex flex-col">
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-0.5">{label}</span>
            <div className="flex items-baseline gap-1">
                <span className={`text-lg font-mono ${active ? 'text-emerald-400' : 'text-zinc-200'}`}>{value}</span>
                {unit && <span className="text-xs text-zinc-600 font-mono">{unit}</span>}
            </div>
        </div>
    )
}

/* --- SUB-COMPONENTS --- */

function FeatureRow({ label, value, active, color, onClick }) {
    return (
        <div
            onClick={onClick}
            className={`flex items-center justify-between p-2 rounded border cursor-pointer transition-all ${active ? 'bg-white/[0.05] border-zinc-700' : 'bg-transparent border-transparent hover:bg-white/[0.02]'}`}
        >
            <span className={`text-xs font-mono transition-colors ${active ? 'text-zinc-200' : 'text-zinc-500'}`}>{label}</span>
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-600 font-mono">{typeof value === 'number' ? value.toFixed(2) : '0.00'}</span>
                <div
                    className={`w-1.5 h-1.5 rounded-full transition-all ${active ? '' : 'bg-zinc-800'}`}
                    style={active ? { backgroundColor: color, boxShadow: `0 0 10px ${color}` } : {}}
                ></div>
            </div>
        </div>
    )
}

function ClassCard({ cls, prediction, onTrain, onRemove, onRename, engineType, onUpload, inputSource }) {
    const isPredicted = prediction?.label === cls.id;
    const confidence = prediction?.confidences?.[cls.id] || 0;
    const [isRecording, setIsRecording] = useState(false);
    const intervalRef = useRef(null);
    const isUploadMode = inputSource === 'upload';

    // File Input Ref
    const fileInputRef = useRef(null);

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0 && onUpload) {
            Array.from(e.target.files).forEach(file => onUpload(cls.id, file));
        }
    };

    // Keep ref to onTrain to avoid stale closures in setInterval
    const onTrainRef = useRef(onTrain);
    useEffect(() => {
        onTrainRef.current = onTrain;
    }, [onTrain]);

    const startRecording = () => {
        setIsRecording(true);
        // console.log('[ClassCard] Start recording/training for:', cls.id);

        // Execute immediately
        if (onTrainRef.current) onTrainRef.current();

        // Start interval using valid ref
        intervalRef.current = setInterval(() => {
            if (onTrainRef.current) onTrainRef.current();
        }, 100);
    };

    const stopRecording = () => {
        setIsRecording(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
    };

    const [isDragOver, setIsDragOver] = useState(false);

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (onUpload && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => onUpload(cls.id, file));
        }
    };

    return (
        <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={`
            relative group p-4 rounded-xl border transition-all h-full flex flex-col justify-between
             ${isDragOver ? 'border-emerald-500 bg-emerald-500/10 scale-[1.02] shadow-xl z-10' : ''}
            ${isPredicted ? 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)] bg-[#0C0C0C]' : 'border-zinc-800 bg-[#0A0A0A] hover:border-zinc-700'}
        `}>
            {/* Active Indicator Top Border */}
            {isPredicted && <div className="absolute top-0 left-0 w-full h-[1px] bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>}

            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isPredicted ? 'bg-emerald-500' : 'bg-zinc-700'}`}></div>
                    <input
                        className="bg-transparent border-none text-xs font-bold text-zinc-300 focus:text-white focus:outline-none placeholder-zinc-700 uppercase tracking-wider w-full"
                        value={cls.name}
                        onChange={(e) => onRename(e.target.value)}
                    />
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-500 transition-all"
                >
                    <Trash2 size={12} />
                </button>
            </div>

            {isUploadMode && (
                <div className="flex-1 overflow-y-auto mb-4 min-h-[100px] custom-scrollbar rounded bg-black/20 p-2 border border-white/5">
                    {cls.thumbnails && cls.thumbnails.length > 0 ? (
                        <div className="grid grid-cols-5 gap-2">
                            {cls.thumbnails.map((src, i) => (
                                <div key={i} className="aspect-square rounded bg-zinc-800 overflow-hidden relative group/thumb border border-white/10">
                                    <img src={src} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-zinc-600 text-[10px] italic flex-col gap-2">
                            <>
                                <Image size={16} className="opacity-50" />
                                <span>Drag & Drop Images</span>
                            </>
                        </div>
                    )}
                </div>
            )}
            {!isUploadMode && <div className="flex-1" />}

            {/* Info Bar */}
            <div className="flex justify-between items-center mb-4 px-1">
                <div>
                    <span className="text-[10px] text-zinc-500 font-mono uppercase">Count</span>
                    <div className="text-xl font-mono text-zinc-200 leading-none">{cls.count}</div>
                </div>
                {isPredicted && (
                    <div className="text-right">
                        <span className="text-[10px] text-emerald-500 font-mono uppercase">Confidence</span>
                        <div className="text-xl font-mono text-emerald-400 leading-none">{(confidence * 100).toFixed(1)}%</div>
                    </div>
                )}
            </div>

            {isUploadMode ? (
                <>
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        multiple
                        onChange={handleFileSelect}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-4 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-500 hover:bg-zinc-700 transition-all text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 relative overflow-hidden group/btn"
                    >
                        <Image size={14} className="group-hover/btn:scale-110 transition-transform" />
                        <span>Upload Images</span>
                        {isDragOver && <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold backdrop-blur-sm">DROP TO ADD</div>}
                    </button>
                </>
            ) : (
                <button
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    className={`
                            w-full py-2 text-[10px] font-bold uppercase tracking-widest rounded border transition-all select-none
                            ${isRecording
                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600'
                        }
                        `}
                >
                    {isRecording ? 'RECORDING' : (engineType === 'dense' ? 'HOLD TO REC' : 'HOLD TO TRAIN')}
                </button>
            )}
        </div>
    )
}

function RegressionCard({ output, prediction, onTrain, onRemove, onUpdateTarget, onUpload, inputSource }) {
    const [isRecording, setIsRecording] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false); // New: Drag & Drop State
    const predictedValue = prediction?.regression?.[output.id];
    const hasPrediction = predictedValue !== undefined && predictedValue !== null;
    const isUploadMode = inputSource === 'upload';
    const fileInputRef = useRef(null);

    const intervalRef = useRef(null);

    // Keep refs for closure stability
    const onTrainRef = useRef(onTrain);
    const outputRef = useRef(output);

    useEffect(() => {
        onTrainRef.current = onTrain;
        outputRef.current = output;
    }, [onTrain, output]);

    const startRecording = () => {
        setIsRecording(true);
        // Execute immediately
        if (onTrainRef.current) onTrainRef.current(outputRef.current.id, outputRef.current.value);

        intervalRef.current = setInterval(() => {
            if (onTrainRef.current) {
                onTrainRef.current(outputRef.current.id, outputRef.current.value);
            }
        }, 50);
    };

    const stopRecording = () => {
        setIsRecording(false);
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    return (
        <div
            className={`group relative bg-[#0A0A0A] border rounded-xl p-5 transition-all
                ${isDragOver ? 'border-emerald-500 bg-emerald-500/10 scale-[1.02] shadow-xl z-10' : 'border-zinc-800 hover:border-zinc-700'}
             `}
            onDragOver={(e) => {
                if (isUploadMode) {
                    e.preventDefault();
                    setIsDragOver(true);
                }
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
                if (isUploadMode) {
                    e.preventDefault();
                    setIsDragOver(false);
                    Array.from(e.dataTransfer.files).forEach(file => onUpload(output.id, file, output.value));
                }
            }}
        >
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{output.name}</span>
                    {hasPrediction && (
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded font-mono border border-emerald-500/20">
                            LIVE: {predictedValue.toFixed(2)}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="text-[10px] text-zinc-600 font-mono">
                        SAMPLES: <span className="text-zinc-400">{output.samples || 0}</span>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-500 transition-all"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                {/* Visual Feedback Bar */}
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden relative">
                    {hasPrediction && (
                        <div
                            className="absolute top-0 bottom-0 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-75"
                            style={{ left: `${predictedValue * 100}%`, width: '4px', transform: 'translateX(-50%)' }}
                        />
                    )}
                    <div
                        className="absolute top-0 bottom-0 w-2 h-2 bg-white rounded-full transition-all"
                        style={{ left: `${output.value * 100}%`, transform: 'translateX(-50%)' }}
                    />
                </div>

                {/* Slider Control */}
                <input
                    type="range" min="0" max="1" step="0.01"
                    value={output.value}
                    onChange={(e) => onUpdateTarget(parseFloat(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-125 transition-all"
                />

                <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
                    <span>0.0</span>
                    <span>TARGET: {output.value.toFixed(2)}</span>
                    <span>1.0</span>
                </div>

                {/* Thumbnail Gallery (Upload Mode Only) */}
                {isUploadMode && (
                    <div className="mt-4">
                        <div className="flex-1 overflow-x-auto min-h-[60px] custom-scrollbar rounded bg-black/20 p-2 border border-white/5 flex gap-2">
                            {output.thumbnails && output.thumbnails.length > 0 ? (
                                output.thumbnails.map((thumb, i) => (
                                    <div key={i} className="h-12 w-12 flex-shrink-0 aspect-square rounded bg-zinc-800 overflow-hidden relative group/thumb border border-white/10" title={`Value: ${thumb.value}`}>
                                        <img src={thumb.src} className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                                            <span className="text-[8px] font-mono text-white">{thumb.value.toFixed(1)}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="w-full text-center text-[10px] text-zinc-600 italic py-2">
                                    Drag images here or use Upload
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {isUploadMode ? (
                    <>
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                                Array.from(e.target.files).forEach(file => onUpload(output.id, file, output.value));
                            }}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full py-2 rounded text-[10px] font-bold uppercase tracking-widest border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-500 transition-all flex items-center justify-center gap-2"
                        >
                            <Image size={12} />
                            <span>Upload for {output.value.toFixed(2)}</span>
                        </button>
                    </>
                ) : (
                    <button
                        onMouseDown={startRecording}
                        onMouseUp={stopRecording}
                        onMouseLeave={stopRecording}
                        className={`
                            w-full py-2 text-[10px] font-bold uppercase tracking-widest rounded border transition-all select-none
                            ${isRecording
                                ? 'bg-emerald-600 border-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600'
                            }
                        `}
                    >
                        {isRecording ? 'RECORDING' : 'Record Target'}
                    </button>
                )}
            </div>
        </div>
    );
}

/* --- MAIN DASHBOARD CONTAINER --- */

export function ConceptDashboard({
    classes, setClasses,
    outputs, setOutputs,
    prediction,
    isRunning, setIsRunning,
    trainingMode, setTrainingMode,
    engineType, setEngineType,
    trainFrame,
    onRemoveClass, onRenameClass, onAddClass,
    onRemoveOutput, onUpdateOutputTarget, onAddOutput,
    handleTrainModel, isModelTraining, trainingProgress, trainingConfig, setTrainingConfig,
    handleExportArduino,
    connectionStatus, incomingData,
    selectedFeatures, toggleFeature,
    clearModel,
    inputSource, setInputSource,
    onSave, onLoad,
    onDeleteSample,
    windowSize, setWindowSize,
    onUpload,
    onTestUpload,
    isCapturingAuto,
    recordingClassId,
    setRecordingClassId,
    onExportWeb,
    dataRefreshKey,
    protocol, setProtocol,
    targetDeviceId, setTargetDeviceId
}) {
    // Internal dashboard state (View switching)
    const [activeView, setActiveView] = useState('training'); // 'data' | 'training' | 'models' | 'deploy'
    const [showAdvancedTraining, setShowAdvancedTraining] = useState(false); // New: Collapse advanced settings
    const [showEmbeddings, setShowEmbeddings] = useState(false); // Toggle for showing MobileNet embeddings
    // outputProtocol removed - now managed in App.jsx and passed as props

    // Auto-switch to monitor when running - NOW switch to DEPLOY tab (Monitor moved there)
    useEffect(() => {
        if (isRunning) setActiveView('deploy');
    }, [isRunning]);

    return (
        <div className="h-full w-full bg-[#050505] text-[#EDEDED] flex flex-col font-sans selection:bg-emerald-500/30 overflow-hidden">

            {/* 1. GLOBAL HEADER */}
            <header className="h-24 border-b border-[#222] bg-[#050505] z-50" style={{ WebkitAppRegion: 'drag' }}>
                <div className="h-full flex items-end pb-6">
                    {/* Left: Logo (256px container, pl-4 aligns with sidebar ACTIVITY text) */}
                    <div className="w-64 flex items-center gap-3 text-zinc-100 font-bold tracking-tight text-sm pl-4 pr-4" style={{ WebkitAppRegion: 'no-drag' }}>
                        <Terminal size={18} className="text-zinc-400" />
                        <span className="tracking-[0.1em] font-bold">ML BRIDGE</span>
                    </div>

                    {/* Middle: Input/Engine Selectors (pl-4 aligns with DATA tab) */}
                    <div className="flex-1 flex items-center gap-6 pl-4" style={{ WebkitAppRegion: 'no-drag' }}>
                        {/* Input Source Selector */}
                        <Dropdown
                            label="INPUT"
                            icon={
                                inputSource === 'serial' ? <Cable size={12} /> :
                                    inputSource === 'webcam' ? <Video size={12} /> :
                                        inputSource === 'upload' ? <Database size={12} /> :
                                            <Wifi size={12} />
                            }
                            value={inputSource === 'serial' ? 'SERIAL BRIDGE' : inputSource.toUpperCase().replace('_', ' ')}
                            options={[
                                { label: "SERIAL BRIDGE", action: () => setInputSource('serial') },
                                { label: "WEBCAM", action: () => setInputSource('webcam') },
                                { label: "IMAGE UPLOAD", action: () => setInputSource('upload') },
                                { label: "OSC", action: () => setInputSource('osc') }
                            ]}
                        />

                        <div className="h-6 w-[1px] bg-[#222]"></div>

                        {/* Training Mode Selector (Classification / Regression) */}
                        <Dropdown
                            label="MODE"
                            icon={trainingMode === 'classification' ? <LayoutGrid size={12} /> : <Target size={12} />}
                            value={trainingMode.toUpperCase()}
                            options={[
                                { label: "CLASSIFICATION", action: () => setTrainingMode('classification') },
                                { label: "REGRESSION", action: () => setTrainingMode('regression') }
                            ]}
                        />

                        <div className="h-6 w-[1px] bg-[#222]"></div>

                        {/* Model Select */}
                        <Dropdown
                            label="ENGINE"
                            value={engineType === 'dense' ? "DENSE NEURAL NET" : "K-NEAREST NEIGHBORS"}
                            options={[
                                { label: "DENSE NEURAL NET", action: () => setEngineType('dense') },
                                { label: "K-NEAREST NEIGHBORS", action: () => setEngineType('knn') }
                            ]}
                        />
                    </div>

                    {/* Right: Save/Export/Connection */}
                    <div className="flex items-center gap-4 px-4" style={{ WebkitAppRegion: 'no-drag' }}>
                        {/* File Menu */}
                        <div className="flex-1" /> {/* Spacer to push ConnectionBadge to right if needed, or just let flex handle it. The original code had flex items-center gap-4.  */}

                        <ConnectionBadge status={connectionStatus} />
                    </div>
                </div>
            </header>


            {/* 2. MAIN WORKSPACE */}
            <div className="flex-1 flex overflow-hidden">

                {/* LEFT SIDEBAR: INPUT & FEATURES */}
                <aside className="w-64 border-r border-[#222] bg-[#080808] flex flex-col z-20">
                    <div className="p-4 border-b border-[#222]">
                        <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest mb-3 flex items-center gap-2">
                            Activity
                        </div>

                        {/* INPUT PREVIEW */}
                        {inputSource === 'webcam' ? (
                            <div className="h-32 bg-black border border-[#222] rounded overflow-hidden relative">
                                <WebcamPreview />
                            </div>
                        ) : inputSource === 'upload' ? (
                            <div className="h-32 bg-black border border-[#222] border-dashed rounded flex flex-col items-center justify-center relative hover:bg-zinc-900 transition-colors group cursor-pointer"
                                onClick={() => document.getElementById('test-upload-input').click()}
                            >
                                <input
                                    id="test-upload-input"
                                    type="file"
                                    className="hidden"
                                    accept="image/*"
                                    onChange={(e) => {
                                        if (e.target.files?.[0] && onTestUpload) onTestUpload(e.target.files[0]);
                                    }}
                                />
                                <div className="flex flex-col items-center gap-2 text-zinc-500 group-hover:text-zinc-300">
                                    <Database size={20} />
                                    <span className="text-[10px] font-bold uppercase tracking-widest">Test Image</span>
                                </div>
                            </div>
                        ) : (
                            /* Mini Sparkline Visualization */
                            <div className="h-32 bg-black border border-[#222] rounded flex items-end gap-[1px] p-2 mb-2 opacity-80 overflow-hidden">
                                <Visualizer data={incomingData} selectedFeatures={selectedFeatures} width={220} height={124} />
                            </div>
                        )}

                    </div>

                    <div className="flex-1 overflow-y-auto p-3">
                        <div className="px-2 py-2 text-[10px] uppercase font-bold text-zinc-500 tracking-widest flex items-center justify-between">
                            <span>Input Features</span>
                            {inputSource === 'webcam' && Object.keys(incomingData).some(k => k.startsWith('f') && /^f\d+$/.test(k)) && (
                                <button
                                    onClick={() => setShowEmbeddings(!showEmbeddings)}
                                    className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                                >
                                    {showEmbeddings ? 'Hide' : 'Show'} Embeddings
                                </button>
                            )}
                        </div>
                        <div className="space-y-1">
                            {(() => {
                                // Replicate Visualizer logic to determine shared colors
                                const keys = Array.from(selectedFeatures || []).length > 0
                                    ? Array.from(selectedFeatures)
                                    : Object.keys(incomingData || {}).filter(k => typeof incomingData[k] === 'number');

                                // Technical palette (matching Visualizer.jsx)
                                const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

                                // Filter out MobileNet features if webcam and embeddings hidden
                                const shouldHideEmbeddings = inputSource === 'webcam' && !showEmbeddings;
                                const entries = Object.entries(incomingData).filter(([key]) => {
                                    if (shouldHideEmbeddings && key.startsWith('f') && /^f\d+$/.test(key)) {
                                        return false; // Hide f0, f1, ... f1023
                                    }
                                    return true;
                                });

                                return entries.map(([key, val]) => {
                                    const index = keys.indexOf(key);
                                    const isActive = selectedFeatures?.has(key);
                                    const color = index !== -1 ? colors[index % colors.length] : '#888';

                                    return (
                                        <FeatureRow
                                            key={key}
                                            label={key}
                                            value={val}
                                            active={isActive}
                                            color={color}
                                            onClick={() => toggleFeature(key)}
                                        />
                                    );
                                });
                            })()}
                            {Object.keys(incomingData || {}).length === 0 && (
                                <div className="text-xs text-zinc-600 p-4 text-center italic">Waiting for Signal...</div>
                            )}
                        </div>
                    </div>
                </aside>


                {/* CENTER STAGE */}
                <main className="flex-1 flex flex-col bg-[#050505] relative">

                    {/* View Tabs */}
                    <div className="h-10 border-b border-[#222] bg-[#0A0A0A] px-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            {[
                                { id: 'data', label: 'Data', icon: <Database size={10} /> },
                                { id: 'training', label: 'Training', icon: <Layers size={10} /> },

                                { id: 'deploy', label: 'Deploy', icon: <Send size={10} /> }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveView(tab.id)}
                                    className={`h-full border-b-2 text-xs font-bold uppercase tracking-wider px-2 transition-colors flex items-center gap-2 ${activeView === tab.id ? 'border-emerald-500 text-white' : 'border-transparent text-zinc-600 hover:text-zinc-400'}`}
                                >
                                    {tab.icon}
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                    </div>

                    {/* View Content */}
                    <div className="flex-1 p-6 overflow-y-auto bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:20px_20px]">

                        {/* DATA TAB (New) */}
                        {activeView === 'data' && (
                            <DataView
                                onLoad={onLoad}
                                onSave={onSave}
                                onDeleteSample={onDeleteSample}
                                key={dataRefreshKey}
                            />
                        )}

                        {/* TRAINING VIEW (Existing) */}
                        {activeView === 'training' && (
                            <div className="h-full">
                                {trainingMode === 'classification' ? (
                                    <div className={`grid gap-4 pb-20 animate-in fade-in slide-in-from-bottom-2 ${inputSource === 'upload' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                                        {classes.map(cls => (
                                            <ClassCard
                                                key={cls.id}
                                                cls={cls}
                                                prediction={prediction}
                                                onTrain={() => trainFrame(cls.id)}
                                                onRemove={() => onRemoveClass(cls.id)}
                                                onRename={(val) => onRenameClass(cls.id, val)}
                                                engineType={engineType}
                                                onUpload={onUpload}
                                                inputSource={inputSource}
                                            />
                                        ))}

                                        {/* Add Class Button */}
                                        <button
                                            onClick={onAddClass}
                                            className="border border-zinc-800 border-dashed rounded-xl flex flex-col items-center justify-center min-h-[160px] text-zinc-600 hover:text-white hover:bg-zinc-900 transition-all gap-2 group"
                                        >
                                            <div className="w-10 h-10 rounded-full border border-zinc-700 flex items-center justify-center bg-zinc-900 group-hover:border-zinc-500 transition-colors">
                                                <Plus size={20} />
                                            </div>
                                            <span className="text-xs font-bold uppercase tracking-wider">Add Class</span>
                                        </button>
                                    </div>
                                ) : (
                                    /* REGRESSION MODE UI */
                                    <div className="max-w-3xl mx-auto space-y-4 animate-in fade-in slide-in-from-bottom-2 pb-20">
                                        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-3 mb-6">
                                            <Activity size={16} className="text-blue-400" />
                                            <div className="text-xs text-blue-200">
                                                <span className="font-bold block uppercase tracking-wider mb-0.5">Continuous Mode Active</span>
                                                Map input sensors to continuous output values (0.0 - 1.0). Use sliders to set targets and record.
                                            </div>
                                        </div>

                                        {outputs.map(out => (
                                            <RegressionCard
                                                key={out.id}
                                                output={out}
                                                prediction={prediction}
                                                onTrain={trainFrame}
                                                onRemove={() => onRemoveOutput(out.id)}
                                                onUpdateTarget={(val) => onUpdateOutputTarget(out.id, val)}
                                                inputSource={inputSource}
                                                onUpload={onUpload}
                                            />
                                        ))}

                                        <button
                                            onClick={onAddOutput}
                                            className="w-full py-4 border border-zinc-800 border-dashed rounded-xl flex items-center justify-center text-zinc-600 hover:text-white hover:bg-zinc-900 transition-all gap-2"
                                        >
                                            <Plus size={16} />
                                            <span className="text-xs font-bold uppercase tracking-wider">Add Output Parameter</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}



                        {/* DEPLOY TAB (New - includes Monitor) */}
                        {activeView === 'deploy' && (
                            <DeployView
                                prediction={prediction}
                                incomingData={incomingData}
                                selectedFeatures={selectedFeatures}
                                isRunning={isRunning}
                                onToggleRun={() => setIsRunning(!isRunning)}
                                engineType={engineType}
                                trainingMode={trainingMode}
                                outputs={outputs}
                                isModelTraining={isModelTraining}
                                trainingProgress={trainingProgress}
                                onTrainModel={handleTrainModel}
                                onExportArduino={handleExportArduino}
                                onExportWeb={onExportWeb}
                                onClearError={() => { }}
                                onUpload={onUpload}
                                inputSource={inputSource}
                                protocol={protocol}
                                setProtocol={setProtocol}
                                targetDeviceId={targetDeviceId}
                                setTargetDeviceId={setTargetDeviceId}
                                serialFormat={serialFormat}
                                setSerialFormat={setSerialFormat}
                            />
                        )}

                    </div>
                </main>


                {/* RIGHT SIDEBAR: CONTROLS */}
                <aside className="w-72 border-l border-[#222] bg-[#080808] flex flex-col z-20">
                    {/* Training Config */}
                    <div className="p-4 border-b border-[#222]">
                        <div className="flex justify-between items-center mb-4">
                            <span className="text-[10px] uppercase font-bold text-[#444] tracking-widest">Training Config</span>
                            <button
                                onClick={() => setShowAdvancedTraining(!showAdvancedTraining)}
                                className={`text-xs p-1 rounded transition-colors ${showAdvancedTraining ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-600 hover:text-white'}`}
                                title="Toggle Advanced Settings"
                            >
                                <Settings size={12} />
                            </button>
                        </div>

                        {/* Advanced Settings (Decoupled) */}
                        {showAdvancedTraining && (
                            <div className="space-y-4 pt-2 mb-8 pb-2 border-b border-zinc-800/50 animate-in slide-in-from-top-2 fade-in">

                                {/* Gesture Mode Toggle (Serial Only) */}
                                {inputSource === 'serial' && (
                                    <div className="mb-4 pb-4 border-b border-zinc-800">
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <span className="text-[10px] text-zinc-500 font-bold tracking-wider block">GESTURE MODE</span>
                                                <span className="text-[9px] text-zinc-600 italic">For IMU gesture recognition</span>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={trainingConfig.gestureMode || false}
                                                    onChange={(e) => {
                                                        setTrainingConfig(prev => ({ ...prev, gestureMode: e.target.checked }));
                                                    }}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                                            </label>
                                        </div>
                                        <p className="text-[9px] text-zinc-600 mt-1">
                                            {trainingConfig.gestureMode
                                                ? '✓ IMU normalization enabled ([-1, 1] range). Optimized for accelerometer/gyroscope gesture data.'
                                                : 'Auto-detect normalization. Works for any sensor type (IMU, EEG, etc.)'}
                                        </p>
                                    </div>
                                )}

                                {/* Temporal Window (Serial Only) */}
                                {inputSource === 'serial' && (
                                    <div className={`border-zinc-800 ${engineType === 'dense' ? 'mb-4 pb-4 border-b' : ''}`}>
                                        <div className="flex justify-between items-baseline mb-2">
                                            <span className="text-[10px] text-zinc-500 font-bold tracking-wider">TEMPORAL WINDOW</span>
                                            <span className="text-xs font-mono text-emerald-400">{windowSize > 1 ? `${windowSize} frames` : 'Instant'}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="1" max="50" step="1"
                                            value={windowSize}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (val !== windowSize) {
                                                    const hasData = (classes.some(c => c.count > 0) || outputs.some(o => (o.samples || 0) > 0));
                                                    if (!hasData || confirm("Changing window size will clear data. Continue?")) {
                                                        setWindowSize(val);
                                                        clearModel();
                                                    }
                                                }
                                            }}
                                            className="w-full h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                                        />
                                    </div>
                                )}

                                {/* Prediction Stability Settings - Only for continuous predictions */}
                                {engineType === 'dense' && trainingProgress && !trainingConfig.gesturePredictionMode && (
                                    <div className="mb-4 pb-4 border-b border-zinc-800">
                                        <span className="text-[10px] text-zinc-500 font-bold tracking-wider block mb-3">PREDICTION STABILITY</span>

                                        <div className="flex justify-between items-center text-[10px] text-zinc-400 mb-2">
                                            <div>
                                                <span>Confidence Threshold</span>
                                                <span className="text-[9px] text-zinc-600 block">Min: {(trainingConfig.confidenceThreshold || 0.6) * 100}%</span>
                                            </div>
                                            <input
                                                type="number" step="0.05" min="0" max="1"
                                                value={trainingConfig.confidenceThreshold || 0.6}
                                                onChange={(e) => setTrainingConfig({ ...trainingConfig, confidenceThreshold: parseFloat(e.target.value) || 0.6 })}
                                                className="w-12 h-5 bg-zinc-800 border border-zinc-700 rounded text-center text-white focus:border-emerald-500 focus:outline-none"
                                            />
                                        </div>

                                        <div className="flex justify-between items-center text-[10px] text-zinc-400 mb-2">
                                            <div>
                                                <span>Smoothing Window</span>
                                                <span className="text-[9px] text-zinc-600 block">Majority vote over N</span>
                                            </div>
                                            <input
                                                type="number" min="1" max="20"
                                                value={trainingConfig.smoothingWindow || 7}
                                                onChange={(e) => setTrainingConfig({ ...trainingConfig, smoothingWindow: parseInt(e.target.value) || 7 })}
                                                className="w-12 h-5 bg-zinc-800 border border-zinc-700 rounded text-center text-white focus:border-emerald-500 focus:outline-none"
                                            />
                                        </div>

                                        <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                            <div>
                                                <span>Cooldown (ms)</span>
                                                <span className="text-[9px] text-zinc-600 block">Min time between changes</span>
                                            </div>
                                            <input
                                                type="number" min="0" max="1000" step="50"
                                                value={trainingConfig.predictionCooldown || 200}
                                                onChange={(e) => setTrainingConfig({ ...trainingConfig, predictionCooldown: parseInt(e.target.value) || 200 })}
                                                className="w-12 h-5 bg-zinc-800 border border-zinc-700 rounded text-center text-white focus:border-emerald-500 focus:outline-none"
                                            />
                                        </div>

                                        <p className="text-[9px] text-zinc-600 mt-2">
                                            For continuous predictions. Higher values = more stable but slower response.
                                        </p>
                                    </div>
                                )}

                                {/* Dense Hyperparams */}
                                {engineType === 'dense' && (
                                    <>
                                        <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                            <span>Epochs</span>
                                            <input
                                                type="number"
                                                value={trainingConfig.epochs}
                                                onChange={(e) => setTrainingConfig({ ...trainingConfig, epochs: parseInt(e.target.value) || 1 })}
                                                className="w-12 h-5 bg-zinc-800 border border-zinc-700 rounded text-center text-white focus:border-emerald-500 focus:outline-none"
                                            />
                                        </div>
                                        <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                            <span>Learning Rate</span>
                                            <input
                                                type="number" step="0.001"
                                                value={trainingConfig.learningRate}
                                                onChange={(e) => setTrainingConfig({ ...trainingConfig, learningRate: parseFloat(e.target.value) || 0.01 })}
                                                className="w-12 h-5 bg-zinc-800 border border-zinc-700 rounded text-center text-white focus:border-emerald-500 focus:outline-none"
                                            />
                                        </div>
                                        <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                            <span>Batch Size</span>
                                            <input
                                                type="number"
                                                value={trainingConfig.batchSize}
                                                onChange={(e) => setTrainingConfig({ ...trainingConfig, batchSize: parseInt(e.target.value) || 1 })}
                                                className="w-12 h-5 bg-zinc-800 border border-zinc-700 rounded text-center text-white focus:border-emerald-500 focus:outline-none"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Gesture Auto-Capture (Arduino/Hardware) */}
                        {engineType === 'dense' && (
                            <>
                                <div className="pt-4 mt-4 border-t border-zinc-800 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-zinc-400">
                                            <Cpu size={12} className={`transition-colors ${trainingConfig.autoCapture ? 'text-emerald-500' : 'text-zinc-600'}`} />
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Arduino Gesture Auto-Capture</span>
                                        </div>
                                        <button
                                            onClick={() => setTrainingConfig({ ...trainingConfig, autoCapture: !trainingConfig.autoCapture })}
                                            className={`w-8 h-4 rounded-full relative transition-colors ${trainingConfig.autoCapture ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.3)]' : 'bg-zinc-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all ${trainingConfig.autoCapture ? 'left-4.5' : 'left-0.5'}`} />
                                        </button>
                                    </div>

                                    {trainingConfig.autoCapture && (
                                        <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div className="space-y-1">
                                                <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                                    <span>Trigger Threshold</span>
                                                    <span className="font-mono text-emerald-400">{trainingConfig.threshold?.toFixed(3)}</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0.05"
                                                    max="1.5"
                                                    step="0.01"
                                                    value={trainingConfig.threshold}
                                                    onChange={(e) => setTrainingConfig({ ...trainingConfig, threshold: parseFloat(e.target.value) })}
                                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                />
                                            </div>

                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-tight">Assign Gestures to:</span>
                                                <select
                                                    value={recordingClassId || ''}
                                                    onChange={(e) => setRecordingClassId(e.target.value)}
                                                    className="w-full h-7 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-zinc-300 focus:border-emerald-500 focus:outline-none px-2 cursor-pointer hover:bg-zinc-800 transition-colors"
                                                >
                                                    <option value="" disabled>Select Class</option>
                                                    {classes.map(c => (
                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {isCapturingAuto ? (
                                                <div className="flex items-center justify-center gap-2 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded animate-pulse">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,1)]" />
                                                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Capturing...</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-center gap-2 py-2 border border-zinc-800 border-dashed rounded opacity-40">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                                                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Listening</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {/* Gesture Prediction Mode (Independent Toggle) */}
                        {engineType === 'dense' && (
                            <div className="pt-4 mt-4 border-t border-zinc-800">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 text-zinc-400">
                                        <Zap size={12} className={`transition-colors ${trainingConfig.gesturePredictionMode ? 'text-blue-400' : 'text-zinc-600'}`} />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Gesture-Triggered Prediction</span>
                                    </div>
                                    <button
                                        onClick={() => setTrainingConfig({ ...trainingConfig, gesturePredictionMode: !trainingConfig.gesturePredictionMode })}
                                        className={`w-8 h-4 rounded-full relative transition-colors ${trainingConfig.gesturePredictionMode ? 'bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.3)]' : 'bg-zinc-700'}`}
                                    >
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all ${trainingConfig.gesturePredictionMode ? 'left-4.5' : 'left-0.5'}`} />
                                    </button>
                                </div>

                                {trainingConfig.gesturePredictionMode ? (
                                    <div className="flex items-start gap-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded">
                                        <div className="w-2 h-2 bg-blue-400 rounded-full mt-1 animate-pulse flex-shrink-0" />
                                        <p className="text-[9px] text-blue-300 leading-relaxed">
                                            <strong>Tiny Trainer Mode:</strong> Predictions only occur when auto-capture completes a full gesture.
                                            No continuous frame-by-frame prediction. Reduces flickering.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-[9px] text-zinc-600 leading-relaxed">
                                        Continuous prediction on every frame. Enable for gesture-triggered prediction (matches Tiny Motion Trainer).
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="pt-4 mt-4 border-t border-zinc-800 space-y-4">
                            {engineType === 'dense' ? (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-zinc-400">
                                            <span>Training Status</span>
                                            <span className={`font-mono text-[10px] ${isModelTraining ? 'text-emerald-400 animate-pulse' : trainingProgress ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                                {isModelTraining ? 'RUNNING' : trainingProgress ? 'COMPLETE' : 'READY'}
                                            </span>
                                        </div>
                                        <div className="flex gap-[2px] h-3">
                                            {Array.from({ length: 40 }).map((_, i) => {
                                                const progress = trainingProgress ? (trainingProgress.epoch / trainingConfig.epochs) : 0;
                                                const isActive = i < (progress * 40);
                                                return (
                                                    <div
                                                        key={i}
                                                        className={`flex-1 rounded-sm transition-all duration-300 ${isActive ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-zinc-800'}`}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleTrainModel}
                                        disabled={isModelTraining}
                                        className={`w-full py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${isModelTraining ? 'bg-zinc-800 text-zinc-500' : 'bg-white text-black hover:bg-zinc-200'}`}
                                    >
                                        {isModelTraining ? 'TRAINING...' : trainingProgress ? 'RETRAIN' : 'START TRAINING'}
                                    </button>
                                    {trainingProgress && (
                                        <div className="text-[10px] font-mono text-emerald-400 text-center">
                                            Loss: {trainingProgress.loss.toFixed(4)} • {trainingMode === 'regression' ? `MSE: ${(trainingProgress.accuracy || 0).toFixed(4)}` : `Acc: ${((trainingProgress.accuracy || 0) * 100).toFixed(0)}%`}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs text-zinc-600 italic text-center py-4 border border-dashed border-zinc-800 rounded">
                                    KNN requires no training step. <br /> Just record & run.
                                </div>
                            )}

                            <button
                                onClick={clearModel}
                                className="mt-4 w-full py-2 border border-zinc-800 text-zinc-500 hover:text-red-500 hover:border-red-500/30 text-xs font-bold uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2"
                            >
                                <RotateCcw size={10} />
                                Reset Model
                            </button>
                        </div>
                    </div>

                    {/* RUN/STOP Control */}
                    <div className="p-4 border-b border-[#222]">
                        <div className="text-[10px] uppercase font-bold text-[#444] tracking-widest mb-3">
                            Inference Control
                        </div>
                        {(() => {
                            const hasData = trainingMode === 'classification'
                                ? classes.some(c => c.count > 0)
                                : outputs.some(o => (o.samples || 0) > 0);
                            const needsTraining = engineType === 'dense' && hasData && !trainingProgress;
                            const isDisabled = !hasData || (engineType === 'dense' && isModelTraining) || needsTraining;

                            return (
                                <>
                                    <button
                                        onClick={() => setIsRunning(!isRunning)}
                                        disabled={isDisabled}
                                        className={`w-full py-2 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2
                                            ${isRunning
                                                ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                                                : 'bg-emerald-500 text-black border border-emerald-400 hover:bg-emerald-400'
                                            } disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-emerald-500`}
                                    >
                                        {isRunning ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                                        {isRunning ? 'STOP' : 'RUN'}
                                    </button>
                                    {!hasData && (
                                        <div className="text-[9px] text-zinc-600 mt-2 text-center">
                                            No training data available
                                        </div>
                                    )}
                                    {hasData && engineType === 'dense' && isModelTraining && (
                                        <div className="text-[9px] text-zinc-600 mt-2 text-center">
                                            Wait for training to complete
                                        </div>
                                    )}
                                    {hasData && needsTraining && !isModelTraining && (
                                        <div className="text-[9px] text-zinc-600 mt-2 text-center">
                                            Train model first
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>

                    {/* OSC Status (Step 2 Pro Journey) */}
                    <div className="p-4 border-b border-[#222]">
                        <div className="text-[10px] uppercase font-bold text-[#444] tracking-widest mb-3">
                            Output Stream
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs text-zinc-400">
                                <span>Protocol</span>
                                <span className="font-mono text-white">
                                    {protocol === 'osc' ? 'OSC (UDP)' :
                                        protocol === 'ws' ? 'WEBSOCKET' : 'SERIAL'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-zinc-400">
                                <span>Target</span>
                                <span className="font-mono text-white">
                                    {protocol === 'osc' ? '127.0.0.1' :
                                        protocol === 'ws' ? 'localhost' : 'Device ID'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-zinc-400">
                                <span>Port/Dest</span>
                                <span className="font-mono text-white">
                                    {protocol === 'osc' ? '12000' :
                                        protocol === 'ws' ? '3100' : 'USB'}
                                </span>
                            </div>
                            <div className="mt-2 text-[10px] font-mono text-zinc-600">
                                {protocol === 'osc' ? '/ml/classification' :
                                    protocol === 'ws' ? 'Event: "prediction"' : 'Serial JSON'}
                            </div>
                        </div>
                    </div>

                    {/* Footer Stats */}
                    <div className="mt-auto p-4 border-t border-[#222] bg-[#050505]">
                        <div className="grid grid-cols-2 gap-4">
                            <StatMetric label="LATENCY" value="12" unit="ms" active={true} />
                            <StatMetric label="ACCURACY" value={prediction && prediction.confidences && Object.keys(prediction.confidences).length > 0 ? (Math.max(...Object.values(prediction.confidences)) * 100).toFixed(1) : "0.0"} unit="%" active={!!prediction} />
                        </div>
                    </div>
                </aside>

            </div >
        </div >
    );
}

// Helper Dropdown
function Dropdown({ label, value, options, icon }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative z-50">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 text-xs font-bold text-zinc-300 hover:text-white uppercase tracking-wider"
            >
                {icon && <span className="text-zinc-500">{icon}</span>}
                {!icon && <span className="text-zinc-600">{label}:</span>}
                {value}
                <ChevronDown size={10} className="text-zinc-600" />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}></div>
                    <div className="absolute top-full left-0 mt-2 w-48 bg-[#111] border border-[#333] rounded shadow-xl z-50 py-1 animate-in fade-in zoom-in-95 duration-75">
                        {options.map((opt, i) => (
                            <button
                                key={i}
                                onClick={() => { opt.action(); setOpen(false); }}
                                className="w-full text-left px-4 py-2 text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-white/[0.05] uppercase tracking-wider"
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
