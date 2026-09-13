/**
 * Standard Date Formatter to output DD-MM-YYYY (e.g. 24-10-2022)
 */
export function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '—';
  
  const str = String(dateStr).trim();

  // If already DD-MM-YYYY format
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;

  // Try parsing ISO or Date string
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {}

  // Manual fallback for YYYY-MM-DD strings
  const parts = str.split(/[-T /]/);
  if (parts.length >= 3) {
    if (parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    }
    if (parts[2].length === 4) {
      return `${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[2]}`;
    }
  }

  return str;
}

/**
 * Standard Quote Badge Date Formatter to output DD MMM YYYY (e.g. 27 Aug 2026)
 */
export function formatQuoteBadgeDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  try {
    const parts = str.split(/[-T /]/);
    if (parts.length >= 3) {
      let day, month, year;
      if (parts[0].length === 4) {
        year = parts[0];
        month = parts[1];
        day = parts[2];
      } else {
        day = parts[0];
        month = parts[1];
        year = parts[2];
      }
      const mNum = parseInt(month, 10);
      if (!isNaN(mNum) && mNum >= 1 && mNum <= 12) {
        const d = new Date(Date.UTC(parseInt(year, 10), mNum - 1, parseInt(day, 10)));
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
      }
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  } catch (e) {}
  return str;
}

/**
 * Unified Quote Badge Status Evaluator
 * Evaluates whether a quote date matches today or the latest completed trading session
 * and returns the appropriate styling flag (isUpToDate) and label (Today / Latest / As of).
 */
export function getQuoteBadgeStatus(dateInput) {
  if (!dateInput) return { isUpToDate: false, isToday: false, isLastTradingDay: false, label: '', formattedDate: '' };

  const formattedDate = formatQuoteBadgeDate(dateInput) || String(dateInput);
  const now = new Date();
  const todayISO = now.toISOString().split('T')[0];
  const todayFormatted = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const todayShort = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Most recent completed trading day (walking back weekend)
  const dow = now.getDay();
  const lastTradingDate = new Date(now);
  if (dow === 6) lastTradingDate.setDate(lastTradingDate.getDate() - 1);
  else if (dow === 0) lastTradingDate.setDate(lastTradingDate.getDate() - 2);

  const lastISO = lastTradingDate.toISOString().split('T')[0];
  const lastFormatted = lastTradingDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const lastShort = lastTradingDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Normalize strings for matching (e.g. Sept vs Sep, dashes vs slashes)
  const normalize = (s) => (s || '').toLowerCase().replace(/sept/g, 'sep').replace(/[^a-z0-9]/g, '');

  const nInput = normalize(String(dateInput));
  const nFormatted = normalize(formattedDate);

  const matchesAny = (...targets) => targets.some(t => {
    const nt = normalize(t);
    return nt === nInput || nt === nFormatted;
  });

  const isToday = matchesAny(todayISO, todayFormatted, todayShort);
  const isLastTradingDay = matchesAny(lastISO, lastFormatted, lastShort);
  const isUpToDate = isToday || isLastTradingDay;

  let label = `As of ${formattedDate}`;
  if (isToday) {
    label = `Today (${formattedDate})`;
  } else if (isLastTradingDay) {
    label = `Latest (${formattedDate})`;
  }

  return {
    isUpToDate,
    isToday,
    isLastTradingDay,
    label,
    formattedDate
  };
}

export default formatDateDDMMYYYY;
