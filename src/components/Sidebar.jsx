import React from 'react';
import { LayoutGrid, Target, Database, Settings, Zap, Activity, LayoutTemplate } from 'lucide-react';

export function Sidebar({ activeTab, setActiveTab, isProMode, setIsProMode, onOpenSettings }) {
    const tabs = [
        { id: 'hub', label: 'HUB', icon: LayoutGrid },
        { id: 'train', label: 'TRAINING', icon: Target },
        { id: 'data', label: 'DATASET', icon: Database },
        { id: 'ui-lab', label: 'UI LAB', icon: LayoutTemplate },
    ];

    return (
        <aside className="w-[80px] lg:w-[240px] border-r border-white/5 bg-[#0C0C0C] flex flex-col justify-between z-50 transition-all duration-300">
            {/* Logo Area */}
            <div className="h-20 flex items-center justify-center lg:justify-start lg:px-6 border-b border-white/5">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                    <Activity size={18} className="text-black" strokeWidth={2.5} />
                </div>
                <span className="hidden lg:block ml-3 font-bold text-lg tracking-wider">BRIDGE</span>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-8 flex flex-col gap-2 px-3">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                            relative flex items-center justify-center lg:justify-start gap-4 p-3 rounded-xl transition-all duration-200 group
                            ${activeTab === tab.id
                                ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                                : 'text-zinc-500 hover:bg-white/5 hover:text-white'
                            }
                        `}
                    >
                        <tab.icon size={20} strokeWidth={activeTab === tab.id ? 2.5 : 2} />
                        <span className={`hidden lg:block text-xs font-bold tracking-widest ${activeTab === tab.id ? 'opacity-100' : 'opacity-80'}`}>
                            {tab.label}
                        </span>

                        {/* Active Indicator (Mobile/Collapsed) */}
                        {activeTab === tab.id && (
                            <div className="lg:hidden absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
                        )}
                    </button>
                ))}
            </nav>

            {/* Footer / Settings */}
            <div className="p-4 border-t border-white/5 flex flex-col gap-4">
                <button
                    onClick={() => setIsProMode(!isProMode)}
                    className={`flex items-center justify-center lg:justify-start gap-3 p-3 rounded-xl transition-all ${isProMode ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/20' : 'text-zinc-600 hover:text-zinc-400'}`}
                >
                    <Zap size={18} className={isProMode ? 'fill-current' : ''} />
                    <span className="hidden lg:block text-xs font-mono font-bold">
                        {isProMode ? 'PRO MODE' : 'LITE MODE'}
                    </span>
                </button>

                <button
                    onClick={onOpenSettings}
                    className="flex items-center justify-center lg:justify-start gap-3 p-3 rounded-xl text-zinc-500 hover:bg-white/5 hover:text-white transition-all"
                >
                    <Settings size={20} />
                    <span className="hidden lg:block text-xs font-medium">Settings</span>
                </button>
            </div>
        </aside>
    );
}
