import React, { useState, useEffect, useMemo } from 'react';
import * as ReactWindow from 'react-window';
import { Database, Filter, Download, Upload, Trash2, Search, Table, RefreshCw } from 'lucide-react';
import { mlEngine } from '../services/MLEngine';
import { UI_CONSTANTS } from '../constants';

export function DataView({ onLoad, onSave, onDeleteSample }) {
    const [samples, setSamples] = useState([]);
    const [stats, setStats] = useState({ totalContexts: 0, totalSamples: 0, classes: 0 });
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedClass, setSelectedClass] = useState('all');
    const [isLoading, setIsLoading] = useState(false);

    // Load data from memory on mount
    useEffect(() => {
        refreshData();
    }, []);

    const refreshData = () => {
        setIsLoading(true);
        const rawData = mlEngine.denseData || [];

        const formatted = rawData.map((d, i) => ({
            id: i,
            label: d.type === 'regression' ? `TARGET: ${d.target.toFixed(2)}` : d.label,
            type: d.type || 'classification',
            features: d.features.length,
            thumbnail: d.thumbnail,
            valPreview: d.features.slice(0, 5).map(v => typeof v === 'number' ? v.toFixed(2) : v).join(', '),
            timestamp: d.timestamp ? new Date(d.timestamp).toLocaleString() : new Date().toISOString()
        }));

        setSamples(formatted);

        setStats({
            totalSamples: formatted.length,
            classes: new Set(rawData.map(s => s.label)).size,
            inputDim: formatted.length > 0 ? rawData[0].features.length : 0
        });

        setTimeout(() => setIsLoading(false), 300);
    };

    const handleDelete = (index) => {
        if (onDeleteSample) {
            onDeleteSample(index);
            refreshData(); // Refresh UI after delete
        }
    };

    // PERFORMANCE: Memoize filtered samples to avoid recalculating on every render
    const filteredSamples = useMemo(() => {
        return samples.filter(s => {
            const matchesSearch = s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                s.valPreview.includes(searchQuery);
            const matchesClass = selectedClass === 'all' || s.label === selectedClass;
            return matchesSearch && matchesClass;
        });
    }, [samples, searchQuery, selectedClass]);

    const uniqueClasses = Array.from(new Set(samples.map(s => s.label)));

    // Row renderer for virtual scrolling
    const Row = ({ index, style }) => {
        const sample = filteredSamples[index];

        return (
            <div style={style} className="group hover:bg-[#0F0F0F] transition-colors border-b border-[#1A1A1A] flex items-center px-6">
                {/* Preview */}
                <div className="w-32 py-4 pr-6">
                    {sample.thumbnail ? (
                        <div className="w-24 h-16 rounded-lg border border-[#222] overflow-hidden bg-black flex items-center justify-center group-hover:border-zinc-700 transition-all shadow-lg group-hover:shadow-blue-500/5">
                            <img src={sample.thumbnail} className="w-full h-full object-cover" alt={`Sample ${sample.id}`} />
                        </div>
                    ) : (
                        <div className="w-24 h-16 rounded-lg border border-[#222] border-dashed flex items-center justify-center text-[10px] font-mono text-zinc-700 bg-[#050505]">
                            NO IMG
                        </div>
                    )}
                </div>

                {/* ID */}
                <div className="w-20 py-4 pr-6 text-xs font-mono text-zinc-500">
                    #{sample.id.toString().padStart(3, '0')}
                </div>

                {/* Label */}
                <div className="flex-1 py-4 pr-6">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-zinc-900 text-zinc-300 border border-zinc-800 group-hover:border-zinc-700 group-hover:bg-zinc-800 transition-colors">
                        {sample.label}
                    </span>
                </div>

                {/* Features Preview */}
                <div className="flex-1 py-4 pr-6 text-[10px] font-mono text-zinc-600 group-hover:text-zinc-500 truncate">
                    [{sample.valPreview}...]
                </div>

                {/* Actions */}
                <div className="w-20 py-4 text-right">
                    <button
                        onClick={() => handleDelete(sample.id)}
                        className="text-zinc-600 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20"
                        title="Delete Sample"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col bg-[#0A0A0A] text-zinc-300 animate-in fade-in zoom-in-95 duration-200 overflow-hidden">

            {/* Header / Stats */}
            <div className="flex flex-col md:flex-row md:items-center justify-between p-4 md:p-6 border-b border-[#222] gap-4 bg-[#0A0A0A]">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                        <Database size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">Data Management</h2>
                        <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-zinc-500 mt-1">
                            <span className="flex items-center gap-1"><Table size={12} /> {stats.totalSamples} SAMPLES</span>
                            <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                            <span>{stats.classes} CLASSES</span>
                            <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                            <span>{stats.inputDim} DIMS</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto">
                    <button
                        onClick={refreshData}
                        className="p-2 hover:bg-[#111] rounded-lg text-zinc-500 hover:text-white transition-all border border-transparent hover:border-zinc-800"
                        title="Refresh Data"
                    >
                        <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                    </button>
                    <div className="h-8 w-[1px] bg-[#222] mx-2"></div>
                    <button
                        onClick={async () => {
                            await onLoad();
                            refreshData();
                        }}
                        className="flex items-center gap-2 px-3 py-2 bg-[#111] hover:bg-[#1A1A1A] border border-[#222] hover:border-zinc-700 rounded-lg text-xs font-bold uppercase tracking-wider transition-all text-zinc-400 hover:text-white"
                    >
                        <Upload size={14} /> Import
                    </button>
                    <button
                        onClick={onSave}
                        className="flex items-center gap-2 px-3 py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/50 hover:border-blue-500 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                    >
                        <Download size={14} /> Export
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="px-4 md:px-6 py-4 flex flex-col md:flex-row items-stretch md:items-center justify-between bg-[#0A0A0A] border-b border-[#222] gap-4">
                <div className="flex items-center gap-4 flex-1">
                    {/* Search */}
                    <div className="relative group w-full md:max-w-md">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-blue-400 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search samples..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-[#050505] border border-[#222] rounded-lg pl-9 pr-4 py-2 text-xs font-mono text-zinc-300 focus:outline-none focus:border-blue-500/50 transition-all placeholder-zinc-700"
                        />
                    </div>

                    {/* Filter */}
                    <div className="relative items-center gap-2 hidden md:flex">
                        <Filter size={14} className="text-zinc-600" />
                        <select
                            value={selectedClass}
                            onChange={(e) => setSelectedClass(e.target.value)}
                            className="bg-transparent text-xs font-bold uppercase tracking-wider text-zinc-400 focus:outline-none cursor-pointer hover:text-white transition-colors [&>option]:bg-[#111]"
                        >
                            <option value="all">All Classes</option>
                            {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* Virtual Scrolling Table Area */}
            <div className="flex-1 overflow-hidden bg-[#0A0A0A]">
                {/* Table Header */}
                <div className="bg-[#0A0A0A] text-[10px] uppercase font-bold text-zinc-500 tracking-widest border-b border-[#222] flex items-center px-6 py-4">
                    <div className="w-32 pr-6">Preview</div>
                    <div className="w-20 pr-6">ID</div>
                    <div className="flex-1 pr-6">Label</div>
                    <div className="flex-1 pr-6 text-zinc-600">Features</div>
                    <div className="w-20 text-right">Actions</div>
                </div>

                {/* Virtual Scrolling List */}
                {filteredSamples.length > 0 ? (
                    <ReactWindow.List
                        height={window.innerHeight - UI_CONSTANTS.DATAVIEW_HEADER_HEIGHT}
                        itemCount={filteredSamples.length}
                        itemSize={UI_CONSTANTS.VIRTUAL_SCROLL_ROW_HEIGHT}
                        width="100%"
                        className="scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent"
                    >
                        {Row}
                    </ReactWindow.List>
                ) : (
                    <div className="px-6 py-24 text-center text-zinc-700 italic text-xs">
                        No samples found. Record some data in the Training tab or Import a dataset.
                    </div>
                )}
            </div>
        </div>
    );
}
