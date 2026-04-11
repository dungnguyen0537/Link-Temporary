const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'links.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// Initialize links file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ githubUrl: '', links: [] }, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Functions ---
function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- API Routes ---

// Get current config
app.get('/api/config', (req, res) => {
  const data = readData();
  res.json({ githubUrl: data.githubUrl });
});

// Set GitHub URL
app.post('/api/config', (req, res) => {
  const { githubUrl } = req.body;
  if (!githubUrl) return res.status(400).json({ error: 'GitHub URL is required' });

  const data = readData();
  data.githubUrl = githubUrl;
  writeData(data);
  res.json({ success: true, githubUrl });
});

// Create a new temporary link
app.post('/api/create-link', (req, res) => {
  const data = readData();
  if (!data.githubUrl) {
    return res.status(400).json({ error: 'Please set GitHub URL first' });
  }

  const id = uuidv4().split('-')[0]; // Short ID (8 chars)
  const link = {
    id,
    createdAt: new Date().toISOString(),
    used: false,
    usedAt: null
  };

  data.links.unshift(link); // Add to beginning
  writeData(data);

  const fullUrl = `${req.protocol}://${req.get('host')}/d/${id}`;
  res.json({ success: true, link, fullUrl });
});

// Get all links
app.get('/api/links', (req, res) => {
  const data = readData();
  res.json({ links: data.links });
});

