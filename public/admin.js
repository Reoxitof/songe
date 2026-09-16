/* ═══════════════════════════════════════════════════════════════
   SONGE TRACKER v2 — public/admin.js
   Panel administration : gestion des comptes utilisateurs
   ═══════════════════════════════════════════════════════════════ */
'use strict';

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
const TOKEN_KEY    = 'st_token';
const USERNAME_KEY = 'st_username';

function getToken() { return localStorage.getItem(TOKEN_KEY); }

async function api(method, endpoint, body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type' : 'application/json',
      'Authorization': 'Bearer ' + getToken(),
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  let res;
  try { res = await fetch('/api' + endpoint, opts); }
  catch { throw new Error('Serveur inaccessible.'); }

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    window.location.replace('/');
    return null;
  }
  if (res.status === 403) {
    window.location.replace('/app.html');
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day:'2-digit', month:'short', year:'numeric',
  });
}

function fmtDatetime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}

function toast(msg, type = 'success') {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div'); c.id = 'toast-container';
    document.body.appendChild(c);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3300);
}

function showMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `admin-msg ${type} visible`;
}
function hideMsg(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('visible');
}

// ══════════════════════════════════════════════════════════════
// ÉTAT
// ══════════════════════════════════════════════════════════════
const state = {
  users        : [],
  currentDetail: null,
};

