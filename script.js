/* ===========================================================================
   Sistem Pengurusan Alamanda — script.js
   Frontend logic (dipisahkan daripada index.html asal).

   PENTING: Tampal URL Web App Google Apps Script anda di bawah selepas deploy.
   Ini SATU-SATUNYA tempat yang perlu ditukar jika URL Web App berubah.
   =========================================================================== */
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxA6zFng5EIX_WM8c-wEjpNYWlnhQa-VSnA_NEviXUF7DM4OydDCn2AGObhACcOTAyD/exec";

/* ===========================================================================
   JEMBATAN (SHIM) fetch('/api/...') -> Google Apps Script Web App
   -----------------------------------------------------------------------
   Kod asal sistem ini menggunakan fetch('/api/xxx', {...}) seolah-olah ia
   memanggil backend Node/Flask di laluan (path) relatif. Supaya SEMUA fungsi
   asal (ratusan panggilan fetch di seluruh fail ini) kekal berfungsi TANPA
   perlu ditulis semula satu-persatu, kita "pintas" (override) fungsi global
   `fetch` — apabila URL bermula dengan '/api/', ia akan disalurkan sebagai
   satu mesej POST kepada SCRIPT_URL (Apps Script Web App), dibungkus dengan
   {path, method, params, body}. Code.gs pula men'dispatch'kan mengikut path
   tersebut kepada fungsi yang setara.

   NOTA CORS: Permintaan POST ke Apps Script SENGAJA tidak diset header
   'Content-Type: application/json' supaya browser menganggapnya sebagai
   "simple request" (text/plain) dan TIDAK mencetuskan preflight OPTIONS —
   kerana Apps Script Web App tidak menyokong OPTIONS preflight. Code.gs
   tetap menghurai (parse) kandungan tersebut sebagai JSON.
   =========================================================================== */
const _nativeFetch = window.fetch.bind(window);

function _getAdminToken() {
    try { return localStorage.getItem('alamanda_admin_token') || ''; } catch (e) { return ''; }
}
function _setAdminToken(tok) {
    try {
        if (tok) localStorage.setItem('alamanda_admin_token', tok);
        else localStorage.removeItem('alamanda_admin_token');
    } catch (e) {}
}

function _parseApiUrl(url) {
    // url contoh: '/api/point_history/123' atau '/api/book_loan/top_borrowers?month=2026-07'
    let rest = url.replace(/^\/api\//, '');
    let [pathPart, queryPart] = rest.split('?');
    const params = {};
    if (queryPart) {
        new URLSearchParams(queryPart).forEach((v, k) => { params[k] = v; });
    }
    let path = pathPart;
    const segs = pathPart.split('/').filter(Boolean);
    // Laluan dinamik (path params) yang wujud dalam sistem asal:
    if (segs[0] === 'point_history' && segs[1]) {
        path = 'point_history'; params.id = segs[1];
    } else if (segs[0] === 'admin' && segs[1] === 'delete_member' && segs[2]) {
        path = 'admin/delete_member'; params.id = segs[2];
    } else if (segs[0] === 'admin' && segs[1] === 'download_excel' && segs[2]) {
        path = 'admin/download_excel'; params.type = segs[2];
    }
    return { path, params };
}

async function _apiFetch(url, options) {
    options = options || {};
    const method = (options.method || 'GET').toUpperCase();
    const { path, params } = _parseApiUrl(url);
    let body = {};
    if (options.body) {
        try { body = JSON.parse(options.body); } catch (e) { body = {}; }
    }
    const envelope = {
        path: path,
        method: method,
        params: params,
        body: body,
        adminToken: _getAdminToken()
    };
    const res = await _nativeFetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify(envelope)
    });
    let data;
    try { data = await res.json(); }
    catch (e) { data = { success: false, message: 'Ralat membaca respons server' }; }
    return {
        ok: true,
        status: 200,
        json: async () => data
    };
}

window.fetch = function (url, options) {
    if (typeof url === 'string' && url.indexOf('/api/') === 0) {
        return _apiFetch(url, options);
    }
    return _nativeFetch(url, options);
};

// ===================== GLOBAL =====================
let allMembers = [];
let allSessions = [];
let memberFilter = 'semua';
let sessionFilter = 'semua';
let isScanning = false;
let paymentMember = null;
let topupMember = null;

// ===================== HELPERS =====================
function formatDuration(minutes) {
    if (!minutes && minutes !== 0) return '—';
    const mins = parseInt(minutes);
    if (isNaN(mins)) return '—';
    if (mins < 60) return `${mins} minit`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (remainingMins === 0) return `${hours} jam`;
    return `${hours} jam ${remainingMins} minit`;
}
function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.textContent = msg;
    toast.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => el.remove(), 400); }, 3200);
}
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ===================== NAVIGATION =====================
function showPage(page) {
    // Hide all pages (including page-urusBertugas which is outside main)
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
        // jika page luar main (urusBertugas), sembunyikan terus
        if (p.id === 'page-urusBertugas' && page !== 'urusBertugas') {
            p.style.display = 'none';
        }
    });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    if (page === 'urusBertugas') {
        // Tunjuk page urusBertugas (luar main), sembunyikan main
        document.querySelector('main').style.display = 'none';
        const pg = document.getElementById('page-urusBertugas');
        if (pg) { pg.style.display = 'block'; pg.classList.add('active'); }
        loadBertugasList();
    } else {
        // Pastikan main kelihatan dan page-urusBertugas tersembunyi
        document.querySelector('main').style.display = '';
        const pgB = document.getElementById('page-urusBertugas');
        if (pgB) { pgB.style.display = 'none'; pgB.classList.remove('active'); }
        const pg = document.getElementById('page-' + page);
        if (pg) pg.classList.add('active');
        const nv = document.getElementById('nav-' + page);
        if (nv) nv.classList.add('active');
        if (page === 'scan') { loadLiveSessions(); loadLeaderboard(); loadBatchActivity(); loadActiveLoans(); loadTopBorrowers(); document.getElementById('nfcInput').focus(); }
        if (page === 'sesi') loadTodaySessions();
        if (page === 'ahli') loadMembers();
        if (page === 'admin') checkAdminStatus();
        if (page === 'kehadiran') { loadBulkAttendanceList(); setTimeout(()=>document.getElementById('bulkAttIc').focus(), 100); }
    }
}

// ===================== UPDATE AHLI (BULK CLASS UPDATE) =====================
async function loadBulkMembersByBatch() {
    const batch = document.getElementById('upBatch').value.trim();
    const course = document.getElementById('upCourse').value.trim();
    if (!batch) { showToast('Sila masukkan nombor batch', 'error'); return; }
    const body = document.getElementById('upMembersBody');
    body.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Memuatkan...</td></tr>';
    try {
        const res = await fetch('/api/bulk_members_by_batch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ batch, course }) });
        const data = await res.json();
        if (!data.success) { showToast(data.message, 'error'); body.innerHTML = `<tr><td colspan="7" class="empty-state">${data.message}</td></tr>`; return; }
        document.getElementById('upMembersInfo').innerHTML = `<i class="fas fa-users"></i> Jumlah: <b>${data.count}</b> ahli biasa IC dalam batch <b>${batch}</b>${course?' (course '+course+')':''}`;
        if (!data.members.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">Tiada ahli sepadan</td></tr>'; return; }
        window._upMembersCache = data.members;
        body.innerHTML = data.members.map((m, i) => `<tr><td>${i+1}</td><td>${m.name}</td><td>${m.ic_number}</td><td>${m.kelas}</td><td>${m.batch}</td><td>${m.category||'-'}</td><td><button class="btn btn-warning btn-sm" onclick="openEditMemberModal(${m.id})"><i class="fas fa-pen"></i> Edit</button></td></tr>`).join('');
    } catch(e) { showToast('Ralat sambungan', 'error'); }
}
async function bulkUpdateKelas() {
    const batch = document.getElementById('upBatch').value.trim();
    const course = document.getElementById('upCourse').value.trim();
    const new_kelas = document.getElementById('upNewKelas').value.trim();
    if (!batch || !new_kelas) { showToast('Sila lengkapkan batch dan kelas baru', 'error'); return; }
    if (!confirm(`Kemaskini SEMUA ahli BULK/IC dalam batch ${batch}${course?' ('+course+')':''} ke kelas "${new_kelas}"?`)) return;
    try {
        const res = await fetch('/api/bulk_update_kelas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ batch, course, new_kelas }) });
        const data = await res.json();
        showToast(data.message, data.success?'success':'error');
        if (data.success) loadBulkMembersByBatch();
    } catch(e) { showToast('Ralat sambungan', 'error'); }
}

// ===================== KEHADIRAN IC/BULK =====================
async function bulkAttendanceCheckin() {
    const ic = document.getElementById('bulkAttIc').value.trim();
    if (!ic) { showToast('Sila masukkan No. IC', 'error'); return; }
    const result = document.getElementById('bulkAttResult');
    try {
        const res = await fetch('/api/bulk_attendance/checkin', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ic_number: ic }) });
        const data = await res.json();
        if (!data.success) {
            if (data.not_found) {
                showAutoPopup('IC tidak dijumpai SILA KE KAUNTER', 'error', 2000);
                result.innerHTML = '';
            } else {
                result.innerHTML = `<div class="card" style="border-left:4px solid var(--danger);background:#fff5f5"><b style="color:var(--danger)"><i class="fas fa-circle-xmark"></i> ${data.message}</b></div>`;
                showToast(data.message, 'error');
            }
            document.getElementById('bulkAttIc').value = '';
        } else {
            const m = data.member;
            const cat = (m.category || '').toLowerCase();
            const catLabel = cat === 'guru' ? 'Guru' : (cat === 'pelajar' ? 'Pelajar' : (m.category || '-'));
            const catColor = cat === 'guru' ? '#7c3aed' : (cat === 'pelajar' ? '#0ea5e9' : '#64748b');
            const catBadge = `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${catColor};color:#fff;font-size:0.75rem;font-weight:700;margin-left:6px">${catLabel}</span>`;
            result.innerHTML = `<div class="card" style="border-left:4px solid var(--success);background:#f0fdf4"><b style="color:var(--success)"><i class="fas fa-circle-check"></i> ${data.message}</b><div style="margin-top:8px;font-size:0.9rem"><b>${m.name}</b> ${catBadge}<br>IC: ${m.ic_number} &middot; Kelas: ${m.kelas} &middot; Kategori: <b>${catLabel}</b><br>Tarikh: ${m.date} &middot; Masa: ${m.time}</div></div>`;
            showToast('Kehadiran berjaya direkod', 'success');
            document.getElementById('bulkAttIc').value = '';
            loadBulkAttendanceList();
        }
        document.getElementById('bulkAttIc').focus();
    } catch(e) { showToast('Ralat sambungan', 'error'); }
}
async function loadBulkAttendanceList() {
    try {
        const res = await fetch('/api/bulk_attendance/list');
        const data = await res.json();
        const body = document.getElementById('bulkAttBody');
        if (!data.length) { body.innerHTML = '<tr><td colspan="5" class="empty-state">Tiada rekod hari ini</td></tr>'; return; }
        body.innerHTML = data.map(r => `<tr><td>${r.name}</td><td>${r.ic_number}</td><td>${r.kelas}</td><td>${r.date}</td><td>${r.time}</td></tr>`).join('');
    } catch(e) {}
}

// ===================== DASHBOARD =====================
async function loadLeaderboard() {
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        const list = document.getElementById('leaderboardList');
        if (!data.length) { list.innerHTML = '<li>Tiada data</li>'; return; }
        list.innerHTML = data.map((item, idx) => `<li><span class="leaderboard-rank">${idx+1}</span><span class="leaderboard-name">${item.name}</span><span class="leaderboard-points">${item.points} pt</span></li>`).join('');
    } catch(e) { console.error(e); }
}
async function loadBatchActivity() {
    try {
        const res = await fetch('/api/batch_activity');
        const data = await res.json();
        const container = document.getElementById('batchActivityList');
        if (!data.length) { container.innerHTML = '<li>Tiada data kehadiran batch bulan ini</li>'; return; }
        container.innerHTML = data.map(item => `<li><span><strong>Batch ${item.batch}</strong></span><span class="batch-count">${item.count} kehadiran</span></li>`).join('');
    } catch(e) { console.error(e); }
}

