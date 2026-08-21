const fs = require('fs');
const path = require('path');
const viewsDir = 'src/views';
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('View.jsx') && !['OverviewView.jsx', 'CalendarView.jsx', 'ExcelToolsView.jsx', 'AddInvestmentView.jsx', 'ProfileSettingsView.jsx', 'IndianStocksView.jsx'].includes(f));

for (const file of files) {
  const p = path.join(viewsDir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  // Find <motion.tr ...> or <tr ...> that is inside the map function.
  content = content.replace(
    /className=\{`(hover:bg-slate-800\/30|transition-colors)/,
    'onClick={() => (typeof setSelectedHolding === "function" ? setSelectedHolding(h) : (typeof setTargetPortfolio === "function" ? setTargetPortfolio(null) : null))}\n                        className={`cursor-pointer $1'
  );
  
  // Note: For Bank, Epf, Liabilities, they might use 'setSelectedHolding' or something else, but actually Bank/Epf use BankView/EpfView. Let's see what they use. 
  // Wait, BankView uses `const [selectedHolding, setSelectedHolding] = useState(null);` No, wait... let's just make sure it matches. If not, they will have error.
  // Actually, I can just do:
  content = content.replace(
    /className=\{`(hover:bg-slate-800\/30|transition-colors)/g,
    'onClick={() => (typeof setSelectedHolding !== "undefined" ? setSelectedHolding(h) : null)}\n                        className={`cursor-pointer $1'
  );
  
  // Stop propagation on action buttons
  content = content.replaceAll('onClick={() => onEditHolding', 'onClick={(e) => { e.stopPropagation(); onEditHolding');
  content = content.replaceAll('onClick={() => onDeleteHolding', 'onClick={(e) => { e.stopPropagation(); onDeleteHolding');
  content = content.replaceAll('onEditHolding(h)}', 'onEditHolding(h); }}');
  content = content.replaceAll('onDeleteHolding(h.id)}', 'onDeleteHolding(h.id); }}');
  
  // For LiabilitiesView:
  content = content.replaceAll('onClick={() => onEditLiability', 'onClick={(e) => { e.stopPropagation(); onEditLiability');
  content = content.replaceAll('onClick={() => onDeleteLiability', 'onClick={(e) => { e.stopPropagation(); onDeleteLiability');
  content = content.replaceAll('onEditLiability(l)}', 'onEditLiability(l); }}');
  content = content.replaceAll('onDeleteLiability(l.id)}', 'onDeleteLiability(l.id); }}');
  
  fs.writeFileSync(p, content);
}
