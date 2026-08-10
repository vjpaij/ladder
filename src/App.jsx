import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AnimatePresence } from 'framer-motion';
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

  useEffect(() => {
    fetchDashboardData();
  }, []);

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
      console.error('[App] Error fetching dashboard data:', err);
    }
  };

  const handleRefreshPrices = async () => {
    setIsRefreshing(true);
    try {
      await axios.post('/api/refresh-prices');
      await fetchDashboardData();
    } catch (err) {
      console.error('[App] Error refreshing prices:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteHolding = async (id) => {
    if (window.confirm('Delete this position?')) {
      try {
        await axios.delete(`/api/holdings/${id}`);
        fetchDashboardData();
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
        }).then(() => fetchDashboardData());
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
      <div className="flex min-h-screen bg-obsidian-950 text-slate-100 antialiased font-sans">
        
        {/* Left Sidebar */}
        <Sidebar
          currentView={currentView}
          setCurrentView={setCurrentView}
          summary={summary}
        />

        {/* Right Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          
          <TopNavbar
            onRefreshPrices={handleRefreshPrices}
            isRefreshing={isRefreshing}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            lastUpdated={lastUpdated}
          />

          <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
            <AnimatePresence mode="wait">
              {renderView()}
            </AnimatePresence>
          </main>

        </div>

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