// ===================== NFC SCAN =====================
const nfcInput = document.getElementById('nfcInput');
nfcInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
let scanTimeout = null;
nfcInput.addEventListener('input', () => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => { if (nfcInput.value.trim().length > 2) doScan(); }, 300);
});
async function doScan() {
    if (isScanning) { showToast('Sila tunggu, sedang memproses...', 'warning'); return; }
    const nfcId = nfcInput.value.trim();
    if (!nfcId) { showToast('Sila imbas atau masukkan ID kad', 'error'); return; }
    isScanning = true;
    nfcInput.disabled = true;
    document.getElementById('scanBtn').disabled = true;
    try {
        const res = await fetch('/api/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ nfc_id:nfcId }) });
        const data = await res.json();
        showScanResult(data);
        nfcInput.value = '';
        loadLiveSessions();
        loadLeaderboard();
        loadBatchActivity();
    } catch(e) { showToast('Ralat sambungan server', 'error'); }
    finally {
        setTimeout(() => { nfcInput.disabled = false; document.getElementById('scanBtn').disabled = false; nfcInput.focus(); isScanning = false; }, 1500);
    }
}
function showScanResult(data) {
    const el = document.getElementById('scanResult');
    el.className = 'scan-result card';
    if (!data.success) {
        el.innerHTML = `<div style="color:var(--danger)"><i class="fas fa-circle-xmark"></i> <b>Gagal</b><div class="result-msg">${data.message}</div></div>`;
        el.classList.add('show', 'error');
        return;
    }
    const m = data.member;
    let statusBadge = '', bgClass = 'success';
    if (data.status_type === 'selesai') statusBadge = `<span class="result-badge badge-selesai"><i class="fas fa-circle-check"></i> Selesai Bertugas (${formatDuration(m.duration)})</span>`;
    else if (data.status_type === 'keluar_awal') { statusBadge = `<span class="result-badge badge-awal"><i class="fas fa-triangle-exclamation"></i> Keluar Awal Bertugas (${formatDuration(m.duration)})</span>`; bgClass = 'warning'; }
    else if (data.status_type === 'checkin_ahli') statusBadge = `<span class="result-badge badge-checkin"><i class="fas fa-star"></i> Log Masuk Ahli</span>`;
    else if (data.status_type === 'checkin_bertugas') statusBadge = `<span class="result-badge badge-checkin"><i class="fas fa-user-check"></i> Log Masuk Bertugas</span>`;
    else if (data.status_type === 'checkout') statusBadge = `<span class="result-badge badge-selesai"><i class="fas fa-right-from-bracket"></i> Log Keluar</span>`;
    let pointsInfo = m.category === 'ahli' ? `<div style="margin-top:8px;font-size:0.85rem;color:var(--primary);font-weight:600"><i class="fas fa-star" style="color:var(--warning)"></i> Jumlah Point: ${m.points} pt (RM ${(m.points/100).toFixed(2)})</div>` : '';
    let autoLogoutInfo = data.auto_logout ? `<div style="margin-top:4px;font-size:0.78rem;color:var(--text-muted)"><i class="fas fa-clock"></i> Auto-logout pada: ${data.auto_logout}</div>` : '';
    el.innerHTML = `<div class="result-name">${m.name}</div><div class="result-msg">${data.message}</div>${statusBadge}${pointsInfo}${autoLogoutInfo}`;
    el.classList.add('show', bgClass);
}

// ===================== LIVE SESSIONS =====================
async function loadLiveSessions() {
    const res = await fetch('/api/today_sessions');
    const sessions = await res.json();
    const active = sessions.filter(s => !s.check_out);
    document.getElementById('liveCount').textContent = `${active.length} orang aktif`;
    const container = document.getElementById('liveSessions');
    if (active.length === 0) { container.innerHTML = '<div class="empty-state"><i class="fas fa-door-open"></i><p>Tiada sesi aktif sekarang</p></div>'; return; }
    container.innerHTML = active.map(s => {
        const initials = s.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
        const avClass = s.category === 'bertugas' ? 'av-bertugas' : 'av-ahli';
        const roleChip = s.role ? `<span class="role-chip chip-${s.role.toLowerCase()}">${s.role}</span>` : '';
        return `<div class="session-item"><div class="session-avatar ${avClass}">${initials}</div><div class="session-info"><div class="session-name">${s.name} ${roleChip}</div><div class="session-meta"><i class="fas fa-clock"></i> Masuk: ${s.check_in} &nbsp;|&nbsp; ${s.category === 'bertugas' ? 'Bertugas' : 'Ahli'}</div></div><div class="session-status"><span class="dot-live"></span> Aktif</div></div>`;
    }).join('');
}

// ===================== TODAY SESSIONS =====================
async function loadTodaySessions() { const res = await fetch('/api/today_sessions'); allSessions = await res.json(); renderSessions(); }
function filterSessions(f) { sessionFilter = f; const btns = document.querySelectorAll('#page-sesi .tab-btn'); btns.forEach(btn => btn.classList.remove('active')); if (event && event.target) event.target.classList.add('active'); renderSessions(); }
function renderSessions() {
    let data = allSessions;
    if (sessionFilter === 'bertugas') data = data.filter(s => s.category === 'bertugas');
    else if (sessionFilter === 'ahli') data = data.filter(s => s.category === 'ahli');
    else if (sessionFilter === 'aktif') data = data.filter(s => !s.check_out);
    const tbody = document.getElementById('sessionsBody');
    if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-inbox"></i><p>Tiada rekod</p></div></td></tr>'; return; }
    tbody.innerHTML = data.map(s => {
        let statusHtml = '—';
        if (!s.check_out) statusHtml = '<span class="status-pill pill-blue"><span class="dot-live"></span>Aktif</span>';
        else if (s.category === 'bertugas') {
            if (s.status === 'selesai') statusHtml = '<span class="status-pill pill-green"> Selesai Bertugas</span>';
            else if (s.status === 'keluar_awal') statusHtml = '<span class="status-pill pill-red"> Keluar Awal</span>';
            else statusHtml = `<span class="status-pill pill-yellow">${s.status}</span>`;
        } else statusHtml = `<span class="status-pill pill-green">+${s.points_earned} pt</span>`;
        const roleChip = s.role ? `<span class="role-chip chip-${s.role.toLowerCase()}">${s.role}</span>` : '';
        // Duration with colour for bertugas
        let durationDisplay = '—';
        if (s.duration || s.duration === 0) {
            const mins = parseInt(s.duration);
            let durColor = '';
            if (s.category === 'bertugas' && s.check_out) {
                if (mins <= 18) durColor = 'color:#dc2626;font-weight:700';
                else if (mins <= 25) durColor = 'color:#d97706;font-weight:700';
                else durColor = 'color:#059669;font-weight:700';
            }
            durationDisplay = durColor ? `<span style="${durColor}">${formatDuration(mins)}</span>` : formatDuration(mins);
        }
        return `<tr>
            <td><b>${s.name}</b></td>
            <td>${s.category === 'bertugas' ? '🔵 Bertugas' : '🟠 Ahli'} ${roleChip}</td>
            <td>${s.check_in}</td>
            <td>${s.check_out || '<span style="color:var(--success)">masih di dalam</span>'}</td>
            <td>${durationDisplay}</td>
            <td>${statusHtml}</td>
        </tr>`;
    }).join('');
}

// ===================== MEMBERS =====================
async function loadMembers() { const res = await fetch('/api/members'); allMembers = await res.json(); renderMembers(); updateAdminStats(); }
function filterMembers(f) { memberFilter = f; const btns = document.querySelectorAll('#page-ahli .tab-btn'); btns.forEach(btn => btn.classList.remove('active')); if (event && event.target) event.target.classList.add('active'); renderMembers(); }
function renderMembers() {
    let data = allMembers;
    if (memberFilter === 'ahli') data = data.filter(m => m.category === 'ahli');
    else if (memberFilter === 'bertugas') data = data.filter(m => m.category === 'bertugas');
    const tbody = document.getElementById('membersBody');
    if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-users"></i><p>Tiada ahli</p></div></td></tr>'; return; }
    tbody.innerHTML = data.map(m => {
        const ptHtml = m.category === 'ahli' ? `<div class="pts-display"><i class="fas fa-star star"></i>${m.points} pt <span class="pts-rm">RM ${(m.points/100).toFixed(2)}</span></div>` : `<span class="status-pill ${m.is_active ? 'pill-green' : 'pill-blue'}">${m.is_active ? '🟢 Bertugas' : 'Tidak Aktif'}</span>`;
        const roleChip = m.role ? `<span class="role-chip chip-${m.role.toLowerCase()}">${m.role}</span>` : `<span class="role-chip chip-ahli">Ahli</span>`;
        const activeChip = m.is_active ? ' <span class="dot-live"></span>' : '';
        const expiryDisplay = m.expiry_date ? m.expiry_date : 'unlimited';
        const remainingDisplay = m.remaining ? m.remaining : 'Premium Subscription';
        return `<tr>
            <td><b>${m.name}</b>${activeChip}</td>
            <td style="font-family:monospace;font-size:0.82rem">${m.nfc_id}</td>
            <td>${roleChip}</td>
            <td>${ptHtml}</td>
            <td style="font-size:0.8rem;color:var(--text-muted)">${m.created_at}</td>
            <td>${expiryDisplay}</td>
            <td>${remainingDisplay}</td>
            <td>${m.batch || '—'}</td>
            <td>${m.category === 'ahli' ? `<button class="btn btn-warning btn-sm" onclick="showHistory(${m.id},'${m.name.replace(/'/g, "\\'")}')"><i class="fas fa-history"></i></button> ` : ''}</td>
        </tr>`;
    }).join('');
}

// ===================== REGISTER =====================
function toggleRoleAndExpiry() {
    const cat = document.getElementById('regCategory').value;
    // Peranan kini wajib untuk ahli & bertugas
    document.getElementById('roleGroup').style.display = (cat === 'ahli' || cat === 'bertugas') ? 'block' : 'none';
    document.getElementById('initialPointsGroup').style.display = cat === 'ahli' ? 'block' : 'none';
    document.getElementById('expiryGroup').style.display = (cat === 'ahli' || cat === 'bertugas') ? 'block' : 'none';
    document.getElementById('batchGroup').style.display = (cat === 'ahli' || cat === 'bertugas') ? 'block' : 'none';
    toggleKelasInput();
}
function toggleKelasInput() {
    const role = document.getElementById('regRole').value;
    document.getElementById('kelasGroup').style.display = role === 'pelajar' ? 'block' : 'none';
}
async function registerMember() {
    const nfc_id = document.getElementById('regNfc').value.trim();
    const name = document.getElementById('regName').value.trim();
    const category = document.getElementById('regCategory').value;
    const roleSel = document.getElementById('regRole').value;
    const kelas = document.getElementById('regKelas') ? document.getElementById('regKelas').value.trim() : '';
    const expiry_date = document.getElementById('regExpiry').value;
    const batch = document.getElementById('regBatch').value.trim();
    const ic_number = document.getElementById('regIc') ? document.getElementById('regIc').value.trim() : '';
    const initial_points = parseInt(document.getElementById('regInitialPoints').value) || 0;
    if (!nfc_id || !name || !category) { showToast('Sila isi semua maklumat', 'error'); return; }
    if (!roleSel) { showToast('Sila pilih peranan (Guru/Pelajar/AKP)', 'error'); return; }
    if (roleSel === 'pelajar' && !kelas) { showToast('Sila isi kelas untuk pelajar', 'error'); return; }
    // Auto: Guru/AKP -> tulis 'Guru'/'AKP'; Pelajar -> tulis nama kelas
    let role;
    if (roleSel === 'guru') role = 'Guru';
    else if (roleSel === 'AKP') role = 'AKP';
    else role = kelas;
    const payload = { nfc_id, name, category, role, initial_points, ic_number: ic_number || undefined };
    if (expiry_date) payload.expiry_date = expiry_date;
    if (batch) payload.batch = batch;
    const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
        document.getElementById('regNfc').value = '';
        if(document.getElementById('regIc')) document.getElementById('regIc').value = '';
        document.getElementById('regName').value = '';
        document.getElementById('regCategory').value = '';
        document.getElementById('regRole').value = '';
        if(document.getElementById('regKelas')) document.getElementById('regKelas').value = '';
        document.getElementById('regExpiry').value = '';
        document.getElementById('regBatch').value = '';
        document.getElementById('regInitialPoints').value = '0';
        document.getElementById('roleGroup').style.display = 'none';
        document.getElementById('kelasGroup').style.display = 'none';
        document.getElementById('initialPointsGroup').style.display = 'none';
        document.getElementById('expiryGroup').style.display = 'none';
        document.getElementById('batchGroup').style.display = 'none';
        loadMembers();
    }
}

// ===================== ADMIN (FIXED) =====================
async function checkAdminStatus() {
    const res = await fetch('/api/admin/check');
    const data = await res.json();
    if (data.logged_in) {
        document.getElementById('adminLogin').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        await loadAdminMembers();
        updateAdminStats();
    } else {
        document.getElementById('adminLogin').style.display = 'block';
        document.getElementById('adminPanel').style.display = 'none';
    }
}
async function adminLogin() {
    const pass = document.getElementById('adminPass').value;
    const res = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ password:pass }) });
    const data = await res.json();
    if (data.success) { _setAdminToken(data.token || ''); checkAdminStatus(); showToast('Log masuk admin berjaya!'); }
    else { showToast(data.message || 'Kata laluan salah', 'error'); }
}
async function adminLogout() {
    await fetch('/api/admin/logout', { method:'POST' });
    _setAdminToken('');
    checkAdminStatus();
    showToast('Log keluar admin');
}
async function loadAdminMembers() {
    const res = await fetch('/api/members');
    const members = await res.json();
    adminMembersList = members;
    filterAdminMembers();
}
let adminMembersList = [];
let currentBatchFilter = '';
function filterAdminMembers() {
    const searchTerm = document.getElementById('adminMemberSearch').value.toLowerCase();
    let filtered = adminMembersList.filter(m => m.name.toLowerCase().includes(searchTerm));
    if (currentBatchFilter !== '') {
        filtered = filtered.filter(m => m.batch === currentBatchFilter);
    }
    const tbody = document.getElementById('adminMembersBody');
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-users"></i><p>Tiada ahli</p></div></td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(m => {
        const ptHtml = m.category === 'ahli' 
            ? `<div class="pts-display"><i class="fas fa-star star"></i>${m.points} pt <span class="pts-rm">RM ${(m.points/100).toFixed(2)}</span></div>`
            : '—';
        const roleChip = m.role ? `<span class="role-chip chip-${m.role.toLowerCase()}">${m.role}</span>` : `<span class="role-chip chip-ahli">Ahli</span>`;
        const expiryDisplay = m.expiry_date ? m.expiry_date : '	Unlimited';
        const remainingDisplay = m.remaining ? m.remaining : 'Premium Subscription';
        return `<tr>
            <td><b>${m.name}</b> ${roleChip}</td>
            <td>${m.category === 'bertugas' ? '🔵 Bertugas' : '🟠 Ahli'}</td>
            <td>${ptHtml}</td>
            <td style="font-size:0.8rem">${m.created_at}</td>
            <td>${expiryDisplay}</td>
            <td>${remainingDisplay}</td>
            <td>${m.batch || '—'}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px">
                ${m.category === 'ahli' ? `<button class="btn btn-warning btn-sm" onclick="openPointModal(${m.id},'${m.name.replace(/'/g, "\\'")}',${m.points})"><i class="fas fa-star"></i> Point</button>` : ''}
                ${m.category === 'ahli' ? `<button class="btn btn-info btn-sm" onclick="openExpiryModal(${m.id},'${m.name.replace(/'/g, "\\'")}','${m.expiry_date || ''}')"><i class="fas fa-calendar"></i> Tamat</button>` : ''}
                <button class="btn btn-danger btn-sm" onclick="openDeleteModal(${m.id},'${m.name.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}
function filterAdminMembersByBatch() {
    const batch = document.getElementById('batchSearchInput').value.trim();
    currentBatchFilter = batch;
    if (batch === '') document.getElementById('batchSearchResult').innerHTML = '';
    else document.getElementById('batchSearchResult').innerHTML = `Menunjukkan ahli dalam batch <strong>${batch}</strong>`;
    filterAdminMembers();
}
async function deleteBatch() {
    const batch = document.getElementById('batchSearchInput').value.trim();
    if (!batch) { showToast('Sila masukkan nombor batch', 'error'); return; }
    if (!confirm(`Anda pasti mahu membuang SEMUA ahli dalam batch "${batch}"? Tindakan ini tidak boleh dibatalkan.`)) return;
    const res = await fetch('/api/admin/delete_by_batch', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ batch }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
        document.getElementById('batchSearchInput').value = '';
        currentBatchFilter = '';
        await loadAdminMembers();
        loadMembers();
    }
}
async function updateAdminStats() {
    const res = await fetch('/api/members');
    const members = await res.json();
    const res2 = await fetch('/api/today_sessions');
    const sessions = await res2.json();
    document.getElementById('statAhli').textContent = members.filter(m=>m.category==='ahli').length;
    document.getElementById('statBertugas').textContent = members.filter(m=>m.category==='bertugas').length;
    document.getElementById('statSesiHariIni').textContent = sessions.length;
    document.getElementById('statPoints').textContent = members.filter(m=>m.category==='ahli').reduce((s,m)=>s+m.points,0);
}
function openPointModal(id, name, points) {
    document.getElementById('pointMemberId').value = id;
    document.getElementById('pointMemberName').value = name;
    document.getElementById('pointMemberCurrent').value = points + ' pt (RM ' + (points/100).toFixed(2) + ')';
    document.getElementById('pointAmount').value = '';
    document.getElementById('pointNote').value = '';
    openModal('pointModal');
}
async function submitPoint() {
    const member_id = document.getElementById('pointMemberId').value;
    const action = document.getElementById('pointAction').value;
    const points = parseInt(document.getElementById('pointAmount').value);
    const note = document.getElementById('pointNote').value;
    if (!points || points < 1) { showToast('Sila masukkan jumlah point', 'error'); return; }
    const res = await fetch('/api/admin/adjust_points', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ member_id, action, points, note }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) { closeModal('pointModal'); await loadAdminMembers(); loadMembers(); loadLeaderboard(); }
}
function openDeleteModal(id, name) {
    document.getElementById('deleteMemberId').value = id;
    document.getElementById('deleteMemberName').textContent = name;
    openModal('deleteModal');
}
async function confirmDelete() {
    const id = document.getElementById('deleteMemberId').value;
    const res = await fetch(`/api/admin/delete_member/${id}`, { method:'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) { closeModal('deleteModal'); await loadAdminMembers(); loadMembers(); loadLeaderboard(); }
}
async function deleteByMonth(category) {
    const month = document.getElementById('deleteMonth').value;
    if (!month) { showToast('Sila pilih bulan terlebih dahulu', 'error'); return; }
    const res = await fetch('/api/admin/delete_by_month', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ category, month }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) await loadAdminMembers();
}
function openExpiryModal(id, name, currentExpiry) {
    document.getElementById('expiryMemberId').value = id;
    document.getElementById('expiryMemberName').value = name;
    document.getElementById('expiryDate').value = currentExpiry;
    openModal('expiryModal');
}
async function setExpiryDate() {
    const member_id = document.getElementById('expiryMemberId').value;
    const expiry_date = document.getElementById('expiryDate').value;
    const res = await fetch('/api/admin/set_expiry', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ member_id, expiry_date: expiry_date || null }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) { closeModal('expiryModal'); await loadAdminMembers(); loadMembers(); }
}
function downloadExcel(type) { window.location.href = `${SCRIPT_URL}?action=admin_download_excel&type=${encodeURIComponent(type)}&adminToken=${encodeURIComponent(_getAdminToken())}`; showToast(`Muat turun laporan ${type} dimulakan...`); }

function downloadExcelByMonth(type) {
    const monthInput = document.getElementById('downloadMonth');
    const month = monthInput ? monthInput.value : '';
    let url = `${SCRIPT_URL}?action=admin_download_excel&type=${encodeURIComponent(type)}&adminToken=${encodeURIComponent(_getAdminToken())}`;
    if (month) url += `&month=${encodeURIComponent(month)}`;
    window.location.href = url;
    const typeLabel = type === 'ahli_nfc' ? 'Ahli NFC' : type === 'ahli_biasa' ? 'Ahli Biasa' : type === 'bulk_attendance' ? 'Kehadiran IC/BULK' : type;
    const label = month ? `bulan ${month}` : 'semua rekod';
    showToast(`Muat turun ${typeLabel} (${label}) dimulakan...`);
}
async function showHistory(id, name) {
    document.getElementById('historyMemberName').textContent = name;
    const res = await fetch(`/api/point_history/${id}`);
    const txs = await res.json();
    const list = document.getElementById('historyList');
    if (txs.length === 0) { list.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>Tiada sejarah</p></div>'; }
    else { list.innerHTML = txs.map(t => { const isPos = t.points > 0; return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:${isPos?'#f0fdf4':'#fef2f2'};border-radius:8px;border-left:3px solid ${isPos?'var(--success)':'var(--danger)'}"><div><div style="font-weight:700;font-size:0.88rem">${t.note || t.action}</div><div style="font-size:0.75rem;color:var(--text-muted)">${t.date}</div></div><div style="font-weight:800;font-size:1rem;color:${isPos?'var(--success)':'var(--danger)'}">${isPos?'+':''}${t.points} pt</div></div>`; }).join(''); }
    openModal('historyModal');
}

// ===================== PAYMENT =====================
function openPaymentModal() {
    openModal('paymentModal');
    paymentMember = null;
    document.getElementById('paymentMemberInfo').innerHTML = '';
    document.getElementById('paymentNfc').value = '';
    document.getElementById('paymentAmount').value = '';
    document.getElementById('paymentNote').value = '';
    document.getElementById('paymentAmount').focus();
}
document.getElementById('paymentAmount').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (paymentMember) processPayment();
        else showToast('Sila imbas kad dahulu', 'warning');
    }
});
document.getElementById('paymentNfc').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const nfc = e.target.value.trim();
        if (nfc) await fetchPaymentMember(nfc);
    }
});
async function fetchPaymentMember(nfcId) {
    const res = await fetch('/api/get_member_by_nfc', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ nfc_id:nfcId }) });
    const data = await res.json();
    if (data.success && data.member) {
        paymentMember = data.member;
        document.getElementById('paymentMemberInfo').innerHTML = `<strong><i class="fas fa-id-card"></i> ${paymentMember.name}</strong><br>Point: ${paymentMember.points} pt (RM ${(paymentMember.points/100).toFixed(2)})`;
    } else {
        paymentMember = null;
        document.getElementById('paymentMemberInfo').innerHTML = '<span style="color:red">Kad tidak dikenali</span>';
    }
}
async function processPayment() {
    const method = document.getElementById('paymentMethod').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const note = document.getElementById('paymentNote').value;
    if (isNaN(amount) || amount <= 0) { showToast('Jumlah tidak sah', 'error'); return; }
    if (!paymentMember) { showToast('Sila imbas kad ahli terlebih dahulu', 'error'); return; }
    const res = await fetch('/api/payment', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ member_id:paymentMember.id, amount_rm:amount, method:method, note:note }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
        closeModal('paymentModal');
        if (method === 'kad') {
            loadMembers();
            loadLeaderboard();
            if (document.getElementById('page-admin').classList.contains('active')) loadAdminMembers();
        }
    }
}

