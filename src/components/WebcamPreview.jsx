import React, { useEffect, useRef, useState } from 'react';
import { webcamManager } from '../services/WebcamManager';
import { Camera, Settings, Check } from 'lucide-react';

export function WebcamPreview() {
    const videoRef = useRef(null);
    const hideTimerRef = useRef(null);
    const [devices, setDevices] = useState([]);
    const [showSelector, setShowSelector] = useState(false);
    const [currentDeviceId, setCurrentDeviceId] = useState(null);

    useEffect(() => {
        // Subscribe to stream updates
        const unsubscribe = webcamManager.onStreamUpdate((stream) => {
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        });

        // Initial device list
        loadDevices();

        // Listen for device changes
        navigator.mediaDevices.addEventListener('devicechange', loadDevices);

        return () => {
            unsubscribe();
            navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
        };
    }, []);

    // Auto-hide logic
    useEffect(() => {
        if (showSelector) {
            resetHideTimer();
        } else {
            clearHideTimer();
        }
        return () => clearHideTimer();
    }, [showSelector]);

    const resetHideTimer = () => {
        clearHideTimer();
        hideTimerRef.current = setTimeout(() => {
            setShowSelector(false);
        }, 5000);
    };

    const clearHideTimer = () => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    };

    const loadDevices = async () => {
        const devs = await webcamManager.getDevices();
        setDevices(devs);
        setCurrentDeviceId(webcamManager.getCurrentDevice());
    };

    const handleDeviceSelect = async (deviceId) => {
        await webcamManager.setDevice(deviceId);
        setCurrentDeviceId(deviceId);
        setShowSelector(false);
    };

    return (
        <div className="w-full flex flex-col" onMouseEnter={resetHideTimer} onMouseLeave={resetHideTimer}>
            {/* Video Feed Area - Fixed Height */}
            <div className="relative h-[160px] w-full bg-black rounded-lg overflow-hidden border border-white/10 shrink-0">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover opacity-80"
                />

                {/* Overlay Grid Hint */}
                <div className="absolute inset-0 grid grid-cols-10 grid-rows-10 pointer-events-none opacity-20">
                    {Array.from({ length: 100 }).map((_, i) => (
                        <div key={i} className="border border-white/30" />
                    ))}
                </div>

                {/* Config Button (Top Right) */}
                <div className="absolute top-2 right-2 z-20">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowSelector(!showSelector);
                        }}
                        className={`p-1.5 rounded-lg backdrop-blur-md border transition-all shadow-lg ${showSelector ? 'bg-white text-black border-white' : 'bg-black/40 text-white/50 hover:text-white border-white/5 hover:border-white/20 hover:bg-black/60'}`}
                    >
                        <Settings size={14} />
                    </button>
                </div>

                {/* Live Indicator */}
                {!showSelector && (
                    <div className="absolute bottom-2 right-2 bg-red-500/20 text-red-400 px-2 py-0.5 text-[9px] font-mono rounded border border-red-500/30 flex items-center gap-1 animate-pulse pointer-events-none z-10">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        LIVE
                    </div>
                )}
            </div>

            {/* Accordion Expansion - Camera Options */}
            {/* Accordion Expansion - Camera Options */}
            {showSelector && (
                <div className="mt-2 bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex flex-col gap-1 shadow-inner relative animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Tiny connector arrow visually connecting to video */}
                    <div className="absolute -top-1 right-3 w-2 h-2 bg-[#0a0a0a] border-t border-l border-white/10 transform rotate-45 z-10" />

                    <div className="flex items-center justify-between px-2 py-1.5 mb-1 border-b border-white/5">
                        <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
                            <Camera size={10} />
                            Available Cameras
                        </div>
                    </div>

                    <div className="max-h-[120px] overflow-y-auto custom-scrollbar flex flex-col gap-1">
                        {devices.length > 0 ? devices.map((device) => (
                            <button
                                key={device.deviceId}
                                onClick={() => handleDeviceSelect(device.deviceId)}
                                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 rounded-md transition-all ${currentDeviceId === device.deviceId ? 'bg-white/10 text-white shadow-inner border border-white/5' : 'text-white/50 hover:bg-white/5 hover:text-white/80 border border-transparent'}`}
                            >
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all ${currentDeviceId === device.deviceId ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-white/20'}`} />
                                <span className="truncate flex-1 font-medium">{device.label || `Camera ${device.deviceId.slice(0, 5)}...`}</span>
                                {currentDeviceId === device.deviceId && <Check size={12} className="text-emerald-500" />}
                            </button>
                        )) : (
                            <div className="px-3 py-3 text-xs text-white/40 italic text-center">No cameras found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
