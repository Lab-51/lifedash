// === FILE PURPOSE ===
// GitHub-style activity heatmap using CSS Grid. Design-agnostic — works in both Classic and Modern.

import { useMemo } from 'react';

export function getColor(count: number): string {
    if (count === 0) return 'bg-surface-700/50';
    if (count === 1) return 'bg-emerald-900/60';
    if (count <= 3) return 'bg-emerald-700/70';
    if (count <= 5) return 'bg-emerald-500/80';
    return 'bg-emerald-400';
}

export function calculateStreak(dayCounts: Record<string, number>): number {
    let count = 0;
    const today = new Date();
    for (let i = 0; i <= 90; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dayOfWeek = d.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
        const dateStr = d.toISOString().split('T')[0];
        if ((dayCounts[dateStr] || 0) > 0) {
            count++;
        } else {
            break;
        }
    }
    return count;
}

interface Props {
    dayCounts: Record<string, number>;
}

export default function ActivityHeatmap({ dayCounts }: Props) {
    const cells = useMemo(() => {
        const today = new Date();
        const result: Array<{ date: string; count: number }> = [];
        for (let i = 90; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            result.push({ date: dateStr, count: dayCounts[dateStr] || 0 });
        }
        return result;
    }, [dayCounts]);

    return (
        <div className="inline-grid grid-flow-col grid-rows-7 gap-[3px]">
            {cells.map(cell => (
                <div
                    key={cell.date}
                    className={`w-[10px] h-[10px] rounded-sm ${getColor(cell.count)}`}
                    title={`${cell.date}: ${cell.count} ${cell.count === 1 ? 'activity' : 'activities'}`}
                />
            ))}
        </div>
    );
}
