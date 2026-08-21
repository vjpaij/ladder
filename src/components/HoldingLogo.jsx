import React, { useState, useEffect } from 'react';
import { getLogoUrlsForHolding } from '../utils/domain';

export default function HoldingLogo({ holding, accentColor, className, fallbackClass }) {
  const [urlIndex, setUrlIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [urls, setUrls] = useState([]);

  useEffect(() => {
    if (holding) {
      setUrls(getLogoUrlsForHolding(holding.name, holding.symbol, holding.category_id));
      setUrlIndex(0);
      setFailed(false);
    }
  }, [holding]);

  const fallbackText = (holding?.symbol || holding?.name || '').slice(0, 2).toUpperCase();

  const handleImageError = () => {
    if (urlIndex < urls.length - 1) {
      setUrlIndex(urlIndex + 1);
    } else {
      setFailed(true);
    }
  };

  if (!holding) return null;

  return (
    <div
      className={`flex items-center justify-center font-black text-sm border overflow-hidden shrink-0 ${className || 'w-11 h-11 rounded-xl'}`}
      style={accentColor ? { background: `${accentColor}20`, borderColor: `${accentColor}40`, color: accentColor } : {}}
    >
      {!failed && urls.length > 0 ? (
        <img 
          src={urls[urlIndex]} 
          alt={fallbackText}
          className="w-full h-full object-contain p-1.5 bg-white"
          onError={handleImageError}
        />
      ) : (
        <span className={fallbackClass || ''}>{fallbackText}</span>
      )}
    </div>
  );
}
