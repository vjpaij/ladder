import React, { useState, useEffect } from 'react';
import { getLogoUrlsForHolding } from '../utils/domain';

export default function HoldingLogo({ 
  holding, 
  symbol, 
  name, 
  category, 
  category_id, 
  accentColor, 
  className, 
  fallbackClass 
}) {
  const [urlIndex, setUrlIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [urls, setUrls] = useState([]);

  const finalName = name || holding?.name || holding?.clean_name || holding?.asset_name || holding?.company || '';
  const finalSymbol = symbol || holding?.symbol || '';
  const finalCategory = category || category_id || holding?.category_id || holding?.category || '';

  useEffect(() => {
    if (finalName || finalSymbol) {
      const generatedUrls = getLogoUrlsForHolding(finalName, finalSymbol, finalCategory);
      setUrls(generatedUrls);
      setUrlIndex(0);
      setFailed(false);
    } else {
      setUrls([]);
      setFailed(true);
    }
  }, [finalName, finalSymbol, finalCategory]);

  const cleanSym = (finalSymbol || finalName || '')
    .replace(/\.(NS|BO|BSE|NSE)$/i, '')
    .replace(/[^A-Za-z0-9]/g, '');
  const fallbackText = (cleanSym.slice(0, 2) || '••').toUpperCase();

  const handleImageError = () => {
    if (urlIndex < urls.length - 1) {
      setUrlIndex(prev => prev + 1);
    } else {
      setFailed(true);
    }
  };

  if (!holding && !finalName && !finalSymbol) return null;

  // Compute container class
  const containerClass = className || 'w-8 h-8 rounded-xl';
  const isSmall = containerClass.includes('w-6') || containerClass.includes('w-5') || containerClass.includes('w-4');

  return (
    <div
      className={`relative flex items-center justify-center font-mono font-black overflow-hidden shrink-0 border border-slate-300/80 dark:border-slate-700/80 bg-white shadow-xs ${containerClass}`}
      style={failed && accentColor ? { background: `${accentColor}18`, borderColor: `${accentColor}40`, color: accentColor } : {}}
      title={finalName || finalSymbol}
    >
      {!failed && urls.length > 0 ? (
        <img 
          src={urls[urlIndex]} 
          alt={fallbackText}
          className={`w-full h-full object-contain bg-white transition-opacity duration-200 ${isSmall ? 'p-0.5' : 'p-1'}`}
          onError={handleImageError}
          loading="lazy"
        />
      ) : (
        <div className={`w-full h-full flex items-center justify-center bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 ${fallbackClass || (isSmall ? 'text-[9px]' : 'text-xs')}`}>
          <span className="select-none tracking-tighter leading-none">{fallbackText}</span>
        </div>
      )}
    </div>
  );
}
