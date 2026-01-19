import React, { useState } from 'react';
import { X, Cpu, Camera, Radio, Globe, Zap } from 'lucide-react';

export function SettingsModal({ onClose, isProMode, setIsProMode, inputSource, setInputSource }) {
    const [localSource, setLocalSource] = useState(inputSource || 'serial');

    const handleSave = () => {
        setInputSource(localSource);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-[500px] bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">

                {/* Header */}
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                            <Zap size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold tracking-tight">System Configuration</h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-white/40 text-xs font-mono uppercase tracking-wider">Pro Mode</span>
                                <button
                                    onClick={() => setIsProMode(!isProMode)}
                                    className={`relative w-8 h-4 rounded-full transition-colors ${isProMode ? 'bg-emerald-500' : 'bg-white/10'}`}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${isProMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">

                    {/* Input Source Selector */}
                    <div>
                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest mb-3 block">Input Source</label>
                        <div className="grid grid-cols-3 gap-3">
                            <SourceOption
                                icon={<Cpu size={20} />}
                                label="Serial"
                                active={localSource === 'serial'}
                                onClick={() => setLocalSource('serial')}
                            />
                            <SourceOption
                                icon={<Camera size={20} />}
                                label="Webcam"
                                active={localSource === 'webcam'}
                                onClick={() => setLocalSource('webcam')}
                                locked={!isProMode}
                            />
                            <SourceOption
                                icon={<Radio size={20} />}
                                label="OSC / UDP"
                                active={localSource === 'osc'}
                                onClick={() => setLocalSource('osc')}
                                locked={!isProMode}
                            />
                        </div>
                        {!isProMode && (
                            <p className="text-[10px] text-white/30 mt-2 text-center">Enable Pro Mode to access Webcam & OSC inputs.</p>
                        )}
                    </div>

                    {/* Placeholder for OSC Settings */}
                    {localSource === 'osc' && isProMode && (
                        <div className="p-4 bg-white/5 rounded-lg border border-white/5 space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="flex justify-between items-center text-xs">
                                <label className="text-white/60">UDP Port</label>
                                <input type="number" defaultValue={12000} className="bg-black/50 border border-white/10 rounded px-2 py-1 text-right w-20 text-white font-mono focus:border-emerald-500 focus:outline-none" />
                            </div>
                            <div className="text-[10px] text-white/30 text-center pt-1">
                                Listening on 0.0.0.0:12000
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-4 bg-white/[0.02] border-t border-white/5 flex justifies-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium text-white/40 hover:text-white transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="flex-1 px-4 py-2 bg-white text-black rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors">
                        Apply Changes
                    </button>
                </div>
            </div>
        </div>
    );
}

function SourceOption({ icon, label, active, onClick, locked }) {
    return (
        <button
            onClick={!locked ? onClick : undefined}
            className={`
                relative flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-200
                ${active ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.1)]' : 'bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:border-white/20'}
                ${locked ? 'opacity-30 cursor-not-allowed grayscale' : 'cursor-pointer'}
            `}
        >
            {icon}
            <span className="text-xs font-medium">{label}</span>
            {locked && <span className="absolute top-2 right-2 text-[10px]">🔒</span>}
        </button>
    );
}
