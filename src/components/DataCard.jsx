import React, { useState, useEffect } from 'react';
import { Database, Download, Upload, Trash2, FileJson, AlertCircle } from 'lucide-react';
import { mlEngine } from '../services/MLEngine';

export function DataCard({ onSave, onLoad, onClear }) {
    const [counts, setCounts] = useState({ classification: {}, regression: {} });
    const [status, setStatus] = useState(null); // { type: 'success'|'error', msg: '' }

    useEffect(() => {
        updateCounts();

        // Poll for updates? Or simple interval
        const interval = setInterval(updateCounts, 1000);
        return () => clearInterval(interval);
    }, []);

    const updateCounts = () => {
        setCounts({
            classification: mlEngine.getClassCounts(),
            regression: mlEngine.getRegressionCounts()
        });
    };

    const handleSave = async () => {
        if (!onSave) return;

        setStatus({ type: 'info', msg: 'Saving...' });
        const res = await onSave();

        if (res.success) {
            setStatus({ type: 'success', msg: 'Dataset Saved!' });
        } else if (!res.canceled) {
            setStatus({ type: 'error', msg: 'Save Failed: ' + res.error });
        } else {
            setStatus(null);
        }
    };

    const handleLoad = async () => {
        if (!onLoad) return;

        setStatus({ type: 'info', msg: 'Loading...' });
        const res = await onLoad();
        if (res.success) {
            setStatus({ type: 'success', msg: 'Dataset Loaded!' });
            updateCounts();
        } else if (!res.canceled) {
            setStatus({ type: 'error', msg: 'Load Failed: ' + res.error });
        } else {
            setStatus(null);
        }
    };

    const handleClear = () => {
        if (confirm("Are you sure you want to clear ALL training data?")) {
            if (onClear) onClear();
            updateCounts();
            setStatus({ type: 'info', msg: 'Dataset Cleared' });
        }
    };

    // Calculate totals
    const totalClassSamples = Object.values(counts?.classification || {}).reduce((a, b) => a + b, 0);
    const totalRegressionSamples = Object.values(counts?.regression || {}).reduce((a, b) => a + b, 0);

    return (
        <div className="h-full flex flex-col p-8 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4">

            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400">
                    <Database size={32} />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Data Management</h1>
                    <p className="text-white/40 font-mono text-sm mt-1">Export, Import, and Manage your Training Sets</p>
                </div>
            </div>

            {/* Status Bar */}
            {status && (
                <div className={`mb-6 p-4 rounded-lg border flex items-center gap-3 ${status.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                    status.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                        'bg-blue-500/10 border-blue-500/30 text-blue-400'
                    }`}>
                    <AlertCircle size={18} />
                    <span className="font-mono text-sm">{status.msg}</span>
                </div>
            )}

            {/* Main Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Stats Card */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <FileJson size={18} className="text-emerald-400" />
                        Current Session
                    </h3>

                    <div className="space-y-4">
                        <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                            <span className="text-white/60 text-sm">Classification Samples</span>
                            <span className="font-mono font-bold text-xl">{totalClassSamples}</span>
                        </div>
                        <div className="pl-4 space-y-2">
                            {Object.entries(counts?.classification || {}).map(([id, count]) => (
                                <div key={id} className="flex justify-between text-xs text-white/40 font-mono">
                                    <span>{id}</span>
                                    <span>{count}</span>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                            <span className="text-white/60 text-sm">Regression Samples</span>
                            <span className="font-mono font-bold text-xl">{totalRegressionSamples}</span>
                        </div>
                    </div>
                </div>

                {/* Actions Card */}
                <div className="space-y-4">
                    <ActionBtn
                        icon={<Download size={20} />}
                        label="Save Dataset"
                        desc="Export current training data to JSON file"
                        onClick={handleSave}
                        color="bg-blue-600 hover:bg-blue-500"
                    />

                    <ActionBtn
                        icon={<Upload size={20} />}
                        label="Load Dataset"
                        desc="Import training data from JSON file"
                        onClick={handleLoad}
                        color="bg-emerald-600 hover:bg-emerald-500"
                    />

                    <div className="h-px bg-white/10 my-4" />

                    <ActionBtn
                        icon={<Trash2 size={20} />}
                        label="Clear All Data"
                        desc="Permanently delete all current training samples"
                        onClick={handleClear}
                        color="bg-red-900/50 hover:bg-red-800/50 text-red-200 border-red-800"
                        variant="danger"
                    />
                </div>
            </div>
        </div>
    );
}

function ActionBtn({ icon, label, desc, onClick, color, variant }) {
    return (
        <button
            onClick={onClick}
            className={`w-full p-4 rounded-xl flex items-center gap-4 transition-all hover:scale-[1.02] active:scale-[0.98] group text-left
                ${variant === 'danger' ? 'border border-red-500/20' : 'bg-white/5 hover:bg-white/10 border border-white/5'}
            `}
        >
            <div className={`p-3 rounded-lg ${color} text-white shadow-lg`}>
                {icon}
            </div>
            <div>
                <div className="font-bold text-sm tracking-wide">{label}</div>
                <div className="text-xs text-white/40 group-hover:text-white/60 transition-colors">{desc}</div>
            </div>
        </button>
    );
}
