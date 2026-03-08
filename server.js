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

// --- Temporary Link Redirect ---
app.get('/d/:id', (req, res) => {
  const data = readData();
  const link = data.links.find(l => l.id === req.params.id);

  if (!link || link.used) {
    // Link expired or not found — serve expired page
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  }

  // Mark as used
  link.used = true;
  link.usedAt = new Date().toISOString();
  writeData(data);

  // Redirect to GitHub
  res.redirect(data.githubUrl);
});

app.listen(PORT, () => {
  console.log(`🔗 Link Tạm Server running at http://localhost:${PORT}`);
});
