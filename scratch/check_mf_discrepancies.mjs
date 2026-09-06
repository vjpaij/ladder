import fs from 'fs';

const mfLines = fs.readFileSync('./Mutual Funds/Ind_Mfs.csv', 'utf8').split('\n').filter(l => l.trim());
const rows = mfLines.slice(1).map(l => {
  const p = l.split(',');
  return { schemeCode: p[1], name: p[3], date: p[4], type: p[5], amount: parseFloat(p[6])||0, units: Math.abs(parseFloat(p[8])||0), nav: parseFloat(p[9])||0 };
});

const testSchemes = ['118551', '120539', '118834', '120823'];
for (const sc of testSchemes) {
  const sRows = rows.filter(r => r.schemeCode === sc);
  console.log('\n=== Scheme:', sc, sRows[0]?.name, '===');
  let buyUnits = 0, sellUnits = 0;
  for (const r of sRows) {
    if (r.type.includes('Investment') || r.type === 'BUY') buyUnits += r.units;
    else if (r.type.includes('Redemption') || r.type === 'SELL') sellUnits += r.units;
    console.log(r.date + ' | ' + r.type + ' | Units: ' + r.units + ' | Amt: ' + r.amount);
  }
  console.log('Total Buy Units: ' + buyUnits.toFixed(4) + ', Total Sell Units: ' + sellUnits.toFixed(4) + ', Net: ' + (buyUnits - sellUnits).toFixed(4));
}
