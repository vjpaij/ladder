import fs from 'fs';
import { supabase } from './server/supabaseClient.js';

async function exportTransactions() {
  // Fetch holdings to map holding_id to symbol and currency
  const { data: holdings, error: holdingsError } = await supabase.from('holdings').select('id, symbol, currency');
  if (holdingsError) throw holdingsError;
  const holdingMap = {};
  holdings.forEach(h => {
    holdingMap[h.id] = { symbol: h.symbol, currency: h.currency };
  });

  // Fetch all transactions
  const { data: txs, error: txError } = await supabase.from('transactions').select('*');
  if (txError) throw txError;

  const header = ['Symbol', 'Transaction Date', 'Buy Quantity', 'Buy Price', 'Sell Quantity', 'Sell Price', 'Charges'];
  const indianRows = [header.join(',')];
  const usRows = [header.join(',')];

  txs.forEach(tx => {
    const hold = holdingMap[tx.holding_id] || { symbol: 'UNKNOWN', currency: 'UNKNOWN' };
    const row = [
      hold.symbol,
      tx.date,
      tx.type === 'BUY' ? tx.quantity : '',
      tx.type === 'BUY' ? tx.price : '',
      tx.type === 'SELL' ? tx.quantity : '',
      tx.type === 'SELL' ? tx.price : '',
      tx.charges || ''
    ];
    const line = row.map(v => (v !== undefined && v !== null ? v : '')).join(',');
    if (hold.currency === 'INR') indianRows.push(line);
    else if (hold.currency === 'USD') usRows.push(line);
  });

  fs.writeFileSync('Indian_Transactions.csv', indianRows.join('\n'));
  fs.writeFileSync('US_Transactions.csv', usRows.join('\n'));
  console.log('Export completed:', indianRows.length - 1, 'Indian rows,', usRows.length - 1, 'US rows');
}

exportTransactions().catch(err => {
  console.error('Error exporting transactions:', err);
});
