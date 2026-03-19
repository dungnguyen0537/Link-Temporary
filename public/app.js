const API = '';
let authToken = localStorage.getItem('authToken') || '';

// --- DOM Elements ---
const loginScreen = document.getElementById('login-screen');
const adminScreen = document.getElementById('admin-screen');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

const githubUrlInput = document.getElementById('github-url');
const saveUrlBtn = document.getElementById('save-url-btn');
const currentUrlEl = document.getElementById('current-url');
const createLinkBtn = document.getElementById('create-link-btn');
const newLinkResult = document.getElementById('new-link-result');
const newLinkUrl = document.getElementById('new-link-url');
const copyLinkBtn = document.getElementById('copy-link-btn');
const linksBody = document.getElementById('links-body');
const emptyState = document.getElementById('empty-state');
const clearUsedBtn = document.getElementById('clear-used-btn');
const linksTable = document.getElementById('links-table');

// Generator DOM
const maxLinksInput = document.getElementById('max-links-input');
const createGeneratorBtn = document.getElementById('create-generator-btn');
const newGeneratorResult = document.getElementById('new-generator-result');
const newGeneratorUrl = document.getElementById('new-generator-url');
const copyGeneratorBtn = document.getElementById('copy-generator-btn');
const generatorsBody = document.getElementById('generators-body');
const generatorsTable = document.getElementById('generators-table');
const generatorsEmpty = document.getElementById('generators-empty');

// --- Auth helpers ---
function authHeaders() {
    return { 'Content-Type': 'application/json', 'x-auth-token': authToken };
}

async function authFetch(url, options = {}) {
    options.headers = { ...options.headers, 'x-auth-token': authToken };
    if (!options.headers['Content-Type'] && options.method !== 'DELETE') {
        options.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
        logout();
        return null;
    }
    return res;
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        showAdmin();
    } else {
        showLogin();
    }
});

// --- Auto-reload on tab focus / visibility change ---
let _lastReload = 0;
function autoReloadData() {
    if (!authToken) return;
    const now = Date.now();
    if (now - _lastReload < 2000) return; // debounce 2s
    _lastReload = now;
    loadLinks();
    loadGenerators();
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoReloadData();
});
window.addEventListener('focus', autoReloadData);
window.addEventListener('pageshow', (e) => {
    if (e.persisted) autoReloadData();
});

// --- Login ---
function showLogin() {
    loginScreen.classList.remove('hidden');
    adminScreen.classList.add('hidden');
}

function showAdmin() {
    loginScreen.classList.add('hidden');
    adminScreen.classList.remove('hidden');
    loadConfig();
    loadLinks();
    loadGenerators();
}

function logout() {
    authToken = '';
    localStorage.removeItem('authToken');
    showLogin();
}

loginBtn.addEventListener('click', doLogin);
passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
});

