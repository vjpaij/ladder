import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  CalendarDays, 
  ChevronLeft, 
  ChevronRight, 
  X, 
  Check
} from 'lucide-react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Dynamic year options spanning past 40 years to future 15 years
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 56 }, (_, i) => CURRENT_YEAR - 40 + i);

/**
 * Normalizes any date input to ISO 'YYYY-MM-DD'
 */
function toIsoDate(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    // Check if DD-MM-YYYY
    const dmyMatch = val.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // Check if YYYY-MM-DD
    const ymdMatch = val.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (ymdMatch) {
      return ymdMatch[0];
    }
  }
  const dateObj = new Date(val);
  if (!isNaN(dateObj.getTime())) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

/**
 * Formats ISO 'YYYY-MM-DD' to user-friendly 'DD-MM-YYYY'
 */
function toDisplayDate(isoStr) {
  if (!isoStr) return '';
  const parts = isoStr.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
  }
  return isoStr;
}

export default function DatePicker({
  value = '',
  onChange,
  name,
  id,
  placeholder = 'DD-MM-YYYY',
  className = '',
  inputClassName = '',
  disabled = false,
  required = false,
  allowClear = true,
  align = 'left'
}) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Coordinates for the portal popover
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 310 });
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);

  const isoValue = useMemo(() => toIsoDate(value), [value]);

  // Typed text in the input
  const [typedText, setTypedText] = useState(() => toDisplayDate(isoValue));

  // Active view date state (year and month currently displayed in calendar)
  const [viewDate, setViewDate] = useState(() => {
    if (isoValue) {
      const [y, m] = isoValue.split('-').map(Number);
      return new Date(y, m - 1, 1);
    }
    return new Date();
  });

  // Keep viewDate and typedText in sync when value changes externally
  useEffect(() => {
    const disp = toDisplayDate(isoValue);
    setTypedText(disp);
    if (isoValue) {
      const [y, m] = isoValue.split('-').map(Number);
      setViewDate(new Date(y, m - 1, 1));
    }
  }, [isoValue]);

  // Calculate coordinates when opening
  const updateCoords = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 310;
    const popoverHeight = 350;

    let left = rect.left;
    if (align === 'right' || rect.left + popoverWidth > window.innerWidth - 12) {
      left = Math.max(12, rect.right - popoverWidth);
    }

    // Check if bottom overflow
    let top = rect.bottom + 6;
    if (rect.bottom + popoverHeight > window.innerHeight - 12 && rect.top > popoverHeight) {
      top = rect.top - popoverHeight - 6;
    }

    setCoords({
      top: top,
      left: Math.max(12, left),
      width: popoverWidth
    });
  }, [align]);

  const handleOpen = () => {
    if (disabled) return;
    updateCoords();
    if (isoValue) {
      const [y, m] = isoValue.split('-').map(Number);
      setViewDate(new Date(y, m - 1, 1));
    } else {
      setViewDate(new Date());
    }
    setIsOpen(true);
  };

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      if (isOpen) updateCoords();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, updateCoords]);

  // Dispatch change event compatible with standard <input type="date">
  const emitChange = useCallback((newIso) => {
    if (!onChange) return;
    const syntheticEvent = {
      target: { value: newIso, name },
      currentTarget: { value: newIso, name },
      value: newIso,
      toString: () => newIso,
      valueOf: () => newIso
    };
    onChange(syntheticEvent);
  }, [onChange, name]);

  const handleSelectDate = (dateObj, closeAfter = true) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    emitChange(iso);
    setTypedText(toDisplayDate(iso));
    setViewDate(new Date(y, dateObj.getMonth(), 1));
    if (closeAfter) {
      setIsOpen(false);
    }
  };

  const handleDirectInputChange = (e) => {
    const raw = e.target.value;
    setTypedText(raw);
    const parsedIso = toIsoDate(raw);
    if (parsedIso) {
      emitChange(parsedIso);
      const [y, m] = parsedIso.split('-').map(Number);
      setViewDate(new Date(y, m - 1, 1));
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    emitChange('');
    setTypedText('');
  };

  const handleQuickToday = () => {
    const now = new Date();
    handleSelectDate(now, true);
  };

  const handleQuickYesterday = () => {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    handleSelectDate(yest, true);
  };

  const handleShiftYear = (delta) => {
    let base = isoValue ? new Date(isoValue) : new Date();
    if (isNaN(base.getTime())) base = new Date();
    base.setFullYear(base.getFullYear() + delta);
    handleSelectDate(base, false);
  };

  // View date components
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  // Navigation handlers
  const handlePrevMonth = () => {
    setViewDate(new Date(viewYear, viewMonth - 1, 1));
  };
  const handleNextMonth = () => {
    setViewDate(new Date(viewYear, viewMonth + 1, 1));
  };

  // Grid calculation for 'days' view
  const daysGrid = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells = [];

    // Trailing days from previous month
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      cells.push({
        date: new Date(viewYear, viewMonth - 1, dayNum),
        dayNum,
        isCurrentMonth: false
      });
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        date: new Date(viewYear, viewMonth, d),
        dayNum: d,
        isCurrentMonth: true
      });
    }

    // Leading days from next month to fill 42 cells (6 rows)
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({
        date: new Date(viewYear, viewMonth + 1, d),
        dayNum: d,
        isCurrentMonth: false
      });
    }

    return cells;
  }, [viewYear, viewMonth]);

  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const popoverContent = isOpen && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popoverRef}
      data-datepicker-portal="true"
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        width: `${coords.width}px`
      }}
      className="fixed z-[9999] p-3.5 modal-surface reports-card border border-[var(--border-color)] rounded-2xl shadow-2xl backdrop-blur-2xl text-[var(--text-primary)] select-none animate-in fade-in zoom-in-95 duration-150 font-sans"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header with Interactive Month & Year Selectors */}
      <div className="flex items-center justify-between gap-1 mb-3 pb-2.5 border-b border-[var(--border-color)]">
        <button
          type="button"
          onClick={handlePrevMonth}
          title="Previous Month"
          className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5">
          {/* Month Dropdown */}
          <select
            value={viewMonth}
            onChange={(e) => setViewDate(new Date(viewYear, Number(e.target.value), 1))}
            className="bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs font-bold outline-none cursor-pointer hover:border-emerald-500/50 transition-colors"
          >
            {MONTH_NAMES.map((m, idx) => (
              <option key={m} value={idx} className="bg-slate-900 text-white">
                {m}
              </option>
            ))}
          </select>

          {/* Year Dropdown */}
          <select
            value={viewYear}
            onChange={(e) => setViewDate(new Date(Number(e.target.value), viewMonth, 1))}
            className="bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs font-mono font-bold outline-none cursor-pointer hover:border-emerald-500/50 transition-colors"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y} className="bg-slate-900 text-white">
                {y}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          title="Next Month"
          className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 mb-1 text-center">
        {DAY_NAMES.map((d, i) => (
          <span
            key={d}
            className={`text-[10px] font-bold tracking-wider uppercase py-1 ${
              i === 0 || i === 6 ? 'text-[var(--text-muted)] opacity-60' : 'text-[var(--text-muted)]'
            }`}
          >
            {d}
          </span>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1">
        {daysGrid.map((cell, idx) => {
          const cellIso = toIsoDate(cell.date);
          const isSelected = isoValue && cellIso === isoValue;
          const isToday = cellIso === todayIso;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectDate(cell.date, true)}
              className={`
                h-8 w-full rounded-xl text-xs font-mono font-medium flex items-center justify-center transition-all relative cursor-pointer
                ${isSelected
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/30 scale-[1.05]'
                  : cell.isCurrentMonth
                    ? 'text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:text-emerald-400'
                    : 'text-[var(--text-muted)] opacity-30 hover:opacity-75 hover:bg-[var(--bg-surface)]'
                }
                ${isToday && !isSelected ? 'ring-1 ring-emerald-500/70 text-emerald-400 font-bold' : ''}
              `}
            >
              {cell.dayNum}
            </button>
          );
        })}
      </div>

      {/* Footer Controls & Quick Shortcuts */}
      <div className="mt-3 pt-2.5 border-t border-[var(--border-color)] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleQuickToday}
            className="px-2 py-1 rounded-lg bg-[var(--bg-surface)] hover:bg-emerald-500/20 text-emerald-400 font-semibold transition-colors cursor-pointer"
          >
            Today
          </button>
          <button
            type="button"
            onClick={handleQuickYesterday}
            className="px-2 py-1 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            Yesterday
          </button>
          <button
            type="button"
            onClick={() => handleShiftYear(-1)}
            title="Previous Year (-1Y)"
            className="px-1.5 py-1 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] font-mono transition-colors font-medium cursor-pointer"
          >
            -1Y
          </button>
          <button
            type="button"
            onClick={() => handleShiftYear(1)}
            title="Next Year (+1Y)"
            className="px-1.5 py-1 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] font-mono transition-colors font-medium cursor-pointer"
          >
            +1Y
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {allowClear && isoValue && (
            <button
              type="button"
              onClick={handleClear}
              className="px-2 py-1 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer"
            >
              Clear
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-sm shadow-emerald-500/20"
          >
            <Check className="w-3 h-3" />
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className={`relative inline-block w-full ${className}`} ref={triggerRef}>
      <div className="relative w-full">
        <input
          ref={inputRef}
          type="text"
          id={id}
          name={name}
          disabled={disabled}
          required={required}
          value={typedText}
          onChange={handleDirectInputChange}
          onClick={handleOpen}
          placeholder={placeholder}
          style={{ backgroundColor: 'inherit', color: 'inherit' }}
          className={`
            w-full px-3 py-1.5 pr-8 bg-inherit border border-inherit rounded-xl text-xs font-mono outline-none
            transition-colors cursor-pointer
            hover:border-emerald-500/60 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            ${isOpen ? 'border-emerald-500 ring-1 ring-emerald-500/20' : ''}
            ${inputClassName}
          `}
        />
        <button
          type="button"
          onClick={handleOpen}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 hover:text-emerald-400 text-[var(--text-muted)] opacity-70 hover:opacity-100 transition-colors cursor-pointer"
          title="Open Calendar"
        >
          <CalendarDays className="w-3.5 h-3.5 flex-shrink-0 pointer-events-none" />
        </button>
      </div>

      {popoverContent}
    </div>
  );
}
