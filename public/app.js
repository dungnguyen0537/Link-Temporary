/* ===== LINK TẠM — ADMIN APP.JS (Mobile-Optimized) ===== */

const API = '';
let authToken = localStorage.getItem('authToken') || '';

// --- Detect mobile for perf optimizations ---
const _isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent || '');

// --- SVG Icons (inline, no dependency) ---
const ICONS = {
  copy: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
  spinner: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" class="spin-anim"><path d="M12 2a10 10 0 0110 10"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
};

// Inject spin animation style
const spinStyle = document.createElement('style');
spinStyle.textContent = `
  .spin-anim { animation: spinIcon 0.7s linear infinite; }
  @keyframes spinIcon { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin-anim { animation: none; } }
`;
document.head.appendChild(spinStyle);

// --- DOM Elements ---
const loginScreen  = document.getElementById('login-screen');
const adminScreen  = document.getElementById('admin-screen');
const passwordInput = document.getElementById('password-input');
const loginBtn     = document.getElementById('login-btn');
const loginError   = document.getElementById('login-error');
const logoutBtn    = document.getElementById('logout-btn');

const githubUrlInput = document.getElementById('github-url');
const saveUrlBtn     = document.getElementById('save-url-btn');
const currentUrlEl   = document.getElementById('current-url');
const createLinkBtn  = document.getElementById('create-link-btn');
const newLinkResult  = document.getElementById('new-link-result');
const newLinkUrl     = document.getElementById('new-link-url');
const copyLinkBtn    = document.getElementById('copy-link-btn');
const linksBody      = document.getElementById('links-body');
const emptyState     = document.getElementById('empty-state');
const clearUsedBtn   = document.getElementById('clear-used-btn');
const linksTable     = document.getElementById('links-table');

// Generator DOM
const maxLinksInput      = document.getElementById('max-links-input');
const createGeneratorBtn = document.getElementById('create-generator-btn');
const newGeneratorResult = document.getElementById('new-generator-result');
const newGeneratorUrl    = document.getElementById('new-generator-url');
const copyGeneratorBtn   = document.getElementById('copy-generator-btn');
const generatorsBody     = document.getElementById('generators-body');
const generatorsTable    = document.getElementById('generators-table');
const generatorsEmpty    = document.getElementById('generators-empty');

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
    // OPTIMIZED: Increased debounce from 3s to 5s — reduces redundant API calls on mobile
    if (now - _lastReload < 5000) return;
    _lastReload = now;
    // Parallel load — faster UX
    Promise.all([loadLinks(), loadGenerators()]);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoReloadData();
}, { passive: true });
window.addEventListener('focus', autoReloadData, { passive: true });
window.addEventListener('pageshow', (e) => {
    if (e.persisted) autoReloadData();
}, { passive: true });

// --- Login / Logout ---
function showLogin() {
    loginScreen.classList.remove('hidden');
    adminScreen.classList.add('hidden');
    // Focus password input
    requestAnimationFrame(() => passwordInput.focus());
}

