import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeAuthContext = createContext();

export function ThemeAuthProvider({ children }) {
  const [theme, setTheme] = useState(localStorage.getItem('ladder_theme') || 'dark');
  const [currency, setCurrency] = useState(localStorage.getItem('ladder_currency') || 'INR');
  const [token, setToken] = useState(localStorage.getItem('ladder_token') || 'demo_token');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('ladder_user') || '{"name":"Vijay Pai","email":"admin@ladder.com","avatar":"VP"}'));
  const [fxRate, setFxRate] = useState(87.25);

  useEffect(() => {
    localStorage.setItem('ladder_theme', theme);
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ladder_currency', currency);
  }, [currency]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
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
      toggleTheme,
      currency,
      toggleCurrency,
      token,
      user,
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
