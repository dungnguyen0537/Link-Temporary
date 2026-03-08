const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Redis } = require('@upstash/redis');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Upstash Redis - env vars auto-set by Vercel when you link Upstash Redis
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

// --- API Routes ---

// Get current config
app.get('/api/config', async (req, res) => {
    const githubUrl = await redis.get('config:githubUrl') || '';
    res.json({ githubUrl });
});

// Set GitHub URL
app.post('/api/config', async (req, res) => {
    const { githubUrl } = req.body;
    if (!githubUrl) return res.status(400).json({ error: 'GitHub URL is required' });

    await redis.set('config:githubUrl', githubUrl);
    res.json({ success: true, githubUrl });
});

// Create a new temporary link
app.post('/api/create-link', async (req, res) => {
    const githubUrl = await redis.get('config:githubUrl');
    if (!githubUrl) {
        return res.status(400).json({ error: 'Please set GitHub URL first' });
    }

    const id = uuidv4().split('-')[0]; // Short ID (8 chars)
    const link = {
        id,
        createdAt: new Date().toISOString(),
        used: false,
        usedAt: null
    };

    // Save link data & add to list
    await redis.set(`link:${id}`, JSON.stringify(link));
    await redis.lpush('links', id);

    const fullUrl = `${req.protocol}://${req.get('host')}/d/${id}`;
    res.json({ success: true, link, fullUrl });
});

// Get all links
app.get('/api/links', async (req, res) => {
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
});

// Delete a link
app.delete('/api/links/:id', async (req, res) => {
    const id = req.params.id;
    await redis.del(`link:${id}`);
    await redis.lrem('links', 0, id);
    res.json({ success: true });
});

// Clear all used links
app.delete('/api/links-used', async (req, res) => {
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
});

// --- Temporary Link Redirect ---
app.get('/d/:id', async (req, res) => {
    const id = req.params.id;
    const raw = await redis.get(`link:${id}`);

    if (!raw) {
        return res.sendFile(path.join(__dirname, '..', 'public', 'expired.html'));
    }

    const link = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (link.used) {
        return res.sendFile(path.join(__dirname, '..', 'public', 'expired.html'));
    }

    // Mark as used
    link.used = true;
    link.usedAt = new Date().toISOString();
    await redis.set(`link:${id}`, JSON.stringify(link));

    // Get config and redirect
    const githubUrl = await redis.get('config:githubUrl');
    res.redirect(githubUrl);
});

// Fallback — serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