// ===================== TOPUP =====================
function openTopupModal() {
    openModal('topupModal');
    topupMember = null;
    document.getElementById('topupMemberInfo').innerHTML = '';
    document.getElementById('topupNfc').value = '';
    document.getElementById('topupAmount').value = '';
    document.getElementById('topupNote').value = '';
    document.getElementById('topupNfc').focus();
}
document.getElementById('topupNfc').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const nfc = e.target.value.trim();
        if (nfc) await fetchTopupMember(nfc);
    }
});
document.getElementById('topupAmount').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (topupMember) processTopup();
        else showToast('Sila imbas kad dahulu', 'warning');
    }
});
async function fetchTopupMember(nfcId) {
    const res = await fetch('/api/get_member_by_nfc', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ nfc_id:nfcId }) });
    const data = await res.json();
    if (data.success && data.member) {
        topupMember = data.member;
        document.getElementById('topupMemberInfo').innerHTML = `<strong><i class="fas fa-id-card"></i> ${topupMember.name}</strong><br>Point semasa: ${topupMember.points} pt (RM ${(topupMember.points/100).toFixed(2)})`;
        document.getElementById('topupAmount').focus();
    } else {
        topupMember = null;
        document.getElementById('topupMemberInfo').innerHTML = '<span style="color:red">Kad tidak dikenali</span>';
    }
}
async function processTopup() {
    const amount = parseFloat(document.getElementById('topupAmount').value);
    const note = document.getElementById('topupNote').value;
    if (isNaN(amount) || amount <= 0) { showToast('Jumlah tidak sah', 'error'); return; }
    if (!topupMember) { showToast('Sila imbas kad ahli terlebih dahulu', 'error'); return; }
    const res = await fetch('/api/topup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ member_id:topupMember.id, amount_rm:amount, note:note }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
        closeModal('topupModal');
        loadMembers();
        loadLeaderboard();
        if (document.getElementById('page-admin').classList.contains('active')) loadAdminMembers();
    }
}

// ===================== MODAL CLICK OUTSIDE =====================
document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('show'); });
});

// ===================== QUEUE SYSTEM =====================
let qUrQueue  = [];
let qUrIdx    = -1;
let qPayQueue = [];
let qPayIdx   = -1;
let qPcState  = [0, 0, 0, 0];
let qPcPerson = ['', '', '', ''];

