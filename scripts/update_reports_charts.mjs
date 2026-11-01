import fs from 'fs';
import path from 'path';

// 1. Update src/components/reports/SectorCapPerformanceSection.jsx
let secCapPath = 'src/components/reports/SectorCapPerformanceSection.jsx';
let secCap = fs.readFileSync(secCapPath, 'utf8');

secCap = secCap.replace(
  'onClick={(entry) => setSelectedGroup(entry.name)}',
  'onClick={(entry) => { const name = entry?.payload?.name || entry?.name; if (name) setSelectedGroup(name); }}'
);

secCap = secCap.replace(
  `strokeWidth={isSelected ? 1.5 : 0}
                        />`,
  `strokeWidth={isSelected ? 1.5 : 0}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedGroup(entry.name)}
                        />`
);

secCap = secCap.replace(
  `<span
                                  className="text-[11px] text-[var(--text-muted)] block truncate max-w-[190px] sm:max-w-[260px] cursor-help"
                                  title={s.name}
                                >
                                  {s.name}
                                </span>`,
  `<span
                                  className="text-[11px] text-[var(--text-muted)] block truncate max-w-[190px] sm:max-w-[260px] cursor-help"
                                  title={s.name}
                                >
                                  {s.name}
                                </span>
                                {(s.sector || s.mcapCategory) && (
                                  <div className="text-[9.5px] text-[var(--text-secondary)] font-medium truncate mt-0.5 flex items-center gap-1">
                                    {s.sector && <span className="text-emerald-500/90">{s.sector}</span>}
                                    {s.sector && s.mcapCategory && <span>•</span>}
                                    {s.mcapCategory && <span className="text-blue-400 font-semibold">{s.mcapCategory}</span>}
                                  </div>
                                )}`
);

fs.writeFileSync(secCapPath, secCap, 'utf8');
console.log('Updated SectorCapPerformanceSection.jsx');

// 2. Update src/components/ReportsView.jsx
let repPath = 'src/components/ReportsView.jsx';
let rep = fs.readFileSync(repPath, 'utf8');

// Update currentSelectedMarketCap to unwrap payload safely
rep = rep.replace(
  `  const currentSelectedMarketCap = useMemo(() => {
    if (!selectedMarketCap) return null;
    const tierName = typeof selectedMarketCap === 'string' ? selectedMarketCap : (selectedMarketCap.name || selectedMarketCap.capTier);
    return marketCapData.find(m => (m.name || m.capTier) === tierName) || null;
  }, [selectedMarketCap, marketCapData]);`,
  `  const currentSelectedMarketCap = useMemo(() => {
    if (!selectedMarketCap) return null;
    const tierName = typeof selectedMarketCap === 'string' 
      ? selectedMarketCap 
      : (selectedMarketCap?.payload?.name || selectedMarketCap?.payload?.capTier || selectedMarketCap?.name || selectedMarketCap?.capTier);
    return marketCapData.find(m => (m.name || m.capTier) === tierName) || null;
  }, [selectedMarketCap, marketCapData]);`
);

// Update currentSelectedSector to unwrap payload safely
rep = rep.replace(
  `  const currentSelectedSector = useMemo(() => {
    if (!selectedSector) return null;
    const secName = typeof selectedSector === 'string' ? selectedSector : (selectedSector.sector || selectedSector.name);
    return sectorData.find(s => (s.sector || s.name) === secName) || null;
  }, [selectedSector, sectorData]);`,
  `  const currentSelectedSector = useMemo(() => {
    if (!selectedSector) return null;
    const secName = typeof selectedSector === 'string' 
      ? selectedSector 
      : (selectedSector?.payload?.sector || selectedSector?.payload?.name || selectedSector?.sector || selectedSector?.name);
    return sectorData.find(s => (s.sector || s.name) === secName) || null;
  }, [selectedSector, sectorData]);`
);

// In ALLOCATION view: pass onItemClick
rep = rep.replace(
  `            {chartStyle === 'BAR' && (
              <CleanBarChartView 
                items={allocationData} 
              />
            )}`,
  `            {chartStyle === 'BAR' && (
              <CleanBarChartView 
                items={allocationData} 
                onItemClick={(item) => {
                  const name = item?.name || item?.payload?.name;
                  const idx = allocationData.findIndex(a => a.name === name);
                  if (idx !== -1) setActivePieIndex(idx);
                }}
              />
            )}`
);

fs.writeFileSync(repPath, rep, 'utf8');
console.log('Updated ReportsView.jsx');
