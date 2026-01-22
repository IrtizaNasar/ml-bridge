import React, { useState, useEffect, useMemo } from 'react';
import { Send, Radio, Settings, Activity, Wifi, Zap, Cpu, Code, Globe, Lock, Play, Hash } from 'lucide-react';
import { Visualizer } from './Visualizer';

export function DeployView({
    prediction, incomingData, selectedFeatures,
    isRunning, onToggleRun,
    engineType, trainingMode, outputs,
    isModelTraining, onExportArduino,
    protocol, setProtocol, // Lifted state from App.jsx
    targetDeviceId, setTargetDeviceId, // Lifted state from App.jsx
    serialFormat, setSerialFormat, // Lifted state from App.jsx
    onExportWeb
}) {
    // const [protocol, setProtocol] = useState('osc'); // REMOVED - now props
    const [wsStatus, setWsStatus] = useState('disconnected');
    // const [targetDeviceId, setTargetDeviceId] = useState(''); // REMOVED - now props
    const [logs, setLogs] = useState(['[SYSTEM] Bridge Ready.']);

    const protocols = [
        { id: 'osc', label: 'OSC (Open Sound Control)', icon: <Wifi size={14} />, detail: 'UDP 127.0.0.1:12000' },
        { id: 'ws', label: 'WebSocket', icon: <Zap size={14} />, detail: 'ws://localhost:3100' },
        { id: 'serial', label: 'Serial Bridge', icon: <Cpu size={14} />, detail: targetDeviceId ? `Target: ${targetDeviceId}` : 'Select a Device ID' }
    ];

    // Log protocol changes
    useEffect(() => {
        const p = protocols.find(x => x.id === protocol);
        setLogs(prev => [...prev.slice(-49), `[CONFIG] Protocol set to ${p?.id.toUpperCase()}`]);
    }, [protocol]);

    // Mock export latency
    const latency = Math.floor(Math.random() * 5) + 8;

    return (
        <div className="h-full flex flex-col bg-[#0A0A0A] text-zinc-300 animate-in fade-in zoom-in-95 duration-200 overflow-hidden relative">

            {/* Background Viz - REMOVED for Windows performance */}
            {/* Full-screen canvas rendering was causing severe lag on Windows */}

            {/* Header */}
            <div className="relative z-10 flex items-center justify-between p-6 border-b border-[#222] bg-[#0A0A0A]">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Send size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">Deployment & Monitor</h2>
                        <div className="flex items-center gap-4 text-xs font-mono text-zinc-500 mt-1">
                            <span className="flex items-center gap-1"><Activity size={12} /> LIVE INFERENCE</span>
                            <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                            <span>{isRunning ? 'RUNNING' : 'STOPPED'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Layout */}
            <div className="relative z-10 flex-1 flex flex-col md:flex-row overflow-hidden">

                {/* Left: Live Monitor (Hero) */}
                <div className="flex-1 flex flex-col items-center justify-center p-6 relative border-b md:border-b-0 md:border-r border-[#222]">
                    <div className="w-[280px] h-[280px] md:w-[360px] md:h-[360px] relative flex items-center justify-center">
                        {/* Rings */}
                        <div className="absolute inset-0 border border-zinc-800 rounded-full"></div>
                        <div className={`absolute inset-4 border border-zinc-800/50 rounded-full border-dashed transition-all duration-1000 ${isRunning ? 'animate-[spin_10s_linear_infinite] border-zinc-700' : ''}`}></div>
                        <div className={`absolute inset-16 border rounded-full bg-[#050505] flex flex-col items-center justify-center shadow-2xl transition-all duration-300 ${prediction && isRunning ? 'border-emerald-500/30 shadow-[0_0_80px_rgba(16,185,129,0.15)]' : 'border-zinc-900'}`}>

                            {isRunning ? (
                                prediction ? (
                                    <div className="text-center animate-in fade-in zoom-in-50 duration-150 w-full px-8">
                                        {trainingMode === 'classification' ? (
                                            <>
                                                <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3">Detected Class</div>
                                                <div className="text-4xl md:text-5xl font-light text-white mb-3 tracking-tighter">{prediction.label}</div>
                                                <div className="inline-flex items-center justify-center px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
                                                    {(Math.max(...Object.values(prediction.confidences || {})) * 100).toFixed(1)}% CONFIDENCE
                                                </div>
                                            </>
                                        ) : (
                                            <div className="space-y-6">
                                                <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Active Regression</div>
                                                <div className="space-y-4">
                                                    {Object.entries(prediction.regression || {}).map(([id, val]) => {
                                                        const output = outputs.find(o => o.id === id);
                                                        return (
                                                            <div key={id} className="text-center">
                                                                <div className="text-xs font-bold text-zinc-400 mb-1">{output?.name || id}</div>
                                                                <div className="text-4xl font-light text-white tracking-tighter mb-2">{val.toFixed(2)}</div>
                                                                <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-emerald-500"
                                                                        style={{ width: `${Math.min(100, Math.max(0, val * 100))}%` }}
                                                                    ></div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <span className="loading loading-spinner text-zinc-600"></span>
                                        <div className="text-xs font-mono text-zinc-600 mt-2 animate-pulse">WAITING FOR INPUT...</div>
                                    </div>
                                )
                            ) : (
                                <div className="text-center opacity-50">
                                    <div className="text-4xl text-zinc-700 mb-2"><Lock size={40} className="mx-auto" /></div>
                                    <div className="text-xs font-mono text-zinc-600">ENGINE STOPPED</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Latency Stats */}
                    {isRunning && (
                        <div className="absolute bottom-8 flex gap-8">
                            <div className="text-center">
                                <div className="text-[10px] uppercase text-zinc-600 font-bold tracking-wider mb-1">Inference</div>
                                <div className="text-lg font-mono text-zinc-300">~{latency}ms</div>
                            </div>
                            <div className="text-center">
                                <div className="text-[10px] uppercase text-zinc-600 font-bold tracking-wider mb-1">FPS</div>
                                <div className="text-lg font-mono text-zinc-300">60</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Output Config */}
                <div className="w-full md:w-80 bg-[#080808] border-l border-[#222] flex flex-col overflow-y-auto">
                    <div className="p-4 border-b border-[#222]">
                        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Output Protocol</h3>
                        <div className="space-y-2">
                            {protocols.map(p => (
                                <div key={p.id} className="w-full">
                                    <button
                                        onClick={() => setProtocol(p.id)}
                                        className={`w-full text-left p-3 rounded-lg border transition-all ${protocol === p.id ? 'bg-[#111] border-zinc-600 shadow-sm' : 'bg-transparent border-transparent hover:bg-[#111] hover:border-[#222]'}`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
                                                {p.icon} {p.label}
                                            </div>
                                            {protocol === p.id && <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>}
                                        </div>
                                        <div className="text-[10px] font-mono text-zinc-600 pl-6">{p.detail}</div>
                                    </button>

                                    {/* Serial Bridge Device ID Input */}
                                    {p.id === 'serial' && protocol === 'serial' && (
                                        <div className="mt-2 pl-3 pr-1 animate-in slide-in-from-top-2 fade-in">
                                            <div className="flex items-center gap-2 bg-[#050505] border border-zinc-800 rounded p-2 focus-within:border-zinc-600 transition-colors">
                                                <Hash size={12} className="text-zinc-600" />
                                                <input
                                                    type="text"
                                                    placeholder="Enter Device ID..."
                                                    value={targetDeviceId}
                                                    onChange={(e) => setTargetDeviceId(e.target.value)}
                                                    className="bg-transparent border-none text-xs font-mono text-zinc-300 placeholder-zinc-700 w-full focus:outline-none"
                                                />
                                            </div>
                                            <div className="text-[9px] text-zinc-600 mt-1 pl-1">
                                                * Required to route messages via Serial Bridge.
                                            </div>

                                            {/* Format Selector */}
                                            <div className="flex items-center gap-2 mt-3 pl-1">
                                                <div className="text-[9px] text-zinc-500 font-bold tracking-wider">FORMAT:</div>
                                                <div className="flex bg-[#050505] border border-zinc-800 rounded overflow-hidden">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setSerialFormat('json'); }}
                                                        className={`px-3 py-1 text-[10px] font-bold transition-colors ${serialFormat === 'json' ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#111]'}`}
                                                    >
                                                        JSON
                                                    </button>
                                                    <div className="w-px bg-zinc-800"></div>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setSerialFormat('csv'); }}
                                                        className={`px-3 py-1 text-[10px] font-bold transition-colors ${serialFormat === 'csv' ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#111]'}`}
                                                    >
                                                        CSV
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>



                    <div className="flex-1 p-4 bg-[#050505]">
                        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Terminal Output</h3>
                        <div className="font-mono text-[10px] text-zinc-400 space-y-1 opacity-70 min-h-[100px] flex flex-col justify-end">
                            {logs.map((log, i) => (
                                <div key={i}>{log}</div>
                            ))}
                            {isRunning && (
                                <>
                                    <div className="text-emerald-500 animate-pulse">[ENGINE] Streaming Live...</div>
                                    <div className="text-blue-400">
                                        [OUT] {protocols.find(p => p.id === protocol)?.detail}
                                        <br />
                                        &nbsp;:: {prediction ? (
                                            trainingMode === 'classification'
                                                ? `Sending "${prediction.label}"`
                                                : `Sending values: ${Object.values(prediction.regression || {}).map(v => v.toFixed(2)).join(', ')}`
                                        ) : '...'}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