// Delete a link
app.delete('/api/links/:id', (req, res) => {
  const data = readData();
  data.links = data.links.filter(l => l.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// Clear all used links
app.delete('/api/links-used', (req, res) => {
  const data = readData();
  data.links = data.links.filter(l => !l.used);
  writeData(data);
  res.json({ success: true });
});

// --- Desktop detection ---
function isDesktop(userAgent) {
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  const mobileKeywords = ['iphone', 'android', 'ipad', 'ipod', 'mobile', 'webos', 'blackberry', 'opera mini', 'iemobile'];
  return !mobileKeywords.some(k => ua.includes(k));
}

const BLOCKED_CSS = `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}html{-webkit-font-smoothing:antialiased}body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#07070f;color:#eaeaf4;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:20px;overscroll-behavior-y:contain}.bg-glow{position:fixed;border-radius:50%;opacity:.18;pointer-events:none;contain:layout style paint size}.g1{width:450px;height:450px;background:radial-gradient(circle,#f06060 0%,rgba(240,96,96,.3) 25%,rgba(240,96,96,.1) 45%,transparent 65%);top:-120px;right:-120px}.g2{width:350px;height:350px;background:radial-gradient(circle,#7c6cf0 0%,rgba(124,108,240,.3) 25%,rgba(124,108,240,.1) 45%,transparent 65%);bottom:-100px;left:-100px}.box{position:relative;z-index:1;text-align:center;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:52px 44px;max-width:420px;width:100%;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);animation:fadeInUp .5s cubic-bezier(.4,0,.2,1) both;box-shadow:0 24px 80px rgba(0,0,0,.4);contain:layout style}@keyframes fadeInUp{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}.icon-wrap{width:72px;height:72px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;border-radius:50%;animation:iconPulse 2.5s ease-in-out infinite}@keyframes iconPulse{0%,100%{opacity:1}50%{opacity:.7}}.icon-wrap svg{width:34px;height:34px;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}h1{font-size:1.45rem;font-weight:800;margin-bottom:12px;letter-spacing:-.02em;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}p{color:#6e6e8a;font-size:.9rem;line-height:1.7}.divider{width:40px;height:2px;margin:20px auto;border-radius:1px}.hint{font-size:.78rem;color:#6e6e8a;opacity:.7;margin-top:8px}@media(max-width:768px){.box{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:rgba(12,12,28,.9)}.bg-glow{opacity:.1}.g1{width:250px;height:250px}.g2{width:200px;height:200px}.icon-wrap{animation:none}}@media(max-width:480px){.box{padding:36px 24px}h1{font-size:1.25rem}}@media(prefers-reduced-motion:reduce){.box,.icon-wrap{animation:none}}`;

const BLOCKED_DESKTOP_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="theme-color" content="#07070f">
  <title>Chỉ hỗ trợ điện thoại</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
  <style>${BLOCKED_CSS}.icon-wrap{background:rgba(240,96,96,.1);border:1px solid rgba(240,96,96,.2)}h1{background:linear-gradient(135deg,#f06060,#ee5a24)}.divider{background:linear-gradient(90deg,transparent,rgba(240,96,96,.4),transparent)}</style>
</head>
<body>
  <div class="bg-glow g1"></div><div class="bg-glow g2"></div>
  <div class="box">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" stroke="#f06060"/><line x1="12" y1="18" x2="12.01" y2="18" stroke="#f06060" stroke-width="2.5"/></svg>
    </div>
    <h1>Chỉ hỗ trợ điện thoại</h1>
    <div class="divider"></div>
    <p>Link này chỉ có thể mở trên điện thoại.</p>
    <p class="hint">Vui lòng mở lại bằng thiết bị di động.</p>
  </div>
</body></html>`;

// --- Safari detection ---
function isSafari(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  const nonSafari = ['chrome', 'crios', 'fxios', 'opios', 'edgios', 'edg/', 'opr/', 'opera', 'firefox', 'samsungbrowser', 'ucbrowser', 'brave'];
  if (!ua.includes('safari')) return false;
  return !nonSafari.some(b => ua.includes(b));
}

const BLOCKED_BROWSER_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="theme-color" content="#07070f">
  <title>Vui lòng dùng Safari</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
  <style>${BLOCKED_CSS}.icon-wrap{background:rgba(124,108,240,.1);border:1px solid rgba(124,108,240,.2)}h1{background:linear-gradient(135deg,#a29bfe,#7c6cf0)}.divider{background:linear-gradient(90deg,transparent,rgba(124,108,240,.4),transparent)}</style>
</head>
<body>
  <div class="bg-glow g1"></div><div class="bg-glow g2"></div>
  <div class="box">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#a29bfe"/><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" stroke="#a29bfe" fill="rgba(124,108,240,.2)"/></svg>
    </div>
    <h1>Vui lòng dùng Safari</h1>
    <div class="divider"></div>
    <p>Link này chỉ hỗ trợ trình duyệt <strong style="color:#eaeaf4;">Safari</strong>.</p>
    <p class="hint">Vui lòng mở lại bằng Safari trên iPhone.</p>
  </div>
</body></html>`;

// --- Temporary Link Redirect ---
app.get('/d/:id', (req, res) => {
  const data = readData();
  const link = data.links.find(l => l.id === req.params.id);

  if (!link || link.used) {
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  }

  // Block desktop users (don't consume the link)
  const userAgent = req.get('User-Agent') || '';
  if (isDesktop(userAgent)) {
    return res.status(403).send(BLOCKED_DESKTOP_HTML);
  }

  // Block non-Safari browsers (don't consume the link)
  if (!isSafari(userAgent)) {
    return res.status(403).send(BLOCKED_BROWSER_HTML);
  }

  // Mark as used
  link.used = true;
  link.usedAt = new Date().toISOString();
  link.usedByIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  writeData(data);

  // Redirect to GitHub
  res.redirect(data.githubUrl);
});

// --- Generator (Link Phụ) ---

// Create a generator
app.post('/api/create-generator', (req, res) => {
  const data = readData();
  if (!data.githubUrl) {
    return res.status(400).json({ error: 'Please set GitHub URL first' });
  }

  const { maxLinks } = req.body;
  if (!maxLinks || maxLinks < 1) {
    return res.status(400).json({ error: 'maxLinks must be at least 1' });
  }

  const gid = uuidv4().split('-')[0];
  const generator = {
    id: gid,
    maxLinks: parseInt(maxLinks),
    usedLinks: 0,
    createdAt: new Date().toISOString(),
  };

  if (!data.generators) data.generators = [];
  data.generators.unshift(generator);
  writeData(data);

  const fullUrl = `${req.protocol}://${req.get('host')}/g/${gid}`;
  res.json({ success: true, generator, fullUrl });
});

// List generators
app.get('/api/generators', (req, res) => {
  const data = readData();
  res.json({ generators: data.generators || [] });
});

// Delete generator
app.delete('/api/generators/:gid', (req, res) => {
  const data = readData();
  data.generators = (data.generators || []).filter(g => g.id !== req.params.gid);
  writeData(data);
  res.json({ success: true });
});

// Get generator info (public)
app.get('/api/generator/:gid/info', (req, res) => {
  const data = readData();
  const gen = (data.generators || []).find(g => g.id === req.params.gid);
  if (!gen) return res.status(404).json({ error: 'Generator not found' });
  res.json({
    id: gen.id,
    maxLinks: gen.maxLinks,
    usedLinks: gen.usedLinks,
    remaining: gen.maxLinks - gen.usedLinks,
  });
});

// Create link from generator (public)
app.post('/api/generator/:gid/create-link', (req, res) => {
  const data = readData();
  const gen = (data.generators || []).find(g => g.id === req.params.gid);
  if (!gen) return res.status(404).json({ error: 'Generator not found' });

  if (gen.usedLinks >= gen.maxLinks) {
    return res.status(403).json({ error: 'Đã hết lượt tạo link' });
  }

  if (!data.githubUrl) {
    return res.status(400).json({ error: 'No source URL configured' });
  }

  const id = uuidv4().split('-')[0];
  const link = {
    id,
    createdAt: new Date().toISOString(),
    used: false,
    usedAt: null,
    generatorId: gen.id
  };

  data.links.unshift(link);
  gen.usedLinks += 1;
  writeData(data);

  const fullUrl = `${req.protocol}://${req.get('host')}/d/${id}`;
  res.json({
    success: true,
    link,
    fullUrl,
    remaining: gen.maxLinks - gen.usedLinks,
  });
});

// Get links created by a generator (public)
app.get('/api/generator/:gid/links', (req, res) => {
  const data = readData();
  const gen = (data.generators || []).find(g => g.id === req.params.gid);
  if (!gen) return res.status(404).json({ error: 'Generator not found' });

  const links = data.links.filter(l => l.generatorId === req.params.gid);
  res.json({ links });
});

// Serve generator page (public)
app.get('/g/:gid', (req, res) => {
  const data = readData();
  const gen = (data.generators || []).find(g => g.id === req.params.gid);
  if (!gen) {
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'generator.html'));
});

app.listen(PORT, () => {
  console.log(`🔗 Link Tạm Server running at http://localhost:${PORT}`);
});