function showAdmin() {
    loginScreen.classList.add('hidden');
    adminScreen.classList.remove('hidden');
    // Parallel load all data at once
    Promise.all([loadConfig(), loadLinks(), loadGenerators()]);
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
    loginBtn.innerHTML = `${ICONS.spinner} Đang đăng nhập...`;
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
            loginError.textContent = data.error || 'Sai mật khẩu';
            loginError.classList.remove('hidden');
            passwordInput.select();
        }
    } catch (err) {
        loginError.textContent = 'Lỗi kết nối — vui lòng thử lại';
        loginError.classList.remove('hidden');
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Đăng nhập`;
    }
}

logoutBtn.addEventListener('click', logout);

// --- Config ---
async function loadConfig() {
    try {
        const res = await authFetch(`${API}/api/config`);
        if (!res) return;
        const data = await res.json();
        if (data.githubUrl) {
            githubUrlInput.value = data.githubUrl;
            currentUrlEl.textContent = `✓ Link hiện tại: ${data.githubUrl}`;
        }
    } catch {}
}

saveUrlBtn.addEventListener('click', async () => {
    const url = githubUrlInput.value.trim();
    if (!url) return showToast('Vui lòng nhập link', 'warn');

    const origHTML = saveUrlBtn.innerHTML;
    saveUrlBtn.disabled = true;
    saveUrlBtn.innerHTML = ICONS.spinner;

    try {
        const res = await authFetch(`${API}/api/config`, {
            method: 'POST',
            body: JSON.stringify({ githubUrl: url })
        });
        if (!res) return;
        const data = await res.json();
        if (data.success) {
            currentUrlEl.textContent = `✓ Link hiện tại: ${url}`;
            showToast('Đã lưu link thành công', 'success');
        }
    } catch {
        showToast('Lỗi khi lưu', 'error');
    } finally {
        saveUrlBtn.disabled = false;
        saveUrlBtn.innerHTML = origHTML;
    }
});

// --- Create Link ---
createLinkBtn.addEventListener('click', async () => {
    const origHTML = createLinkBtn.innerHTML;
    createLinkBtn.disabled = true;
    createLinkBtn.innerHTML = `${ICONS.spinner} Đang tạo...`;

    try {
        const res = await authFetch(`${API}/api/create-link`, { method: 'POST' });
        if (!res) return;
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'warn');
            return;
        }

        newLinkUrl.value = data.fullUrl;
        newLinkResult.classList.remove('hidden');

        // Copy to clipboard
        await copyToClipboard(data.fullUrl, false);
        showLinkHint('#new-link-result .link-hint');

        // Refresh list
        loadLinks();
        showToast('Đã tạo và copy link!', 'success');
    } catch {
        showToast('Lỗi tạo link', 'error');
    } finally {
        createLinkBtn.disabled = false;
        createLinkBtn.innerHTML = origHTML;
    }
});

// --- Copy link button ---
copyLinkBtn.addEventListener('click', async () => {
    await copyToClipboard(newLinkUrl.value);
    showLinkHint('#new-link-result .link-hint');
});

// --- Load Links (optimized with batched rendering) ---
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
            const safeId  = escapeHtml(link.id);
            const fullUrl = `${baseUrl}/d/${safeId}`;
            const tr = document.createElement('tr');

            const statusBadge = link.used
                ? `<span class="badge badge-used">Đã dùng</span>`
                : `<span class="badge badge-active">Sẵn sàng</span>`;
            const sourceBadge = link.generatorId
                ? `<span class="badge badge-source-sub">Phụ</span>`
                : `<span class="badge badge-source-main">Gốc</span>`;

            tr.innerHTML = `
                <td><span class="link-cell" role="button" tabindex="0" title="Click để copy">/d/${safeId}</span></td>
                <td>${statusBadge}</td>
                <td>${sourceBadge}</td>
                <td class="time-cell">${formatTime(link.createdAt)}</td>
                <td class="time-cell">${link.usedAt ? formatTime(link.usedAt) : '—'}</td>
                <td class="ip-cell">${link.usedByIp ? escapeHtml(link.usedByIp) : '—'}</td>
                <td><button class="btn-delete" title="Xoá" aria-label="Xoá link">${ICONS.trash}</button></td>
            `;

            const linkCell = tr.querySelector('.link-cell');
            linkCell.addEventListener('click', () => copyToClipboard(fullUrl));
            linkCell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') copyToClipboard(fullUrl);
            });
            tr.querySelector('.btn-delete').addEventListener('click', () => deleteLink(safeId, tr));
            frag.appendChild(tr);
        }

        linksBody.innerHTML = '';
        linksBody.appendChild(frag);
    } catch {} finally {
        _loadingLinks = false;
    }
}

// --- Delete Link (optimistic UI) ---
async function deleteLink(id, rowEl) {
    // Optimistic: fade out row immediately
    if (rowEl) {
        rowEl.style.transition = 'opacity 0.2s, transform 0.2s';
        rowEl.style.opacity = '0';
        rowEl.style.transform = 'translateX(8px)';
        setTimeout(() => rowEl.remove(), 200);
    }
    try {
        await authFetch(`${API}/api/links/${id}`, { method: 'DELETE' });
        showToast('Đã xoá link', 'success');
        // Refresh to sync state (after optimistic remove)
        setTimeout(loadLinks, 500);
    } catch {
        showToast('Lỗi xoá link', 'error');
        loadLinks(); // Re-sync on error
    }
}

// --- Clear Used ---
clearUsedBtn.addEventListener('click', async () => {
    const origHTML = clearUsedBtn.innerHTML;
    clearUsedBtn.disabled = true;
    clearUsedBtn.innerHTML = `${ICONS.spinner} Đang xoá...`;
    try {
        await authFetch(`${API}/api/links-used`, { method: 'DELETE' });
        await loadLinks();
        showToast('Đã xoá các link đã dùng', 'success');
    } catch {
        showToast('Lỗi khi xoá', 'error');
    } finally {
        clearUsedBtn.disabled = false;
        clearUsedBtn.innerHTML = origHTML;
    }
});

// ======== GENERATOR (Link Phụ) ========

createGeneratorBtn.addEventListener('click', async () => {
    const maxLinks = parseInt(maxLinksInput.value);
    if (!maxLinks || maxLinks < 1) return showToast('Vui lòng nhập số lượt hợp lệ', 'warn');

    const origHTML = createGeneratorBtn.innerHTML;
    createGeneratorBtn.disabled = true;
    createGeneratorBtn.innerHTML = `${ICONS.spinner} Đang tạo...`;

    try {
        const res = await authFetch(`${API}/api/create-generator`, {
            method: 'POST',
            body: JSON.stringify({ maxLinks })
        });
        if (!res) return;
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'warn');
            return;
        }

        newGeneratorUrl.value = data.fullUrl;
        newGeneratorResult.classList.remove('hidden');

        await copyToClipboard(data.fullUrl, false);
        showLinkHint('#generator-link-hint');
        loadGenerators();
        showToast('Đã tạo và copy link phụ!', 'success');
    } catch {
        showToast('Lỗi tạo link phụ', 'error');
    } finally {
        createGeneratorBtn.disabled = false;
        createGeneratorBtn.innerHTML = origHTML;
    }
});

copyGeneratorBtn.addEventListener('click', async () => {
    await copyToClipboard(newGeneratorUrl.value);
    showLinkHint('#generator-link-hint');
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
            const safeId    = escapeHtml(gen.id);
            const fullUrl   = `${baseUrl}/g/${safeId}`;
            const remaining = gen.maxLinks - gen.usedLinks;
            const pct       = Math.round((remaining / gen.maxLinks) * 100);
            const isOut     = remaining <= 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="link-cell" role="button" tabindex="0" title="Click để copy">/g/${safeId}</span></td>
                <td><span class="badge ${isOut ? 'badge-used' : 'badge-active'}" title="${remaining} lượt còn lại">${gen.usedLinks}/${gen.maxLinks}</span></td>
                <td class="time-cell">${formatTime(gen.createdAt)}</td>
                <td><button class="btn-delete" title="Xoá" aria-label="Xoá link phụ">${ICONS.trash}</button></td>
            `;

            const linkCell = tr.querySelector('.link-cell');
            linkCell.addEventListener('click', () => copyToClipboard(fullUrl));
            linkCell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') copyToClipboard(fullUrl);
            });
            tr.querySelector('.btn-delete').addEventListener('click', () => deleteGenerator(safeId, tr));
            frag.appendChild(tr);
        }

        generatorsBody.innerHTML = '';
        generatorsBody.appendChild(frag);
    } catch {} finally {
        _loadingGens = false;
    }
}

