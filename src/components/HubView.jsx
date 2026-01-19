import React from 'react';
import { Wifi, Radio, Cpu, Activity, CheckCircle, XCircle } from 'lucide-react';

export function HubView({ connectionStatus, isProMode }) {
    const isConn = connectionStatus.connected;

    return (
        <div className="h-full flex flex-col p-8 items-center justify-center relative overflow-hidden">
            {/* Background Decoration */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03),transparent_70%)]" />

            <div className="relative z-10 text-center space-y-8 max-w-lg w-full">

                {/* Status Ring */}
                <div className="relative mx-auto w-48 h-48 flex items-center justify-center">
                    {/* Outer Rings */}
                    <div className={`absolute inset-0 rounded-full border-2 ${isConn ? 'border-emerald-500/20 animate-pulse-slow' : 'border-white/5'}`} />
                    <div className={`absolute inset-4 rounded-full border border-dashed ${isConn ? 'border-emerald-500/40 animate-spin-slow' : 'border-white/10'}`} />

                    {/* Inner Circle */}
                    <div className={`w-32 h-32 rounded-full flex items-center justify-center backdrop-blur-xl border transition-all duration-500 ${isConn
                        ? 'bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.2)]'
                        : 'bg-white/5 border-white/10'
                        }`}>
                        {isConn ? (
                            <Wifi size={48} className="text-emerald-500" strokeWidth={1.5} />
                        ) : (
                            <Wifi size={48} className="text-white/20" strokeWidth={1.5} />
                        )}
                    </div>

                    {/* Status Badge */}
                    <div className={`absolute -bottom-4 px-4 py-1.5 rounded-full border text-xs font-mono font-bold tracking-wider uppercase backdrop-blur-md ${isConn
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400'
                        : 'bg-black/50 border-white/10 text-zinc-500'
                        }`}>
                        {isConn ? 'SYSTEM ONLINE' : 'DISCONNECTED'}
                    </div>
                </div>


                {/* Info Card */}
                <div className="grid grid-cols-2 gap-4 mt-8">
                    <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center gap-2">
                        <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">Protocol</span>
                        <div className="flex items-center gap-2">
                            <Radio size={14} className="text-emerald-400" />
                            <span className="text-white font-mono text-sm">{connectionStatus.source || 'SERIAL'}</span>
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center gap-2">
                        <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">Engine</span>
                        <div className="flex items-center gap-2">
                            <Cpu size={14} className="text-blue-400" />
                            <span className="text-white font-mono text-sm">TF.JS {isProMode ? '(PRO)' : '(STD)'}</span>
                        </div>
                    </div>
                </div>

                {!isConn && (
                    <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/10 text-red-400/80 text-xs font-mono">
                        Waiting for Serial Bridge connection on localhost...
                    </div>
                )}
            </div>
        </div>
    );
}
