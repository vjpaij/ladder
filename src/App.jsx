import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { ThemeAuthProvider } from './context/ThemeAuthContext';
import { useThemeAuth } from './context/ThemeAuthContext';
import Sidebar from './components/Sidebar';
import TopNavbar from './components/TopNavbar';
import OverviewView from './views/OverviewView';
import CalendarView from './views/CalendarView';
import IndianStocksView from './views/IndianStocksView';
import UsStocksView from './views/UsStocksView';
import MutualFundsView from './views/MutualFundsView';
import NpsView from './views/NpsView';
import BankView from './views/BankView';
import EpfView from './views/EpfView';
import LiabilitiesView from './views/LiabilitiesView';
import DividendsView from './views/DividendsView';
import ReportsView from './components/ReportsView';
import DatabaseStudioView from './views/DatabaseStudioView';
import ExcelToolsView from './views/ExcelToolsView';
import HoldingDetailModal from './components/HoldingDetailModal';
import EditProfileModal from './components/EditProfileModal';
import AddInvestmentView from './views/AddInvestmentView';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <ThemeAuthProvider>
      <AppInner />
    </ThemeAuthProvider>
  );
}

function AppInner() {
  const { setFxRate, showError, showSuccess, showPrompt } = useThemeAuth();
  const [currentView, setCurrentView] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [targetPortfolio, setTargetPortfolio] = useState(null);
  const [selectedHoldingModal, setSelectedHoldingModal] = useState(null);
  const [deleteConfirmHolding, setDeleteConfirmHolding] = useState(null);
  const [isDeletingHolding, setIsDeletingHolding] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());
  const [toast, setToast] = useState(null);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const reportsBackHandlerRef = React.useRef(null);

  const handleGlobalBack = () => {
    if (currentView === 'reports' && reportsBackHandlerRef.current) {
      const handled = reportsBackHandlerRef.current();
      if (handled) return;
    }
    setTargetPortfolio(null);
    setCurrentView('overview');
  };

  useEffect(() => {
    fetchDashboardData();

    // Real-time automatic background polling every 2 seconds
    const pollInterval = setInterval(() => {
      fetchDashboardData(true);
    }, 2000);

    // Instant refresh when user switches back to this tab
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchDashboardData(true);
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchDashboardData = async (isSilent = false) => {
    try {
      const [sumRes, holdRes, liabRes] = await Promise.all([
        axios.get('/api/summary'),
        axios.get('/api/holdings'),
        axios.get('/api/liabilities')
      ]);
      setSummary(sumRes.data);
      setHoldings(holdRes.data);
      setLiabilities(liabRes.data);
      setLastUpdated(new Date().toLocaleTimeString());
      // Sync live FX rate into global context so all currency conversions use today's real rate
      if (sumRes.data.fxRate) setFxRate(sumRes.data.fxRate);
    } catch (err) {
      if (!isSilent) {
        console.error('[App] Failed to fetch dashboard data:', err);
        setToast({
          type: 'error',
          message: 'Database connection failed: ' + (err.response?.data?.error || err.message)
        });
      }
    }
  };

  const handleRefreshPrices = async () => {
    setIsRefreshing(true);
    try {
      const res = await axios.post('/api/refresh-prices');
      await fetchDashboardData();
      setToast({
        type: 'success',
        message: 'Live prices, mutual fund NAVs & FX rates synced successfully!'
      });
    } catch (err) {
      console.error('[App] Error refreshing prices:', err);
      setToast({
        type: 'error',
        message: 'Could not refresh prices: ' + (err.response?.data?.error || err.message)
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteHolding = (id) => {
    const holding = holdings.find(h => h.id === id);
    if (!holding) return;
    setDeleteConfirmHolding(holding);
  };

  const handleConfirmDeleteHolding = async () => {
    if (!deleteConfirmHolding) return;
    setIsDeletingHolding(true);
    const label = deleteConfirmHolding.name || deleteConfirmHolding.symbol;
    try {
      await axios.delete(`/api/holdings/${deleteConfirmHolding.id}`);
      setDeleteConfirmHolding(null);
      await fetchDashboardData();
      setToast({ type: 'success', message: `Position "${label}" removed from portfolio.` });
    } catch (err) {
      showError('Error deleting holding: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsDeletingHolding(false);
    }
  };

  const handleEditHolding = async (holding) => {
    const newQtyStr = await showPrompt(`New quantity for ${holding.name}:`, holding.quantity);
    if (newQtyStr === null) return;
    const newQty = Number(newQtyStr);

    let newPriceStr = null;
    let newPrice = Number(holding.current_price);
    
    // Always ask for price, even for mutual funds, if they want to override
    newPriceStr = await showPrompt(`Current price (${holding.currency}):`, holding.current_price);
    if (newPriceStr !== null) {
      newPrice = Number(newPriceStr);
    }
    
    axios.put(`/api/holdings/${holding.id}`, {
      ...holding,
      quantity: Number(newQty),
      current_price: Number(newPrice)
    }).then(() => {
      fetchDashboardData();
      setToast({ type: 'success', message: `${holding.name} updated.` });
    }).catch(err => {
      showError('Error updating holding: ' + (err.response?.data?.error || err.message));
    });
  };

  const handleCloseBankAccount = async (holding, reopen = false, reopenBalance = 0) => {
    if (reopen) {
      try {
        await axios.put(`/api/holdings/${holding.id}`, { ...holding, quantity: 1, current_price: reopenBalance });
        await fetchDashboardData();
        setToast({ type: 'success', message: `${holding.name} reopened.` });
      } catch (err) {
        setToast({ type: 'error', message: `Could not reopen ${holding.name}: ${err.message}` });
      }
      return;
    }
    try {
      await axios.put(`/api/holdings/${holding.id}`, {
        ...holding,
        quantity: 0,
        current_price: 0
      });
      await fetchDashboardData();
      setToast({ type: 'success', message: `${holding.name} closed.` });
    } catch (err) {
      setToast({ type: 'error', message: `Could not close ${holding.name}: ${err.message}` });
    }
  };

  const handleCloseLiability = async (liability, reopen = false, reopenBalance = 0) => {
    if (reopen) {
      try {
        await axios.put(`/api/liabilities/${liability.id}`, {
          ...liability,
          outstanding_balance: Number(reopenBalance)
        });
        await fetchDashboardData();
        setToast({ type: 'success', message: `${liability.name} reopened.` });
      } catch (err) {
        setToast({ type: 'error', message: `Could not reopen ${liability.name}: ${err.message}` });
      }
      return;
    }
    try {
      await axios.put(`/api/liabilities/${liability.id}`, {
        ...liability,
        outstanding_balance: 0
      });
      await fetchDashboardData();
      setToast({ type: 'success', message: `${liability.name} closed.` });
    } catch (err) {
      setToast({ type: 'error', message: `Could not close ${liability.name}: ${err.message}` });
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'overview':
        return <OverviewView key="overview" summary={summary} holdings={holdings} liabilities={liabilities} onNavigate={setCurrentView} />;
      case 'calendar':
        return <CalendarView key="calendar" />;
      case 'indian_stocks':
        return <IndianStocksView key="indian_stocks" summary={summary} holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onRefresh={fetchDashboardData} onOpenAddModal={() => { setTargetPortfolio('in_stocks'); setCurrentView('add_investment'); }} />;
      case 'us_stocks':
        return <UsStocksView key="us_stocks" summary={summary} holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onRefresh={fetchDashboardData} onOpenAddModal={() => { setTargetPortfolio('us_stocks'); setCurrentView('add_investment'); }} />;
      case 'mutual_funds':
        return <MutualFundsView key="mutual_funds" summary={summary} holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onRefresh={fetchDashboardData} onOpenAddModal={() => { setTargetPortfolio('mutual_funds'); setCurrentView('add_investment'); }} />;
      case 'nps':
        return <NpsView key="nps" summary={summary} holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onRefresh={fetchDashboardData} onOpenAddModal={() => { setTargetPortfolio('nps'); setCurrentView('add_investment'); }} />;
      case 'bank':
        return <BankView key="bank" holdings={holdings} onSelectHolding={(h) => setSelectedHoldingModal(h)} onCloseHolding={handleCloseBankAccount} onOpenAddModal={() => { setTargetPortfolio('bank'); setCurrentView('add_investment'); }} />;
      case 'epf':
        return <EpfView key="epf" holdings={holdings} onSelectHolding={(h) => setSelectedHoldingModal(h)} onOpenAddModal={() => { setTargetPortfolio('epf'); setCurrentView('add_investment'); }} />;
      case 'liabilities':
        return <LiabilitiesView key="liabilities" liabilities={liabilities} onSelectHolding={(h) => setSelectedHoldingModal(h)} onCloseLiability={handleCloseLiability} onOpenAddModal={() => { setTargetPortfolio('loans'); setCurrentView('add_investment'); }} />;
      case 'dividends':
        return <DividendsView key="dividends" holdings={holdings} onRefresh={fetchDashboardData} />;
      case 'reports':
        return <ReportsView key="reports" summary={summary} holdings={holdings} registerBackHandler={(fn) => { reportsBackHandlerRef.current = fn; }} />;
      case 'database':
        return <DatabaseStudioView key="database" />;
      case 'excel_tools':
        return <ExcelToolsView key="excel_tools" onRefresh={fetchDashboardData} />;
      case 'add_investment':
        return <AddInvestmentView key="add_investment" initialPortfolio={targetPortfolio} onRefresh={fetchDashboardData} />;
      default:
        return <OverviewView key="overview" summary={summary} holdings={holdings} liabilities={liabilities} onNavigate={setCurrentView} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-obsidian-950 text-slate-100 antialiased font-sans p-2 sm:p-3 md:p-4 gap-3 md:gap-4 overflow-hidden">
      
      {/* Left Sidebar */}
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        summary={summary}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Right Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0 h-[calc(100vh-1rem)] md:h-[calc(100vh-2rem)] gap-3 md:gap-4">
        
        <ErrorBoundary>
          <TopNavbar
            currentView={currentView}
            onRefreshPrices={handleRefreshPrices}
            isRefreshing={isRefreshing}
            lastUpdated={lastUpdated}
            holdings={holdings}
            liabilities={liabilities}
            onSelectHolding={(h) => setSelectedHoldingModal(h)}
            onNavigate={(view) => { setTargetPortfolio(null); setCurrentView(view); }}
            onOpenProfile={() => setIsEditProfileOpen(true)}
            summary={summary}
          />
        </ErrorBoundary>

        <main className="flex-1 glass-card border border-slate-800 rounded-3xl overflow-y-auto w-full relative">
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
            <ErrorBoundary>
              <AnimatePresence mode="wait">
                {renderView()}
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </main>

      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-2xl border flex items-center gap-3 ${
              toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-800/80 text-rose-200'
                : 'bg-slate-900/95 border-emerald-500/40 text-slate-100'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${toast.type === 'error' ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`} />
            <span className="text-xs font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Holding Detail Modal */}
      {selectedHoldingModal && (
        <HoldingDetailModal
          holding={selectedHoldingModal}
          onClose={() => setSelectedHoldingModal(null)}
        />
      )}

      {/* Floating Bottom-Right Back Button (Persistent, Transparent, Only Arrow Symbol) */}
      <AnimatePresence>
        {currentView && currentView !== 'overview' && (
          <motion.button
            initial={{ scale: 0, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: 15 }}
            onClick={handleGlobalBack}
            className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-slate-900/30 hover:bg-slate-900/60 dark:bg-slate-800/40 dark:hover:bg-slate-700/60 backdrop-blur-md border border-slate-400/20 dark:border-slate-600/30 text-slate-800 dark:text-white shadow-xl cursor-pointer transition-all hover:scale-110 flex items-center justify-center group"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Edit Profile Modal */}
      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
      />

      {/* Standard Themed Position Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmHolding && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => !isDeletingHolding && setDeleteConfirmHolding(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface w-full max-w-sm rounded-2xl border border-slate-700/80 p-5 shadow-2xl space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">Delete Position</h3>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Portfolio Scheme</span>
                </div>
              </div>

              <div className="text-xs space-y-1.5 leading-relaxed text-slate-700 dark:text-slate-300">
                <p>
                  Are you sure you want to delete <span className="font-bold text-rose-500">{deleteConfirmHolding.name || deleteConfirmHolding.symbol}</span>?
                </p>
                <p className="text-[11px] text-slate-500 pt-1">
                  This will permanently remove this position and all its transactions from your portfolio. This action cannot be undone.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  disabled={isDeletingHolding}
                  onClick={() => setDeleteConfirmHolding(null)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingHolding}
                  onClick={handleConfirmDeleteHolding}
                  className="rounded-xl px-4 py-1.5 text-xs font-black bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-500/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isDeletingHolding ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
