import React, { useEffect, useRef } from 'react';

/**
 * Visualizer Component
 * Renders a real-time oscilloscope-style line graph (or "Training Curves")
 * using HTML5 Canvas for performance.
 */
export function Visualizer({ data, selectedFeatures, width = 300, height = 100 }) {
    const canvasRef = useRef(null);
    const historyRef = useRef({}); // Stores { featureKey: [values] }
    const maxHistory = 100; // Moving window size

    useEffect(() => {
        if (!data || Object.keys(data).length === 0) return;

        // Determine which keys we track (all seen keys + currently selected)
        const incomingKeys = Object.keys(data).filter(k => typeof data[k] === 'number');

        // Ensure all historical buffers are same length
        const allKeys = new Set([...Object.keys(historyRef.current), ...incomingKeys]);

        allKeys.forEach(k => {
            if (!historyRef.current[k]) historyRef.current[k] = [];
            const buffer = historyRef.current[k];

            const newVal = (typeof data[k] === 'number')
                ? data[k]
                : (buffer.length > 0 ? buffer[buffer.length - 1] : 0);

            buffer.push(newVal);
            if (buffer.length > maxHistory) buffer.shift();
        });

        drawCanvas();
    }, [data, selectedFeatures]);

    const drawCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const history = historyRef.current;

        // --- 1. SETUP CANVAS ---
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, width, height);

        // --- 2. TECHNICAL GRID ---
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        for (let y = 0; y <= height; y += 20) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
        ctx.stroke();

        // Active keys to draw
        const activeKeys = Array.from(selectedFeatures).length > 0
            ? Array.from(selectedFeatures)
            : Object.keys(history);

        if (activeKeys.length === 0) return;

        if (activeKeys.length === 0) return;

        // Cinematic colors
        const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

        // --- 3. DRAW CINEMATIC LINES ---
        activeKeys.forEach((k, idx) => {
            const buffer = history[k];
            if (!buffer || buffer.length < 2) return;
            const color = colors[idx % colors.length];

            // Local Auto-Scale (Individual Scaling)
            let min = Infinity;
            let max = -Infinity;
            buffer.forEach(v => {
                if (v < min) min = v;
                if (v > max) max = v;
            });

            const range = max - min;
            const margin = range === 0 ? (Math.abs(min) * 0.1 || 1) : range * 0.2;
            const drawMin = min - margin;
            const drawMax = max + margin;
            const getLocalY = (val) => height - ((val - drawMin) / (drawMax - drawMin)) * height;

            // 1. Subtle Glow Path
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.08;
            buffer.forEach((val, i) => {
                const x = (i / maxHistory) * width;
                const y = getLocalY(val);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // 2. Crisp Core Line
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = 0.9;
            buffer.forEach((val, i) => {
                const x = (i / maxHistory) * width;
                const y = getLocalY(val);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        });

        ctx.globalAlpha = 1.0;
    }

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="w-full h-full block border-t border-white/20"
        />
    );
}
