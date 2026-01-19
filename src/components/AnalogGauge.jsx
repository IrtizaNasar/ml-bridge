import React from 'react';

export function AnalogGauge({ value, label, min = 0, max = 1 }) {
    const normalizedValue = Math.min(1, Math.max(0, (value - min) / (max - min)));
    const needleAngle = -90 + (normalizedValue * 180);

    const radius = 70;
    const centerX = 100;
    const centerY = 100;

    const startAngle = Math.PI;
    const endAngle = startAngle + (normalizedValue * Math.PI);

    const x1 = centerX + radius * Math.cos(startAngle);
    const y1 = centerY + radius * Math.sin(startAngle);
    const x2 = centerX + radius * Math.cos(endAngle);
    const y2 = centerY + radius * Math.sin(endAngle);

    const largeArcFlag = normalizedValue > 0.5 ? 1 : 0;

    return (
        <div className="flex flex-col items-center justify-center">
            <div className="relative w-44 h-20 mb-4">
                <svg className="w-full h-full" viewBox="0 0 200 100">
                    <defs>
                        <linearGradient id={`g-${label}`} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#3b82f6" />
                            <stop offset="50%" stopColor="#10b981" />
                            <stop offset="100%" stopColor="#eab308" />
                        </linearGradient>
                    </defs>

                    {/* Background arc */}
                    <path
                        d="M 30 100 A 70 70 0 0 1 170 100"
                        fill="none"
                        stroke="#27272a"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />

                    {/* Active arc */}
                    {normalizedValue > 0 && (
                        <path
                            d={`M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`}
                            fill="none"
                            stroke={`url(#g-${label})`}
                            strokeWidth="2"
                            strokeLinecap="round"
                            className="transition-all duration-300"
                        />
                    )}

                    {/* Needle */}
                    <line
                        x1={centerX}
                        y1={centerY}
                        x2={centerX + 60 * Math.cos((needleAngle * Math.PI) / 180)}
                        y2={centerY + 60 * Math.sin((needleAngle * Math.PI) / 180)}
                        stroke="#ffffff"
                        strokeWidth="1"
                        strokeLinecap="round"
                        className="transition-all duration-300"
                    />
                </svg>
            </div>

            <div className="text-center">
                <div className="text-5xl font-extralight text-white tabular-nums">
                    {(value * 100).toFixed(0)}
                </div>
                <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mt-1">
                    {label}
                </div>
            </div>
        </div>
    );
}
