import { Visualizer } from './Visualizer';
import { WebcamPreview } from './WebcamPreview';
import { Lock } from 'lucide-react';

export function InputCard({ incomingData, connectionStatus, isProMode, selectedFeatures, onToggleFeature, hasTrainingData }) {
    // Extract number of keys for display stats
    const featureCount = Object.keys(incomingData || {}).length;

    return (
        <div className="col-span-12 lg:col-span-4 fui-panel p-0 flex flex-col h-full min-h-[500px] overflow-hidden relative">

            {/* Header */}
            <div className="px-6 py-5 border-b border-white/5 bg-white/[0.01] flex justify-between items-center backdrop-blur-sm relative z-10">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-white/90 tracking-tight">Input Stream</h3>
                        {hasTrainingData && (
                            <div className="text-[10px] text-amber-500/80 border border-amber-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 bg-amber-500/5 shadow-[0_0_10px_rgba(245,158,11,0.1)]">
                                <Lock size={10} strokeWidth={2.5} />
                                <span className="font-bold tracking-wider uppercase text-[9px]">Fixed</span>
                            </div>
                        )}
                    </div>
                    <p className="text-white/40 text-[11px] mt-0.5 font-sans">Source: {connectionStatus.source}</p>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${connectionStatus.connected ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/10' : 'bg-red-500/10 text-red-500 border-red-500/10'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${connectionStatus.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {connectionStatus.connected ? 'Connected' : 'Disconnected'}
                </div>
            </div>

            {/* Visualizer Area - Inset "Screen" Look */}
            <div className="p-4 pb-0">
                <div className="h-40 bg-black/40 border border-white/5 rounded-xl relative overflow-hidden group shadow-inner">
                    {connectionStatus.source.includes('Webcam') ? (
                        <WebcamPreview />
                    ) : connectionStatus.source.includes('Image Upload') ? (
                        <div className="flex flex-col items-center justify-center h-full text-white/20 gap-2">
                            <Database size={24} />
                            <span className="text-[10px] uppercase tracking-widest">Upload Mode</span>
                        </div>
                    ) : (
                        <>
                            <Visualizer data={incomingData} selectedFeatures={selectedFeatures} width={400} height={160} />
                            <div className="absolute top-2 right-3 text-[9px] font-medium text-white/20 tracking-wider">LIVE SIGNAL</div>
                        </>
                    )}
                </div>
            </div>

            {/* Data List container */}
            <div className="flex-1 overflow-y-auto p-2 font-mono-tech text-xs bg-transparent custom-scrollbar mt-2 relative">

                {/* Subtle Gradient Hint for Locked State at Bottom */}
                {hasTrainingData && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 pointer-events-none bg-amber-500/20 z-20" />
                )}

                {featureCount > 0 ? (
                    <div className={`space-y-1 px-2 ${hasTrainingData ? 'pointer-events-none grayscale-[0.5] opacity-80' : ''}`}>
                        {/* Header Row */}
                        <div className="flex justify-between px-4 py-2 text-white/30 text-[10px] uppercase tracking-wider font-sans font-medium mb-1">
                            <span>Sensor Channel</span>
                            <span>Value</span>
                        </div>

                        {(() => {
                            try {
                                return Object.entries(incomingData || {}).map(([key, val]) => {
                                    const isSelected = selectedFeatures.has(key);
                                    return (
                                        <div key={key} className={`flex justify-between items-center px-4 py-3 rounded-lg transition-all cursor-pointer group border ${isSelected ? 'bg-white/[0.03] border-white/5' : 'border-transparent hover:bg-white/[0.02]'}`} onClick={() => !hasTrainingData && onToggleFeature(key)}>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${isSelected ? 'bg-emerald-500 border-emerald-500 shadow-sm' : 'border-white/20 group-hover:border-white/40'}`}>
                                                    {isSelected && <div className="text-black text-[10px]">✓</div>}
                                                </div>
                                                <span className={`text-sm font-medium font-sans ${isSelected ? 'text-white/90' : 'text-white/40'}`}>{key}</span>
                                            </div>
                                            <span className={`font-mono-tech tabular-nums text-[11px] ${isSelected ? 'text-emerald-400' : 'text-white/30'}`}>
                                                {typeof val === 'number' ? val.toFixed(3) : String(val)}
                                            </span>
                                        </div>
                                    );
                                });
                            } catch (e) {
                                console.error("InputCard Render Error:", e);
                                return null;
                            }
                        })()}
                    </div>
                ) : (
                    <div className="flex h-full flex-col items-center justify-center text-white/20 gap-3">
                        <div className="p-3 rounded-full bg-white/5">
                            <div className="animate-spin text-xl opacity-50">◌</div>
                        </div>
                        <span className="text-xs font-sans">Waiting for data stream...</span>
                    </div>
                )}
            </div>

            {/* Footer Stats */}
            <div className="p-3 border-t border-white/5 bg-white/[0.01] flex justify-between text-[10px] text-white/30 font-sans">
                <span>9600 BAUD</span>
                <span>{featureCount} Active Channels</span>
            </div>
        </div>
    );
}