const qSynth = window.speechSynthesis;
let qVoices = [];
function qLoadVoices(){ qVoices = qSynth.getVoices(); }
qLoadVoices();
if(qSynth.onvoiceschanged !== undefined) qSynth.onvoiceschanged = qLoadVoices;

function qPickVoice(){
  return qVoices.find(v=>v.lang==='ms-MY')
      || qVoices.find(v=>v.lang.startsWith('ms'))
      || qVoices.find(v=>v.lang==='id-ID')
      || qVoices.find(v=>v.lang.startsWith('id'))
      || qVoices.find(v=>v.lang.startsWith('en'))
      || (qVoices.length ? qVoices[0] : null);
}
function qSpeak(text, cb){
  qSynth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = qPickVoice();
  if(v){ u.voice=v; u.lang=v.lang; } else { u.lang='ms-MY'; }
  u.rate=0.88; u.pitch=1.05;
  u.onstart = ()=>{ qSetLog(true,'🔊 ' + text); };
  u.onend   = ()=>{ qSetLog(false,'Selesai menyebut.'); if(cb) cb(); };
  u.onerror = ()=>{ qSetLog(false,'⚠️ Audio error.'); };
  qSynth.speak(u);
}
function qAddName(){
  const inp = document.getElementById('qUInput');
  const name = inp.value.trim();
  if(!name) return;
  qUrQueue.push({name, pc:null, pcAssigned:false});
  inp.value=''; inp.focus();
  qRenderUrusan(); qUpdateUBtn();
  qSetLog(false,'✅ Ditambah: '+name);
}
function qCallUrusan(){
  if(qUrIdx+1 >= qUrQueue.length) return;
  qUrIdx++;
  const p = qUrQueue[qUrIdx];
  p.pc = null; p.pcAssigned = false;
  qAnimateName('qUName', p.name);
  const rem = qUrQueue.length - qUrIdx - 1;
  document.getElementById('qUInfo').textContent =
    'Giliran ke-'+(qUrIdx+1)+' daripada '+qUrQueue.length+(rem>0?' · '+rem+' lagi':' · Terakhir!');
  document.getElementById('qUPcBadge').style.display='none';
  document.getElementById('qUDisplay').classList.add('q-speaking');
  const msg = 'Giliran '+p.name+'. '+p.name+', sila ke kaunter urusan.';
  qSpeak(msg, ()=>{ document.getElementById('qUDisplay').classList.remove('q-speaking'); });
  document.getElementById('qURepeat').disabled=false;
  qRenderUrusan(); qRenderPCAssignBtns(); qUpdateUBtn();
}
function qRepeatUrusan(){
  if(qUrIdx<0||qUrIdx>=qUrQueue.length) return;
  const p=qUrQueue[qUrIdx];
  document.getElementById('qUDisplay').classList.add('q-speaking');
  qSpeak('Giliran '+p.name+'. '+p.name+', sila ke kaunter urusan.',
    ()=>document.getElementById('qUDisplay').classList.remove('q-speaking'));
}
function qAssignPC(n){
  if(qUrIdx<0||qUrIdx>=qUrQueue.length){ qSetLog(false,'⚠️ Panggil orang dulu sebelum assign PC.'); return; }
  if(qPcState[n-1]===1){ qSetLog(false,'⚠️ PC '+n+' sedang sibuk.'); return; }
  const p=qUrQueue[qUrIdx];
  if(p.pcAssigned){
    const old=p.pc;
    if(old){ qPcState[old-1]=0; qPcPerson[old-1]=''; }
  }
  p.pc=n; p.pcAssigned=true;
  qPcState[n-1]=1; qPcPerson[n-1]=p.name;
  document.getElementById('qUPcBadge').textContent='PC '+n;
  document.getElementById('qUPcBadge').style.display='inline-block';
  document.getElementById('qUInfo').textContent='Diarahkan ke PC '+n;
  qSpeak(p.name+', sila ke PC '+n+'.');
  qRenderPCGrid(); qRenderPCAssignBtns(); qRenderUrusan();
  qSetLog(false,'✅ '+p.name+' ditetapkan ke PC '+n);
}
function qPcReady(n){
  const name=qPcPerson[n-1];
  if(!name) return;
  qPcState[n-1]=2;
  qPayQueue.push({name, pc:n});
  qRenderPCGrid(); qRenderPayment(); qUpdatePBtn();
  qSetLog(false,'💳 '+name+' (PC '+n+') sedia untuk bayar.');
  document.getElementById('qPayAlertName').textContent=name+' (PC '+n+') —, sila ke kaunter pembayaran';
  document.getElementById('qPayAlert').classList.add('q-show');
  setTimeout(()=>document.getElementById('qPayAlert').classList.remove('q-show'),5000);
}
function qCallPayment(){
  if(qPayIdx+1>=qPayQueue.length) return;
  qPayIdx++;
  const p=qPayQueue[qPayIdx];
  if(p.pc){ qPcState[p.pc-1]=0; qPcPerson[p.pc-1]=''; }
  qAnimateName('qPName', p.name);
  const rem=qPayQueue.length-qPayIdx-1;
  document.getElementById('qPInfo').textContent=
    'Giliran ke-'+(qPayIdx+1)+' daripada '+qPayQueue.length+(rem>0?' · '+rem+' lagi':' · Terakhir!');
  document.getElementById('qPDisplay').classList.add('q-speaking');
  qSpeak(p.name+',sila ke kaunter pembayaran.',
    ()=>document.getElementById('qPDisplay').classList.remove('q-speaking'));
  document.getElementById('qPRepeat').disabled=false;
  qRenderPCGrid(); qRenderPayment(); qUpdatePBtn();
}
function qRepeatPayment(){
  if(qPayIdx<0||qPayIdx>=qPayQueue.length) return;
  const p=qPayQueue[qPayIdx];
  document.getElementById('qPDisplay').classList.add('q-speaking');
  qSpeak(p.name+',panggilan terakhir, sila ke kaunter pembayaran.',
    ()=>document.getElementById('qPDisplay').classList.remove('q-speaking'));
}
function qRenderUrusan(){
  const list=document.getElementById('qUList');
  if(!qUrQueue.length){ list.innerHTML='<div class="q-empty-state">Tambah nama untuk mula.</div>'; qUpdateUProg(); return; }
  list.innerHTML=qUrQueue.map((p,i)=>{
    let rowCls='q-item', numCls='q-num', badge='';
    if(i<qUrIdx){ rowCls+=' q-done'; badge='<span class="q-badge q-b-done">Selesai</span>'; }
    else if(i===qUrIdx){
      rowCls+=' q-active-row'; numCls+=' q-cur';
      badge=p.pcAssigned
        ? '<span class="q-badge q-b-ready">PC '+p.pc+'</span>'
        : '<span class="q-badge q-b-cur">Sekarang</span>';
    } else {
      badge='<span class="q-badge q-b-wait">Menunggu</span>';
    }
    const canDel=i>qUrIdx;
    return `<div class="${rowCls}">
      <div class="${numCls}">${i+1}</div>
      <div class="q-name-wrap"><div class="q-name">${qEsc(p.name)}</div>${p.pcAssigned&&i===qUrIdx?'<div class="q-meta">PC '+p.pc+'</div>':''}</div>
      ${badge}
      ${canDel?`<button class="q-del-btn" onclick="qDelUr(${i})">×</button>`:''}
    </div>`;
  }).join('');
  document.getElementById('qUBadge').textContent=(qUrQueue.length-Math.max(0,qUrIdx+1))+' menunggu';
  qUpdateUProg();
}
function qRenderPayment(){
  const list=document.getElementById('qPList');
  if(!qPayQueue.length){ list.innerHTML='<div class="q-empty-state">Tiada dalam giliran bayar lagi.</div>'; qUpdatePProg(); return; }
  list.innerHTML=qPayQueue.map((p,i)=>{
    let rowCls='q-item', numCls='q-num', badge='';
    if(i<qPayIdx){ rowCls+=' q-done'; badge='<span class="q-badge q-b-done">Selesai</span>'; }
    else if(i===qPayIdx){ rowCls+=' q-active-row q-g'; numCls+=' q-gcur'; badge='<span class="q-badge q-b-gcur">Sekarang</span>'; }
    else { badge='<span class="q-badge q-b-ready">Sedia Bayar</span>'; }
    return `<div class="${rowCls}">
      <div class="${numCls}">${i+1}</div>
      <div class="q-name-wrap"><div class="q-name">${qEsc(p.name)}</div><div class="q-meta">PC ${p.pc}</div></div>
      ${badge}
    </div>`;
  }).join('');
  document.getElementById('qPBadge').textContent=(qPayQueue.length-Math.max(0,qPayIdx+1))+' menunggu';
  qUpdatePProg();
}
function qRenderPCGrid(){
  const grid=document.getElementById('qPcGrid');
  grid.innerHTML=[1,2,3,4].map(n=>{
    const s=qPcState[n-1], nm=qPcPerson[n-1];
    let cls='q-pc-card', statusTxt='', nameTxt='', btn='';
    if(s===0){ statusTxt='<div class="q-pc-status">Kosong</div>'; nameTxt='<div class="q-pc-empty">—</div>'; }
    else if(s===1){ cls+=' q-busy'; nameTxt='<div class="q-pc-name">'+qEsc(nm)+'</div>'; statusTxt='<div class="q-pc-status q-s-busy">Sedang Berurusan</div>'; btn='<button class="q-pc-btn-ready" onclick="qPcReady('+n+')">✔ Siap</button>'; }
    else if(s===2){ cls+=' q-ready-pay'; nameTxt='<div class="q-pc-name">'+qEsc(nm)+'</div>'; statusTxt='<div class="q-pc-status q-s-ready">Sedia Bayar</div>'; }
    return `<div class="${cls}"><div class="q-pc-label">PC ${n}</div>${nameTxt}${statusTxt}${btn}</div>`;
  }).join('');
}
function qRenderPCAssignBtns(){
  [1,2,3,4].forEach(n=>{
    const btn=document.getElementById('qPcBtn'+n);
    btn.disabled = qPcState[n-1]===1;
    btn.style.borderColor = qPcState[n-1]===1?'#378ADD':'';
    btn.style.color = qPcState[n-1]===1?'#185FA5':'';
  });
}
function qUpdateUBtn(){
  const btn=document.getElementById('qUNext');
  const done=qUrIdx+1>=qUrQueue.length&&qUrQueue.length>0;
  btn.disabled=done||!qUrQueue.length;
  btn.textContent=done?'✔ Semua Dipanggil':'▶ Panggil Seterusnya';
}
function qUpdatePBtn(){
  const btn=document.getElementById('qPNext');
  const done=qPayIdx+1>=qPayQueue.length&&qPayQueue.length>0;
  btn.disabled=done||!qPayQueue.length;
  btn.textContent=done?'✔ Semua Selesai':'▶ Panggil Untuk Bayar';
}
function qUpdateUProg(){
  const done=Math.max(0,qUrIdx+1), total=qUrQueue.length;
  document.getElementById('qUProg').textContent=done+' / '+total;
  document.getElementById('qUFill').style.width=(total>0?done/total*100:0)+'%';
}
function qUpdatePProg(){
  const done=Math.max(0,qPayIdx+1), total=qPayQueue.length;
  document.getElementById('qPProg').textContent=done+' / '+total;
  document.getElementById('qPFill').style.width=(total>0?done/total*100:0)+'%';
}
function qAnimateName(id, name){
  const el=document.getElementById(id);
  el.classList.remove('q-pop'); void el.offsetWidth; el.classList.add('q-pop');
  el.textContent=name;
}
function qSetLog(active, msg){
  const dot=document.getElementById('qLogDot');
  if(dot) dot.className='q-log-dot'+(active?' q-active':'');
  const txt=document.getElementById('qLogText');
  if(txt) txt.textContent=msg;
}
function qResetAll(){
  qSynth.cancel();
  qUrQueue=[]; qUrIdx=-1; qPayQueue=[]; qPayIdx=-1;
  qPcState=[0,0,0,0]; qPcPerson=['','','',''];
  document.getElementById('qUName').textContent='—';
  document.getElementById('qUInfo').textContent='Tekan Panggil untuk mula';
  document.getElementById('qUPcBadge').style.display='none';
  document.getElementById('qUDisplay').classList.remove('q-speaking');
  document.getElementById('qPName').textContent='—';
  document.getElementById('qPInfo').textContent='Tiada panggilan lagi';
  document.getElementById('qPDisplay').classList.remove('q-speaking');
  document.getElementById('qURepeat').disabled=true;
  document.getElementById('qPRepeat').disabled=true;
  document.getElementById('qPayAlert').classList.remove('q-show');
  qRenderUrusan(); qRenderPayment(); qRenderPCGrid(); qRenderPCAssignBtns();
  qUpdateUBtn(); qUpdatePBtn();
  qSetLog(false,'Sistem di-reset. Sedia untuk mula semula.');
}
function qDelUr(i){ qUrQueue.splice(i,1); qRenderUrusan(); qUpdateUBtn(); }
function qEsc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// Queue init
qRenderUrusan(); qRenderPayment(); qRenderPCGrid(); qRenderPCAssignBtns();
qUpdateUBtn(); qUpdatePBtn();

