import React, { useEffect, useRef } from 'react';
import { webcamManager } from '../services/WebcamManager';

export function WebcamPreview() {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    useEffect(() => {
        // Subscribe to stream updates
        const unsubscribe = webcamManager.onStreamUpdate((stream) => {
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        });

        return () => unsubscribe();
    }, []);

    return (
        <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden rounded-lg border border-white/10">
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

            <div className="absolute bottom-2 right-2 bg-red-500/20 text-red-400 px-2 py-0.5 text-[9px] font-mono rounded border border-red-500/30 flex items-center gap-1 animate-pulse">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                LIVE
            </div>
        </div>
    );
}
