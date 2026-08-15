import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeAuthContext = createContext();

const THEMES = [
  { id: 'dark', label: 'Obsidian Dark', color: '#060709', accent: '#10B981' },
  { id: 'midnight', label: 'Midnight Blue', color: '#080E21', accent: '#38BDF8' },
  { id: 'sunset', label: 'Sunset Rose', color: '#120716', accent: '#F472B6' },
  { id: 'light', label: 'Clean Light', color: '#F8FAFC', accent: '#2563EB' },
  { id: 'warm_light', label: 'Warm Sand', color: '#FAF8F5', accent: '#D97706' },
  { id: 'nordic_light', label: 'Nordic Frost', color: '#F0F4F8', accent: '#0284C7' }
];

export function ThemeAuthProvider({ children }) {
  const [theme, setTheme] = useState(localStorage.getItem('ladder_theme') || 'dark');
  const [currency, setCurrency] = useState(localStorage.getItem('ladder_currency') || 'INR');
  const [token, setToken] = useState(localStorage.getItem('ladder_token') || 'demo_token');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('ladder_user') || '{"name":"Vijay Pai","email":"admin@ladder.com","avatar":"VP"}'));
  const [fxRate, setFxRate] = useState(87.25);

  useEffect(() => {
    localStorage.setItem('ladder_theme', theme);
    // Remove all previous theme classes
    const classes = ['light', 'midnight', 'sunset', 'warm_light', 'nordic_light'];
    classes.forEach(c => document.documentElement.classList.remove(c));
    if (theme !== 'dark') {
      document.documentElement.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ladder_currency', currency);
  }, [currency]);

  const toggleTheme = () => {
    const currentIndex = THEMES.findIndex(t => t.id === theme);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setTheme(THEMES[nextIndex].id);
  };

  const toggleCurrency = () => setCurrency(prev => prev === 'INR' ? 'USD' : 'INR');

  const logout = () => {
    localStorage.removeItem('ladder_token');
    localStorage.removeItem('ladder_user');
    setToken(null);
    setUser(null);
  };

  const login = (newToken, userData) => {
    localStorage.setItem('ladder_token', newToken);
    localStorage.setItem('ladder_user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
  };

  const updateUserAvatar = (avatarUrl) => {
    const updated = { ...(user || {}), avatarUrl };
    setUser(updated);
    localStorage.setItem('ladder_user', JSON.stringify(updated));
  };

  const formatMoney = (amountInINR, forceINR = false) => {
    if (amountInINR === undefined || amountInINR === null) return '₹0';
    if (currency === 'USD' && !forceINR) {
      const usdVal = amountInINR / (fxRate || 87.25);
      return '$' + usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return '₹' + Math.round(amountInINR).toLocaleString('en-IN');
  };

  const formatRawUSD = (amountUSD) => {
    if (amountUSD === undefined || amountUSD === null) return '$0.00';
    return '$' + Number(amountUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <ThemeAuthContext.Provider value={{
      theme,
      setTheme,
      toggleTheme,
      availableThemes: THEMES,
      currency,
      toggleCurrency,
      token,
      user,
      updateUserAvatar,
      login,
      logout,
      fxRate,
      setFxRate,
      formatMoney,
      formatRawUSD
    }}>
      {children}
    </ThemeAuthContext.Provider>
  );
}

export const useThemeAuth = () => useContext(ThemeAuthContext);