// ===================== BOOK LOAN =====================
let loanNfcId = null;
let loanStep = 1;
let loanNfcScanTimer = null;
let loanMemberInfo = null; // {name, ic_number, kelas, category}

function openLoanModal() {
    loanNfcId = null; loanStep = 1; loanMemberInfo = null;
    document.getElementById('loanStep1').style.display = '';
    document.getElementById('loanStep2').style.display = 'none';
    document.getElementById('loanNfc').value = '';
    document.getElementById('loanNfcInfo').innerHTML = '';
    document.getElementById('loanActionBtn').innerHTML = '<i class="fas fa-arrow-right"></i> Seterusnya';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('loanDate').value = today;
    document.getElementById('loanDue').value = '';
    ['loanIc','loanKelas','loanBookNum','loanBookTitle'].forEach(id => document.getElementById(id).value = '');
    openModal('loanModal');
    setTimeout(() => document.getElementById('loanNfc').focus(), 200);
}

function _addOneMonth(yyyymmdd) {
    if (!yyyymmdd) return '';
    const d = new Date(yyyymmdd + 'T00:00:00');
    const day = d.getDate();
    d.setMonth(d.getMonth() + 1);
    if (d.getDate() < day) d.setDate(0); // handle short month
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

async function loanCheckNfc() {
    const nfc = document.getElementById('loanNfc').value.trim();
    if (!nfc) { showToast('Sila tap atau taip UID kad', 'warning'); return; }
    document.getElementById('loanNfcInfo').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyemak...';
    try {
        const res = await fetch('/api/book_loan/check_nfc', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nfc_id:nfc}) });
        const data = await res.json();
        if (data.success) {
            loanNfcId = nfc;
            loanMemberInfo = { name: data.member.name, ic_number: data.member.ic_number || '', kelas: data.member.kelas || '', category: data.member.category };
            document.getElementById('loanNfcInfo').innerHTML = `<span style="color:#059669"><strong><i class="fas fa-id-card"></i> ${data.member.name}</strong> (${data.member.category}) — Kad dikenali ✔</span>`;
        } else {
            loanNfcId = null; loanMemberInfo = null;
            document.getElementById('loanNfcInfo').innerHTML = `<span style="color:red"><i class="fas fa-circle-xmark"></i> ${data.message}</span>`;
        }
    } catch(e) {
        document.getElementById('loanNfcInfo').innerHTML = '<span style="color:red">Ralat sambungan</span>';
    }
}

// Auto-scan for loan NFC: trigger after short pause (NFC reader sends Enter)
document.getElementById('loanNfc').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); loanCheckNfc(); }
});
document.getElementById('loanNfc').addEventListener('input', function() {
    clearTimeout(loanNfcScanTimer);
    loanNfcScanTimer = setTimeout(() => {
        if (document.getElementById('loanNfc').value.trim().length > 2) loanCheckNfc();
    }, 350);
});

async function handleLoanAction() {
    if (loanStep === 1) {
        if (!loanNfcId) {
            // Try to check NFC once more if there's a value
            const nfcVal = document.getElementById('loanNfc').value.trim();
            if (nfcVal) {
                await loanCheckNfc();
                if (!loanNfcId) { showToast('Kad tidak dikenali. Sila tap semula.', 'error'); return; }
            } else {
                showToast('Sila tap kad dahulu', 'warning'); return;
            }
        }
        // Auto-fill maklumat ahli & due date (+1 bulan)
        if (loanMemberInfo) {
            if (loanMemberInfo.ic_number && !document.getElementById('loanIc').value.trim()) {
                document.getElementById('loanIc').value = loanMemberInfo.ic_number;
            }
            if (loanMemberInfo.kelas && !document.getElementById('loanKelas').value.trim()) {
                document.getElementById('loanKelas').value = loanMemberInfo.kelas;
            }
        }
        const loanDateEl = document.getElementById('loanDate');
        if (!loanDateEl.value) loanDateEl.value = new Date().toISOString().split('T')[0];
        const dueEl = document.getElementById('loanDue');
        if (!dueEl.value) dueEl.value = _addOneMonth(loanDateEl.value);
        document.getElementById('loanStep1').style.display = 'none';
        document.getElementById('loanStep2').style.display = '';
        document.getElementById('loanActionBtn').innerHTML = '<i class="fas fa-save"></i> Simpan Pinjaman';
        loanStep = 2;
    } else {
        const ic = document.getElementById('loanIc').value.trim();
        const kelas = document.getElementById('loanKelas').value.trim();
        const bookNum = document.getElementById('loanBookNum').value.trim();
        const bookTitle = document.getElementById('loanBookTitle').value.trim();
        const loanDate = document.getElementById('loanDate').value;
        const dueDate = document.getElementById('loanDue').value;
        if (!bookNum || !bookTitle || !loanDate || !dueDate) {
            showToast('Sila isi nombor buku, tajuk, tarikh pinjam dan tarikh limit', 'error'); return;
        }
        try {
            const res = await fetch('/api/book_loan/borrow', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({ nfc_id:loanNfcId, ic_number:ic, kelas, book_number:bookNum, book_title:bookTitle, loan_date:loanDate, due_date:dueDate })
            });
            const data = await res.json();
            showToast(data.message, data.success ? 'success' : 'error');
            if (data.success) closeModal('loanModal');
        } catch(e) { showToast('Ralat sambungan server', 'error'); }
    }
}

// ===================== BOOK RETURN =====================
let returnLoans = [];
let selectedLoanId = null;
let returnNfcScanTimer = null;

function openReturnModal() {
    returnLoans = []; selectedLoanId = null;
    document.getElementById('returnStep1').style.display = '';
    document.getElementById('returnStep2').style.display = 'none';
    document.getElementById('returnNfc').value = '';
    document.getElementById('returnIcInput').value = '';
    document.getElementById('returnNfcInfo').innerHTML = '';
    document.getElementById('returnLoanList').innerHTML = '';
    document.getElementById('returnActionArea').innerHTML = '';
    document.getElementById('returnScanBtn').style.display = '';
    // Reset to NFC tab
    switchReturnTab('nfc');
    openModal('returnModal');
    setTimeout(() => document.getElementById('returnNfc').focus(), 200);
}

document.getElementById('returnNfc').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); doReturnScan(); }
});
document.getElementById('returnNfc').addEventListener('input', function() {
    clearTimeout(returnNfcScanTimer);
    returnNfcScanTimer = setTimeout(() => {
        if (document.getElementById('returnNfc').value.trim().length > 2) doReturnScan();
    }, 350);
});
document.addEventListener('DOMContentLoaded', function() {
    const retIcEl = document.getElementById('returnIcInput');
    if (retIcEl) {
        retIcEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doReturnScanIc(); }
        });
    }
});

function switchReturnTab(mode) {
    document.getElementById('returnTabNfc').className = 'tab-btn' + (mode==='nfc' ? ' active' : '');
    document.getElementById('returnTabIc').className = 'tab-btn' + (mode==='ic' ? ' active' : '');
    document.getElementById('returnNfcTab').style.display = mode==='nfc' ? '' : 'none';
    document.getElementById('returnIcTab').style.display = mode==='ic' ? '' : 'none';
    document.getElementById('returnNfcInfo').innerHTML = '';
    if (mode==='ic') setTimeout(() => document.getElementById('returnIcInput').focus(), 100);
    else setTimeout(() => document.getElementById('returnNfc').focus(), 100);
}

async function doReturnScanIc() {
    const ic = document.getElementById('returnIcInput').value.trim();
    if (!ic) { showToast('Sila masukkan No. IC', 'warning'); return; }
    document.getElementById('returnNfcInfo').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyemak pinjaman...';
    try {
        const res = await fetch('/api/book_loan/check_return', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ic_number: ic}) });
        const data = await res.json();
        if (!data.success) {
            document.getElementById('returnNfcInfo').innerHTML = `<span style="color:red"><i class="fas fa-circle-xmark"></i> ${data.message}</span>`;
            return;
        }
        returnLoans = data.loans;
        document.getElementById('returnNfcInfo').innerHTML = `<span style="color:#059669"><strong><i class="fas fa-id-card"></i> ${data.member_name}</strong> — ${returnLoans.length} pinjaman aktif ditemui ✔</span>`;
        document.getElementById('returnStep1').style.display = 'none';
        document.getElementById('returnStep2').style.display = '';
        document.getElementById('returnScanBtn').style.display = 'none';
        selectedLoanId = returnLoans[0].id;
        renderReturnLoans();
    } catch(e) {
        document.getElementById('returnNfcInfo').innerHTML = '<span style="color:red">Ralat sambungan server</span>';
    }
}

