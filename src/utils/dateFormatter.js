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

export default formatDateDDMMYYYY;