// ══════════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════════
function initTabs() {
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`admin-tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'overview') renderOverview();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// STATS HEADER
// ══════════════════════════════════════════════════════════════
async function loadAdminStats() {
  try {
    const stats = await api('GET', '/admin/stats');
    if (!stats) return;
    document.getElementById('admin-stats-bar').innerHTML = `
      <div class="admin-stat">👥 <span class="val">${stats.totalUsers}</span> utilisateurs</div>
      <div class="admin-stat">🛡️ <span class="val">${stats.adminCount}</span> admins</div>
      <div class="admin-stat">🚫 <span class="val">${stats.bannedCount}</span> bannis</div>
      <div class="admin-stat">📜 <span class="val">${stats.totalSessions}</span> sessions</div>
      <div class="admin-stat">⚒️ <span class="val">${stats.totalForge}</span> forgemagies</div>
    `;
  } catch (err) {
    document.getElementById('admin-stats-bar').innerHTML = `<span style="color:var(--red);font-size:.8rem">${escHtml(err.message)}</span>`;
  }
}

// ══════════════════════════════════════════════════════════════
// LISTE UTILISATEURS
// ══════════════════════════════════════════════════════════════
async function loadUsers(q = '') {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:1.5rem">⏳ Chargement...</td></tr>`;
  try {
    const params = q ? `?q=${encodeURIComponent(q)}` : '';
    state.users  = await api('GET', `/admin/users${params}`);
    if (!state.users) return;
    renderUsersTable(state.users);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:1rem">${escHtml(err.message)}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2rem">Aucun utilisateur trouvé.</td></tr>`;
    return;
  }

  users.forEach(u => {
    const tr = document.createElement('tr');
    const roleBadge  = u.isAdmin
      ? `<span class="badge badge-admin">🛡️ Admin</span>`
      : `<span class="badge badge-user">👤 Utilisateur</span>`;
    const statusBadge = u.banned
      ? `<span class="badge badge-banned">🚫 Banni</span>`
      : `<span class="badge badge-active">✅ Actif</span>`;

    tr.innerHTML = `
      <td><strong>${escHtml(u.username)}</strong></td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td>${u.sessionsCount ?? 0}</td>
      <td>${fmtDate(u.createdAt)}</td>
      <td>
        <div class="td-actions">
          <button class="btn-tbl detail" data-id="${u.id}" title="Voir le détail">🔍 Détail</button>
          <button class="btn-tbl pwd"    data-id="${u.id}" data-name="${escHtml(u.username)}" title="Changer le mot de passe">🔑 Pwd</button>
          ${u.isAdmin
            ? `<button class="btn-tbl demote" data-id="${u.id}" title="Retirer admin">⬇️ Retirer admin</button>`
            : `<button class="btn-tbl promote" data-id="${u.id}" title="Promouvoir admin">⬆️ Rendre admin</button>`
          }
          ${u.banned
            ? `<button class="btn-tbl unban" data-id="${u.id}" title="Débannir">✅ Débannir</button>`
            : `<button class="btn-tbl ban"   data-id="${u.id}" title="Bannir">🚫 Bannir</button>`
          }
          <button class="btn-tbl del" data-id="${u.id}" data-name="${escHtml(u.username)}" title="Supprimer">🗑 Suppr.</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  bindTableActions();
}

function bindTableActions() {
  // Détail
  document.querySelectorAll('.btn-tbl.detail').forEach(btn => {
    btn.addEventListener('click', () => showUserDetail(btn.dataset.id));
  });

  // Réinitialiser mot de passe
  document.querySelectorAll('.btn-tbl.pwd').forEach(btn => {
    btn.addEventListener('click', () => openResetPwdModal(btn.dataset.id, btn.dataset.name));
  });

  // Promouvoir admin
  document.querySelectorAll('.btn-tbl.promote').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Rendre "${state.users.find(u=>u.id===btn.dataset.id)?.username}" administrateur ?`)) return;
      try {
        await api('PATCH', `/admin/users/${btn.dataset.id}`, { isAdmin: true });
        toast('Utilisateur promu admin.');
        await loadUsers(document.getElementById('admin-search').value.trim());
        await loadAdminStats();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Rétrograder admin
  document.querySelectorAll('.btn-tbl.demote').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Retirer les droits admin ?')) return;
      try {
        await api('PATCH', `/admin/users/${btn.dataset.id}`, { isAdmin: false });
        toast('Droits admin retirés.');
        await loadUsers(document.getElementById('admin-search').value.trim());
        await loadAdminStats();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Bannir
  document.querySelectorAll('.btn-tbl.ban').forEach(btn => {
    btn.addEventListener('click', async () => {
      const user = state.users.find(u => u.id === btn.dataset.id);
      if (!confirm(`Bannir "${user?.username}" ? Il ne pourra plus se connecter.`)) return;
      try {
        await api('PATCH', `/admin/users/${btn.dataset.id}`, { banned: true });
        toast(`"${user?.username}" banni.`, 'error');
        await loadUsers(document.getElementById('admin-search').value.trim());
        await loadAdminStats();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Débannir
  document.querySelectorAll('.btn-tbl.unban').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api('PATCH', `/admin/users/${btn.dataset.id}`, { banned: false });
        toast('Compte réactivé.');
        await loadUsers(document.getElementById('admin-search').value.trim());
        await loadAdminStats();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Supprimer
  document.querySelectorAll('.btn-tbl.del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`Supprimer DÉFINITIVEMENT le compte "${name}" et toutes ses données ?`)) return;
      try {
        await api('DELETE', `/admin/users/${btn.dataset.id}`);
        toast(`Compte "${name}" supprimé.`, 'error');
        // Masquer le détail si c'était l'utilisateur affiché
        if (state.currentDetail === btn.dataset.id) {
          document.getElementById('user-detail-panel').style.display = 'none';
          state.currentDetail = null;
        }
        await loadUsers(document.getElementById('admin-search').value.trim());
        await loadAdminStats();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ══════════════════════════════════════════════════════════════
// DÉTAIL UTILISATEUR
// ══════════════════════════════════════════════════════════════
async function showUserDetail(userId) {
  const panel = document.getElementById('user-detail-panel');

  // Toggle si même utilisateur
  if (state.currentDetail === userId) {
    panel.style.display = 'none';
    state.currentDetail = null;
    return;
  }
  state.currentDetail = userId;
  panel.style.display = 'block';
  panel.innerHTML = '<p style="color:var(--text-dim);font-size:.85rem;padding:.5rem">⏳ Chargement...</p>';

  try {
    const [user, sessions] = await Promise.all([
      api('GET', `/admin/users/${userId}`),
      api('GET', `/admin/users/${userId}/sessions`),
    ]);
    if (!user) return;

    const sessionsHtml = sessions && sessions.length
      ? sessions.slice(0, 10).map(s => `
          <div class="session-mini-row">
            <span>📅 ${fmtDatetime(s.date)}</span>
            <span>⏱ ${Math.floor(s.durationSec/60)}min</span>
            ${s.floor ? `<span>🏰 Étage ${s.floor}</span>` : ''}
            <span style="color:var(--text-dim)">${(s.legends||[]).reduce((a,i)=>a+i.qty,0)} légendes · ${(s.runes||[]).reduce((a,i)=>a+i.qty,0)} runes</span>
          </div>`).join('')
      : '<p style="color:var(--text-dim);font-size:.8rem;padding:.5rem">Aucune session.</p>';

    panel.innerHTML = `
      <div class="user-detail-panel">
        <div class="user-detail-header">
          <div>
            <span class="user-detail-name">👤 ${escHtml(user.username)}</span>
            ${user.isAdmin ? '<span class="badge badge-admin" style="margin-left:.5rem">Admin</span>' : ''}
            ${user.banned  ? '<span class="badge badge-banned" style="margin-left:.5rem">Banni</span>' : ''}
          </div>
          <button class="btn-secondary" id="btn-close-detail" style="font-size:.75rem;padding:.3rem .7rem">✕ Fermer</button>
        </div>
        <div class="user-detail-grid">
          <div class="user-detail-stat"><div class="lbl">Sessions</div><div class="val">${user.sessionsCount}</div></div>
          <div class="user-detail-stat"><div class="lbl">Inscrit le</div><div class="val" style="font-size:.8rem">${fmtDate(user.createdAt)}</div></div>
          <div class="user-detail-stat"><div class="lbl">Rôle</div><div class="val" style="font-size:.85rem">${user.isAdmin?'Admin':'Utilisateur'}</div></div>
          <div class="user-detail-stat"><div class="lbl">Statut</div><div class="val" style="font-size:.85rem;color:${user.banned?'var(--red)':'var(--teal)'}">${user.banned?'Banni':'Actif'}</div></div>
        </div>
        <div>
          <p style="font-size:.75rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">
            Dernières sessions
            ${sessions && sessions.length > 10 ? `<span style="font-weight:400">(10/${sessions.length} affichées)</span>` : ''}
          </p>
          <div class="sessions-mini">${sessionsHtml}</div>
        </div>
        ${sessions && sessions.length > 0 ? `
        <div style="margin-top:.75rem;display:flex;gap:.5rem">
          <button class="btn-danger" id="btn-purge-sessions" data-id="${user.id}" data-name="${escHtml(user.username)}" style="font-size:.78rem">
            🗑 Purger les sessions (${sessions.length})
          </button>
        </div>` : ''}
      </div>`;

    document.getElementById('btn-close-detail')?.addEventListener('click', () => {
      panel.style.display = 'none'; state.currentDetail = null;
    });

    document.getElementById('btn-purge-sessions')?.addEventListener('click', async (e) => {
      const { id, name } = e.currentTarget.dataset;
      if (!confirm(`Supprimer TOUTES les sessions de "${name}" ?`)) return;
      try {
        await api('DELETE', `/admin/users/${id}/sessions`);
        toast(`Sessions de "${name}" purgées.`, 'error');
        await showUserDetail(id); // refresh
        await loadAdminStats();
      } catch (err) { toast(err.message, 'error'); }
    });

  } catch (err) {
    panel.innerHTML = `<p style="color:var(--red);font-size:.85rem;padding:.5rem">${escHtml(err.message)}</p>`;
  }
}

// ══════════════════════════════════════════════════════════════
// MODAL RESET MOT DE PASSE
// ══════════════════════════════════════════════════════════════
function openResetPwdModal(userId, username) {
  document.getElementById('reset-uid').value = userId;
  document.getElementById('reset-username-display').textContent = username;
  document.getElementById('reset-new-pwd').value  = '';
  document.getElementById('reset-new-pwd2').value = '';
  hideMsg('reset-err'); hideMsg('reset-ok');
  document.getElementById('modal-reset-pwd').classList.remove('hidden');
  setTimeout(() => document.getElementById('reset-new-pwd').focus(), 50);
}

function initResetPwdModal() {
  document.getElementById('modal-reset-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-reset-pwd').classList.add('hidden');
  });
  document.getElementById('modal-reset-pwd')?.addEventListener('click', e => {
    if (e.target === e.currentTarget)
      document.getElementById('modal-reset-pwd').classList.add('hidden');
  });
  document.getElementById('modal-reset-confirm')?.addEventListener('click', async () => {
    const uid   = document.getElementById('reset-uid').value;
    const pwd   = document.getElementById('reset-new-pwd').value;
    const pwd2  = document.getElementById('reset-new-pwd2').value;
    hideMsg('reset-err'); hideMsg('reset-ok');
    if (!pwd) { showMsg('reset-err', 'Saisis un mot de passe.', 'error'); return; }
    if (pwd !== pwd2) { showMsg('reset-err', 'Les mots de passe ne correspondent pas.', 'error'); return; }
    try {
      await api('PATCH', `/admin/users/${uid}`, { password: pwd });
      showMsg('reset-ok', '✓ Mot de passe réinitialisé !', 'success');
      document.getElementById('reset-new-pwd').value  = '';
      document.getElementById('reset-new-pwd2').value = '';
      setTimeout(() => document.getElementById('modal-reset-pwd').classList.add('hidden'), 1500);
    } catch (err) { showMsg('reset-err', err.message, 'error'); }
  });
}

// ══════════════════════════════════════════════════════════════
// CRÉER UN COMPTE
// ══════════════════════════════════════════════════════════════
function initCreateUser() {
  document.getElementById('btn-create-user')?.addEventListener('click', async () => {
    hideMsg('create-err'); hideMsg('create-ok');
    const username = document.getElementById('create-username').value.trim();
    const password = document.getElementById('create-password').value;
    const isAdmin  = document.getElementById('create-is-admin').checked;
    if (!username || !password) { showMsg('create-err', 'Remplis tous les champs.', 'error'); return; }
    const btn = document.getElementById('btn-create-user');
    btn.disabled = true; btn.textContent = '⏳ Création...';
    try {
      const user = await api('POST', '/admin/users', { username, password, isAdmin });
      if (!user) return;
      showMsg('create-ok', `✓ Compte "${user.username}" créé avec succès !`, 'success');
      document.getElementById('create-username').value = '';
      document.getElementById('create-password').value = '';
      document.getElementById('create-is-admin').checked = false;
      await loadUsers();
      await loadAdminStats();
    } catch (err) { showMsg('create-err', err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '➕ Créer le compte'; }
  });
}

// ══════════════════════════════════════════════════════════════
// VUE GLOBALE
// ══════════════════════════════════════════════════════════════
async function renderOverview() {
  try {
    const stats = await api('GET', '/admin/stats');
    if (!stats) return;

    document.getElementById('overview-grid').innerHTML = `
      <div class="card stat-card"><div class="stat-icon">👥</div><div class="stat-label">Utilisateurs</div><div class="stat-big">${stats.totalUsers}</div></div>
      <div class="card stat-card"><div class="stat-icon">🛡️</div><div class="stat-label">Administrateurs</div><div class="stat-big">${stats.adminCount}</div></div>
      <div class="card stat-card"><div class="stat-icon">🚫</div><div class="stat-label">Comptes bannis</div><div class="stat-big" style="color:var(--red)">${stats.bannedCount}</div></div>
      <div class="card stat-card"><div class="stat-icon">📜</div><div class="stat-label">Sessions totales</div><div class="stat-big">${stats.totalSessions}</div></div>
      <div class="card stat-card"><div class="stat-icon">⚒️</div><div class="stat-label">Forgemagies</div><div class="stat-big">${stats.totalForge}</div></div>
      <div class="card stat-card highlight-card"><div class="stat-icon">🆕</div><div class="stat-label">Dernier inscrit</div><div class="stat-big" style="font-size:1.1rem">${escHtml(stats.newestUser||'—')}</div></div>
    `;

    // 10 derniers utilisateurs
    const users = await api('GET', '/admin/users');
    if (!users) return;
    const recent = [...users].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,10);
    document.getElementById('recent-users-list').innerHTML = recent.length
      ? `<table style="width:100%">
          <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Statut</th><th>Sessions</th><th>Inscription</th></tr></thead>
          <tbody>
            ${recent.map(u => `<tr>
              <td><strong>${escHtml(u.username)}</strong></td>
              <td>${u.isAdmin?'<span class="badge badge-admin">Admin</span>':'<span class="badge badge-user">User</span>'}</td>
              <td>${u.banned?'<span class="badge badge-banned">Banni</span>':'<span class="badge badge-active">Actif</span>'}</td>
              <td>${u.sessionsCount??0}</td>
              <td>${fmtDate(u.createdAt)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
      : '<p class="empty-msg">Aucun utilisateur.</p>';

  } catch (err) {
    document.getElementById('overview-grid').innerHTML =
      `<p style="color:var(--red)">${escHtml(err.message)}</p>`;
  }
}

// ══════════════════════════════════════════════════════════════
// NAVIGATION / DÉCONNEXION
// ══════════════════════════════════════════════════════════════
function initNavButtons() {
  document.getElementById('btn-go-app')?.addEventListener('click', () => {
    window.location.href = '/app.html';
  });
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (!confirm('Se déconnecter ?')) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem('st_admin');
    window.location.replace('/');
  });
}

// ══════════════════════════════════════════════════════════════
// RECHERCHE UTILISATEURS
// ══════════════════════════════════════════════════════════════
function initSearch() {
  let deb;
  document.getElementById('admin-search')?.addEventListener('input', e => {
    clearTimeout(deb);
    deb = setTimeout(() => loadUsers(e.target.value.trim()), 350);
  });
  document.getElementById('btn-refresh-users')?.addEventListener('click', async () => {
    document.getElementById('admin-search').value = '';
    await loadUsers();
    await loadAdminStats();
    toast('Liste actualisée.');
  });
}

// ══════════════════════════════════════════════════════════════
// INITIALISATION
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {

  if (!getToken()) { window.location.replace('/'); return; }

  // Vérifier que l'utilisateur est bien admin
  try {
    const me = await api('GET', '/auth/me');
    if (!me) return;
    if (!me.isAdmin) { window.location.replace('/app.html'); return; }
  } catch { window.location.replace('/'); return; }

  // Init
  initTabs();
  initNavButtons();
  initSearch();
  initResetPwdModal();
  initCreateUser();

  // Chargement initial
  await Promise.all([loadAdminStats(), loadUsers()]);
});
