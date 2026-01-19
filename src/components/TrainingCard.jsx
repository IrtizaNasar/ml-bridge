import { Trash2, Plus, UploadCloud } from 'lucide-react';

export function TrainingCard({
    mode, setMode,
    isRunning, setIsRunning,
    classes, outputs,
    prediction,
    onTrain, onClear,
    onAddClass, onRemoveClass, onRenameClass,
    onAddOutput, onRemoveOutput, onUpdateOutputTarget,
    error,
    engineType, setEngineType,
    isModelTraining, trainingProgress,
    onTrainModel, onExportArduino,
    hasDenseModel,
    onClearError,
    onUpload, // New Prop for handling file drops
    inputSource
}) {
    return (
        <div className="col-span-12 lg:col-span-8 fui-panel p-0 flex flex-col h-full min-h-[500px] relative">
            {error && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-2 rounded-lg text-xs font-mono flex items-center gap-2 backdrop-blur-md shadow-lg animate-in fade-in slide-in-from-top-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    {error}
                    {onClearError && (
                        <button onClick={onClearError} className="ml-2 hover:text-white"><Trash2 size={10} /></button>
                    )}
                </div>
            )}
            {/* Header / Toolbar */}
            <div className="px-6 py-4 border-b border-white/5 bg-white/[0.01] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 backdrop-blur-sm">

                {/* Mode Switcher */}
                <div className="flex gap-4 items-center">
                    <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                        <button
                            onClick={() => setMode('classification')}
                            className={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all ${mode === 'classification' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/70'}`}
                        >
                            Classification
                        </button>
                        <button
                            onClick={() => setMode('regression')}
                            className={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all ${mode === 'regression' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/70'}`}
                        >
                            Regression
                        </button>
                    </div>

                    {mode === 'classification' && (
                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 ml-2">
                            <button
                                onClick={() => setEngineType('knn')}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-mono transition-all ${engineType === 'knn' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'text-white/30 hover:text-white/60'}`}
                            >
                                KNN (Instant)
                            </button>
                            <button
                                onClick={() => setEngineType('dense')}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-mono transition-all ${engineType === 'dense' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'text-white/30 hover:text-white/60'}`}
                            >
                                Neural Net (Export)
                            </button>
                        </div>
                    )}
                </div>

                {/* Controls Frame */}
                <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    {/* Run / Stop Toggle */}
                    <button
                        onClick={() => setIsRunning(!isRunning)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${isRunning
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)] hover:bg-emerald-500/20'
                            : 'bg-yellow-500/5 border-yellow-500/20 text-yellow-500/80 hover:bg-yellow-500/10'
                            }`}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-yellow-500'} `}></div>
                        <span className="text-[10px] font-bold tracking-widest uppercase">{isRunning ? 'Running' : 'Paused'}</span>
                    </button>

                    <div className="h-4 w-[1px] bg-white/10 mx-1"></div>

                    <button
                        onClick={onClear}
                        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-white/40 hover:text-white/90 hover:bg-white/5 transition-all"
                    >
                        <Trash2 size={12} className="group-hover:text-red-400 transition-colors" />
                        <span>Reset</span>
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {engineType === 'dense' && mode === 'classification' && (
                <div className="px-6 py-4 bg-emerald-500/5 border-b border-emerald-500/10 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onTrainModel}
                            disabled={isModelTraining}
                            className={`px-4 py-2 rounded-lg font-bold text-xs tracking-wider uppercase transition-all flex items-center gap-2 ${isModelTraining ? 'bg-white/5 text-white/20 cursor-wait' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40'}`}
                        >
                            {isModelTraining ? <div className="animate-spin w-3 h-3 border-2 border-white/20 border-t-white rounded-full" /> : <div className="w-2 h-2 bg-white rounded-full" />}
                            {isModelTraining ? 'TRAINING...' : 'TRAIN MODEL'}
                        </button>

                        {trainingProgress && (
                            <div className="flex gap-4 text-[10px] font-mono text-emerald-300">
                                <span>EPOCH: {trainingProgress.epoch}</span>
                                <span>LOSS: {trainingProgress.loss.toFixed(4)}</span>
                                {trainingProgress.modelType === 'regression' ? (
                                    <span>MSE: {trainingProgress.accuracy.toFixed(4)}</span>
                                ) : (
                                    <span>ACC: {(trainingProgress.accuracy * 100).toFixed(1)}%</span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onExportArduino}
                            disabled={!hasDenseModel || isModelTraining}
                            className={`px-3 py-1.5 rounded border text-[10px] font-mono flex items-center gap-2 transition-all ${hasDenseModel && !isModelTraining ? 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10' : 'border-white/5 text-white/10 cursor-not-allowed'}`}
                        >
                            <span>EXPORT FOR ARDUINO</span>
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                {mode === 'classification' ? (
                    <div className="grid grid-cols-2 gap-4 h-full content-start">
                        {classes.map((cls) => (
                            <ClassCard
                                key={cls.id}
                                cls={cls}
                                prediction={prediction}
                                onTrain={() => onTrain(cls.id)}
                                onRemove={() => onRemoveClass(cls.id)}
                                onRename={(val) => onRenameClass(cls.id, val)}
                                engineType={engineType}
                                onUpload={onUpload} // Pass down
                                inputSource={inputSource}
                            />
                        ))}

                        <button
                            onClick={onAddClass}
                            className="border border-white/5 border-dashed rounded-xl flex flex-col items-center justify-center text-white/20 hover:text-white/80 hover:bg-white/[0.02] hover:border-white/20 transition-all min-h-[200px] group gap-3 active:scale-[0.99]"
                        >
                            <div className="p-3 rounded-full bg-white/[0.02] group-hover:bg-white/10 transition-colors shadow-sm">
                                <Plus size={24} strokeWidth={1.5} />
                            </div>
                            <span className="text-xs font-medium tracking-wide">Add New Class</span>
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {outputs.map((out) => (
                            <RegressionCard
                                key={out.id}
                                output={out}
                                prediction={prediction}
                                onTrain={onTrain}
                                onRemove={() => onRemoveOutput(out.id)}
                                onUpdateTarget={(val) => onUpdateOutputTarget(out.id, val)}
                            />
                        ))}
                        <button
                            onClick={onAddOutput}
                            className="w-full py-4 border border-white/5 border-dashed rounded-xl flex items-center justify-center text-white/20 hover:text-white/80 hover:bg-white/[0.02] hover:border-white/20 transition-all gap-2 active:scale-[0.99]"
                        >
                            <Plus size={16} />
                            <span className="text-xs font-medium tracking-wide">Add Parameter</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function RegressionCard({ output, prediction, onTrain, onRemove, onUpdateTarget }) {
    const predictedValue = prediction?.regression?.[output.id];
    const hasPrediction = predictedValue !== undefined && predictedValue !== null;

    return (
        <div className="relative group bg-[#0C0C0C] border border-white/5 p-5 rounded-xl flex gap-6 items-center">
            <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="absolute top-3 right-3 p-1.5 text-white/10 hover:text-red-400 hover:bg-white/5 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-20"
            >
                <Trash2 size={14} />
            </button>

            {/* Slider Control */}
            <div className="flex-1 relative">
                <div className="flex justify-between mb-2">
                    <div className="flex items-center gap-3">
                        <h4 className="text-sm font-medium text-white/90">{output.name}</h4>
                        {hasPrediction && (
                            <span className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 animate-pulse">
                                LIVE: {predictedValue.toFixed(2)}
                            </span>
                        )}
                    </div>
                    <span className="font-mono text-white/40 text-xs">Target: {output.value.toFixed(2)}</span>
                </div>

                <div className="flex flex-col gap-1">
                    {/* Visual Prediction Feedback Bar (Separate from Input) */}
                    <div className="relative h-2 bg-white/5 rounded-full overflow-hidden w-full">
                        {hasPrediction && (
                            <div
                                className="absolute top-0 left-0 h-full bg-emerald-500 transition-all duration-75 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                                style={{ width: `${predictedValue * 100}% ` }}
                            />
                        )}
                    </div>

                    {/* Target Slider (Interactive) */}
                    <div className="relative h-5 flex items-center">
                        <input
                            type="range"
                            min="0" max="1" step="0.01"
                            value={output.value}
                            onChange={(e) => onUpdateTarget(parseFloat(e.target.value))}
                            className="relative w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer z-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_5px_rgba(255,255,255,0.5)] hover:[&::-webkit-slider-thumb]:scale-125 transition-all focus:outline-none"
                        />
                    </div>
                </div>

                <div className="flex justify-between -mt-1 text-[9px] text-white/20 font-mono">
                    <span>0.0</span>
                    <span>1.0</span>
                </div>
            </div>

            <div className="text-[10px] text-white/30 font-medium bg-white/[0.02] px-2 py-0.5 rounded">
                {output.samples} SAMPLES
            </div>
            <button
                onMouseDown={() => {
                    const interval = setInterval(() => onTrain(output.id, output.value), 50);
                    window.currentTrainInterval = interval;
                }}
                onMouseUp={() => {
                    if (window.currentTrainInterval) clearInterval(window.currentTrainInterval);
                }}
                onMouseLeave={() => {
                    if (window.currentTrainInterval) clearInterval(window.currentTrainInterval);
                }}
                className="w-full py-2 bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/20 border border-white/5 rounded-lg text-xs font-medium text-white/60 transition-all flex justify-center items-center gap-2 select-none active:scale-95"
            >
                Record
            </button>
        </div>
    );
}



function ClassCard({ cls, prediction, onTrain, onRemove, onRename, engineType, onUpload, inputSource }) {
    const confidence = prediction?.confidences?.[cls.id] || 0;
    const isPredicted = prediction?.label === cls.id;
    const [isRecording, setIsRecording] = React.useState(false);

    // File Input Ref
    const fileInputRef = React.useRef(null);

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0 && onUpload) {
            Array.from(e.target.files).forEach(file => onUpload(cls.id, file));
        }
    };

    const isUploadMode = inputSource === 'upload';

    return (
        <div
            className={`relative group bg-[#0C0C0C] border p-5 h-full flex flex-col rounded-xl transition-all duration-300 ${isPredicted ? 'border-emerald-500/30 shadow-[0_4px_20px_-4px_rgba(16,185,129,0.1)]' : 'border-white/5 hover:border-white/10 hover:shadow-lg hover:shadow-black/50'
                } `}
        >

            <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="absolute top-3 right-3 p-1.5 text-white/10 hover:text-red-400 hover:bg-white/5 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-20"
            >
                <Trash2 size={14} />
            </button>

            <div className={`absolute top-0 left-0 w-full h-[2px] transition-all duration-300 ${isPredicted ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-transparent'} `} />

            <div className="mt-1 flex-1">
                <div className="flex justify-between items-start">
                    <div>
                        <input
                            type="text"
                            value={cls.name}
                            onChange={(e) => onRename(e.target.value)}
                            className="text-lg font-medium text-white/90 tracking-tight bg-transparent border-none p-0 focus:outline-none focus:ring-0 focus:border-b focus:border-white/20 w-32 placeholder-white/20"
                        />
                        <p className="text-white/30 text-[10px] font-mono mt-0.5">{cls.id}</p>
                    </div>
                    {isPredicted && (
                        <div className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/10 self-start">
                            <span className="text-[9px] font-bold text-emerald-500 tracking-wide">ACTIVE</span>
                        </div>
                    )}
                </div>

                <div className="mt-6">
                    <div className="flex items-baseline gap-1.5">
                        <span className={`text-4xl font-light tracking-tighter transition-colors ${isPredicted ? 'text-emerald-400' : 'text-white/80'} `}>
                            {Math.round(confidence * 100)}
                        </span>
                        <span className="text-sm text-white/30 font-light">%</span>
                    </div>
                </div>
            </div>

            <div className="mt-6 relative z-10 flex gap-2">
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                />

                {isUploadMode ? (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-2.5 rounded-lg bg-white/5 border border-white/5 text-white/70 hover:text-white hover:bg-white/10 hover:border-white/10 transition-all flex items-center justify-center gap-2 group/upload"
                    >
                        <UploadCloud size={16} className="text-white/40 group-hover/upload:text-white transition-colors" />
                        <span className="text-xs font-medium">Upload Images</span>
                    </button>
                ) : (
                    <button
                        onMouseDown={() => {
                            onTrain(); // Record immediately
                            const interval = setInterval(onTrain, 100);
                            window.currentTrainInterval = interval;
                            setIsRecording(true);
                        }}
                        onMouseUp={() => {
                            if (window.currentTrainInterval) clearInterval(window.currentTrainInterval);
                            setIsRecording(false);
                        }}
                        onMouseLeave={() => {
                            if (window.currentTrainInterval) clearInterval(window.currentTrainInterval);
                            setIsRecording(false);
                        }}
                        className={`flex-1 py-2 rounded-lg font-medium text-[11px] transition-all active:scale-[0.98] select-none flex items-center justify-center gap-2 ${isRecording
                            ? (engineType === 'dense'
                                ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)] border border-transparent'
                                : 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)] border border-transparent')
                            : (isPredicted
                                ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] border border-transparent'
                                : 'bg-white/5 border border-white/5 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/10')
                            } `}
                    >
                        {isRecording ? (
                            <>
                                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> {engineType === 'dense' ? 'Recording...' : 'Training...'}
                            </>
                        ) : (engineType === 'dense' ? 'Hold to Record' : 'Hold to Train')}
                    </button>
                )}
            </div>
        </div>
    );
}
