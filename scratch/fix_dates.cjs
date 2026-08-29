const fs = require('fs');
const file = 'src/views/AddInvestmentView.jsx';
let content = fs.readFileSync(file, 'utf8');
const regex = /(type="date"[\s\S]*?className="[^"]+)"/g;
content = content.replace(regex, (match, p1) => {
  if (!p1.includes('[color-scheme:dark]')) {
    return p1 + ' [color-scheme:dark]"';
  }
  return match;
});
fs.writeFileSync(file, content);
console.log('Updated date inputs in AddInvestmentView.jsx');
