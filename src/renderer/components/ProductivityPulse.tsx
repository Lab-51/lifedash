// === FILE PURPOSE ===
// Productivity Pulse — SVG-based Contribution Graph
// Renders a strict GitHub-style activity heatmap.
// Accurate date alignment, Year handling, and precise distribution.

import { useMemo, useState, useEffect, useRef } from 'react';
import { Flame } from 'lucide-react';

interface Props {
  data: Record<string, number>;
}

// Visual Configuration
const SQUARE_SIZE = 12;
const GAP = 3;
const DAY_LABEL_WIDTH = 30; // Width for Mon, Wed, Fri labels
const MONTH_LABEL_HEIGHT = 20;
const WEEK_WIDTH = SQUARE_SIZE + GAP;

/** Format a Date as YYYY-MM-DD in local timezone (avoids UTC shift from toISOString). */
function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calculateStreak(data: Record<string, number>): number {
  let count = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = toLocalDateStr(d);
    const val = data[dateStr] || 0;

    if (i === 0 && val === 0) continue;

    if (val > 0) count++;
    else break;
  }
  return count;
}

function getClass(count: number): string {
  if (count === 0) return 'fill-surface-100 dark:fill-surface-800/50';
  if (count <= 1) return 'fill-emerald-200 dark:fill-emerald-900/60';
  if (count <= 3) return 'fill-emerald-300 dark:fill-emerald-700';
  if (count <= 5) return 'fill-emerald-400 dark:fill-emerald-600';
  return 'fill-emerald-500 dark:fill-emerald-500';
}

