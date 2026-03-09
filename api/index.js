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

app.get('/api/links', requireAuth, async (req, res) => {
    try {
        const linkIds = await redis.lrange('links', 0, -1) || [];
        const links = [];
        for (const id of linkIds) {
            const raw = await redis.get(`link:${id}`);
            if (raw) {
                const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
                links.push(link);
            }
        }
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

app.delete('/api/links-used', requireAuth, async (req, res) => {
    try {
        const linkIds = await redis.lrange('links', 0, -1) || [];
        for (const id of linkIds) {
            const raw = await redis.get(`link:${id}`);
            if (raw) {
                const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (link.used) {
                    await redis.del(`link:${id}`);
                    await redis.lrem('links', 0, id);
                }
            }
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

// List all generators
app.get('/api/generators', requireAuth, async (req, res) => {
    try {
        const gids = await redis.lrange('generators', 0, -1) || [];
        const generators = [];
        for (const gid of gids) {
            const raw = await redis.get(`generator:${gid}`);
            if (raw) {
                const gen = typeof raw === 'string' ? JSON.parse(raw) : raw;
                generators.push(gen);
            }
        }
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

        await redis.set(`link:${id}`, JSON.stringify(link));
        await redis.lpush('links', id);

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

// Get links created by a generator (public — no auth)
app.get('/api/generator/:gid/links', async (req, res) => {
    try {
        const gid = req.params.gid;
        const raw = await redis.get(`generator:${gid}`);
        if (!raw) {
            return res.status(404).json({ error: 'Generator not found' });
        }

        const linkIds = await redis.lrange('links', 0, -1) || [];
        const links = [];
        for (const id of linkIds) {
            const linkRaw = await redis.get(`link:${id}`);
            if (linkRaw) {
                const link = typeof linkRaw === 'string' ? JSON.parse(linkRaw) : linkRaw;
                if (link.generatorId === gid) {
                    links.push(link);
                }
            }
        }
        res.json({ links });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve generator page (public)
app.get('/g/:gid', async (req, res) => {
    try {
        const gid = req.params.gid;
        const raw = await redis.get(`generator:${gid}`);
        if (!raw) {
            const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'expired.html'), 'utf-8');
            return res.status(410).send(html);
        }
        const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'generator.html'), 'utf-8');
        res.send(html);
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

const BLOCKED_DESKTOP_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Không hỗ trợ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a1a; color: #e8e8f0;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .bg-glow { position: fixed; border-radius: 50%; filter: blur(120px); opacity: 0.25; pointer-events: none; }
    .g1 { width: 400px; height: 400px; background: #ff6b6b; top: -100px; right: -100px; }
    .g2 { width: 300px; height: 300px; background: #6c5ce7; bottom: -80px; left: -80px; }
    .box { position: relative; z-index: 1; text-align: center; background: rgba(255,255,255,0.04);
           border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 50px 40px;
           max-width: 420px; backdrop-filter: blur(20px); animation: fadeIn 0.5s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 10px;
         background: linear-gradient(135deg, #ff6b6b, #ee5a24);
         -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    p { color: #8888aa; font-size: 0.92rem; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="bg-glow g1"></div>
  <div class="bg-glow g2"></div>
  <div class="box">
    <div class="icon">📱</div>
    <h1>Chỉ hỗ trợ điện thoại</h1>
    <p>Link này chỉ có thể mở trên điện thoại.<br>Vui lòng mở lại bằng thiết bị di động.</p>
  </div>
</body>
</html>`;

// --- Safari detection ---
function isSafari(userAgent) {
    if (!userAgent) return false;
    const ua = userAgent.toLowerCase();
    // Safari contains "safari" but NOT chrome/crios/fxios/opios/edgios/etc.
    const nonSafari = ['chrome', 'crios', 'fxios', 'opios', 'edgios', 'edg/', 'opr/', 'opera', 'firefox', 'samsungbrowser', 'ucbrowser', 'brave'];
    if (!ua.includes('safari')) return false;
    return !nonSafari.some(b => ua.includes(b));
}

const BLOCKED_BROWSER_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Không hỗ trợ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a1a; color: #e8e8f0;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .bg-glow { position: fixed; border-radius: 50%; filter: blur(120px); opacity: 0.25; pointer-events: none; }
    .g1 { width: 400px; height: 400px; background: #ff6b6b; top: -100px; right: -100px; }
    .g2 { width: 300px; height: 300px; background: #6c5ce7; bottom: -80px; left: -80px; }
    .box { position: relative; z-index: 1; text-align: center; background: rgba(255,255,255,0.04);
           border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 50px 40px;
           max-width: 420px; backdrop-filter: blur(20px); animation: fadeIn 0.5s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 10px;
         background: linear-gradient(135deg, #ff6b6b, #ee5a24);
         -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    p { color: #8888aa; font-size: 0.92rem; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="bg-glow g1"></div>
  <div class="bg-glow g2"></div>
  <div class="box">
    <div class="icon">🧭</div>
    <h1>Vui lòng dùng Safari</h1>
    <p>Link này chỉ hỗ trợ trình duyệt <strong style="color:#e8e8f0;">Safari</strong>.<br>Vui lòng mở lại bằng Safari trên iPhone.</p>
  </div>
</body>
</html>`;

// --- Step 1: /d/:id → intermediate page → redirect to .mobileconfig ---
app.get('/d/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const raw = await redis.get(`link:${id}`);

        if (!raw) {
            const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'expired.html'), 'utf-8');
            return res.status(410).send(html);
        }

        const link = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (link.used) {
            const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'expired.html'), 'utf-8');
            return res.status(410).send(html);
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
        await redis.set(`link:${id}`, JSON.stringify(link));
        await redis.set(`download:${id}`, 'allowed', { ex: 60 });

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
    }, 500);
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
            const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'expired.html'), 'utf-8');
            return res.status(410).send(html);
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
