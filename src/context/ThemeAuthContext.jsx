import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Edit3 } from 'lucide-react';

const ThemeAuthContext = createContext();

// Synchronously initialize axios default authorization header on module evaluation
const initialSavedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('ladder_token') : null;
if (initialSavedToken) {
  axios.defaults.headers.common.Authorization = `Bearer ${initialSavedToken}`;
}

// Global axios request interceptor guaranteeing dynamic token attachment on every outgoing request
if (typeof window !== 'undefined' && !window.__ladderAxiosIntercepted) {
  window.__ladderAxiosIntercepted = true;
  axios.interceptors.request.use((config) => {
    const currentToken = localStorage.getItem('ladder_token');
    if (currentToken) {
      config.headers = config.headers || {};
      if (!config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${currentToken}`;
      }
    }
    return config;
  }, (error) => Promise.reject(error));
}

// Global fetch interceptor ensuring any native fetch('/api/...') passes JWT authorization
if (typeof window !== 'undefined' && !window.__ladderFetchIntercepted) {
  window.__ladderFetchIntercepted = true;
  const rawFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const currentToken = localStorage.getItem('ladder_token');
    if (currentToken && typeof url === 'string' && (url.startsWith('/api') || url.includes('/api/'))) {
      const headers = new Headers(init.headers || (typeof input === 'object' && input.headers ? input.headers : {}));
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${currentToken}`);
      }
      init = { ...init, headers };
    }
    return rawFetch(input, init);
  };
}

