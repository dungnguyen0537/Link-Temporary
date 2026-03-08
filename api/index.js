const express = require('express');
const { v4: uuidv4 } = require('uuid');
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

// --- API Routes ---

app.get('/api/config', async (req, res) => {
    try {
        const githubUrl = await redis.get('config:githubUrl') || '';
        res.json({ githubUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config', async (req, res) => {
    try {
        const { githubUrl } = req.body;
        if (!githubUrl) return res.status(400).json({ error: 'GitHub URL is required' });
        await redis.set('config:githubUrl', githubUrl);
        res.json({ success: true, githubUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/create-link', async (req, res) => {
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

app.get('/api/links', async (req, res) => {
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

app.delete('/api/links/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await redis.del(`link:${id}`);
        await redis.lrem('links', 0, id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/links-used', async (req, res) => {
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

// ============================================================
// STEP 1: User clicks /d/:id → marks as used → shows loading
//         page that auto-redirects to /d/:id/install.mobileconfig
// ============================================================
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

        // Bot → don't consume
        const userAgent = req.get('User-Agent') || '';
        if (isBot(userAgent)) {
            return res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Download</title></head><body><p>Download file</p></body></html>');
        }

        // Mark as used + set a short-lived token (60s) for the file download
        link.used = true;
        link.usedAt = new Date().toISOString();
        await redis.set(`link:${id}`, JSON.stringify(link));
        await redis.set(`download:${id}`, 'allowed', { ex: 60 });

        // Serve an intermediate page that redirects to the .mobileconfig URL
        // Safari needs to see .mobileconfig extension to trigger profile installation
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
    // Redirect to .mobileconfig URL so Safari triggers profile installer
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

// ============================================================
// STEP 2: /d/:id/install.mobileconfig → proxy download the file
//         Safari sees .mobileconfig extension → opens profile installer
//         Only works within 60s of step 1 (download token)
// ============================================================
app.get('/d/:id/install.mobileconfig', async (req, res) => {
    try {
        const id = req.params.id;

        // Check download token (set in step 1, expires after 60s)
        const allowed = await redis.get(`download:${id}`);
        if (!allowed) {
            const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'expired.html'), 'utf-8');
            return res.status(410).send(html);
        }

        // Delete download token (one-time use)
        await redis.del(`download:${id}`);

        // Proxy download — fetch from original URL, serve to user
        const originalUrl = await redis.get('config:githubUrl');
        const response = await fetch(originalUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            redirect: 'follow',
        });

        if (!response.ok) {
            return res.status(502).send('Could not fetch file');
        }

        // Correct headers for .mobileconfig → iOS automatically installs profile
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