async function doLogin() {
    const password = passwordInput.value.trim();
    if (!password) return;

    loginBtn.disabled = true;
    loginBtn.textContent = '⏳';
    loginError.classList.add('hidden');

    try {
        const res = await fetch(`${API}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            passwordInput.value = '';
            showAdmin();
        } else {
            loginError.textContent = '❌ ' + (data.error || 'Sai mật khẩu');
            loginError.classList.remove('hidden');
        }
    } catch (err) {
        loginError.textContent = '❌ Lỗi kết nối';
        loginError.classList.remove('hidden');
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Đăng nhập';
    }
}

logoutBtn.addEventListener('click', logout);

// --- Config ---
async function loadConfig() {
    const res = await authFetch(`${API}/api/config`);
    if (!res) return;
    const data = await res.json();
    if (data.githubUrl) {
        githubUrlInput.value = data.githubUrl;
        currentUrlEl.textContent = `✅ Link hiện tại: ${data.githubUrl}`;
    }
}

saveUrlBtn.addEventListener('click', async () => {
    const url = githubUrlInput.value.trim();
    if (!url) return showToast('⚠️ Vui lòng nhập link');

    const res = await authFetch(`${API}/api/config`, {
        method: 'POST',
        body: JSON.stringify({ githubUrl: url })
    });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        currentUrlEl.textContent = `✅ Link hiện tại: ${url}`;
        showToast('✅ Đã lưu link');
    }
});

// --- Create Link ---
createLinkBtn.addEventListener('click', async () => {
    createLinkBtn.disabled = true;
    createLinkBtn.textContent = '⏳ Đang tạo...';

    try {
        const res = await authFetch(`${API}/api/create-link`, { method: 'POST' });
        if (!res) return;
        const data = await res.json();

        if (data.error) {
            showToast(`⚠️ ${data.error}`);
            return;
        }

        newLinkUrl.value = data.fullUrl;
        newLinkResult.classList.remove('hidden');

        try { await navigator.clipboard.writeText(data.fullUrl); } catch {}
        document.querySelector('.link-hint').classList.add('show');
        setTimeout(() => document.querySelector('.link-hint').classList.remove('show'), 2000);

        loadLinks();
    } catch (err) {
        showToast('❌ Lỗi tạo link');
    } finally {
        createLinkBtn.disabled = false;
        createLinkBtn.innerHTML = '<span class="btn-icon">+</span> Lấy Link Mới';
    }
});

// --- Copy ---
copyLinkBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(newLinkUrl.value); } catch {}
    document.querySelector('.link-hint').classList.add('show');
    showToast('📋 Đã copy!');
    setTimeout(() => document.querySelector('.link-hint').classList.remove('show'), 2000);
});

// --- Load Links ---
let _loadingLinks = false;
async function loadLinks() {
    if (_loadingLinks) return;
    _loadingLinks = true;
    try {
        const res = await authFetch(`${API}/api/links`);
        if (!res) return;
        const data = await res.json();

        if (!data.links || data.links.length === 0) {
            linksTable.style.display = 'none';
            emptyState.classList.remove('hidden');
            clearUsedBtn.style.display = 'none';
            return;
        }

        linksTable.style.display = 'table';
        emptyState.classList.add('hidden');

        const hasUsed = data.links.some(l => l.used);
        clearUsedBtn.style.display = hasUsed ? 'inline-flex' : 'none';

        const frag = document.createDocumentFragment();
        const baseUrl = window.location.origin;
        for (const link of data.links) {
            const safeId = escapeHtml(link.id);
            const fullUrl = `${baseUrl}/d/${safeId}`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="link-cell" title="Click để copy">/d/${safeId}</td>
                <td>${link.used ? '<span class="badge badge-used">Đã dùng</span>' : '<span class="badge badge-active">Sẵn sàng</span>'}</td>
                <td>${link.generatorId ? '<span class="badge badge-source-sub">Phụ</span>' : '<span class="badge badge-source-main">Gốc</span>'}</td>
                <td class="time-cell">${formatTime(link.createdAt)}</td>
                <td class="time-cell">${link.usedAt ? formatTime(link.usedAt) : '—'}</td>
                <td class="ip-cell">${link.usedByIp ? '🌐 ' + escapeHtml(link.usedByIp) : '—'}</td>
                <td><button class="btn-delete" title="Xoá">✕</button></td>
            `;
            tr.querySelector('.link-cell').addEventListener('click', () => copyToClipboard(fullUrl));
            tr.querySelector('.btn-delete').addEventListener('click', () => deleteLink(safeId));
            frag.appendChild(tr);
        }
        linksBody.innerHTML = '';
        linksBody.appendChild(frag);
    } finally {
        _loadingLinks = false;
    }
}

// --- Delete Link ---
async function deleteLink(id) {
    await authFetch(`${API}/api/links/${id}`, { method: 'DELETE' });
    loadLinks();
    showToast('🗑 Đã xoá link');
}