// Helper component for dialog keydown handling without re-rendering the whole tree
function DialogKeyHandler({ successMsg, errorMsg, confirmState, hideSuccess, hideError, handleConfirmClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (successMsg) hideSuccess();
        else if (errorMsg) hideError();
        else if (confirmState) handleConfirmClose(false);
      } else if (e.key === 'Enter') {
        if (successMsg) hideSuccess();
        else if (errorMsg) hideError();
        else if (confirmState) handleConfirmClose(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [successMsg, errorMsg, confirmState, hideSuccess, hideError, handleConfirmClose]);
  
  return null;
}

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
  const [token, setToken] = useState(localStorage.getItem('ladder_token'));
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ladder_user') || 'null');
    } catch {
      return null;
    }
  });
  const [fxRate, setFxRate] = useState(null); // Initialized to null; real rate fetched from /api/fx-rate on mount

  // Global UI states for Modals
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [confirmState, setConfirmState] = useState(null); // { message: string, resolve: function }
  const [promptState, setPromptState] = useState(null); // { message: string, defaultValue: string, resolve: function }
  const [promptInput, setPromptInput] = useState('');

  const showError = (msg) => setErrorMsg(msg);
  const hideError = () => setErrorMsg(null);

  const showSuccess = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000); // auto-hide success
  };
  const hideSuccess = () => setSuccessMsg(null);

  const showConfirm = (msg) => {
    return new Promise((resolve) => {
      setConfirmState({ message: msg, resolve });
    });
  };

  const handleConfirmClose = (result) => {
    if (confirmState && confirmState.resolve) {
      confirmState.resolve(result);
    }
    setConfirmState(null);
  };

  const showPrompt = (msg, defaultValue = '') => {
    return new Promise((resolve) => {
      setPromptInput(defaultValue);
      setPromptState({ message: msg, defaultValue, resolve });
    });
  };

  const handlePromptClose = (submit) => {
    if (promptState && promptState.resolve) {
      promptState.resolve(submit ? promptInput : null);
    }
    setPromptState(null);
  };

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

  useEffect(() => {
    if (token) axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    else delete axios.defaults.headers.common.Authorization;
  }, [token]);

  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401 && token) {
          localStorage.removeItem('ladder_token');
          localStorage.removeItem('ladder_user');
          setToken(null);
          setUser(null);
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptorId);
  }, [token]);

  // Live real-time USD/INR Forex stream
  useEffect(() => {
    const fetchLiveFx = async () => {
      try {
        const res = await fetch('/api/fx-rate');
        if (res.ok) {
          const data = await res.json();
          if (data && data.rate > 0) {
            setFxRate(Number(data.rate));
          }
        }
      } catch (e) {
        // Fallback gracefully
      }
    };
    fetchLiveFx();
    const interval = setInterval(fetchLiveFx, 15000);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const currentIndex = THEMES.findIndex(t => t.id === theme);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setTheme(THEMES[nextIndex].id);
  };

  const toggleCurrency = () => setCurrency(prev => prev === 'INR' ? 'USD' : 'INR');

  const logout = () => {
    localStorage.removeItem('ladder_token');
    localStorage.removeItem('ladder_user');
    delete axios.defaults.headers.common.Authorization;
    setToken(null);
    setUser(null);
  };

  const login = (newToken, userData) => {
    localStorage.setItem('ladder_token', newToken);
    localStorage.setItem('ladder_user', JSON.stringify(userData));
    if (newToken) {
      axios.defaults.headers.common.Authorization = `Bearer ${newToken}`;
    }
    setToken(newToken);
    setUser(userData);
  };

  const updateUserAvatar = (avatarUrl) => {
    const updated = { ...(user || {}), avatarUrl };
    setUser(updated);
    localStorage.setItem('ladder_user', JSON.stringify(updated));
  };

  const updateUserProfile = (name, email) => {
    const updated = { ...(user || {}), name, email };
    setUser(updated);
    localStorage.setItem('ladder_user', JSON.stringify(updated));
  };

  const formatMoney = (amountInINR, forceINR = false, decimals = 2) => {
    if (amountInINR === undefined || amountInINR === null) return decimals === 4 ? '₹0.0000' : '₹0.00';
    if (currency === 'USD' && !forceINR) {
      if (!fxRate || fxRate <= 0) return '$—'; // Rate not yet loaded
      const usdVal = amountInINR / fxRate;
      return '$' + usdVal.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    return '₹' + Number(amountInINR).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatNAV = (nav, forceINR = true) => {
    if (nav === undefined || nav === null || isNaN(Number(nav))) return '₹0.0000';
    return formatMoney(nav, forceINR, 4);
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
      updateUserProfile,
      login,
      logout,
      fxRate,
      setFxRate,
      formatMoney,
      formatNAV,
      formatRawUSD,
      showError,
      hideError,
      showSuccess,
      hideSuccess,
      showConfirm,
      showPrompt
    }}>
      {children}

      {/* Global keydown listener for dialogs */}
      {typeof document !== 'undefined' && (successMsg || errorMsg || confirmState) && (
        <DialogKeyHandler
          successMsg={successMsg}
          errorMsg={errorMsg}
          confirmState={confirmState}
          hideSuccess={hideSuccess}
          hideError={hideError}
          handleConfirmClose={handleConfirmClose}
        />
      )}
      
      {/* Global Success Modal */}
      {successMsg && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface reports-card relative w-full max-w-sm rounded-2xl border border-inherit shadow-2xl p-6 text-center"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-inherit mb-2">Success</h3>
              <p className="text-sm text-slate-400 mb-6">{successMsg}</p>
              <button
                onClick={hideSuccess}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Global Error Modal */}
      {errorMsg && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface reports-card relative w-full max-w-sm rounded-2xl border border-inherit shadow-2xl p-6 text-center"
            >
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 mx-auto flex items-center justify-center mb-4">
                <XCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-inherit mb-2">Error</h3>
              <p className="text-sm text-slate-400 mb-6">{errorMsg}</p>
              <button
                onClick={hideError}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Global Confirm Modal */}
      {confirmState && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface reports-card relative w-full max-w-sm rounded-2xl border border-inherit shadow-2xl p-6 text-center"
            >
              <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 mx-auto flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-inherit mb-2">Confirm Action</h3>
              <p className="text-sm text-slate-400 mb-6">{confirmState.message}</p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => handleConfirmClose(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirmClose(true)}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors cursor-pointer"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}
      {/* Global Prompt Modal */}
      {promptState && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface reports-card relative w-full max-w-sm rounded-2xl border border-inherit shadow-2xl p-6 text-center"
            >
              <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 mx-auto flex items-center justify-center mb-4">
                <Edit3 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-inherit mb-2">Input Required</h3>
              <p className="text-sm text-slate-400 mb-4">{promptState.message}</p>
              <input
                type="text"
                autoFocus
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handlePromptClose(true);
                  if (e.key === 'Escape') handlePromptClose(false);
                }}
                className="w-full px-4 py-2.5 mb-6 bg-slate-900 border border-slate-700 rounded-xl text-sm outline-none focus:border-blue-500 text-center"
              />
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => handlePromptClose(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handlePromptClose(true)}
                  className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold text-sm transition-colors cursor-pointer"
                >
                  Submit
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}
    </ThemeAuthContext.Provider>
  );
}

export const useThemeAuth = () => useContext(ThemeAuthContext);
