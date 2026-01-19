import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-[#0a0a0a] border border-zinc-800 rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden">
                {/* Header */}
                <div className="p-6 pb-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                        <AlertTriangle className="text-amber-500" size={20} />
                    </div>
                    <h2 className="text-lg font-bold text-white">{title}</h2>
                </div>

                {/* Content */}
                <div className="px-6 pb-6">
                    <p className="text-sm text-zinc-400 leading-relaxed">
                        Switching input source will clear all training data and models.
                    </p>
                    <p className="text-sm text-zinc-500 mt-3">
                        Any unsaved work will be lost.
                    </p>
                </div>

                {/* Actions */}
                <div className="px-6 pb-6 flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2.5 rounded bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white border border-zinc-800 text-sm font-bold uppercase tracking-wider transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 px-4 py-2.5 rounded bg-emerald-500 text-black hover:bg-emerald-400 text-sm font-bold uppercase tracking-wider transition-all"
                    >
                        Continue
                    </button>
                </div>
            </div>
        </div>
    );
}
