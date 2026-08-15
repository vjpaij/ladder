import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { ThemeAuthProvider } from './context/ThemeAuthContext';
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
import AddAssetModal from './components/AddAssetModal';
import HoldingDetailModal from './components/HoldingDetailModal';

export default function App() {
  const [currentView, setCurrentView] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedHoldingModal, setSelectedHoldingModal] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());
  const [toast, setToast] = useState(null);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchDashboardData = async () => {
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
    } catch (err) {
      console.error('[App] Failed to fetch dashboard data:', err);
      setToast({
        type: 'error',
        message: 'Database connection failed: ' + (err.response?.data?.error || err.message)
      });
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

  const handleDeleteHolding = async (id) => {
    if (window.confirm('Delete this position?')) {
      try {
        await axios.delete(`/api/holdings/${id}`);
        fetchDashboardData();
        setToast({ type: 'success', message: 'Position removed from portfolio.' });
      } catch (err) {
        alert('Error deleting holding: ' + err.message);
      }
    }
  };

  const handleEditHolding = (holding) => {
    const newQty = prompt(`New quantity for ${holding.name}:`, holding.quantity);
    if (newQty !== null && !isNaN(newQty)) {
      const newPrice = prompt(`Current price (${holding.currency}):`, holding.current_price);
      if (newPrice !== null && !isNaN(newPrice)) {
        axios.put(`/api/holdings/${holding.id}`, {
          ...holding,
          quantity: Number(newQty),
          current_price: Number(newPrice)
        }).then(() => {
          fetchDashboardData();
          setToast({ type: 'success', message: `${holding.name} updated.` });
        });
      }
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'overview':
        return <OverviewView key="overview" summary={summary} holdings={holdings} liabilities={liabilities} onNavigate={setCurrentView} />;
      case 'calendar':
        return <CalendarView key="calendar" />;
      case 'indian_stocks':
        return <IndianStocksView key="indian_stocks" holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onOpenAddModal={() => setIsAddModalOpen(true)} />;
      case 'us_stocks':
        return <UsStocksView key="us_stocks" holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onOpenAddModal={() => setIsAddModalOpen(true)} />;
      case 'mutual_funds':
        return <MutualFundsView key="mutual_funds" holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onOpenAddModal={() => setIsAddModalOpen(true)} />;
      case 'nps':
        return <NpsView key="nps" holdings={holdings} onDeleteHolding={handleDeleteHolding} onEditHolding={handleEditHolding} onOpenAddModal={() => setIsAddModalOpen(true)} />;
      case 'bank':
        return <BankView key="bank" holdings={holdings} onSelectHolding={(h) => setSelectedHoldingModal(h)} onOpenAddModal={() => setIsAddModalOpen(true)} />;
      case 'epf':
        return <EpfView key="epf" holdings={holdings} onSelectHolding={(h) => setSelectedHoldingModal(h)} onOpenAddModal={() => setIsAddModalOpen(true)} />;
      case 'liabilities':
        return <LiabilitiesView key="liabilities" liabilities={liabilities} onSelectHolding={(h) => setSelectedHoldingModal(h)} onOpenAddModal={() => setIsAddModalOpen(true)} />;
      case 'dividends':
        return <DividendsView key="dividends" />;
      case 'reports':
        return <ReportsView key="reports" summary={summary} holdings={holdings} />;
      case 'database':
        return <DatabaseStudioView key="database" />;
      case 'excel_tools':
        return <ExcelToolsView key="excel_tools" onRefresh={fetchDashboardData} />;
      default:
        return <OverviewView key="overview" summary={summary} holdings={holdings} liabilities={liabilities} onNavigate={setCurrentView} />;
    }
  };

  return (
    <ThemeAuthProvider>
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
          
          <TopNavbar
            onRefreshPrices={handleRefreshPrices}
            isRefreshing={isRefreshing}
            lastUpdated={lastUpdated}
            holdings={holdings}
            liabilities={liabilities}
            onSelectHolding={(h) => setSelectedHoldingModal(h)}
            onNavigate={setCurrentView}
            summary={summary}
          />

          <main className="flex-1 glass-card border border-slate-800 rounded-3xl overflow-y-auto w-full relative">
            <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
              <AnimatePresence mode="wait">
                {renderView()}
              </AnimatePresence>
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

        {/* Add Asset Modal */}
        <AddAssetModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onRefresh={fetchDashboardData}
        />

        {/* Holding Detail Modal */}
        {selectedHoldingModal && (
          <HoldingDetailModal
            holding={selectedHoldingModal}
            onClose={() => setSelectedHoldingModal(null)}
          />
        )}

      </div>
    </ThemeAuthProvider>
  );
}