export default function ProductivityPulse({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numWeeks, setNumWeeks] = useState(52);

  // 1. Responsive width calculation
  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth - 48; // Padding 24px * 2
        const availableWidth = width - DAY_LABEL_WIDTH;
        const weeks = Math.floor(availableWidth / WEEK_WIDTH);
        setNumWeeks(Math.max(10, weeks));
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 2. Data Processing & Grid Generation
  const { grid, monthLabels } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the Saturday of the current week to anchor the end of the graph
    // This ensures the last column (current week) is visible
    const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat
    const daysUntilSaturday = 6 - dayOfWeek;

    const gridEndDate = new Date(today);
    gridEndDate.setDate(today.getDate() + daysUntilSaturday);

    // Calculate Start Date based on numWeeks
    // gridStart = gridEndDate - (numWeeks weeks) + 1 day?
    // We want exactly numWeeks columns.
    // Start date should be a Sunday.
    // gridEndDate is Saturday.
    // total days = numWeeks * 7.
    // startDate = gridEndDate - (totalDays - 1)
    const totalDays = numWeeks * 7;
    const startDate = new Date(gridEndDate);
    startDate.setDate(gridEndDate.getDate() - totalDays + 1);

    const gridData = [];
    const months: { label: string; x: number }[] = [];

    let currentDate = new Date(startDate);
    let firstLabelAdded = false;

    for (let w = 0; w < numWeeks; w++) {
      const weekDays = [];
      let weekContainsFirstOfMonth = false;
      let monthOfFirst = -1;
      let yearOfFirst = -1;

      for (let d = 0; d < 7; d++) {
        const dateStr = toLocalDateStr(currentDate);
        const count = data[dateStr] || 0;
        const m = currentDate.getMonth();
        const y = currentDate.getFullYear();
        const dom = currentDate.getDate();

        // Check if this specific day is the 1st of the month
        if (dom === 1) {
          weekContainsFirstOfMonth = true;
          monthOfFirst = m;
          yearOfFirst = y;
        }

        // Don't show future days in the last week
        const isFuture = currentDate > today;

        weekDays.push({
          date: new Date(currentDate),
          dateStr,
          count,
          isFuture,
        });

        currentDate.setDate(currentDate.getDate() + 1); // Next day
      }

      gridData.push({ days: weekDays, index: w });

      // Month Labels Logic
      // If this week contains the 1st of a month, we label it.
      if (weekContainsFirstOfMonth) {
        const dateForLabel = new Date(yearOfFirst, monthOfFirst, 1);
        const isJan = monthOfFirst === 0;

        let label = dateForLabel.toLocaleDateString('en-US', { month: 'short' });

        // Add year if January OR if it's the very first label we are showing (for context)
        if (isJan || !firstLabelAdded) {
          label += ` ${dateForLabel.getFullYear()}`;
        }

        // Prevent overlapping labels: Only add if enough space from last one?
        // Visual check: 4 weeks per month approx. 4 * 15px = 60px.
        // Label "Jan 2024" is approx 50-60px. "Jan" is 20px.
        // We should be fine mostly.

        // Adjust X position: slightly left to align with the start of the week?
        // Or align with the day that is the 1st?
        // GitHub aligns roughly over the column.
        months.push({ label, x: w * WEEK_WIDTH + DAY_LABEL_WIDTH });
        firstLabelAdded = true;
      }
    }

    return { grid: gridData, monthLabels: months };
  }, [data, numWeeks]);

  const streak = useMemo(() => calculateStreak(data), [data]);
  const totalActivities = Object.values(data).reduce((a, b) => a + b, 0);

  const svgWidth = numWeeks * WEEK_WIDTH + DAY_LABEL_WIDTH;
  const svgHeight = 7 * WEEK_WIDTH + MONTH_LABEL_HEIGHT;

  // Summary stats to fill vertical space
  const todayStr = toLocalDateStr(new Date());
  const todayCount = data[todayStr] || 0;

  // Best day
  const bestDay = useMemo(() => {
    let max = 0;
    let bestDate = '';
    for (const [date, count] of Object.entries(data)) {
      if (count > max) {
        max = count;
        bestDate = date;
      }
    }
    return { count: max, date: bestDate };
  }, [data]);

  // Weekly average
  const weeklyAvg = useMemo(() => {
    const weeks = Math.max(1, Math.round(numWeeks));
    return (totalActivities / weeks).toFixed(1);
  }, [totalActivities, numWeeks]);

  // Active days count
  const activeDays = useMemo(() => {
    return Object.values(data).filter((c) => c > 0).length;
  }, [data]);

  return (
    <div ref={containerRef} className="w-full h-full hud-panel clip-corner-cut-sm p-6 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="font-hud text-xs tracking-widest text-[var(--color-accent-dim)]">SYS.PULSE</span>
            <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
          </div>
          <p className="font-data text-sm text-[var(--color-text-secondary)]">
            {totalActivities} contributions in the last {Math.round(numWeeks / 4.3)} months
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[var(--color-accent-subtle)] rounded-lg border border-[var(--color-border-accent)]">
          <Flame
            size={16}
            className={
              streak > 0 ? 'text-[var(--color-warm)] fill-[var(--color-warm)]/20' : 'text-[var(--color-text-muted)]'
            }
          />
          <span className="font-data text-sm text-[var(--color-text-primary)]">{streak} day streak</span>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="w-full overflow-hidden shrink-0">
        <svg width="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="overflow-visible block">
          {/* Month Labels */}
          <g transform={`translate(0, 10)`}>
            {monthLabels.map((m, i) => (
              <text
                key={i}
                x={m.x}
                y={0}
                className="fill-surface-400 text-[0.625rem] font-semibold"
                dominantBaseline="middle"
              >
                {m.label}
              </text>
            ))}
          </g>

          {/* Day Labels - Mon, Wed, Fri */}
          <g transform={`translate(0, ${MONTH_LABEL_HEIGHT})`}>
            <text
              x={0}
              y={1 * WEEK_WIDTH + SQUARE_SIZE / 2 + 1}
              className="fill-surface-400 text-[0.625rem]"
              dominantBaseline="middle"
            >
              Mon
            </text>
            <text
              x={0}
              y={3 * WEEK_WIDTH + SQUARE_SIZE / 2 + 1}
              className="fill-surface-400 text-[0.625rem]"
              dominantBaseline="middle"
            >
              Wed
            </text>
            <text
              x={0}
              y={5 * WEEK_WIDTH + SQUARE_SIZE / 2 + 1}
              className="fill-surface-400 text-[0.625rem]"
              dominantBaseline="middle"
            >
              Fri
            </text>
          </g>

          {/* The Grid */}
          <g transform={`translate(${DAY_LABEL_WIDTH}, ${MONTH_LABEL_HEIGHT})`}>
            {grid.map((week, wIndex) => (
              <g key={wIndex} transform={`translate(${wIndex * WEEK_WIDTH}, 0)`}>
                {week.days.map((day, dIndex) =>
                  /* Only render if not future, or render placeholder */
                  day.isFuture ? (
                    <rect
                      key={dIndex}
                      y={dIndex * WEEK_WIDTH}
                      width={SQUARE_SIZE}
                      height={SQUARE_SIZE}
                      rx={2}
                      className="fill-transparent" // Invisible place holder
                    />
                  ) : (
                    <rect
                      key={dIndex}
                      y={dIndex * WEEK_WIDTH}
                      width={SQUARE_SIZE}
                      height={SQUARE_SIZE}
                      rx={2}
                      className={`transition-all duration-200 hover:opacity-80 shape-rendering-geometricPrecision ${getClass(day.count)}`}
                    >
                      <title>{`${day.date.toDateString()}: ${day.count} activities`}</title>
                    </rect>
                  ),
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>

      {/* Legend + Stats row — fills remaining vertical space */}
      <div className="flex items-center justify-between mt-3 pt-3 shrink-0">
        <div className="ruled-line-accent flex-1 mr-4" />
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] font-data">
          <span>Less</span>
          <div className="flex gap-1">
            <div className="w-3 h-3 rounded-[2px] bg-surface-100 dark:bg-surface-800/50" />
            <div className="w-3 h-3 rounded-[2px] bg-emerald-200 dark:bg-emerald-900/60" />
            <div className="w-3 h-3 rounded-[2px] bg-emerald-300 dark:bg-emerald-700" />
            <div className="w-3 h-3 rounded-[2px] bg-emerald-400 dark:bg-emerald-600" />
            <div className="w-3 h-3 rounded-[2px] bg-emerald-500 dark:bg-emerald-500" />
          </div>
          <span>More</span>
        </div>
      </div>

      {/* Summary Stats — fills the remaining vertical space */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 flex-1">
        <div className="hud-panel clip-corner-cut-sm p-3 flex flex-col justify-center">
          <p className="font-hud text-[0.625rem] tracking-wider text-[var(--color-accent-dim)]">Today</p>
          <p className="font-[var(--font-display)] text-xl text-[var(--color-accent)] text-glow mt-1">{todayCount}</p>
          <p className="font-data text-[0.625rem] text-[var(--color-text-muted)]">activities</p>
        </div>
        <div className="hud-panel clip-corner-cut-sm p-3 flex flex-col justify-center">
          <p className="font-hud text-[0.625rem] tracking-wider text-[var(--color-accent-dim)]">Best Day</p>
          <p className="font-[var(--font-display)] text-xl text-[var(--color-accent)] text-glow mt-1">
            {bestDay.count}
          </p>
          <p className="font-data text-[0.625rem] text-[var(--color-text-muted)]">
            {bestDay.date
              ? new Date(bestDay.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—'}
          </p>
        </div>
        <div className="hud-panel clip-corner-cut-sm p-3 flex flex-col justify-center">
          <p className="font-hud text-[0.625rem] tracking-wider text-[var(--color-accent-dim)]">Weekly Avg</p>
          <p className="font-[var(--font-display)] text-xl text-[var(--color-text-primary)] mt-1">{weeklyAvg}</p>
          <p className="font-data text-[0.625rem] text-[var(--color-text-muted)]">per week</p>
        </div>
        <div className="hud-panel clip-corner-cut-sm p-3 flex flex-col justify-center">
          <p className="font-hud text-[0.625rem] tracking-wider text-[var(--color-accent-dim)]">Active Days</p>
          <p className="font-[var(--font-display)] text-xl text-[var(--color-text-primary)] mt-1">{activeDays}</p>
          <p className="font-data text-[0.625rem] text-[var(--color-text-muted)]">of {numWeeks * 7}</p>
        </div>
      </div>
    </div>
  );
}