async function doReturnScan() {
    const nfc = document.getElementById('returnNfc').value.trim();
    if (!nfc) { showToast('Sila tap atau taip UID kad', 'warning'); return; }
    document.getElementById('returnNfcInfo').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyemak pinjaman...';
    try {
        const res = await fetch('/api/book_loan/check_return', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nfc_id:nfc}) });
        const data = await res.json();
        if (!data.success) {
            document.getElementById('returnNfcInfo').innerHTML = `<span style="color:red"><i class="fas fa-circle-xmark"></i> ${data.message}</span>`;
            return;
        }
        returnLoans = data.loans;
        document.getElementById('returnNfcInfo').innerHTML = `<span style="color:#059669"><strong><i class="fas fa-id-card"></i> ${data.member_name}</strong> — ${returnLoans.length} pinjaman aktif ditemui ✔</span>`;
        document.getElementById('returnStep1').style.display = 'none';
        document.getElementById('returnStep2').style.display = '';
        document.getElementById('returnScanBtn').style.display = 'none';
        selectedLoanId = returnLoans[0].id;
        renderReturnLoans();
    } catch(e) {
        document.getElementById('returnNfcInfo').innerHTML = '<span style="color:red">Ralat sambungan server</span>';
    }
}
function renderReturnLoans() {
    const container = document.getElementById('returnLoanList');
    container.innerHTML = returnLoans.map(l => {
        const lateLabel = l.days_late > 0 ? `<span style="color:#dc2626;font-weight:600"> ⚠ Lewat ${l.days_late} hari (RM ${l.auto_fine.toFixed(2)})</span>` : '<span style="color:#059669"> ✔ Dalam Tempoh</span>';
        const sel = selectedLoanId === l.id ? 'border:2px solid var(--accent);background:#e0f7ff;' : '';
        return `<div onclick="selectLoan(${l.id})" style="cursor:pointer;padding:12px 16px;border-radius:10px;border:1.5px solid var(--border);margin-bottom:8px;${sel}">
            <div style="font-weight:700">${l.book_title} <span style="font-size:0.8rem;color:var(--text-muted)">[${l.book_number}]</span></div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Pinjam: ${l.loan_date} | Due: ${l.due_date} ${lateLabel}</div>
        </div>`;
    }).join('');
    if (!selectedLoanId && returnLoans.length > 0) { selectedLoanId = returnLoans[0].id; renderReturnLoans(); return; }
    renderReturnActions();
}
function selectLoan(id) { selectedLoanId = id; renderReturnLoans(); }
function renderReturnActions() {
    const loan = returnLoans.find(l => l.id === selectedLoanId);
    if (!loan) return;
    const lateSection = loan.days_late > 0 ? `
        <div style="background:#fff5f5;border-radius:8px;padding:10px 14px;margin-bottom:10px;border:1px solid #fecaca">
            <div style="font-weight:700;color:#dc2626;font-size:0.9rem"><i class="fas fa-exclamation-triangle"></i> Buku Lewat ${loan.days_late} hari — Denda RM ${loan.auto_fine.toFixed(2)}</div>
            <div style="font-size:0.8rem;color:#64748b;margin-top:4px">Tekan <b>"Buku Ada (Lewat)"</b> untuk proses bayaran denda dengan kad atau tunai</div>
        </div>` : '';
    const adaLabel = loan.days_late > 0 ? 'Buku Ada — Bayar Denda' : 'Buku Ada (Pulang Buku)';
    const adaOnclick = loan.days_late > 0
        ? `openFinePayModal({id:${loan.id},book_title:'${loan.book_title.replace(/'/g,"\\'")}',days_left:${-loan.days_late},fine:${loan.auto_fine}})`
        : `processReturn(${loan.id},'ada')`;
    document.getElementById('returnActionArea').innerHTML = `
        <div style="background:#f8fafc;border-radius:10px;padding:14px 16px;margin-bottom:10px">
            <div style="font-weight:700;margin-bottom:8px;color:var(--primary)"><i class="fas fa-book"></i> Tindakan untuk: ${loan.book_title}</div>
            ${lateSection}
            <div style="display:flex;gap:10px;flex-wrap:wrap">
                <button class="btn btn-success btn-sm" onclick="${adaOnclick}"><i class="fas fa-check"></i> ${adaLabel}</button>
                <button class="btn btn-danger btn-sm" onclick="showFineInput(${loan.id},'tiada')"><i class="fas fa-times"></i> Buku Hilang/Rosak (Bayar Denda)</button>
                <button class="btn btn-warning btn-sm" onclick="showExtendInput(${loan.id})"><i class="fas fa-calendar-plus"></i> Lanjut Tempoh</button>
            </div>
        </div>
        <div id="returnExtraInput"></div>`;
}
async function processReturn(loanId, action, extraData = {}) {
    const payload = { loan_id: loanId, action, ...extraData };
    const res = await fetch('/api/book_loan/return', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) { closeModal('returnModal'); loadActiveLoans(); }
}
function showFineInput(loanId, action) {
    document.getElementById('returnExtraInput').innerHTML = `
        <div style="background:#fff5f5;border-radius:10px;padding:12px 16px;border:1px solid #fecaca">
            <label style="font-size:0.82rem;font-weight:600;color:var(--danger)">Tetapkan Harga Ganti Rugi (RM)</label>
            <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
                <input type="number" id="returnFineAmount" step="0.01" min="0" placeholder="0.00" style="flex:1;min-width:120px;padding:10px 14px;border-radius:8px;border:1.5px solid var(--border)">
                <select id="returnFineMethod" onchange="toggleReturnFineKad()" style="padding:10px 14px;border-radius:8px;border:1.5px solid var(--border);font-family:inherit">
                    <option value="tunai">Tunai</option>
                    <option value="kad">Kad (Tolak Point)</option>
                </select>
            </div>
            <div id="returnFineKadRow" style="display:none;margin-top:8px">
                <input type="text" id="returnFineNfc" placeholder="Tap kad NFC untuk bayar..." style="width:100%;padding:10px 14px;border-radius:8px;border:1.5px solid var(--border)">
                <div id="returnFineNfcInfo" style="font-size:0.8rem;margin-top:4px;color:#64748b"></div>
            </div>
            <div style="margin-top:10px">
                <button class="btn btn-danger btn-sm" onclick="submitFineWithMethod(${loanId},'${action}')"><i class="fas fa-check"></i> Sahkan Ganti Rugi</button>
            </div>
        </div>`;
    // Setup NFC listener for fine kad
    setTimeout(() => {
        const nfcEl = document.getElementById('returnFineNfc');
        if (!nfcEl) return;
        let t = null;
        nfcEl.addEventListener('input', function() {
            clearTimeout(t);
            if (this.value.trim().length > 2) t = setTimeout(() => fetchReturnFineNfc(this.value.trim()), 350);
        });
        nfcEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); fetchReturnFineNfc(this.value.trim()); }
        });
    }, 100);
}
function toggleReturnFineKad() {
    const method = document.getElementById('returnFineMethod').value;
    const row = document.getElementById('returnFineKadRow');
    if (row) row.style.display = method === 'kad' ? '' : 'none';
}
let returnFineMember = null;
async function fetchReturnFineNfc(nfcId) {
    const res = await fetch('/api/get_member_by_nfc', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nfc_id:nfcId}) });
    const data = await res.json();
    const infoEl = document.getElementById('returnFineNfcInfo');
    if (!infoEl) return;
    if (data.success && data.member) {
        returnFineMember = data.member;
        infoEl.innerHTML = `<span style="color:#059669"><strong>${data.member.name}</strong> — ${data.member.points} pt (RM ${(data.member.points/100).toFixed(2)})</span>`;
    } else {
        returnFineMember = null;
        infoEl.innerHTML = '<span style="color:red">Kad tidak dikenali</span>';
    }
}
async function submitFineWithMethod(loanId, action) {
    const fine = parseFloat(document.getElementById('returnFineAmount').value) || 0;
    const method = document.getElementById('returnFineMethod') ? document.getElementById('returnFineMethod').value : 'tunai';
    if (method === 'kad') {
        const nfcId = document.getElementById('returnFineNfc') ? document.getElementById('returnFineNfc').value.trim() : '';
        if (!nfcId) { showToast('Sila tap kad untuk bayar dengan kad', 'warning'); return; }
        const payload = { loan_id: loanId, method: 'kad', fine_amount: fine, nfc_id: nfcId };
        const res = await fetch('/api/book_loan/pay_fine', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const data = await res.json();
        if (data.success && action === 'tiada') {
            await fetch('/api/book_loan/return', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({loan_id:loanId, action:'tiada', fine_amount:fine}) });
        }
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) { closeModal('returnModal'); loadActiveLoans(); loadMembers(); loadLeaderboard(); }
    } else {
        await processReturn(loanId, action, { fine_amount: fine });
        loadActiveLoans();
    }
}
async function submitFine(loanId, action) {
    const fine = parseFloat(document.getElementById('returnFineAmount').value) || 0;
    await processReturn(loanId, action, { fine_amount: fine });
    loadActiveLoans();
}
function showExtendInput(loanId) {
    document.getElementById('returnExtraInput').innerHTML = `
        <div style="background:#f0fdf4;border-radius:10px;padding:12px 16px;border:1px solid #bbf7d0">
            <label style="font-size:0.82rem;font-weight:600;color:#059669">Tarikh Lanjutan Baru</label>
            <div style="display:flex;gap:10px;margin-top:8px">
                <input type="date" id="returnExtendDate" style="flex:1;padding:10px 14px;border-radius:8px;border:1.5px solid var(--border)">
                <button class="btn btn-success btn-sm" onclick="submitExtend(${loanId})"><i class="fas fa-check"></i> Lanjutkan</button>
            </div>
        </div>`;
}
async function submitExtend(loanId) {
    const extDate = document.getElementById('returnExtendDate').value;
    if (!extDate) { showToast('Sila pilih tarikh lanjutan', 'error'); return; }
    await processReturn(loanId, 'lanjut', { extend_date: extDate });
}

