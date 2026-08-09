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

export default formatDateDDMMYYYY;
