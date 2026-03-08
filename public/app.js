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

        await navigator.clipboard.writeText(data.fullUrl);
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
    await navigator.clipboard.writeText(newLinkUrl.value);
    document.querySelector('.link-hint').classList.add('show');
    showToast('📋 Đã copy!');
    setTimeout(() => document.querySelector('.link-hint').classList.remove('show'), 2000);
});

// --- Load Links ---
async function loadLinks() {
    const res = await authFetch(`${API}/api/links`);
    if (!res) return;
    const data = await res.json();

    if (data.links.length === 0) {
        linksTable.style.display = 'none';
        emptyState.classList.remove('hidden');
        clearUsedBtn.style.display = 'none';
        return;
    }

    linksTable.style.display = 'table';
    emptyState.classList.add('hidden');

    const hasUsed = data.links.some(l => l.used);
    clearUsedBtn.style.display = hasUsed ? 'inline-flex' : 'none';

    linksBody.innerHTML = data.links.map(link => {
        const baseUrl = window.location.origin;
        const fullUrl = `${baseUrl}/d/${link.id}`;
        const createdAt = formatTime(link.createdAt);
        const usedAt = link.usedAt ? formatTime(link.usedAt) : '—';
        const statusBadge = link.used
            ? '<span class="badge badge-used">Đã dùng</span>'
            : '<span class="badge badge-active">Sẵn sàng</span>';

        return `
      <tr>
        <td class="link-cell" onclick="copyToClipboard('${fullUrl}')" title="Click để copy">/d/${link.id}</td>
        <td>${statusBadge}</td>
        <td class="time-cell">${createdAt}</td>
        <td class="time-cell">${usedAt}</td>
        <td><button class="btn-delete" onclick="deleteLink('${link.id}')" title="Xoá">✕</button></td>
      </tr>
    `;
    }).join('');
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

// --- Copy helper ---
async function copyToClipboard(text) {
    await navigator.clipboard.writeText(text);
    showToast('📋 Đã copy link!');
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