// ===================== ACTIVE LOANS (DASHBOARD) =====================
async function loadActiveLoans() {
    try {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const monthDisplay = now.toLocaleString('ms-MY', {month:'long', year:'numeric'});
        const labelEl = document.getElementById('activeLoanMonthLabel');
        if (labelEl) labelEl.textContent = `— ${monthDisplay}`;
        const res = await fetch('/api/book_loan/active_loans');
        const allLoans = await res.json();
        // Filter hanya buku yang dipinjam bulan ini
        const loans = allLoans.filter(l => l.loan_date && l.loan_date.startsWith(currentMonth));
        const container = document.getElementById('activeLoansList');
        if (!loans.length) { container.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:8px">Tiada buku dipinjam bulan ini</div>'; return; }
        container.innerHTML = loans.map(l => {
            const isLate = l.is_late;
            const borderColor = isLate ? '#dc2626' : '#10b981';
            const statusText = isLate
                ? `<span style="color:#dc2626;font-weight:700;font-size:0.75rem">⚠ Lewat ${Math.abs(l.days_left)} hari | Denda RM${l.fine.toFixed(2)}</span>`
                : `<span style="color:#059669;font-size:0.75rem">Tamat: ${l.due_date} (${l.days_left} hari lagi)</span>`;
            return `<div style="padding:8px 10px;border-radius:8px;border-left:3px solid ${borderColor};background:${isLate?'#fff5f5':'#f0fdf4'};margin-bottom:7px">
                <div style="font-weight:700;font-size:0.85rem">${l.borrower_name}${l.kelas ? ' <span style="font-weight:400;font-size:0.75rem;color:#64748b">('+l.kelas+')</span>' : ''}</div>
                <div style="font-size:0.78rem;color:#64748b;margin-top:1px">${l.book_title}</div>
                ${statusText}
            </div>`;
        }).join('');
    } catch(e) { console.error(e); }
}

// ===================== TOP BORROWERS (DASHBOARD) =====================
async function loadTopBorrowers() {
    try {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const monthDisplay = now.toLocaleString('ms-MY', {month:'long', year:'numeric'});
        const labelEl = document.getElementById('topBorrowerMonthLabel');
        if (labelEl) labelEl.textContent = `— ${monthDisplay}`;
        const res = await fetch(`/api/book_loan/top_borrowers?month=${currentMonth}`);
        const data = await res.json();
        const container = document.getElementById('topBorrowersList');
        if (!data.length) { container.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:8px">Tiada data pinjaman bulan ini</div>'; return; }
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
        container.innerHTML = data.map((item, idx) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:1rem;width:28px">${medals[idx]||''}</span>
                <span style="flex:1;font-weight:600;font-size:0.87rem">${item.name}<br><span style="font-weight:400;font-size:0.75rem;color:#64748b">${item.kelas}</span></span>
                <span style="font-weight:700;color:var(--primary);font-size:0.88rem">${item.total} buku</span>
            </div>`).join('');
    } catch(e) { console.error(e); }
}

// ===================== FINE PAYMENT =====================
let fineLoanData = null;
let finePayMember = null;

function openFinePayModal(loan) {
    fineLoanData = loan;
    finePayMember = null;
    document.getElementById('fineLoanId').value = loan.id;
    document.getElementById('fineLoanInfo').textContent = `"${loan.book_title}" — Lewat ${Math.abs(loan.days_left)} hari`;
    document.getElementById('fineDendaAmt').textContent = `Denda: RM ${loan.fine.toFixed(2)}`;
    document.getElementById('finePayNfc').value = '';
    document.getElementById('finePayMemberInfo').innerHTML = '';
    document.getElementById('finePayMethod').value = 'kad';
    document.getElementById('fineKadSection').style.display = '';
    document.getElementById('fineTunaiSection').style.display = 'none';
    openModal('finePayModal');
    setTimeout(() => document.getElementById('finePayNfc').focus(), 200);
}

function toggleFinePayMethod() {
    const method = document.getElementById('finePayMethod').value;
    document.getElementById('fineKadSection').style.display = method === 'kad' ? '' : 'none';
    document.getElementById('fineTunaiSection').style.display = method === 'tunai' ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', function() {
    const fineNfcInput = document.getElementById('finePayNfc');
    if (fineNfcInput) {
        let fineNfcTimer = null;
        fineNfcInput.addEventListener('keydown', async function(e) {
            if (e.key === 'Enter') { e.preventDefault(); await fetchFinePayMember(this.value.trim()); }
        });
        fineNfcInput.addEventListener('input', function() {
            clearTimeout(fineNfcTimer);
            fineNfcTimer = setTimeout(() => { if (this.value.trim().length > 2) fetchFinePayMember(this.value.trim()); }, 350);
        });
    }
});

async function fetchFinePayMember(nfcId) {
    if (!nfcId) return;
    const res = await fetch('/api/get_member_by_nfc', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nfc_id:nfcId}) });
    const data = await res.json();
    if (data.success && data.member) {
        finePayMember = data.member;
        const fine = fineLoanData ? fineLoanData.fine : 0;
        const ptNeeded = Math.round(fine * 100);
        const enough = data.member.points >= ptNeeded;
        document.getElementById('finePayMemberInfo').innerHTML = `<strong><i class="fas fa-id-card"></i> ${data.member.name}</strong><br>
            Point: ${data.member.points} pt (RM ${(data.member.points/100).toFixed(2)}) — 
            ${enough ? '<span style="color:#059669">✔ Mencukupi</span>' : '<span style="color:#dc2626">✘ Tidak mencukupi, guna tunai</span>'}`;
    } else {
        finePayMember = null;
        document.getElementById('finePayMemberInfo').innerHTML = '<span style="color:red">Kad tidak dikenali</span>';
    }
}

async function submitFinePay() {
    const loanId = document.getElementById('fineLoanId').value;
    const method = document.getElementById('finePayMethod').value;
    const fine = fineLoanData ? fineLoanData.fine : 0;
    if (!loanId || fine <= 0) { showToast('Data tidak lengkap', 'error'); return; }
    if (method === 'kad' && !finePayMember) { showToast('Sila tap kad ahli dahulu', 'warning'); return; }
    const payload = {
        loan_id: parseInt(loanId),
        method,
        fine_amount: fine,
        nfc_id: method === 'kad' && finePayMember ? finePayMember.nfc_id || document.getElementById('finePayNfc').value.trim() : ''
    };
    // need nfc_id for kad, get it from input
    if (method === 'kad') payload.nfc_id = document.getElementById('finePayNfc').value.trim();
    const res = await fetch('/api/book_loan/pay_fine', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
        closeModal('finePayModal');
        closeModal('returnModal');
        loadActiveLoans();
        if (method === 'kad') { loadMembers(); loadLeaderboard(); }
    }
}


// ===================== SENARAI AHLI - add ic_number to renderMembers =====================
// (Patched in renderMembers below)

// ===================== BULK REGISTER =====================
let bulkRows = [];

function openBulkRegisterModal() {
    bulkRows = [];
    document.getElementById('bulkExcelFile').value = '';
    document.getElementById('bulkBatch').value = '';
    document.getElementById('bulkExpiry').value = '';
    document.getElementById('bulkPreview').style.display = 'none';
    document.getElementById('bulkPreviewCount').textContent = '';
    document.getElementById('bulkPreviewBody').innerHTML = '';
    openModal('bulkRegisterModal');
}

async function previewBulkExcel() {
    const file = document.getElementById('bulkExcelFile').files[0];
    if (!file) return;
    try {
        const data = await file.arrayBuffer();
        // Parse Excel using SheetJS via CDN — load dynamically if needed
        let XLSX;
        if (window.XLSX) {
            XLSX = window.XLSX;
        } else {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
            XLSX = window.XLSX;
        }
        const wb = XLSX.read(data, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        // Skip first row (header), read kelas|nama|no ic
        bulkRows = [];
        for (let i = 1; i < raw.length; i++) {
            const row = raw[i];
            const kelas = (row[0] || '').toString().trim();
            const name = (row[1] || '').toString().trim();
            const ic = (row[2] || '').toString().trim();
            if (name) bulkRows.push({kelas, name, ic_number: ic});
        }
        const tbody = document.getElementById('bulkPreviewBody');
        tbody.innerHTML = bulkRows.slice(0, 20).map(r =>
            `<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${r.kelas}</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${r.name}</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${r.ic_number}</td></tr>`
        ).join('');
        document.getElementById('bulkPreview').style.display = '';
        document.getElementById('bulkPreviewCount').textContent = `Dijumpai: ${bulkRows.length} rekod${bulkRows.length > 20 ? ' (menunjukkan 20 pertama)' : ''}`;
    } catch(e) {
        showToast('Gagal baca Excel: ' + e.message, 'error');
    }
}

async function submitBulkRegister() {
    if (!bulkRows.length) { showToast('Sila upload fail Excel dahulu', 'warning'); return; }
    const batch = document.getElementById('bulkBatch').value.trim();
    const category = document.getElementById('bulkCategory').value;
    const expiry_date = document.getElementById('bulkExpiry').value || null;
    try {
        const res = await fetch('/api/bulk_register', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({rows: bulkRows, batch, category, expiry_date})
        });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) { closeModal('bulkRegisterModal'); loadMembers(); }
    } catch(e) { showToast('Ralat sambungan', 'error'); }
}

// ===================== ASSIGN NFC (SETKAN SEBAGAI AHLI) — ENHANCED =====================
let _assignFoundMember = null; // cache data ahli yang telah dikenali

function openAssignNfcModal() {
    _assignFoundMember = null;
    document.getElementById('assignIc').value = '';
    document.getElementById('assignNfcLookup').value = '';
    document.getElementById('assignNfcInput').value = '';
    document.getElementById('assignNfcScanStatus').textContent = '';
    document.getElementById('assignBatch').value = '';
    document.getElementById('assignBatchB').value = '';
    document.getElementById('assignKelas').value = '';
    document.getElementById('assignKelasB').value = '';
    document.getElementById('assignExpiry').value = '';
    document.getElementById('assignMemberInfo').innerHTML = '';
    document.getElementById('assignCategory').value = 'ahli';
    document.getElementById('assignKategoriPerananGroup').style.display = 'none';
    document.getElementById('assignAhliKelasGroup').style.display = '';
    document.getElementById('assignBertugasKelasGroup').style.display = 'none';
    document.getElementById('assignKategoriPeranan') && (document.getElementById('assignKategoriPeranan').value = 'pelajar');
    switchAssignTab('ic');
    openModal('assignNfcModal');
    setTimeout(() => document.getElementById('assignIc').focus(), 200);
}

function switchAssignTab(mode) {
    document.getElementById('assignTabIcBtn').className = 'tab-btn' + (mode==='ic'?' active':'');
    document.getElementById('assignTabNfcBtn').className = 'tab-btn' + (mode==='nfc'?' active':'');
    document.getElementById('assignTabIc').style.display = mode==='ic' ? '' : 'none';
    document.getElementById('assignTabNfc').style.display = mode==='nfc' ? '' : 'none';
    if (mode === 'nfc') setTimeout(() => document.getElementById('assignNfcLookup').focus(), 100);
    else setTimeout(() => document.getElementById('assignIc').focus(), 100);
}

// Populate form with recognised member data
function _populateAssignForm(m) {
    _assignFoundMember = m;
    const hasNfc = m.nfc_id && !m.nfc_id.startsWith('BULK_');
    const el = document.getElementById('assignMemberInfo');

    // Determine label
    const rl = (m.kategori_peranan || m.category || '').toLowerCase();
    let katLabel = 'Pelajar';
    if (rl === 'guru') katLabel = 'Guru';
    else if (rl === 'akp') katLabel = 'AKP';

    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px">
        <span style="color:#059669;font-weight:700"><i class="fas fa-user-check"></i> ${m.name}</span>
        <span style="font-size:0.82rem;color:#334155">
            IC: <b>${m.ic_number||'—'}</b> &nbsp;|&nbsp;
            Batch: <b>${m.batch||'—'}</b> &nbsp;|&nbsp;
            Kelas: <b>${m.kelas||'—'}</b> &nbsp;|&nbsp;
            Peranan: <b>${katLabel}</b>
        </span>
        ${hasNfc ? '<span style="color:#d97706;font-size:0.8rem">⚠ Sudah ada NFC, akan digantikan</span>' : '<span style="color:#10b981;font-size:0.8rem">✔ Belum ada NFC</span>'}
    </div>`;

    // Auto-fill IC
    if (m.ic_number) document.getElementById('assignIc').value = m.ic_number;

    // Auto-fill batch
    if (m.batch) {
        document.getElementById('assignBatch').value = m.batch;
        document.getElementById('assignBatchB').value = m.batch;
    }

    // Auto-fill kelas
    const kelasFill = (m.kelas || '').trim();
    const katPeranan = (m.kategori_peranan || '').toLowerCase();

    if (katPeranan === 'guru' || katPeranan === 'akp') {
        // Guru/AKP — auto set kategori bertugas dan peranan
        document.getElementById('assignCategory').value = 'bertugas';
        onAssignCategoryChange(false); // update UI without clearing
        document.getElementById('assignKategoriPeranan').value = katPeranan;
        onAssignKategoriPerananChange(false);
    } else {
        // Pelajar — fill kelas
        if (kelasFill && kelasFill.toLowerCase() !== 'guru' && kelasFill.toLowerCase() !== 'akp') {
            document.getElementById('assignKelas').value = kelasFill;
            document.getElementById('assignKelasB').value = kelasFill;
        }
    }
}

async function assignCheckIc() {
    const ic = document.getElementById('assignIc').value.trim();
    if (!ic) { showToast('Sila masukkan No. IC', 'warning'); return; }
    const el = document.getElementById('assignMemberInfo');
    el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mencari...';
    try {
        const res = await fetch('/api/find_by_ic', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ic_number:ic})});
        const data = await res.json();
        if (data.success && data.member) {
            _populateAssignForm(data.member);
        } else {
            _assignFoundMember = null;
            el.innerHTML = `<span style="color:#dc2626"><i class="fas fa-circle-xmark"></i> ${data.message}</span>`;
        }
    } catch(e) {
        el.innerHTML = '<span style="color:red">Ralat sambungan</span>';
    }
}

// Lookup NFC untuk KENALI ahli (bukan untuk tetapkan)
async function _assignLookupNfc(nfcId) {
    if (!nfcId || nfcId.length < 3) return;
    const el = document.getElementById('assignMemberInfo');
    el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengenal pasti ahli...';
    try {
        const res = await fetch('/api/find_by_nfc_assign', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nfc_id:nfcId})});
        const data = await res.json();
        if (data.success && data.member) {
            _populateAssignForm(data.member);
            // Jika tab NFC lookup: clear field dan cadangkan guna NFC baru di field bawah
            if (document.getElementById('assignTabNfc').style.display !== 'none') {
                showToast(`Ahli dikenali: ${data.member.name}`, 'success');
                document.getElementById('assignNfcInput').focus();
            }
        } else {
            _assignFoundMember = null;
            el.innerHTML = `<span style="color:#64748b"><i class="fas fa-info-circle"></i> UID ini tidak didaftarkan lagi — sila isi maklumat manual</span>`;
        }
    } catch(e) {
        el.innerHTML = '<span style="color:red">Ralat sambungan</span>';
    }
}

function onAssignCategoryChange(clearFields=true) {
    const cat = document.getElementById('assignCategory').value;
    if (cat === 'bertugas') {
        document.getElementById('assignKategoriPerananGroup').style.display = '';
        document.getElementById('assignAhliKelasGroup').style.display = 'none';
        // Tunjuk kelas bertugas hanya untuk pelajar
        const peranan = document.getElementById('assignKategoriPeranan').value;
        document.getElementById('assignBertugasKelasGroup').style.display = (peranan === 'pelajar') ? '' : 'none';
    } else {
        // Ahli Mengumpul Point — tunjuk kelas+batch
        document.getElementById('assignKategoriPerananGroup').style.display = 'none';
        document.getElementById('assignAhliKelasGroup').style.display = '';
        document.getElementById('assignBertugasKelasGroup').style.display = 'none';
    }
}

function onAssignKategoriPerananChange(clearKelas=true) {
    const peranan = document.getElementById('assignKategoriPeranan').value;
    const rl = peranan.toLowerCase();
    if (rl === 'guru' || rl === 'akp') {
        document.getElementById('assignBertugasKelasGroup').style.display = 'none';
    } else {
        // Pelajar — perlu kelas & batch
        document.getElementById('assignBertugasKelasGroup').style.display = '';
        // Auto-fill dari data ahli jika ada
        if (_assignFoundMember && _assignFoundMember.kelas && !document.getElementById('assignKelasB').value) {
            const k = _assignFoundMember.kelas;
            if (k.toLowerCase() !== 'guru' && k.toLowerCase() !== 'akp') {
                document.getElementById('assignKelasB').value = k;
            }
        }
    }
}

// Listeners untuk NFC assign
document.addEventListener('DOMContentLoaded', function() {
    // NFC Lookup field (tab NFC — untuk kenali ahli)
    const lookupEl = document.getElementById('assignNfcLookup');
    if (lookupEl) {
        let t1 = null;
        lookupEl.addEventListener('input', function() {
            clearTimeout(t1);
            t1 = setTimeout(() => { if (this.value.trim().length > 2) _assignLookupNfc(this.value.trim()); }, 350);
        });
        lookupEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); _assignLookupNfc(this.value.trim()); }
        });
    }

    // NFC Input (kad yang akan ditetapkan)
    const assignNfcEl = document.getElementById('assignNfcInput');
    if (assignNfcEl) {
        let t2 = null;
        assignNfcEl.addEventListener('input', function() {
            clearTimeout(t2);
            const st = document.getElementById('assignNfcScanStatus');
            t2 = setTimeout(() => {
                if (this.value.trim().length > 2) {
                    if (st) st.innerHTML = '<span style="color:#059669"><i class="fas fa-check-circle"></i> Kad diimbas — sedia untuk ditetapkan</span>';
                } else {
                    if (st) st.textContent = '';
                }
            }, 350);
        });
        assignNfcEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); submitAssignNfc(); }
        });
    }

    // IC input enter key
    const icEl = document.getElementById('assignIc');
    if (icEl) {
        icEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); assignCheckIc(); }
        });
    }
});

// Legacy: toggleAssignRole dipanggil dari elemen lama — kekalkan untuk keserasian
function toggleAssignRole() { onAssignCategoryChange(); }

