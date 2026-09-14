import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays, X, ChevronDown } from 'lucide-react';
import DatePicker from './common/DatePicker';

/**
 * Compute start & end ISO dates for any range selection
 */
export function computeRangeDates(type, count = 1, unit = 'M', customStart = '', customEnd = '') {
  const today = new Date();
  const endIso = today.toISOString().split('T')[0];

  if (type === 'ALL') {
    return { startDate: null, endDate: endIso, label: 'ALL', rangeKey: 'ALL' };
  }

  if (type === 'CUSTOM') {
    return {
      startDate: customStart || '2020-01-01',
      endDate: customEnd || endIso,
      label: 'Custom',
      rangeKey: 'CUSTOM'
    };
  }

  const safeCount = Math.max(1, parseInt(count, 10) || 1);
  const normalizedUnit = (unit || 'M').toUpperCase().charAt(0); // 'D', 'W', 'M', 'Y'
  const d = new Date(today);

  if (normalizedUnit === 'D') {
    d.setDate(d.getDate() - safeCount);
  } else if (normalizedUnit === 'W') {
    d.setDate(d.getDate() - safeCount * 7);
  } else if (normalizedUnit === 'M') {
    d.setMonth(d.getMonth() - safeCount);
  } else if (normalizedUnit === 'Y') {
    d.setFullYear(d.getFullYear() - safeCount);
  }

  const startIso = d.toISOString().split('T')[0];
  const unitLabel = normalizedUnit === 'D' ? (safeCount === 1 ? 'Day' : 'Days') :
                    normalizedUnit === 'W' ? (safeCount === 1 ? 'Week' : 'Weeks') :
                    normalizedUnit === 'M' ? (safeCount === 1 ? 'Month' : 'Months') :
                    (safeCount === 1 ? 'Year' : 'Years');

  return {
    startDate: startIso,
    endDate: endIso,
    label: `${safeCount} ${unitLabel}`,
    rangeKey: `${safeCount}${normalizedUnit}`
  };
}

/**
 * Parse an existing range string like '1M', '3M', '6M', '1Y', 'ALL', 'CUSTOM'
 */
export function parseInitialRange(initialRange = '1M') {
  if (!initialRange || initialRange === 'ALL') {
    return { type: 'ALL', count: 1, unit: 'M' };
  }
  if (initialRange === 'CUSTOM') {
    return { type: 'CUSTOM', count: 1, unit: 'M' };
  }
  const match = String(initialRange).match(/^(\d+)([DWMYdwmy])$/);
  if (match) {
    return {
      type: 'RELATIVE',
      count: parseInt(match[1], 10) || 1,
      unit: match[2].toUpperCase()
    };
  }
  return { type: 'RELATIVE', count: 1, unit: 'M' };
}

