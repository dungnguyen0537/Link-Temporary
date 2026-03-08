const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { kv } = require('@vercel/kv');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- KV Keys ---
// "config"       → { githubUrl: string }
// "links"        → string[] (array of link IDs, newest first)
// "link:{id}"    → { id, createdAt, used, usedAt }

// --- API Routes ---

// Get current config
app.get('/api/config', async (req, res) => {
    const config = await kv.get('config') || { githubUrl: '' };
    res.json(config);
});

// Set GitHub URL
app.post('/api/config', async (req, res) => {
    const { githubUrl } = req.body;
    if (!githubUrl) return res.status(400).json({ error: 'GitHub URL is required' });

    await kv.set('config', { githubUrl });
    res.json({ success: true, githubUrl });
});

// Create a new temporary link
app.post('/api/create-link', async (req, res) => {
    const config = await kv.get('config');
    if (!config || !config.githubUrl) {
        return res.status(400).json({ error: 'Please set GitHub URL first' });
    }

    const id = uuidv4().split('-')[0]; // Short ID (8 chars)
    const link = {
        id,
        createdAt: new Date().toISOString(),
        used: false,
        usedAt: null
    };

    // Save link data
    await kv.set(`link:${id}`, link);

    // Add to links list
    const linkIds = await kv.get('links') || [];
    linkIds.unshift(id);
    await kv.set('links', linkIds);

    const fullUrl = `${req.protocol}://${req.get('host')}/d/${id}`;
    res.json({ success: true, link, fullUrl });
});

// Get all links
app.get('/api/links', async (req, res) => {
    const linkIds = await kv.get('links') || [];
    const links = [];

    for (const id of linkIds) {
        const link = await kv.get(`link:${id}`);
        if (link) links.push(link);
    }

    res.json({ links });
});

// Delete a link
app.delete('/api/links/:id', async (req, res) => {
    const id = req.params.id;
    await kv.del(`link:${id}`);

    const linkIds = await kv.get('links') || [];
    const filtered = linkIds.filter(lid => lid !== id);
    await kv.set('links', filtered);

    res.json({ success: true });
});

// Clear all used links
app.delete('/api/links-used', async (req, res) => {
    const linkIds = await kv.get('links') || [];
    const remaining = [];

    for (const id of linkIds) {
        const link = await kv.get(`link:${id}`);
        if (link && !link.used) {
            remaining.push(id);
        } else {
            await kv.del(`link:${id}`);
        }
    }

    await kv.set('links', remaining);
    res.json({ success: true });
});

// --- Temporary Link Redirect ---
app.get('/d/:id', async (req, res) => {
    const id = req.params.id;
    const link = await kv.get(`link:${id}`);

    if (!link || link.used) {
        return res.sendFile(path.join(__dirname, '..', 'public', 'expired.html'));
    }

    // Mark as used
    link.used = true;
    link.usedAt = new Date().toISOString();
    await kv.set(`link:${id}`, link);

    // Get config and redirect
    const config = await kv.get('config');
    res.redirect(config.githubUrl);
});

// Fallback — serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