async function submitAssignNfc() {
    const ic_number = document.getElementById('assignIc').value.trim();
    const nfc_id = document.getElementById('assignNfcInput').value.trim();
    const category = document.getElementById('assignCategory').value;
    const expiry_date = document.getElementById('assignExpiry').value || null;

    if (!ic_number) { showToast('Sila masukkan No. IC dahulu', 'warning'); return; }
    if (!nfc_id) { showToast('Sila tap kad NFC yang akan ditetapkan', 'warning'); return; }

    // Determine kelas, batch, kategori_peranan
    let kelas = null, batch = null, kategori_peranan = 'pelajar';

    if (category === 'ahli') {
        kelas = document.getElementById('assignKelas').value.trim() || null;
        batch = document.getElementById('assignBatch').value.trim() || null;
        kategori_peranan = 'pelajar';
    } else {
        // bertugas
        const peranan = document.getElementById('assignKategoriPeranan').value;
        kategori_peranan = peranan;
        if (peranan === 'guru') {
            kelas = 'guru';
            batch = document.getElementById('assignBatch').value.trim() || null;
        } else if (peranan === 'akp') {
            kelas = 'akp';
            batch = document.getElementById('assignBatch').value.trim() || null;
        } else {
            // pelajar bertugas
            kelas = document.getElementById('assignKelasB').value.trim() || null;
            batch = document.getElementById('assignBatchB').value.trim() || null;
        }
    }

    try {
        const res = await fetch('/api/assign_nfc', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ ic_number, nfc_id, kelas, batch, category, expiry_date, kategori_peranan })
        });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) { closeModal('assignNfcModal'); loadMembers(); }
    } catch(e) { showToast('Ralat sambungan', 'error'); }
}

// ===================== LOAN TAB SWITCH (NFC / IC) =====================
let loanMode = 'nfc'; // 'nfc' or 'ic'

function switchLoanTab(mode) {
    loanMode = mode;
    document.getElementById('loanTabNfc').className = 'tab-btn' + (mode==='nfc'?' active':'');
    document.getElementById('loanTabIc').className = 'tab-btn' + (mode==='ic'?' active':'');
    document.getElementById('loanNfcTab').style.display = mode==='nfc' ? '' : 'none';
    document.getElementById('loanIcTab').style.display = mode==='ic' ? '' : 'none';
    document.getElementById('loanNfcInfo').innerHTML = '';
    if (mode==='ic') setTimeout(() => document.getElementById('loanIcSearch').focus(), 100);
    else setTimeout(() => document.getElementById('loanNfc').focus(), 100);
}

async function loanCheckIc() {
    const ic = document.getElementById('loanIcSearch').value.trim();
    if (!ic) { showToast('Sila masukkan No. IC', 'warning'); return; }
    document.getElementById('loanNfcInfo').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyemak...';
    try {
        const res = await fetch('/api/book_loan/check_ic', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ic_number:ic})});
        const data = await res.json();
        if (data.success) {
            const m = data.member;
            loanNfcId = m.nfc_id || ('IC_' + ic);
            loanMemberInfo = { name: m.name, ic_number: m.ic_number || ic, kelas: m.kelas || '', category: m.category };
            document.getElementById('loanNfcInfo').innerHTML = `<span style="color:#059669"><strong><i class="fas fa-id-card"></i> ${m.name}</strong> (${m.category}) — ${data.via==='ic_only'?'Pinjaman tanpa kad ahli':'Kad ahli dikenali'} ✔</span>`;
        } else {
            loanNfcId = null; loanMemberInfo = null;
            document.getElementById('loanNfcInfo').innerHTML = `<span style="color:red">${data.message}</span>`;
        }
    } catch(e) {
        document.getElementById('loanNfcInfo').innerHTML = '<span style="color:red">Ralat sambungan</span>';
    }
}

// Add Enter key for loanIcSearch
document.addEventListener('DOMContentLoaded', function() {
    const el = document.getElementById('loanIcSearch');
    if (el) el.addEventListener('keydown', function(e) { if(e.key==='Enter'){e.preventDefault();loanCheckIc();} });
});

// ===================== EDIT INDIVIDU AHLI =====================
// Source pool: cari ahli dalam mana-mana cache yang ada (bulk update / urus bertugas)
function _findEditMember(id) {
    const pools = [window._upMembersCache, window._bertugasCache];
    for (const p of pools) {
        if (Array.isArray(p)) {
            const f = p.find(x => x.id === id);
            if (f) return f;
        }
    }
    return null;
}

function openEditMemberModal(id) {
    const m = _findEditMember(id);
    if (!m) { showToast('Data ahli tidak dijumpai dalam senarai', 'error'); return; }
    window._editMemberSource = (window._bertugasCache || []).some(x => x.id === id) ? 'bertugas' : 'bulk';
    document.getElementById('editMemberId').value = m.id;
    document.getElementById('editMemberNfc').value = m.nfc_id || '';
    document.getElementById('editMemberName').value = m.name || '';
    // Bagi senarai bertugas, m.kelas sudah dinormalkan ('-' jika Guru/AKP). Jika '-' kosongkan.
    let kelasVal = (m.kelas && m.kelas !== '-') ? m.kelas : '';
    // Jika role asal (untuk bertugas) ialah kelas, gunakannya
    if (!kelasVal && m.role && !['guru','akp'].includes(String(m.role).toLowerCase())) kelasVal = m.role;
    document.getElementById('editMemberKelas').value = kelasVal;
    document.getElementById('editMemberBatch').value = (m.batch && m.batch !== '-') ? m.batch : '';
    const kelasUp = kelasVal.toUpperCase();
    const courseMatch = kelasUp.match(/\b(ETN|ETE|MTK|MTA|BAK|BKP|PPU|MPI|CTP)\b/);
    document.getElementById('editMemberCourse').value = courseMatch ? courseMatch[1] : '';
    // Tentukan kategori/peranan: utamakan m.kategori (Pelajar/Guru/AKP) jika ada, else dari role
    let kat = (m.kategori || '').toLowerCase();
    if (!kat) {
        const roleLow = String(m.role || m.category || '').toLowerCase();
        kat = roleLow === 'guru' ? 'guru' : (roleLow === 'akp' ? 'akp' : 'pelajar');
    }
    document.getElementById('editMemberCategory').value = (kat === 'guru' ? 'guru' : (kat === 'akp' ? 'akp' : 'pelajar'));
    openModal('editMemberModal');
}

async function submitEditMember() {
    const id = parseInt(document.getElementById('editMemberId').value);
    const nfc_id = document.getElementById('editMemberNfc').value.trim();
    const name = document.getElementById('editMemberName').value.trim();
    let kelas = document.getElementById('editMemberKelas').value.trim();
    const course = document.getElementById('editMemberCourse').value.trim();
    const batch = document.getElementById('editMemberBatch').value.trim();
    const kat = document.getElementById('editMemberCategory').value; // pelajar/guru/akp
    if (!name) { showToast('Nama wajib diisi', 'error'); return; }
    if (!nfc_id) { showToast('UID/NFC wajib diisi', 'error'); return; }
    // Tentukan nilai 'role' yang disimpan: Guru/AKP -> string literal; Pelajar -> nama kelas
    let roleToSave = '';
    if (kat === 'guru') roleToSave = 'Guru';
    else if (kat === 'akp') roleToSave = 'AKP';
    else {
        if (course && kelas && !kelas.toUpperCase().includes(course.toUpperCase())) {
            kelas = kelas + ' ' + course;
        }
        roleToSave = kelas;
    }
    // category dalam DB tidak ditukar (kekal 'ahli' / 'bertugas') — hantar kosong supaya COALESCE kekalkan
    try {
        const res = await fetch('/api/update_member_individual', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ id, nfc_id, name, kelas: roleToSave, batch, category: '' })
        });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) {
            closeModal('editMemberModal');
            if (window._editMemberSource === 'bertugas') loadBertugasList();
            else loadBulkMembersByBatch();
        }
    } catch(e) { showToast('Ralat sambungan', 'error'); }
}

// ===================== URUS BERTUGAS =====================
async function loadBertugasList() {
    const body = document.getElementById('bertugasListBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Memuatkan...</td></tr>';
    try {
        const res = await fetch('/api/admin/bertugas_list');
        const data = await res.json();
        if (!data.success) {
            body.innerHTML = `<tr><td colspan="9" class="empty-state">${data.message || 'Gagal memuatkan'}</td></tr>`;
            return;
        }
        window._bertugasCache = data.members;
        filterBertugasList();
    } catch(e) {
        body.innerHTML = '<tr><td colspan="9" class="empty-state">Ralat sambungan</td></tr>';
    }
}

function filterBertugasList() {
    const all = window._bertugasCache || [];
    const q = (document.getElementById('bertugasSearchName').value || '').toLowerCase().trim();
    const qb = (document.getElementById('bertugasFilterBatch').value || '').toLowerCase().trim();
    const qk = (document.getElementById('bertugasFilterKelas').value || '').toLowerCase().trim();
    const qc = (document.getElementById('bertugasFilterKategori').value || '').toLowerCase().trim();
    const filtered = all.filter(m => {
        if (q && !(m.name || '').toLowerCase().includes(q)) return false;
        if (qb && !String(m.batch || '').toLowerCase().includes(qb)) return false;
        if (qk && !String(m.kelas || '').toLowerCase().includes(qk)) return false;
        if (qc && String(m.kategori || '').toLowerCase() !== qc) return false;
        return true;
    });
    const body = document.getElementById('bertugasListBody');
    const infoEl = document.getElementById('bertugasInfo');
    if (infoEl) infoEl.innerHTML = `<i class="fas fa-users"></i> Memaparkan <b>${filtered.length}</b> daripada <b>${all.length}</b> pengawas bertugas`;
    if (!filtered.length) {
        body.innerHTML = '<tr><td colspan="9" class="empty-state">Tiada rekod sepadan</td></tr>';
        return;
    }
    body.innerHTML = filtered.map((m, i) => `
        <tr>
            <td>${i+1}</td>
            <td><b>${m.name}</b></td>
            <td><code style="font-size:0.78rem">${m.nfc_id || '-'}</code></td>
            <td>${m.batch || '-'}</td>
            <td>${m.kelas || '-'}</td>
            <td>${m.course || '-'}</td>
            <td><span class="status-pill pill-blue">${m.kategori}</span></td>
            <td><span class="status-pill" style="background:#e0f2fe;color:#0369a1">Pengawas Bertugas</span></td>
            <td><button class="btn btn-warning btn-sm" onclick="openEditMemberModal(${m.id})"><i class="fas fa-pen"></i> Edit</button></td>
        </tr>
    `).join('');
}


// ===================== AUTO-DISMISS POPUP (IC NOT FOUND etc.) =====================
function showAutoPopup(message, type, ms) {
    type = type || 'error'; ms = ms || 2000;
    let el = document.getElementById('autoPopupOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'autoPopupOverlay';
        el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);opacity:0;transition:opacity .2s';
        el.innerHTML = '<div id="autoPopupBox" style="background:#fff;border-radius:18px;padding:28px 36px;box-shadow:0 20px 60px rgba(0,0,0,0.25);min-width:280px;max-width:90vw;text-align:center;transform:scale(.9);transition:transform .2s"><div id="autoPopupIcon" style="font-size:2.6rem;margin-bottom:10px"></div><div id="autoPopupMsg" style="font-size:1.05rem;font-weight:600;color:#1e293b"></div></div>';
        document.body.appendChild(el);
    }
    const colors = { error:'#ef4444', success:'#10b981', warning:'#f59e0b', info:'#0ea5e9' };
    const icons  = { error:'<i class="fas fa-circle-xmark"></i>', success:'<i class="fas fa-circle-check"></i>', warning:'<i class="fas fa-triangle-exclamation"></i>', info:'<i class="fas fa-info-circle"></i>' };
    document.getElementById('autoPopupIcon').innerHTML = icons[type] || icons.info;
    document.getElementById('autoPopupIcon').style.color = colors[type] || colors.info;
    document.getElementById('autoPopupMsg').textContent = message;
    requestAnimationFrame(() => {
        el.style.opacity = '1';
        document.getElementById('autoPopupBox').style.transform = 'scale(1)';
    });
    clearTimeout(window._autoPopupTimer);
    window._autoPopupTimer = setTimeout(() => {
        el.style.opacity = '0';
        document.getElementById('autoPopupBox').style.transform = 'scale(.9)';
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }, ms);
}

// ===================== INIT =====================
document.getElementById('current-year').innerText = new Date().getFullYear();
loadLiveSessions();
loadLeaderboard();
loadBatchActivity();
loadActiveLoans();
loadTopBorrowers();
setInterval(() => {
    if (document.getElementById('page-scan').classList.contains('active')) {
        loadLiveSessions();
        loadLeaderboard();
        loadBatchActivity();
        loadActiveLoans();
        loadTopBorrowers();
    }
}, 30000);


/* ===========================================================================
   PWA — Daftar Service Worker (tiada popup / prompt automatik dipaparkan).
   Pengguna boleh "Install App" melalui fungsi biasa pelayar (Chrome/Edge:
   ikon install di address bar; Safari iOS: Share -> Add to Home Screen).
   =========================================================================== */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
}
