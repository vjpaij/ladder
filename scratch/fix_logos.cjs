const fs = require('fs');

let content = fs.readFileSync('src/utils/domain.js', 'utf8');

// Inject pushLogos helper function at the top
const pushLogosHelper = `const pushLogos = (urls, domain) => {
  urls.push(\`https://icon.horse/icon/\${domain}\`);
  urls.push(\`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://\${domain}&size=128\`);
  urls.push(\`https://logos.hunter.io/\${domain}\`);
};

export const getLogoUrlsForHolding`;

content = content.replace('export const getLogoUrlsForHolding', pushLogosHelper);

// Replace urls.push('https://logos.hunter.io/DOMAIN') with pushLogos(urls, 'DOMAIN')
content = content.replace(/urls\.push\(['"`]https:\/\/logos\.hunter\.io\/([^'"`]+)['"`]\)/g, (match, domain) => {
    return `pushLogos(urls, \`${domain}\`)`;
});

fs.writeFileSync('src/utils/domain.js', content);
console.log('Done replacing domain.js');
