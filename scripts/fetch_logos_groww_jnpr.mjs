import https from 'https';
import http from 'http';
import fs from 'fs';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed with status ${res.statusCode} for ${url}`));
      }
      const stream = fs.createWriteStream(dest);
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        resolve(dest);
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Downloading Groww logo...');
  try {
    await downloadFile('https://s3-symbol-logo.tradingview.com/growwamc-growwdefnc--600.png', 'public/logos/groww.png');
    console.log('Groww logo saved to public/logos/groww.png size:', fs.statSync('public/logos/groww.png').size);
  } catch (err) {
    console.error('Groww download error:', err.message);
  }

  // Search junipergreenenergy.com for logo
  https.get('https://www.junipergreenenergy.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', async () => {
      const urls = [];
      const imgRegex = /src=["']([^"']+)["']/gi;
      let match;
      while ((match = imgRegex.exec(body)) !== null) {
        if (match[1].toLowerCase().includes('logo')) {
          urls.push(match[1]);
        }
      }
      console.log('Juniper logo candidates:', urls);
      if (urls.length > 0) {
        let bestUrl = urls[0];
        if (!bestUrl.startsWith('http')) {
          bestUrl = 'https://www.junipergreenenergy.com/' + bestUrl.replace(/^\//, '');
        }
        console.log('Downloading Juniper logo from:', bestUrl);
        const ext = bestUrl.endsWith('.svg') ? 'svg' : 'png';
        const dest = `public/logos/jnpr.${ext}`;
        try {
          await downloadFile(bestUrl, dest);
          console.log(`Saved Juniper logo to ${dest} size:`, fs.statSync(dest).size);
        } catch (e) {
          console.error('Error downloading bestUrl:', e.message);
        }
      }
    });
  });
}

run();
