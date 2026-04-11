const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Upstash Redis
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

// Admin password from env var (set in Vercel dashboard)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// --- Cache for static HTML files (avoid fs.readFileSync on every request) ---
const _htmlCache = {};
function getHtmlFile(filename) {
    if (_htmlCache[filename]) return _htmlCache[filename];
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', filename), 'utf-8');
    _htmlCache[filename] = html;
    return html;
}

// --- Auth middleware ---
async function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const valid = await redis.get(`session:${token}`);
    if (!valid) return res.status(401).json({ error: 'Session expired' });

    next();
}

// --- Login ---
app.post('/api/login', async (req, res) => {
    try {
        const { password } = req.body;
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: 'Sai mật khẩu' });
        }

        // Create session token (valid 24h)
        const token = crypto.randomBytes(32).toString('hex');
        await redis.set(`session:${token}`, 'active', { ex: 86400 });

        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Protected API Routes ---

app.get('/api/config', requireAuth, async (req, res) => {
    try {
        const githubUrl = await redis.get('config:githubUrl') || '';
        res.json({ githubUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config', requireAuth, async (req, res) => {
    try {
        const { githubUrl } = req.body;
        if (!githubUrl) return res.status(400).json({ error: 'GitHub URL is required' });
        await redis.set('config:githubUrl', githubUrl);
        res.json({ success: true, githubUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/create-link', requireAuth, async (req, res) => {
    try {
        const githubUrl = await redis.get('config:githubUrl');
        if (!githubUrl) {
            return res.status(400).json({ error: 'Please set GitHub URL first' });
        }

        const id = uuidv4().split('-')[0];
        const link = {
            id,
            createdAt: new Date().toISOString(),
            used: false,
            usedAt: null
        };

        await redis.set(`link:${id}`, JSON.stringify(link));
        await redis.lpush('links', id);

        const fullUrl = `https://${req.get('host')}/d/${id}`;
        res.json({ success: true, link, fullUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// OPTIMIZED: Batch Redis queries using mget instead of N sequential gets
app.get('/api/links', requireAuth, async (req, res) => {
    try {
        const linkIds = await redis.lrange('links', 0, -1) || [];
        if (linkIds.length === 0) {
            return res.json({ links: [] });
        }

        // Batch fetch all links in one Redis call
        const keys = linkIds.map(id => `link:${id}`);
        const rawResults = await redis.mget(...keys);

        const links = [];
        for (const raw of rawResults) {
            if (raw) {
                const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
                links.push(link);
            }
        }

        // Set cache header for short-lived caching
        res.set('Cache-Control', 'private, max-age=2');
        res.json({ links });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/links/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        await redis.del(`link:${id}`);
        await redis.lrem('links', 0, id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// OPTIMIZED: Batch delete with mget
app.delete('/api/links-used', requireAuth, async (req, res) => {
    try {
        const linkIds = await redis.lrange('links', 0, -1) || [];
        if (linkIds.length === 0) {
            return res.json({ success: true });
        }

        // Batch fetch all links
        const keys = linkIds.map(id => `link:${id}`);
        const rawResults = await redis.mget(...keys);

        // Find used links and delete them
        const deletePromises = [];
        for (let i = 0; i < linkIds.length; i++) {
            const raw = rawResults[i];
            if (raw) {
                const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (link.used) {
                    deletePromises.push(redis.del(`link:${linkIds[i]}`));
                    deletePromises.push(redis.lrem('links', 0, linkIds[i]));
                }
            }
        }

        if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Generator (Link Phụ) API ---

// Create a new generator
app.post('/api/create-generator', requireAuth, async (req, res) => {
    try {
        const githubUrl = await redis.get('config:githubUrl');
        if (!githubUrl) {
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

        await redis.set(`generator:${gid}`, JSON.stringify(generator));
        await redis.lpush('generators', gid);

        const fullUrl = `https://${req.get('host')}/g/${gid}`;
        res.json({ success: true, generator, fullUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// OPTIMIZED: Batch fetch generators
app.get('/api/generators', requireAuth, async (req, res) => {
    try {
        const gids = await redis.lrange('generators', 0, -1) || [];
        if (gids.length === 0) {
            return res.json({ generators: [] });
        }

        const keys = gids.map(gid => `generator:${gid}`);
        const rawResults = await redis.mget(...keys);

        const generators = [];
        for (const raw of rawResults) {
            if (raw) {
                const gen = typeof raw === 'string' ? JSON.parse(raw) : raw;
                generators.push(gen);
            }
        }

        res.set('Cache-Control', 'private, max-age=2');
        res.json({ generators });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a generator
app.delete('/api/generators/:gid', requireAuth, async (req, res) => {
    try {
        const gid = req.params.gid;
        await redis.del(`generator:${gid}`);
        await redis.lrem('generators', 0, gid);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get generator info (public — no auth)
app.get('/api/generator/:gid/info', async (req, res) => {
    try {
        const gid = req.params.gid;
        const raw = await redis.get(`generator:${gid}`);
        if (!raw) {
            return res.status(404).json({ error: 'Generator not found' });
        }
        const gen = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // Cache briefly for mobile performance
        res.set('Cache-Control', 'private, max-age=3');
        res.json({
            id: gen.id,
            maxLinks: gen.maxLinks,
            usedLinks: gen.usedLinks,
            remaining: gen.maxLinks - gen.usedLinks,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create link from generator (public — no auth)
app.post('/api/generator/:gid/create-link', async (req, res) => {
    try {
        const gid = req.params.gid;
        const raw = await redis.get(`generator:${gid}`);
        if (!raw) {
            return res.status(404).json({ error: 'Generator not found' });
        }

        const gen = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (gen.usedLinks >= gen.maxLinks) {
            return res.status(403).json({ error: 'Đã hết lượt tạo link' });
        }

        const githubUrl = await redis.get('config:githubUrl');
        if (!githubUrl) {
            return res.status(400).json({ error: 'No source URL configured' });
        }

        const id = uuidv4().split('-')[0];
        const link = {
            id,
            createdAt: new Date().toISOString(),
            used: false,
            usedAt: null,
            generatorId: gid
        };

        // Parallel writes for speed
        await Promise.all([
            redis.set(`link:${id}`, JSON.stringify(link)),
            redis.lpush('links', id),
        ]);

        gen.usedLinks += 1;
        await redis.set(`generator:${gid}`, JSON.stringify(gen));

        const fullUrl = `https://${req.get('host')}/d/${id}`;
        res.json({
            success: true,
            link,
            fullUrl,
            remaining: gen.maxLinks - gen.usedLinks,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// OPTIMIZED: Batch fetch generator links
app.get('/api/generator/:gid/links', async (req, res) => {
    try {
        const gid = req.params.gid;
        const raw = await redis.get(`generator:${gid}`);
        if (!raw) {
            return res.status(404).json({ error: 'Generator not found' });
        }

        const linkIds = await redis.lrange('links', 0, -1) || [];
        if (linkIds.length === 0) {
            return res.json({ links: [] });
        }

        // Batch fetch all links in one call
        const keys = linkIds.map(id => `link:${id}`);
        const rawResults = await redis.mget(...keys);

        const links = [];
        for (const linkRaw of rawResults) {
            if (linkRaw) {
                const link = typeof linkRaw === 'string' ? JSON.parse(linkRaw) : linkRaw;
                if (link.generatorId === gid) {
                    links.push(link);
                }
            }
        }

        res.set('Cache-Control', 'private, max-age=3');
        res.json({ links });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve generator page (public) — using cached HTML
app.get('/g/:gid', async (req, res) => {
    try {
        const gid = req.params.gid;
        const raw = await redis.get(`generator:${gid}`);
        if (!raw) {
            return res.status(410).send(getHtmlFile('expired.html'));
        }
        res.send(getHtmlFile('generator.html'));
    } catch (err) {
        res.status(500).send('Server error: ' + err.message);
    }
});

// --- Bot detection ---
function isBot(userAgent) {
    if (!userAgent) return false;
    const bots = [
        'facebookexternalhit', 'Facebot', 'FacebookBot',
        'ZaloBot', 'ZaloMessageBot',
        'TelegramBot', 'WhatsApp', 'Viber',
        'Discordbot', 'Twitterbot',
        'Slackbot', 'Slack-ImgProxy', 'LinkedInBot',
        'Googlebot', 'bingbot', 'PetalBot', 'Bytespider',
        'bot', 'crawler', 'spider', 'preview',
        'curl', 'wget', 'python-requests', 'HeadlessChrome',
    ];
    const ua = userAgent.toLowerCase();
    return bots.some(b => ua.includes(b.toLowerCase()));
}

// --- Desktop detection ---
function isDesktop(userAgent) {
    if (!userAgent) return true;
    const ua = userAgent.toLowerCase();
    const mobileKeywords = ['iphone', 'android', 'ipad', 'ipod', 'mobile', 'webos', 'blackberry', 'opera mini', 'iemobile'];
    return !mobileKeywords.some(k => ua.includes(k));
}

const PROTECTION_SCRIPT = `<script>(function(){'use strict';document.addEventListener('contextmenu',function(e){e.preventDefault()},true);document.addEventListener('keydown',function(e){if(e.key==='F12'||e.keyCode===123){e.preventDefault();e.stopPropagation();return false}if((e.ctrlKey||e.metaKey)&&e.shiftKey&&['I','J','C','K'].includes(e.key.toUpperCase())){e.preventDefault();e.stopPropagation();return false}if((e.ctrlKey||e.metaKey)&&e.key.toUpperCase()==='U'){e.preventDefault();e.stopPropagation();return false}if((e.ctrlKey||e.metaKey)&&e.key.toUpperCase()==='S'){e.preventDefault();e.stopPropagation();return false}if((e.ctrlKey||e.metaKey)&&e.key.toUpperCase()==='P'){e.preventDefault();e.stopPropagation();return false}},true);document.addEventListener('dragstart',function(e){e.preventDefault()},true);document.addEventListener('selectstart',function(e){e.preventDefault()},true);var _dt=function(){var t=window.outerWidth-window.innerWidth>160||window.outerHeight-window.innerHeight>160;if(t){document.body.style.display='none'}else{document.body.style.display=''}};window.addEventListener('resize',_dt);setInterval(function(){console.clear()},2000)})()</script>`;

// OPTIMIZED: Pre-blurred CSS — no filter:blur() for mobile GPU
const BLOCKED_CSS = `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}html{-webkit-font-smoothing:antialiased}body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#07070f;color:#eaeaf4;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:20px;overscroll-behavior-y:contain}.bg-glow{position:fixed;border-radius:50%;opacity:.18;pointer-events:none;contain:layout style paint size}.g1{width:450px;height:450px;background:radial-gradient(circle,#f06060 0%,rgba(240,96,96,.3) 25%,rgba(240,96,96,.1) 45%,transparent 65%);top:-120px;right:-120px}.g2{width:350px;height:350px;background:radial-gradient(circle,#7c6cf0 0%,rgba(124,108,240,.3) 25%,rgba(124,108,240,.1) 45%,transparent 65%);bottom:-100px;left:-100px}.box{position:relative;z-index:1;text-align:center;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:52px 44px;max-width:420px;width:100%;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);animation:fadeInUp .5s cubic-bezier(.4,0,.2,1) both;box-shadow:0 24px 80px rgba(0,0,0,.4);contain:layout style}@keyframes fadeInUp{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}.icon-wrap{width:72px;height:72px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;border-radius:50%;animation:iconPulse 2.5s ease-in-out infinite}@keyframes iconPulse{0%,100%{opacity:1}50%{opacity:.7}}.icon-wrap svg{width:34px;height:34px;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}h1{font-size:1.45rem;font-weight:800;margin-bottom:12px;letter-spacing:-.02em;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}p{color:#6e6e8a;font-size:.9rem;line-height:1.7}.divider{width:40px;height:2px;margin:20px auto;border-radius:1px}.hint{font-size:.78rem;color:#6e6e8a;opacity:.7;margin-top:8px}@media(max-width:768px){.box{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:rgba(12,12,28,.9)}.bg-glow{opacity:.1}.g1{width:250px;height:250px}.g2{width:200px;height:200px}.icon-wrap{animation:none}}@media(max-width:480px){.box{padding:36px 24px}h1{font-size:1.25rem}}@media(prefers-reduced-motion:reduce){.box,.icon-wrap{animation:none}}`;

const BLOCKED_DESKTOP_HTML = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"><meta name="theme-color" content="#07070f"><title>Chỉ hỗ trợ điện thoại</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet"><style>${BLOCKED_CSS}.icon-wrap{background:rgba(240,96,96,.1);border:1px solid rgba(240,96,96,.2)}h1{background:linear-gradient(135deg,#f06060,#ee5a24);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.divider{background:linear-gradient(90deg,transparent,rgba(240,96,96,.4),transparent)}</style></head><body><div class="bg-glow g1"></div><div class="bg-glow g2"></div><div class="box"><div class="icon-wrap"><svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" stroke="#f06060"/><line x1="12" y1="18" x2="12.01" y2="18" stroke="#f06060" stroke-width="2.5"/></svg></div><h1>Chỉ hỗ trợ điện thoại</h1><div class="divider"></div><p>Link này chỉ có thể mở trên điện thoại.</p><p class="hint">Vui lòng mở lại bằng thiết bị di động.</p></div>${PROTECTION_SCRIPT}</body></html>`;

// --- Safari detection ---
function isSafari(userAgent) {
    if (!userAgent) return false;
    const ua = userAgent.toLowerCase();
    // Safari contains "safari" but NOT chrome/crios/fxios/opios/edgios/etc.
    const nonSafari = ['chrome', 'crios', 'fxios', 'opios', 'edgios', 'edg/', 'opr/', 'opera', 'firefox', 'samsungbrowser', 'ucbrowser', 'brave'];
    if (!ua.includes('safari')) return false;
    return !nonSafari.some(b => ua.includes(b));
}

const BLOCKED_BROWSER_HTML = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"><meta name="theme-color" content="#07070f"><title>Vui lòng dùng Safari</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet"><style>${BLOCKED_CSS}.icon-wrap{background:rgba(124,108,240,.1);border:1px solid rgba(124,108,240,.2)}h1{background:linear-gradient(135deg,#a29bfe,#7c6cf0);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.divider{background:linear-gradient(90deg,transparent,rgba(124,108,240,.4),transparent)}</style></head><body><div class="bg-glow g1"></div><div class="bg-glow g2"></div><div class="box"><div class="icon-wrap"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#a29bfe"/><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" stroke="#a29bfe" fill="rgba(124,108,240,.2)"/></svg></div><h1>Vui lòng dùng Safari</h1><div class="divider"></div><p>Link này chỉ hỗ trợ trình duyệt <strong style="color:#eaeaf4;">Safari</strong>.</p><p class="hint">Vui lòng mở lại bằng Safari trên iPhone.</p></div>${PROTECTION_SCRIPT}</body></html>`;
// --- Step 1: /d/:id → intermediate page → redirect to .mobileconfig ---
app.get('/d/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const raw = await redis.get(`link:${id}`);

        if (!raw) {
            return res.status(410).send(getHtmlFile('expired.html'));
        }

        const link = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (link.used) {
            return res.status(410).send(getHtmlFile('expired.html'));
        }

        const userAgent = req.get('User-Agent') || '';
        if (isBot(userAgent)) {
            return res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Download</title></head><body><p>Download file</p></body></html>');
        }

        // Block desktop users
        if (isDesktop(userAgent)) {
            return res.status(403).send(BLOCKED_DESKTOP_HTML);
        }

        // Block non-Safari browsers
        if (!isSafari(userAgent)) {
            return res.status(403).send(BLOCKED_BROWSER_HTML);
        }

        link.used = true;
        link.usedAt = new Date().toISOString();
        link.usedByIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

        // Parallel: update link + set download token
        await Promise.all([
            redis.set(`link:${id}`, JSON.stringify(link)),
            redis.set(`download:${id}`, 'allowed', { ex: 60 }),
        ]);

        res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Đang tải hồ sơ...</title>
  <style>
    body { background: #0a0a1a; color: #e8e8f0; font-family: -apple-system, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1);
               border-top-color: #6c5ce7; border-radius: 50%; animation: spin 0.8s linear infinite;
               margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #8888aa; font-size: 14px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <p>Đang tải hồ sơ cấu hình...</p>
  </div>
  <script>
    setTimeout(function() {
      window.location.href = '/d/${id}/install.mobileconfig';
    }, 200);
  </script>
</body>
</html>`);
    } catch (err) {
        res.status(500).send('Server error: ' + err.message);
    }
});

// --- Step 2: /d/:id/install.mobileconfig → proxy download ---
app.get('/d/:id/install.mobileconfig', async (req, res) => {
    try {
        const id = req.params.id;

        const allowed = await redis.get(`download:${id}`);
        if (!allowed) {
            return res.status(410).send(getHtmlFile('expired.html'));
        }

        await redis.del(`download:${id}`);

        const originalUrl = await redis.get('config:githubUrl');
        const response = await fetch(originalUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            redirect: 'follow',
        });

        if (!response.ok) {
            return res.status(502).send('Could not fetch file');
        }

        res.setHeader('Content-Type', 'application/x-apple-asn1');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cache-Control', 'no-store, no-cache');

        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
    } catch (err) {
        res.status(500).send('Server error: ' + err.message);
    }
});

module.exports = app;