// --- Clear Used ---
clearUsedBtn.addEventListener('click', async () => {
    await authFetch(`${API}/api/links-used`, { method: 'DELETE' });
    loadLinks();
    showToast('🗑 Đã xoá các link đã dùng');
});

// ======== GENERATOR (Link Phụ) ========

// --- Create Generator ---
createGeneratorBtn.addEventListener('click', async () => {
    const maxLinks = parseInt(maxLinksInput.value);
    if (!maxLinks || maxLinks < 1) return showToast('⚠️ Vui lòng nhập số lượt hợp lệ');

    createGeneratorBtn.disabled = true;
    createGeneratorBtn.textContent = '⏳ Đang tạo...';

    try {
        const res = await authFetch(`${API}/api/create-generator`, {
            method: 'POST',
            body: JSON.stringify({ maxLinks })
        });
        if (!res) return;
        const data = await res.json();

        if (data.error) {
            showToast(`⚠️ ${data.error}`);
            return;
        }

        newGeneratorUrl.value = data.fullUrl;
        newGeneratorResult.classList.remove('hidden');

        try { await navigator.clipboard.writeText(data.fullUrl); } catch {}
        const hint = document.getElementById('generator-link-hint');
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 2000);

        loadGenerators();
    } catch (err) {
        showToast('❌ Lỗi tạo link phụ');
    } finally {
        createGeneratorBtn.disabled = false;
        createGeneratorBtn.innerHTML = '<span class="btn-icon">+</span> Tạo Link Phụ';
    }
});

// --- Copy Generator Link ---
copyGeneratorBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(newGeneratorUrl.value); } catch {}
    const hint = document.getElementById('generator-link-hint');
    hint.classList.add('show');
    showToast('📋 Đã copy!');
    setTimeout(() => hint.classList.remove('show'), 2000);
});

// --- Load Generators ---
let _loadingGens = false;
async function loadGenerators() {
    if (_loadingGens) return;
    _loadingGens = true;
    try {
        const res = await authFetch(`${API}/api/generators`);
        if (!res) return;
        const data = await res.json();

        if (!data.generators || data.generators.length === 0) {
            generatorsTable.style.display = 'none';
            generatorsEmpty.classList.remove('hidden');
            return;
        }

        generatorsTable.style.display = 'table';
        generatorsEmpty.classList.add('hidden');

        const frag = document.createDocumentFragment();
        const baseUrl = window.location.origin;
        for (const gen of data.generators) {
            const safeId = escapeHtml(gen.id);
            const fullUrl = `${baseUrl}/g/${safeId}`;
            const remaining = gen.maxLinks - gen.usedLinks;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="link-cell" title="Click để copy">/g/${safeId}</td>
                <td><span class="badge ${remaining <= 0 ? 'badge-used' : 'badge-active'}">${gen.usedLinks}/${gen.maxLinks}</span></td>
                <td class="time-cell">${formatTime(gen.createdAt)}</td>
                <td><button class="btn-delete" title="Xoá">✕</button></td>
            `;
            tr.querySelector('.link-cell').addEventListener('click', () => copyToClipboard(fullUrl));
            tr.querySelector('.btn-delete').addEventListener('click', () => deleteGenerator(safeId));
            frag.appendChild(tr);
        }
        generatorsBody.innerHTML = '';
        generatorsBody.appendChild(frag);
    } finally {
        _loadingGens = false;
    }
}

// --- Delete Generator ---
async function deleteGenerator(gid) {
    await authFetch(`${API}/api/generators/${gid}`, { method: 'DELETE' });
    loadGenerators();
    showToast('🗑 Đã xoá link phụ');
}

// --- Copy helper ---
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('📋 Đã copy link!');
    } catch {
        showToast('⚠️ Không thể copy, hãy copy thủ công');
    }
}

// --- Escape HTML helper (anti-XSS) ---
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Time format ---
function formatTime(isoStr) {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Toast ---
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2000);
}