// --- Delete Generator (optimistic UI) ---
async function deleteGenerator(gid, rowEl) {
    if (rowEl) {
        rowEl.style.transition = 'opacity 0.2s, transform 0.2s';
        rowEl.style.opacity = '0';
        rowEl.style.transform = 'translateX(8px)';
        setTimeout(() => rowEl.remove(), 200);
    }
    try {
        await authFetch(`${API}/api/generators/${gid}`, { method: 'DELETE' });
        showToast('Đã xoá link phụ', 'success');
        setTimeout(loadGenerators, 500);
    } catch {
        showToast('Lỗi xoá link phụ', 'error');
        loadGenerators();
    }
}

// --- Copy helper (with fallback for mobile) ---
async function copyToClipboard(text, toast = true) {
    try {
        // Modern API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            // Fallback for older mobile browsers / non-HTTPS
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;top:-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        if (toast) showToast('Đã copy link!', 'success');
        return true;
    } catch {
        if (toast) showToast('Không thể copy — hãy copy thủ công', 'warn');
        return false;
    }
}

// --- Show link hint (animated) ---
function showLinkHint(selector) {
    const hint = document.querySelector(selector);
    if (!hint) return;
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 2500);
}

// --- Escape HTML helper (anti-XSS) ---
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- Time format (Vietnamese-friendly) ---
function formatTime(isoStr) {
    if (!isoStr) return '—';
    try {
        const d = new Date(isoStr);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return '—';
    }
}

// --- Toast (with type support) ---
let _toastTimer = null;
function showToast(msg, type = 'default') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    // Clear existing timer
    if (_toastTimer) clearTimeout(_toastTimer);

    // Set color based on type
    const colors = {
        success: 'var(--green)',
        error:   'var(--red)',
        warn:    'var(--yellow)',
        default: 'var(--text)',
    };
    toast.style.color = colors[type] || colors.default;
    toast.style.borderColor = type !== 'default'
        ? colors[type].replace('var(', '').replace(')', '') === 'var(--green)' ? 'var(--green-border)' : 'var(--border)'
        : 'var(--border)';

    toast.textContent = msg;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => toast.classList.add('show'));

    _toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2500);
}