export default function ChartRangeSelector({
  rangeType: controlledType,
  relativeCount: controlledCount,
  relativeUnit: controlledUnit,
  startDate: controlledStartDate,
  endDate: controlledEndDate,
  initialRange = '1M',
  onChange,
  className = '',
  popoverAlign = 'right'
}) {
  const initialParsed = parseInitialRange(initialRange);

  // Internal state
  const [rangeType, setRangeType] = useState(controlledType || initialParsed.type);
  const [count, setCount] = useState(controlledCount || initialParsed.count || 1);
  const [unit, setUnit] = useState(controlledUnit || initialParsed.unit || 'M');
  const [showCalendar, setShowCalendar] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];
  const [customStart, setCustomStart] = useState(controlledStartDate || '2023-01-01');
  const [customEnd, setCustomEnd] = useState(controlledEndDate || todayStr);

  const containerRef = useRef(null);

  // Sync with controlled props if supplied
  useEffect(() => {
    if (controlledType !== undefined) setRangeType(controlledType);
  }, [controlledType]);

  useEffect(() => {
    if (controlledCount !== undefined) setCount(controlledCount);
  }, [controlledCount]);

  useEffect(() => {
    if (controlledUnit !== undefined) setUnit(controlledUnit);
  }, [controlledUnit]);

  useEffect(() => {
    if (controlledStartDate !== undefined && controlledStartDate) setCustomStart(controlledStartDate);
  }, [controlledStartDate]);

  useEffect(() => {
    if (controlledEndDate !== undefined && controlledEndDate) setCustomEnd(controlledEndDate);
  }, [controlledEndDate]);

  // Notify parent of updates
  const notifyChange = (newType, newCount, newUnit, newStart, newEnd) => {
    const dates = computeRangeDates(newType, newCount, newUnit, newStart, newEnd);
    if (onChange) {
      onChange({
        type: newType,
        count: newCount,
        unit: newUnit,
        startDate: dates.startDate,
        endDate: dates.endDate,
        rangeKey: dates.rangeKey,
        label: dates.label
      });
    }
  };

  // Close calendar popover on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Do not close if clicking inside a DatePicker portal or popover
      if (e.target.closest && (e.target.closest('[data-datepicker-portal]') || e.target.closest('.modal-surface'))) {
        return;
      }
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowCalendar(false);
      }
    };
    if (showCalendar) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCalendar]);


  // Keyboard accessibility for calendar popover
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!showCalendar) return;
      if (e.key === 'Escape') {
        setShowCalendar(false);
      } else if (e.key === 'Enter') {
        if (customStart && customEnd) {
          applyCustomRange();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCalendar, customStart, customEnd]);

  const handleSelectAll = () => {
    setRangeType('ALL');
    setShowCalendar(false);
    notifyChange('ALL', count, unit, customStart, customEnd);
  };

  const handleCountChange = (e) => {
    const rawVal = e.target.value;
    if (rawVal === '') {
      setCount('');
      return;
    }
    const val = parseInt(rawVal, 10);
    if (isNaN(val) || val <= 0) return;
    const safeVal = Math.min(999, Math.max(1, val));
    setCount(safeVal);
    setRangeType('RELATIVE');
    setShowCalendar(false);
    notifyChange('RELATIVE', safeVal, unit, customStart, customEnd);
  };

  const handleCountBlur = () => {
    if (count === '' || count <= 0) {
      setCount(1);
      setRangeType('RELATIVE');
      notifyChange('RELATIVE', 1, unit, customStart, customEnd);
    }
  };

  const handleUnitChange = (e) => {
    const newUnit = e.target.value;
    setUnit(newUnit);
    const safeCount = count === '' ? 1 : Math.max(1, count);
    setCount(safeCount);
    setRangeType('RELATIVE');
    setShowCalendar(false);
    notifyChange('RELATIVE', safeCount, newUnit, customStart, customEnd);
  };

  const applyCustomRange = () => {
    if (!customStart || !customEnd) return;
    setRangeType('CUSTOM');
    setShowCalendar(false);
    notifyChange('CUSTOM', count, unit, customStart, customEnd);
  };

  const isAllActive = rangeType === 'ALL';
  const isRelativeActive = rangeType === 'RELATIVE';
  const isCustomActive = rangeType === 'CUSTOM';

  return (
    <div ref={containerRef} className={`relative inline-flex items-center gap-1.5 ${className}`}>
      {/* Unified Compact Segmented Control Bar */}
      <div className="flex items-center gap-1 p-0.5 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xs backdrop-blur-md text-[var(--text-primary)]">
        {/* 'ALL' Button */}
        <button
          type="button"
          onClick={handleSelectAll}
          className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
            isAllActive
              ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent hover:bg-[var(--bg-card)]'
          }`}
          title="Show all available data"
        >
          ALL
        </button>

        {/* Divider */}
        <div className="w-px h-3.5 bg-[var(--border-color)]" />

        {/* Dynamic Number Input & Unit Dropdown Capsule */}
        <div
          className={`flex items-center gap-0.5 px-1 py-0.5 rounded-lg border transition-all duration-200 ${
            isRelativeActive
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-500 shadow-xs'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          {/* Integer Input */}
          <input
            type="number"
            min="1"
            max="999"
            step="1"
            value={count}
            onChange={handleCountChange}
            onBlur={handleCountBlur}
            onFocus={(e) => {
              try { e.target.select(); } catch (err) { /* quiet select */ }
              if (!isRelativeActive) {
                const safeCount = count === '' ? 1 : Math.max(1, count);
                setRangeType('RELATIVE');
                notifyChange('RELATIVE', safeCount, unit, customStart, customEnd);
              }
            }}
            style={{ backgroundColor: 'transparent', color: 'inherit' }}
            className="w-8 text-center bg-transparent border-0 outline-none text-[11px] font-mono font-bold appearance-none [moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none cursor-pointer focus:cursor-text rounded"
            title="Enter period number"
          />

          {/* Unit Dropdown */}
          <div className="relative flex items-center">
            <select
              value={unit}
              onChange={handleUnitChange}
              style={{ backgroundColor: 'transparent', color: 'inherit' }}
              className="bg-transparent border-0 outline-none text-[10px] font-bold uppercase tracking-wider cursor-pointer pr-3 appearance-none"
              title="Select time unit"
            >
              <option value="D" className="bg-[var(--bg-card)] text-[var(--text-primary)]">Day{count > 1 ? 's' : ''}</option>
              <option value="W" className="bg-[var(--bg-card)] text-[var(--text-primary)]">Week{count > 1 ? 's' : ''}</option>
              <option value="M" className="bg-[var(--bg-card)] text-[var(--text-primary)]">Month{count > 1 ? 's' : ''}</option>
              <option value="Y" className="bg-[var(--bg-card)] text-[var(--text-primary)]">Year{count > 1 ? 's' : ''}</option>
            </select>
            <ChevronDown className="w-2.5 h-2.5 pointer-events-none absolute right-0 opacity-60" />
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-3.5 bg-[var(--border-color)]" />

        {/* Calendar Trigger */}
        <button
          type="button"
          onClick={() => setShowCalendar(prev => !prev)}
          className={`p-1 rounded-lg border transition-all duration-200 flex items-center justify-center cursor-pointer ${
            isCustomActive || showCalendar
              ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/40 shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-transparent hover:bg-[var(--bg-card)]'
          }`}
          title="Select Custom Calendar Range"
        >
          <CalendarDays className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Calendar Date Range Popover */}
      <AnimatePresence>
        {showCalendar && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`absolute top-full mt-2 z-50 p-3 modal-surface reports-card border border-[var(--border-color)] rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col gap-2.5 text-xs min-w-[260px] text-[var(--text-primary)] ${
              popoverAlign === 'left' ? 'left-0' : 'right-0'
            }`}
          >
            <div className="flex items-center justify-between pb-1 border-b border-[var(--border-color)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3 text-emerald-500" />
                Custom Date Range
              </span>
              <button
                type="button"
                onClick={() => setShowCalendar(false)}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold text-[var(--text-muted)]">From Date</span>
                <DatePicker
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold text-[var(--text-muted)]">To Date</span>
                <DatePicker
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={applyCustomRange}
              disabled={!customStart || !customEnd}
              className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-lg text-xs transition-colors shadow cursor-pointer mt-0.5"
            >
              Apply Range
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
