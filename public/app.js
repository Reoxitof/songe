/* ═══════════════════════════════════════════════════════════════
   SONGE TRACKER v2 — public/app.js
   Modules : songes, forgemagie, prix, compte
   Auth    : JWT Bearer dans localStorage
   ═══════════════════════════════════════════════════════════════ */
'use strict';

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
const TOKEN_KEY    = 'st_token';
const USERNAME_KEY = 'st_username';

function getToken()    { return localStorage.getItem(TOKEN_KEY); }
function getUsername() { return localStorage.getItem(USERNAME_KEY); }

async function api(method, endpoint, body = null, signal = null) {
  const opts = {
    method,
    headers: {
      'Content-Type' : 'application/json',
      'Authorization': 'Bearer ' + getToken(),
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  if (signal) opts.signal = signal;

  let res;
  try { res = await fetch('/api' + endpoint, opts); }
  catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('Serveur inaccessible.');
  }

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    window.location.replace('/');
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ══════════════════════════════════════════════════════════════
const state = {
  // session songe — séparé par type de rune
  currentLegendes    : [],  // [{name,qty}] légendes (ressources craft)
  currentRunes       : [],  // [{name,qty}] runes astrales
  // timer
  timerInterval: null, timerStart: null,
  timerElapsed: 0, timerRunning: false,
  // modals
  modalContext: null, newTypeContext: null,
  // forgemagie en cours de saisie
  fgRunes: [],
  fgEditRunes: [],
  // filtre forgemagie
  fgFilter: 'all',
  // aide / entraide
  aideType: 'donjon',            // type sélectionné dans le formulaire
  aideFilterStatus: 'all',
  aideFilterType: 'all',
  // panoplie : { "slot:idx": item }  où item = détail complet de l'API
  panoItems: {},
  panoCurrentSlot: null,         // slot ciblé par la recherche en cours
  panoClass: '',                 // classe sélectionnée (visuel)
  panoBrowse: { slot: '', page: 1, loaded: false, stats: [], typeId: '' }, // état onglet "Parcourir"
  panoGlobalFm: [],              // exos FM globaux [{name, val}] appliqués à toute la panoplie
  panoScoreWeights: { damage: 1, resist: 1, initiative: .05, prospecting: 1, apmpo: 120, vitality: .05 },
  // cache prix
  pricesCache: null,
};

const PANO_DRAFT_KEY = 'st_pano_draft';
const _setDetailCache = {};
const _abortCtrls = {};
let _panoStatsGen = 0;
let _chartState = null;
let _chartResizeObs = null;
let _forgeChartStats = null;
let _forgeChartResizeObs = null;

function beginAbortable(key, alsoAbort = []) {
  [key, ...alsoAbort].forEach(k => _abortCtrls[k]?.abort());
  const ac = new AbortController();
  _abortCtrls[key] = ac;
  return ac.signal;
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

function persistPanoDraft() {
  try {
    localStorage.setItem(`${PANO_DRAFT_KEY}:${getUsername() || ''}`, JSON.stringify({
      v: 1,
      items: state.panoItems,
      class: state.panoClass,
      globalFm: state.panoGlobalFm || [],
    }));
  } catch { /* quota / mode privé */ }
}

function loadPanoDraft() {
  try {
    const raw = localStorage.getItem(`${PANO_DRAFT_KEY}:${getUsername() || ''}`);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.items || typeof d.items !== 'object' || Array.isArray(d.items)) return;
    state.panoItems = d.items;
    if (typeof d.class === 'string') state.panoClass = d.class;
    if (Array.isArray(d.globalFm)) state.panoGlobalFm = d.globalFm;
  } catch {}
}

async function fetchSetDetail(setId, withItems = false) {
  const key = `${setId}:${withItems ? 1 : 0}`;
  if (_setDetailCache[key]) return _setDetailCache[key];
  const qs = withItems ? '?items=1' : '';
  const set = await api('GET', `/dofusdb/set/${encodeURIComponent(setId)}${qs}`);
  if (set) _setDetailCache[key] = set;
  return set;
}

// ══════════════════════════════════════════════════════════════
// CACHE PRIX
// ══════════════════════════════════════════════════════════════
async function loadPrices(force = false) {
  if (state.pricesCache && !force) return state.pricesCache;
  try { state.pricesCache = await api('GET', '/prices'); }
  catch { state.pricesCache = state.pricesCache || { dreamPtPrice:0, oniricPrice:0, runesForgemagie:[], runesAstrales:[], runesTranscendance:[], legendesSonge:[], runeTypes:[] }; }
  return state.pricesCache;
}
function invalidatePrices() { state.pricesCache = null; }

// ══════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════
function secToLabel(s) {
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=s%60;
  if(h>0) return `${h}h ${m}m ${ss}s`;
  if(m>0) return `${m}m ${ss}s`;
  return `${ss}s`;
}
function secToHMS(s) {
  return [Math.floor(s/3600), Math.floor((s%3600)/60), s%60]
    .map(n=>String(n).padStart(2,'0')).join(':');
}
function secToHM(s) { return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`; }

function fmtK(k) {
  if (k===0) return '0 k';
  const abs = Math.abs(k);
  let str;
  if (abs>=1_000_000) str=(abs/1_000_000).toFixed(2).replace(/\.?0+$/,'')+' Mkk';
  else if (abs>=1_000) str=(abs/1_000).toFixed(1).replace(/\.?0+$/,'')+' kk';
  else str=Math.round(abs).toLocaleString('fr-FR')+' k';
  return k<0 ? '-'+str : str;
}

function escHtml(s) {
  return String(s??'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toast(msg, type='success') {
  let c=document.getElementById('toast-container');
  if(!c){ c=document.createElement('div'); c.id='toast-container'; document.body.appendChild(c); }
  const el=document.createElement('div');
  el.className=`toast ${type}`; el.textContent=msg;
  c.appendChild(el);
  setTimeout(()=>el.remove(), 3300);
}

function getFormDuration() {
  return (parseInt(document.getElementById('dur-h').value)||0)*3600
       + (parseInt(document.getElementById('dur-m').value)||0)*60
       + (parseInt(document.getElementById('dur-s').value)||0);
}

/** Cherche un item dans toutes les collections de runes */
function findRunePrice(name, prices) {
  const all = [
    ...(prices.runesForgemagie    || []),
    ...(prices.runesAstrales      || []),
    ...(prices.runesTranscendance || []),
    ...(prices.runeTypes          || []), // rétrocompatibilité
  ];
  return all.find(x => x.name === name);
}

function calcSessionValue(session, prices) {
  let t=0;
  (session.legendes||[]).forEach(i=>{ const p=(prices.legendesSonge||[]).find(x=>x.name===i.name); if(p) t+=p.price*i.qty; });
  (session.runes||[]).forEach(i=>{ const p=findRunePrice(i.name, prices); if(p) t+=p.price*i.qty; });
  t+=(session.dreamPoints||0)*(prices.dreamPtPrice||0);
  t+=(session.oniricReflets||0)*(prices.oniricPrice||0);
  return t;
}

async function calcCurrentValue() {
  const prices=await loadPrices();
  let lgs=0, run=0, dr=0, on=0;
  state.currentLegendes.forEach(i=>{ const p=(prices.legendesSonge||[]).find(x=>x.name===i.name); if(p) lgs+=p.price*i.qty; });
  state.currentRunes.forEach(i=>{ const p=findRunePrice(i.name, prices); if(p) run+=p.price*i.qty; });
  dr=(parseInt(document.getElementById('dream-points')?.value)||0)*(prices.dreamPtPrice||0);
  on=(parseInt(document.getElementById('oniric-reflets')?.value)||0)*(prices.oniricPrice||0);
  return {legendes:lgs, runes:run, dream:dr, oniric:on, total:lgs+run+dr+on};
}

// ══════════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════════
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if(btn.dataset.tab==='historique') renderHistory();
      if(btn.dataset.tab==='stats')      renderStats();
      if(btn.dataset.tab==='forgemagie') renderForgeList();
      if(btn.dataset.tab==='panoplies')  renderPano();
      if(btn.dataset.tab==='aide')       renderAideList();
      if(btn.dataset.tab==='prix')       renderPricesTab();
      if(btn.dataset.tab==='compte')     renderCompte();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// TIMER
// ══════════════════════════════════════════════════════════════
function initTimer() {
  const disp=document.getElementById('timer-display');
  const bS=document.getElementById('btn-timer-start');
  const bP=document.getElementById('btn-timer-stop');
  const bR=document.getElementById('btn-timer-reset');

  function tick() {
    disp.textContent=secToHMS(state.timerElapsed+Math.floor((Date.now()-state.timerStart)/1000));
  }
  bS.addEventListener('click',()=>{
    if(state.timerRunning)return;
    state.timerStart=Date.now(); state.timerRunning=true;
    state.timerInterval=setInterval(tick,500);
    bS.disabled=true; bP.disabled=false;
  });
  bP.addEventListener('click',()=>{
    if(!state.timerRunning)return;
    state.timerElapsed+=Math.floor((Date.now()-state.timerStart)/1000);
    clearInterval(state.timerInterval); state.timerRunning=false;
    bS.disabled=false; bP.disabled=true;
    const s=state.timerElapsed;
    document.getElementById('dur-h').value=Math.floor(s/3600);
    document.getElementById('dur-m').value=Math.floor((s%3600)/60);
    document.getElementById('dur-s').value=s%60;
    updatePreview();
  });
  bR.addEventListener('click',()=>{
    clearInterval(state.timerInterval);
    Object.assign(state,{timerRunning:false,timerElapsed:0,timerStart:null});
    disp.textContent='00:00:00'; bS.disabled=false; bP.disabled=true;
    ['dur-h','dur-m','dur-s'].forEach(id=>{ document.getElementById(id).value=''; });
    updatePreview();
  });
}

// ══════════════════════════════════════════════════════════════
// APERÇU VALEUR SESSION
// ══════════════════════════════════════════════════════════════
async function updatePreview() {
  const v=await calcCurrentValue(), sec=getFormDuration();
  const lgsEl=document.getElementById('prev-legendes-songe');
  if(lgsEl) lgsEl.textContent=fmtK(v.legendes);
  document.getElementById('prev-runes').textContent=fmtK(v.runes);
  document.getElementById('prev-dream').textContent=fmtK(v.dream);
  document.getElementById('prev-oniric').textContent=fmtK(v.oniric);
  document.getElementById('prev-total').textContent=fmtK(v.total);
  const rw=document.getElementById('prev-rate-wrap');
  if(sec>0){ document.getElementById('prev-rate').textContent=fmtK(Math.round(v.total/(sec/3600)))+'/h'; rw.style.display='flex'; }
  else rw.style.display='none';
}
function bindPreviewListeners() {
  ['dur-h','dur-m','dur-s','dream-points','oniric-reflets'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',updatePreview);
  });
}

// ══════════════════════════════════════════════════════════════
// LISTE ITEMS SESSION
// ══════════════════════════════════════════════════════════════
// Icônes officielles des runes astrales. Les autres runes gardent une icône
// de rune Dofus afin de rester cohérentes même lorsqu'un type est personnalisé.
function runeIcon(name, className = 'rune-icon') {
  const normalized = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
  const icons = {
    'rune astrale mineure': 'astrale-mineure',
    'rune astrale moyenne': 'astrale-moyenne',
    'rune astrale majeure': 'astrale-majeure',
    'rune astrale epatante': 'astrale-epatante',
    'rune astrale merveilleuse': 'astrale-merveilleuse',
    'rune astrale legendaire': 'astrale-legendaire',
  };
  const icon = icons[normalized] || 'forgemagie';
  return `<img src="image/runes/${icon}.png" alt="" class="${className}" aria-hidden="true" />`;
}

async function renderItemList(containerId, items, pillClass) {
  const prices    = await loadPrices();
  // Choisir la liste de prix selon le type de pill
  let pl;
  if (pillClass === 'pill-legende') pl = prices.legendesSonge    || [];
  else if (pillClass === 'pill-rune') pl = prices.runesAstrales      || [];
  else if (pillClass === 'pill-rune-trans') pl = prices.runesTranscendance || [];
  else pl = [...(prices.runesForgemagie||[]),...(prices.runesAstrales||[]),...(prices.runesTranscendance||[]),...(prices.runeTypes||[])];
  const c=document.getElementById(containerId);
  if(!c) return;
  c.innerHTML='';
  items.forEach((item,idx)=>{
    const found=pl.find(t=>t.name===item.name);
    const val=found?found.price*item.qty:0;
    const row=document.createElement('div');
    row.className='item-row';
    row.innerHTML=`
      <span class="item-name"><span class="drop-pill ${pillClass}">${pillClass.includes('rune') ? runeIcon(item.name) : ''}${escHtml(item.name)}</span></span>
      <span class="item-qty">× ${item.qty}</span>
      <span class="item-value">${fmtK(val)}</span>
      <button class="btn-remove" data-idx="${idx}" title="Supprimer">✕</button>`;
    c.appendChild(row);
  });
  c.querySelectorAll('.btn-remove').forEach(btn=>{
    btn.addEventListener('click',()=>{
      items.splice(parseInt(btn.dataset.idx),1);
      renderItemList(containerId,items,pillClass);
      updatePreview();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// MODAL ITEM (session)
// ══════════════════════════════════════════════════════════════
async function openModal(ctx) {
  state.modalContext = ctx;
  const prices = await loadPrices();

  // Choisir la liste selon le contexte
  const config = {
    'legende-songe': { title: '✦ Ajouter une légende',      label: 'Nom de la légende',    list: prices.legendesSonge || [] },
    'rune-astrale' : { title: '✨ Ajouter une rune astrale', label: 'Rune astrale (songe)', list: prices.runesAstrales || [] },
  };
  const c = config[ctx] || config['rune-astrale'];

  document.getElementById('modal-title').textContent      = c.title;
  document.getElementById('modal-name-label').textContent = c.label;

  const dl = document.getElementById('modal-datalist');
  dl.innerHTML = '';
  c.list.forEach(t => { const o=document.createElement('option'); o.value=t.name; dl.appendChild(o); });

  document.getElementById('modal-name').value = '';
  document.getElementById('modal-qty').value  = 1;
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-name').focus(), 50);
}

function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); state.modalContext = null; }

async function confirmModal() {
  const name = document.getElementById('modal-name').value.trim();
  const qty  = Math.max(1, parseInt(document.getElementById('modal-qty').value) || 1);
  if (!name) { toast('Saisis un nom !', 'error'); return; }

  const prices = await loadPrices();
  const ctx    = state.modalContext;

  // Déterminer la liste cible et le endpoint selon le contexte
  const ctxMap = {
    'legende-songe': { list: prices.legendesSonge||[],  ep: '/prices/legende-songe-types', target: state.currentLegendes, containerId: 'legendes-songe-list', pill: 'pill-legende' },
    'rune-astrale' : { list: prices.runesAstrales||[],  ep: '/prices/astrale-types',       target: state.currentRunes,    containerId: 'runes-list',          pill: 'pill-rune'    },
  };
  const m = ctxMap[ctx] || ctxMap['rune-astrale'];

  // Créer le type s'il n'existe pas encore
  if (!m.list.find(t => t.name.toLowerCase() === name.toLowerCase())) {
    try { await api('POST', m.ep, { name, price: 0 }); invalidatePrices(); } catch {}
  }

  const ex = m.target.find(i => i.name === name);
  if (ex) ex.qty += qty; else m.target.push({ name, qty });

  await renderItemList(m.containerId, m.target, m.pill);
  closeModal();
  updatePreview();
}

function initModal() {
  document.getElementById('btn-add-legende-songe')?.addEventListener('click',        () => openModal('legende-songe'));
  document.getElementById('btn-add-rune-astrale-session')?.addEventListener('click', () => openModal('rune-astrale'));
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-confirm').addEventListener('click',confirmModal);
  document.getElementById('modal-overlay').addEventListener('click',e=>{ if(e.target===e.currentTarget)closeModal(); });
  document.getElementById('modal-name').addEventListener('keydown',e=>{ if(e.key==='Enter')confirmModal(); });
}

// ══════════════════════════════════════════════════════════════
// MODAL NOUVEAU TYPE (prix)
// ══════════════════════════════════════════════════════════════
function openNewTypeModal(ctx) {
  state.newTypeContext = ctx;
  const titles = {
    'forgemagie'   : '🔷 Nouvelle rune de forgemagie',
    'astrale'      : '✨ Nouvelle rune astrale',
    'transcendance': '💫 Nouvelle rune de transcendance',
    'legende-songe': '✦ Nouvelle légende (ressource craft)',
    'rune'         : '🔷 Nouveau type de rune',
  };
  document.getElementById('modal-new-type-title').textContent = titles[ctx] || 'Nouveau type';
  document.getElementById('modal-new-type-name').value  = '';
  document.getElementById('modal-new-type-price').value = '';
  document.getElementById('modal-new-type-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-new-type-name').focus(), 50);
}
function closeNewTypeModal() { document.getElementById('modal-new-type-overlay').classList.add('hidden'); state.newTypeContext = null; }
async function confirmNewType() {
  const name  = document.getElementById('modal-new-type-name').value.trim();
  const price = parseInt(document.getElementById('modal-new-type-price').value) || 0;
  if (!name) { toast('Saisis un nom !', 'error'); return; }

  const epMap = {
    'forgemagie'   : '/prices/forgemagie-types',
    'astrale'      : '/prices/astrale-types',
    'transcendance': '/prices/transcendance-types',
    'legende-songe': '/prices/legende-songe-types',
    'rune'         : '/prices/forgemagie-types',
  };
  const ep = epMap[state.newTypeContext] || '/prices/forgemagie-types';
  try {
    await api('POST', ep, { name, price });
    invalidatePrices();
    closeNewTypeModal();
    await renderPricesTab();
    toast(`"${escHtml(name)}" ajouté !`);
  } catch(err) { toast(err.message, 'error'); }
}
function initNewTypeModal() {
  // Les boutons "ajouter" dans l'onglet Prix sont gérés par initPricesTab
  // Mais on garde le listener pour le bouton générique de l'ancienne interface
  document.getElementById('btn-add-rune-type')?.addEventListener('click', () => openNewTypeModal('forgemagie'));
  document.getElementById('modal-new-type-cancel').addEventListener('click',  closeNewTypeModal);
  document.getElementById('modal-new-type-confirm').addEventListener('click', confirmNewType);
  document.getElementById('modal-new-type-overlay').addEventListener('click', e => { if (e.target===e.currentTarget) closeNewTypeModal(); });
  document.getElementById('modal-new-type-name').addEventListener('keydown',  e => { if (e.key==='Enter') confirmNewType(); });
}

// ══════════════════════════════════════════════════════════════
// SAUVEGARDE SESSION
// ══════════════════════════════════════════════════════════════
function initSaveSession() {
  document.getElementById('btn-save').addEventListener('click',async()=>{
    const sec=getFormDuration();
    if(sec<=0){toast('Saisis une durée !','error');return;}
    const btn=document.getElementById('btn-save');
    btn.disabled=true; btn.textContent='⏳ Enregistrement...';
    try{
      await api('POST','/sessions',{
        durationSec:sec,
        floor:parseInt(document.getElementById('floor').value)||null,
        legendes:JSON.parse(JSON.stringify(state.currentLegendes)),
        runes   :JSON.parse(JSON.stringify(state.currentRunes)),
        dreamPoints:parseInt(document.getElementById('dream-points').value)||0,
        oniricReflets:parseInt(document.getElementById('oniric-reflets').value)||0,
        notes:document.getElementById('notes').value.trim(),
      });
      await resetForm(); await updateHeaderStats(); toast('✦ Session enregistrée !');
    }catch(err){toast(err.message,'error');}
    finally{btn.disabled=false; btn.textContent='✦ Enregistrer la session';}
  });
}
async function resetForm() {
  ['dur-h','dur-m','dur-s','floor','dream-points','oniric-reflets','notes'].forEach(id=>{
    const el=document.getElementById(id); if(el)el.value='';
  });
  state.currentLegendes = [];
  state.currentRunes    = [];
  clearInterval(state.timerInterval);
  Object.assign(state,{timerRunning:false,timerElapsed:0,timerStart:null});
  document.getElementById('timer-display').textContent='00:00:00';
  document.getElementById('btn-timer-start').disabled=false;
  document.getElementById('btn-timer-stop').disabled=true;
  await renderItemList('legendes-songe-list', state.currentLegendes, 'pill-legende');
  await renderItemList('runes-list',          state.currentRunes,    'pill-rune');
  await updatePreview();
}

// ══════════════════════════════════════════════════════════════
// HEADER STATS
// ══════════════════════════════════════════════════════════════
async function updateHeaderStats() {
  try{
    const [sessions,prices]=await Promise.all([api('GET','/sessions'),loadPrices()]);
    if(!sessions)return;
    document.getElementById('stat-sessions').textContent=sessions.length;
    const totalSec=sessions.reduce((a,s)=>a+s.durationSec,0);
    document.getElementById('stat-total-time').textContent=secToHM(totalSec);
    if(sessions.length>0&&totalSec>0){
      const tv=sessions.reduce((a,s)=>a+calcSessionValue(s,prices),0);
      document.getElementById('stat-per-hour').textContent=fmtK(Math.round(tv/(totalSec/3600)))+'/h';
    }else document.getElementById('stat-per-hour').textContent='— kk';
  }catch{}
}

// ══════════════════════════════════════════════════════════════
// HISTORIQUE SESSIONS
// ══════════════════════════════════════════════════════════════
async function renderHistory(filter='') {
  const c=document.getElementById('history-list');
  c.innerHTML='<p class="empty-msg">⏳ Chargement...</p>';
  try{
    const params=filter?`?q=${encodeURIComponent(filter)}`:'';
    const [sessions,prices]=await Promise.all([api('GET',`/sessions${params}`),loadPrices()]);
    if(!sessions)return;
    c.innerHTML='';
    if(!sessions.length){c.innerHTML='<p class="empty-msg">Aucune session trouvée.</p>';return;}
    sessions.forEach(s=>{
      const d=new Date(s.date), val=calcSessionValue(s,prices);
      const rate=s.durationSec>0?Math.round(val/(s.durationSec/3600)):0;
      const tLg=(s.legendes||[]).reduce((a,i)=>a+i.qty,0);
      const tR=(s.runes||[]).reduce((a,i)=>a+i.qty,0);
      let pills='';
      if(tLg>0) pills+=`<span class="drop-pill pill-legende">✦ ${tLg} légende${tLg>1?'s':''}</span>`;
      if(tR>0) pills+=`<span class="drop-pill pill-rune">${runeIcon('Rune Astrale Mineure')} ${tR} rune${tR>1?'s':''}</span>`;
      if((s.dreamPoints||0)>0)   pills+=`<span class="drop-pill pill-dream">💎 ${s.dreamPoints} pts</span>`;
      if((s.oniricReflets||0)>0) pills+=`<span class="drop-pill pill-oniric">🌙 ${s.oniricReflets} reflets</span>`;
      const el=document.createElement('div');
      el.className='history-item';
      el.innerHTML=`
        <div class="history-date">
          <div class="day">${String(d.getDate()).padStart(2,'0')}</div>
          <div class="month">${d.toLocaleString('fr-FR',{month:'short'})}</div>
          <div class="year">${d.getFullYear()}</div>
        </div>
        <div class="history-body">
          <div class="history-meta">
            <span class="duration">⏱ ${secToLabel(s.durationSec)}</span>
            ${s.floor?`<span class="floor">🏰 Étage ${s.floor}</span>`:''}
            <span>${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>
          </div>
          <div class="history-drops">${pills||'<span style="color:var(--text-dim);font-size:.78rem">Aucun drop</span>'}</div>
          ${s.notes?`<div class="history-notes">📝 ${escHtml(s.notes)}</div>`:''}
        </div>
        <div class="history-value-col">
          <div class="history-value">${fmtK(val)}</div>
          ${rate>0?`<div class="history-rate">${fmtK(rate)}/h</div>`:''}
        </div>
        <button class="btn-delete-session" data-id="${escHtml(s.id)}" title="Supprimer">🗑</button>`;
      c.appendChild(el);
    });
    c.querySelectorAll('.btn-delete-session').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        if(!confirm('Supprimer cette session ?'))return;
        try{
          await api('DELETE',`/sessions/${btn.dataset.id}`);
          await renderHistory(document.getElementById('search-history')?.value.trim()||'');
          await updateHeaderStats();
        }catch(err){toast(err.message,'error');}
      });
    });
  }catch(err){ c.innerHTML=`<p class="empty-msg" style="color:var(--red)">Erreur : ${escHtml(err.message)}</p>`; }
}
function initHistory() {
  let deb;
  document.getElementById('search-history')?.addEventListener('input',e=>{
    clearTimeout(deb); deb=setTimeout(()=>renderHistory(e.target.value.trim()),350);
  });
  document.getElementById('btn-clear-all')?.addEventListener('click',async()=>{
    if(!confirm('Supprimer TOUTES les sessions ?'))return;
    try{ await api('DELETE','/sessions'); await renderHistory(); await updateHeaderStats(); toast('Historique effacé.','error'); }
    catch(err){toast(err.message,'error');}
  });
}

// ══════════════════════════════════════════════════════════════
// STATISTIQUES SESSIONS
// ══════════════════════════════════════════════════════════════
async function renderStats() {
  try{
    const [sessions,prices]=await Promise.all([api('GET','/sessions'),loadPrices()]);
    if(!sessions)return;
    let tLg=0,tR=0,tP=0,tRf=0,tV=0,tS=0,bV=0;
    sessions.forEach(s=>{
      tLg+=(s.legendes||[]).reduce((a,i)=>a+i.qty,0);
      tR+=(s.runes||[]).reduce((a,i)=>a+i.qty,0);
      tP+=s.dreamPoints||0; tRf+=s.oniricReflets||0; tS+=s.durationSec||0;
      const v=calcSessionValue(s,prices); tV+=v; if(v>bV)bV=v;
    });
    const avg=tS>0?Math.round(tV/(tS/3600)):0;
    const lgEl=document.getElementById('s-total-legends'); if(lgEl) lgEl.textContent=tLg;
    document.getElementById('s-total-runes').textContent=tR;
    document.getElementById('s-total-pts').textContent=tP.toLocaleString('fr-FR');
    document.getElementById('s-total-reflets').textContent=tRf.toLocaleString('fr-FR');
    document.getElementById('s-total-value').textContent=fmtK(tV);
    document.getElementById('s-avg-hour').textContent=sessions.length>0?fmtK(avg)+'/h':'—';
    document.getElementById('s-best-session').textContent=sessions.length>0?fmtK(bV):'—';
    document.getElementById('s-sessions-count').textContent=sessions.length;
    renderChart(sessions,prices);
    renderDropRanking(sessions,prices);
  }catch{}
}

// ══════════════════════════════════════════════════════════════
// TOP DROPS — légendes & runes les plus rentables sur l'ensemble
// des sessions (quantité totale × prix unitaire configuré)
// ══════════════════════════════════════════════════════════════
function renderDropRanking(sessions, prices) {
  const legWrap = document.getElementById('drop-legends-list');
  const runeWrap = document.getElementById('drop-runes-list');
  if (!legWrap || !runeWrap) return;

  function tally(field) {
    const totals = {}; // name -> { qty, value }
    sessions.forEach(s => (s[field] || []).forEach(i => {
      if (!i?.name) return;
      const t = totals[i.name] ||= { name: i.name, qty: 0, value: 0 };
      t.qty += i.qty || 0;
    }));
    return totals;
  }

  function priceFor(name, isRune) {
    if (isRune) {
      const t = findRunePrice(name, prices);
      return t ? (t.price || 0) : 0;
    }
    const t = (prices.legendesSonge || []).find(t => t.name === name);
    return t ? (t.price || 0) : 0;
  }

  function renderList(wrap, totals, isRune) {
    const rows = Object.values(totals)
      .map(t => ({ ...t, value: t.qty * priceFor(t.name, isRune) }))
      .filter(t => t.qty > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    if (!rows.length) { wrap.innerHTML = '<p class="empty-msg">Aucune donnée.</p>'; return; }
    wrap.innerHTML = rows.map(r => `
      <div class="drop-rank-row">
        <span class="drop-rank-name">${isRune ? runeIcon(r.name, 'rune-icon-sm') : '✦ '}${escHtml(r.name)}</span>
        <span class="drop-rank-qty">×${r.qty.toLocaleString('fr-FR')}</span>
        <span class="drop-rank-val">${fmtK(r.value)}</span>
      </div>`).join('');
  }

  renderList(legWrap, tally('legendes'), false);
  renderList(runeWrap, tally('runes'), true);
}

// ══════════════════════════════════════════════════════════════
// GRAPHIQUE CANVAS
// ══════════════════════════════════════════════════════════════
function renderChart(sessions,prices) {
  const canvas=document.getElementById('chart-sessions');
  if(!canvas)return;
  _chartState = { sessions, prices };
  const ctx=canvas.getContext('2d'), dpr=window.devicePixelRatio||1;
  const W=canvas.parentElement.clientWidth, H=260;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  canvas.width=W*dpr; canvas.height=H*dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0,0,W,H);
  const data=[...sessions].reverse().slice(0,20);
  if(!data.length){
    ctx.fillStyle='#4a4a6a'; ctx.font='14px Segoe UI'; ctx.textAlign='center';
    ctx.fillText('Aucune donnée',W/2,H/2); return;
  }
  const vals=data.map(s=>calcSessionValue(s,prices));
  const maxV=Math.max(...vals,1);
  const pL=56,pR=16,pT=24,pB=44,cW=W-pL-pR,cH=H-pT-pB;
  const slot=cW/data.length;
  const bW=Math.min(40,Math.max(6, slot-6));
  const showBarLabels = bW >= 28;
  const labelEvery = data.length > 10 ? Math.ceil(data.length / 8) : 1;
  ctx.strokeStyle='#2a2f52'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pT+cH-(cH*i/4);
    ctx.beginPath(); ctx.moveTo(pL,y); ctx.lineTo(W-pR,y); ctx.stroke();
    ctx.fillStyle='#7a7aa0'; ctx.font='10px Segoe UI'; ctx.textAlign='right';
    ctx.fillText(fmtK(Math.round(maxV*i/4)),pL-4,y+4);
  }
  data.forEach((s,idx)=>{
    const val=vals[idx], bH=cH*(val/maxV);
    const x=pL+slot*idx+(slot-bW)/2, y=pT+cH-bH;
    const r=Math.min(4,bW/2,Math.max(0,bH/2));
    const g=ctx.createLinearGradient(0,y,0,pT+cH);
    g.addColorStop(0,'#9d6fff'); g.addColorStop(1,'#4a1a9a');
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+bW-r,y);
    ctx.quadraticCurveTo(x+bW,y,x+bW,y+r);
    ctx.lineTo(x+bW,y+bH); ctx.lineTo(x,y+bH); ctx.lineTo(x,y+r);
    ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath(); ctx.fill();
    if(showBarLabels && bH>20){
      ctx.fillStyle='#e8e0ff'; ctx.font='9px Segoe UI'; ctx.textAlign='center';
      ctx.fillText(fmtK(val),x+bW/2,y-4);
    }
    if(idx % labelEvery === 0 || idx === data.length - 1){
      const dd=new Date(s.date);
      ctx.fillStyle='#7a7aa0'; ctx.font='10px Segoe UI'; ctx.textAlign='center';
      ctx.fillText(`${String(dd.getDate()).padStart(2,'0')}/${String(dd.getMonth()+1).padStart(2,'0')}`,x+bW/2,pT+cH+14);
    }
  });
}

function initChartResize() {
  const canvas = document.getElementById('chart-sessions');
  const wrap = canvas?.parentElement;
  if (!wrap || _chartResizeObs) return;
  if (typeof ResizeObserver === 'undefined') return;
  let t;
  _chartResizeObs = new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!_chartState) return;
      if (!document.getElementById('tab-stats')?.classList.contains('active')) return;
      renderChart(_chartState.sessions, _chartState.prices);
    }, 80);
  });
  _chartResizeObs.observe(wrap);
}

function initForgeChartResize() {
  const canvas = document.getElementById('chart-forge');
  const wrap = canvas?.parentElement;
  if (!wrap || _forgeChartResizeObs) return;
  if (typeof ResizeObserver === 'undefined') return;
  let t;
  _forgeChartResizeObs = new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!_forgeChartStats) return;
      if (!document.getElementById('tab-forgemagie')?.classList.contains('active')) return;
      renderForgeChart(_forgeChartStats);
    }, 80);
  });
  _forgeChartResizeObs.observe(wrap);
}

// ══════════════════════════════════════════════════════════════
// FORGEMAGIE — RUNES INLINE (formulaire principal)
// ══════════════════════════════════════════════════════════════
async function renderFgRunes(containerId, runesArr, onUpdate) {
  const c = document.getElementById(containerId);
  if (!c) return;

  // Charger la liste des runes de forgemagie pour l'autocomplétion
  const prices = await loadPrices();
  const allFmRunes = [
    ...(prices.runesForgemagie    || []),
    ...(prices.runesTranscendance || []),
    ...(prices.runeTypes          || []),
  ];

  // Créer/mettre à jour la datalist globale pour ce container
  const dlId = containerId + '-datalist';
  let dl = document.getElementById(dlId);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = dlId;
    document.body.appendChild(dl);
  }
  dl.innerHTML = '';
  allFmRunes.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.name;
    dl.appendChild(opt);
  });

  c.innerHTML = '';
  runesArr.forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'forge-rune-row';
    row.innerHTML = `
      <input type="text" placeholder="Nom de la rune" value="${escHtml(r.nom)}"
        data-field="nom" data-idx="${idx}" maxlength="60"
        list="${dlId}" autocomplete="off"/>
      <input type="number" placeholder="Qté" value="${r.quantite || ''}"
        min="0" data-field="quantite" data-idx="${idx}"/>
      <input type="number" placeholder="Prix/u (k)" value="${r.prixUnitaire || ''}"
        min="0" data-field="prixUnitaire" data-idx="${idx}"/>
      <button class="btn-del-rune" data-idx="${idx}" title="Supprimer">✕</button>`;
    c.appendChild(row);
  });

  c.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.dataset.idx), f = inp.dataset.field;
      if (f === 'nom') {
        runesArr[i].nom = inp.value;
        // Auto-remplir le prix unitaire si la rune est connue
        const found = allFmRunes.find(x => x.name.toLowerCase() === inp.value.toLowerCase());
        if (found && found.price > 0) {
          runesArr[i].prixUnitaire = found.price;
          // Mettre à jour visuellement le champ prix
          const priceInp = inp.closest('.forge-rune-row')?.querySelector('[data-field="prixUnitaire"]');
          if (priceInp && !priceInp.value) priceInp.value = found.price;
        }
      } else {
        runesArr[i][f] = parseFloat(inp.value) || 0;
      }
      if (onUpdate) onUpdate();
    });
  });

  c.querySelectorAll('.btn-del-rune').forEach(btn => {
    btn.addEventListener('click', () => {
      runesArr.splice(parseInt(btn.dataset.idx), 1);
      renderFgRunes(containerId, runesArr, onUpdate);
      if (onUpdate) onUpdate();
    });
  });
}

function updateFgPreview() {
  const achat=parseFloat(document.getElementById('fg-achat')?.value)||0;
  const craft=parseFloat(document.getElementById('fg-craft')?.value)||0;
  const vente=parseFloat(document.getElementById('fg-vente')?.value)||0;
  const coutRunes=state.fgRunes.reduce((a,r)=>(r.quantite||0)*(r.prixUnitaire||0)+a,0);
  const total=achat+craft+coutRunes;
  const benef=vente-total;
  const marge=total>0?Math.round((benef/total)*1000)/10:0;

  document.getElementById('fg-prev-achat').textContent=fmtK(achat);
  document.getElementById('fg-prev-craft').textContent=fmtK(craft);
  document.getElementById('fg-prev-runes').textContent=fmtK(coutRunes);
  document.getElementById('fg-prev-total').textContent=fmtK(total);
  document.getElementById('fg-prev-vente').textContent=fmtK(vente);

  const bEl=document.getElementById('fg-prev-benefice');
  bEl.textContent=fmtK(benef);
  bEl.style.color=benef>0?'var(--teal)':benef<0?'var(--red)':'var(--gold)';

  const mw=document.getElementById('fg-prev-marge-wrap');
  if(total>0){
    document.getElementById('fg-prev-marge').textContent=marge+'%';
    document.getElementById('fg-prev-marge').style.color=marge>0?'var(--teal)':marge<0?'var(--red)':'var(--gold)';
    mw.style.display='flex';
  } else mw.style.display='none';
}

function initForgemagie() {
  // Listeners aperçu
  ['fg-achat','fg-craft','fg-vente'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',updateFgPreview);
  });

  // Ajouter rune
  document.getElementById('btn-fg-add-rune')?.addEventListener('click', async () => {
    state.fgRunes.push({nom:'', quantite:0, prixUnitaire:0});
    await renderFgRunes('fg-runes-list', state.fgRunes, updateFgPreview);
  });

  // Sauvegarder
  document.getElementById('btn-fg-save')?.addEventListener('click',async()=>{
    const itemNom=document.getElementById('fg-item').value.trim();
    if(!itemNom){toast('Nom de l\'item requis !','error');return;}
    const btn=document.getElementById('btn-fg-save');
    btn.disabled=true; btn.textContent='⏳...';
    try{
      await api('POST','/forgemagie',{
        itemNom,
        itemType:document.getElementById('fg-type').value.trim()||'Équipement',
        prixAchat:parseFloat(document.getElementById('fg-achat').value)||0,
        coutCraft:parseFloat(document.getElementById('fg-craft').value)||0,
        prixVente:parseFloat(document.getElementById('fg-vente').value)||0,
        runes:state.fgRunes.filter(r=>r.nom.trim()),
        notes:document.getElementById('fg-notes').value.trim(),
        tentativeStatut:document.getElementById('fg-result').value,
        exo:document.getElementById('fg-exo').checked,
      });
      // Reset formulaire
      ['fg-item','fg-type','fg-achat','fg-craft','fg-vente','fg-notes'].forEach(id=>{
        const el=document.getElementById(id); if(el)el.value='';
      });
      document.getElementById('fg-result').value='succes';
      document.getElementById('fg-exo').checked=false;
      state.fgRunes=[];
      await renderFgRunes('fg-runes-list', state.fgRunes, updateFgPreview);
      updateFgPreview();
      await renderForgeList();
      toast('⚒️ Forgemagie enregistrée !');
    }catch(err){toast(err.message,'error');}
    finally{btn.disabled=false; btn.textContent='⚒️ Enregistrer';}
  });

  // Filtres
  document.querySelectorAll('.filter-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.fgFilter=btn.dataset.filter;
      renderForgeList();
    });
  });

  // Recherche
  let deb;
  document.getElementById('fg-search')?.addEventListener('input',()=>{
    clearTimeout(deb); deb=setTimeout(renderForgeList,350);
  });

  // Modal édition rune
  document.getElementById('modal-forge-add-rune')?.addEventListener('click', async () => {
    state.fgEditRunes.push({nom:'', quantite:0, prixUnitaire:0});
    await renderFgRunes('modal-forge-runes', state.fgEditRunes, null);
  });

  document.getElementById('modal-forge-cancel')?.addEventListener('click',()=>{
    document.getElementById('modal-forge-overlay').classList.add('hidden');
  });
  document.getElementById('modal-forge-overlay')?.addEventListener('click',e=>{
    if(e.target===e.currentTarget) document.getElementById('modal-forge-overlay').classList.add('hidden');
  });

  document.getElementById('modal-forge-confirm')?.addEventListener('click',async()=>{
    const id=document.getElementById('modal-forge-id').value;
    const itemNom=document.getElementById('modal-forge-item').value.trim();
    if(!itemNom){toast('Nom requis !','error');return;}
    try{
      await api('PUT',`/forgemagie/${id}`,{
        itemNom,
        prixAchat:parseFloat(document.getElementById('modal-forge-achat').value)||0,
        coutCraft:parseFloat(document.getElementById('modal-forge-craft').value)||0,
        prixVente:parseFloat(document.getElementById('modal-forge-vente').value)||0,
        runes:state.fgEditRunes.filter(r=>r.nom.trim()),
        notes:document.getElementById('modal-forge-notes').value.trim(),
        tentativeStatut:document.getElementById('modal-forge-result').value,
        exo:document.getElementById('modal-forge-exo').checked,
      });
      document.getElementById('modal-forge-overlay').classList.add('hidden');
      await renderForgeList();
      toast('✏️ Entrée modifiée !');
    }catch(err){toast(err.message,'error');}
  });
}

async function renderForgeList() {
  const container=document.getElementById('forge-list');
  if(!container)return;
  container.innerHTML='<p class="empty-msg">⏳ Chargement...</p>';

  try{
    const q=document.getElementById('fg-search')?.value.trim()||'';
    const filter=state.fgFilter==='all'?'':state.fgFilter;
    let url='/forgemagie';
    const params=[];
    if(q) params.push(`q=${encodeURIComponent(q)}`);
    if(filter) params.push(`statut=${filter}`);
    if(params.length) url+='?'+params.join('&');

    const [forges,stats]=await Promise.all([
      api('GET',url),
      api('GET','/forgemagie/stats'),
    ]);
    if(!forges) return;

    // Résumé stats
    renderForgeSummary(stats);
    renderForgeRanking(stats);
    renderForgeChart(stats);

    container.innerHTML='';
    if(!forges.length){container.innerHTML='<p class="empty-msg">Aucune entrée trouvée.</p>';return;}

    forges.forEach(f=>{
      const b=f.benefice||0, m=f.marge||0;
      const cls=b>0?'gain':b<0?'perte':'neutre';
      const bColor=b>0?'var(--teal)':b<0?'var(--red)':'var(--gold)';
      const d=new Date(f.date);
      const runesHtml=(f.runes||[]).map(r=>
        `<span class="forge-rune-pill">${runeIcon(r.nom)} ${escHtml(r.nom)} ×${r.quantite} @ ${fmtK(r.prixUnitaire)}</span>`
      ).join('');

      const el=document.createElement('div');
      el.className=`forge-item ${cls}`;
      el.innerHTML=`
        <div>
          <div class="forge-title">
            ${escHtml(f.itemNom)}
            <span class="forge-type">${escHtml(f.itemType||'')}</span>
          </div>
          <div class="forge-meta">
            <span>📅 ${d.toLocaleDateString('fr-FR')}</span>
            <span>💸 Achat : ${fmtK(f.prixAchat)}</span>
            <span>🔨 Craft : ${fmtK(f.coutCraft)}</span>
            <span>📦 Coût total : ${fmtK(f.coutTotal)}</span>
            <span>🏷 Vendu : ${fmtK(f.prixVente)}</span>
            <span>${f.tentativeStatut==='succes' ? '✅ Succès' : f.tentativeStatut==='echec' ? '❌ Échec' : '➖ Résultat inconnu'}${f.exo ? ' · Exo' : ''}</span>
          </div>
          ${runesHtml?`<div class="forge-runes">${runesHtml}</div>`:''}
          ${f.notes?`<div class="forge-notes">📝 ${escHtml(f.notes)}</div>`:''}
        </div>
        <div class="forge-result">
          <div class="forge-benefice ${cls}" style="color:${bColor}">${fmtK(b)}</div>
          <div class="forge-marge">${m}%</div>
        </div>
        <div class="forge-actions">
          <button class="btn-forge-edit" data-id="${escHtml(f.id)}">✏️ Éditer</button>
          <button class="btn-forge-del"  data-id="${escHtml(f.id)}">🗑 Suppr.</button>
        </div>`;
      container.appendChild(el);
    });

    // Boutons édition
    container.querySelectorAll('.btn-forge-edit').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const f=forges.find(x=>x.id===btn.dataset.id);
        if(!f)return;
        document.getElementById('modal-forge-id').value=f.id;
        document.getElementById('modal-forge-item').value=f.itemNom;
        document.getElementById('modal-forge-achat').value=f.prixAchat;
        document.getElementById('modal-forge-craft').value=f.coutCraft;
        document.getElementById('modal-forge-vente').value=f.prixVente;
        document.getElementById('modal-forge-result').value=f.tentativeStatut||'inconnu';
        document.getElementById('modal-forge-exo').checked=!!f.exo;
        document.getElementById('modal-forge-notes').value=f.notes||'';
        state.fgEditRunes=JSON.parse(JSON.stringify(f.runes||[]));
        await renderFgRunes('modal-forge-runes', state.fgEditRunes, null);
        document.getElementById('modal-forge-overlay').classList.remove('hidden');
      });
    });

    // Boutons suppression
    container.querySelectorAll('.btn-forge-del').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        if(!confirm('Supprimer cette entrée ?'))return;
        try{ await api('DELETE',`/forgemagie/${btn.dataset.id}`); await renderForgeList(); toast('Entrée supprimée.'); }
        catch(err){toast(err.message,'error');}
      });
    });

  }catch(err){ container.innerHTML=`<p class="empty-msg" style="color:var(--red)">Erreur : ${escHtml(err.message)}</p>`; }
}

function renderForgeSummary(stats) {
  const c=document.getElementById('forge-summary');
  if(!c||!stats)return;
  c.innerHTML=`
    <div class="forge-sum-card gold">
      <div class="forge-sum-lbl">Entrées totales</div>
      <div class="forge-sum-val">${stats.total}</div>
    </div>
    <div class="forge-sum-card pos">
      <div class="forge-sum-lbl">Bénéfices</div>
      <div class="forge-sum-val">${stats.benefices}</div>
    </div>
    <div class="forge-sum-card neg">
      <div class="forge-sum-lbl">Pertes</div>
      <div class="forge-sum-val">${stats.pertes}</div>
    </div>
    <div class="forge-sum-card ${stats.totalBenefice>=0?'pos':'neg'}">
      <div class="forge-sum-lbl">Bénéfice total</div>
      <div class="forge-sum-val">${fmtK(stats.totalBenefice)}</div>
    </div>
    <div class="forge-sum-card gold">
      <div class="forge-sum-lbl">Total investi</div>
      <div class="forge-sum-val">${fmtK(stats.totalInvesti)}</div>
    </div>
    <div class="forge-sum-card ${stats.margeGlobale>=0?'pos':'neg'}">
      <div class="forge-sum-lbl">Marge globale</div>
      <div class="forge-sum-val">${stats.margeGlobale}%</div>
    </div>
    <div class="forge-sum-card gold">
      <div class="forge-sum-lbl">Coût moyen d’un exo</div>
      <div class="forge-sum-val">${stats.coutMoyenExo === null ? '—' : fmtK(stats.coutMoyenExo)}</div>
    </div>
    <div class="forge-sum-card ${stats.exoSuccesses ? 'pos' : 'gold'}">
      <div class="forge-sum-lbl">Exos réussis</div>
      <div class="forge-sum-val">${stats.exoSuccesses || 0} / ${stats.exoAttempts || 0}</div>
    </div>
    <div class="forge-sum-card gold">
      <div class="forge-sum-lbl">Item le + rentable</div>
      <div class="forge-sum-val" style="font-size:.82rem">${stats.byItem?.[0] ? escHtml(stats.byItem[0].itemNom) + ' · ' + fmtK(stats.byItem[0].totalBenefice) : '—'}</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// CLASSEMENT DE RENTABILITÉ PAR ITEM (FM)
// ══════════════════════════════════════════════════════════════
function renderForgeRanking(stats) {
  const el = document.getElementById('forge-ranking');
  if (!el) return;
  const items = (stats.byItem || []).filter(i => i.attempts > 0);
  if (!items.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée pour l’instant.</p>'; return; }

  // Déjà trié par bénéfice total décroissant côté serveur.
  el.innerHTML = items.map((i, idx) => {
    const cls = i.totalBenefice > 0 ? 'pos' : i.totalBenefice < 0 ? 'neg' : '';
    return `
      <div class="forge-rank-row">
        <span class="forge-rank-pos">${idx + 1}</span>
        <span class="forge-rank-name">${escHtml(i.itemNom)}</span>
        <span class="forge-rank-meta">${i.attempts} essai${i.attempts > 1 ? 's' : ''}${i.tauxReussite !== null ? ' · ' + i.tauxReussite + '% réussite' : ''}</span>
        <span class="forge-rank-val ${cls}">${fmtK(i.totalBenefice)}</span>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// GRAPHIQUE : ÉVOLUTION DU BÉNÉFICE FM (par jour)
// ══════════════════════════════════════════════════════════════
function renderForgeChart(stats) {
  const canvas = document.getElementById('chart-forge');
  if (!canvas) return;
  _forgeChartStats = stats;
  const ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth, H = 180;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const data = stats.history || [];
  if (!data.length) {
    ctx.fillStyle = '#4a4a6a'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('Aucune donnée', W / 2, H / 2);
    return;
  }

  const pL = 56, pR = 16, pT = 16, pB = 28, cW = W - pL - pR, cH = H - pT - pB;
  const maxAbs = Math.max(...data.map(d => Math.abs(d.benefice)), 1);
  const zeroY = pT + cH / 2;
  const slot = cW / data.length;
  const bW = Math.min(32, Math.max(4, slot - 4));
  const labelEvery = data.length > 10 ? Math.ceil(data.length / 8) : 1;

  // Ligne zéro
  ctx.strokeStyle = '#2a2f52'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pL, zeroY); ctx.lineTo(W - pR, zeroY); ctx.stroke();
  ctx.fillStyle = '#7a7aa0'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'right';
  ctx.fillText(fmtK(maxAbs), pL - 4, pT + 8);
  ctx.fillText('0', pL - 4, zeroY + 4);
  ctx.fillText('-' + fmtK(maxAbs), pL - 4, pT + cH - 2);

  data.forEach((d, idx) => {
    const h = (Math.abs(d.benefice) / maxAbs) * (cH / 2);
    const x = pL + slot * idx + (slot - bW) / 2;
    const y = d.benefice >= 0 ? zeroY - h : zeroY;
    ctx.fillStyle = d.benefice >= 0 ? '#3ddbbd' : '#ff5555';
    ctx.fillRect(x, y, bW, Math.max(1, h));

    if (idx % labelEvery === 0 || idx === data.length - 1) {
      const dd = new Date(d.date);
      ctx.fillStyle = '#7a7aa0'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(`${String(dd.getDate()).padStart(2, '0')}/${String(dd.getMonth() + 1).padStart(2, '0')}`, x + bW / 2, pT + cH + 14);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// ONGLET PRIX
// ══════════════════════════════════════════════════════════════
async function renderPricesTab() {
  const prices = await loadPrices(true);
  document.getElementById('price-dream').value  = prices.dreamPtPrice || 0;
  document.getElementById('price-oniric').value = prices.oniricPrice  || 0;

  // ── Helper : construit une grille de prix ──────────────────
  function buildPriceGrid(containerId, items, collectionKey) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    (items || []).forEach((r, idx) => {
      const d = document.createElement('div');
      d.className = 'price-item';
      d.innerHTML = `
        <span class="price-item-name">${['forgemagie-types', 'astrale-types', 'transcendance-types'].includes(collectionKey) ? runeIcon(r.name) : ''}${escHtml(r.name)}</span>
        <div class="input-wrap">
          <input type="number" min="0"
            class="price-input-field"
            data-collection="${collectionKey}"
            data-idx="${idx}"
            value="${r.price || 0}" />
          <span class="unit" style="position:static;margin-left:.25rem">k</span>
        </div>
        <button class="btn-remove-type"
          data-collection="${collectionKey}"
          data-name="${escHtml(r.name)}"
          title="Supprimer">✕</button>`;
      c.appendChild(d);
    });
  }

  // Runes de forgemagie
  buildPriceGrid('rune-forgemagie-list', prices.runesForgemagie, 'forgemagie-types');
  // Runes astrales (songe)
  buildPriceGrid('rune-astrale-list',    prices.runesAstrales,   'astrale-types');
  buildPriceGrid('rune-transcendance-list', prices.runesTranscendance, 'transcendance-types');
  // Légendes (ressources drop)
  buildPriceGrid('legende-songe-prices-list',  prices.legendesSonge,  'legende-songe-types');

  // Boutons suppression
  document.querySelectorAll('.btn-remove-type').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ep = `/prices/${btn.dataset.collection}/${encodeURIComponent(btn.dataset.name)}`;
      try {
        await api('DELETE', ep);
        invalidatePrices();
        await renderPricesTab();
      } catch(err) { toast(err.message, 'error'); }
    });
  });
}

function initPricesTab() {
  document.getElementById('btn-save-prices')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-prices');
    btn.disabled = true; btn.textContent = '⏳ Sauvegarde...';

    const prices = await loadPrices();

    // Mise à jour depuis les inputs
    prices.dreamPtPrice = parseInt(document.getElementById('price-dream')?.value)  || 0;
    prices.oniricPrice  = parseInt(document.getElementById('price-oniric')?.value) || 0;

    document.querySelectorAll('.price-input-field').forEach(inp => {
      const col = inp.dataset.collection;
      const idx = parseInt(inp.dataset.idx);
      const val = parseInt(inp.value) || 0;
      const map = {
        'forgemagie-types'    : 'runesForgemagie',
        'astrale-types'       : 'runesAstrales',
        'transcendance-types' : 'runesTranscendance',
        'legende-songe-types' : 'legendesSonge',
      };
      const key = map[col];
      if (key && prices[key]?.[idx]) prices[key][idx].price = val;
    });

    try {
      await api('PUT', '/prices', prices);
      invalidatePrices();
      await updatePreview();
      await updateHeaderStats();
      toast('💾 Prix sauvegardés !');
    } catch(err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '💾 Sauvegarder les prix'; }
  });

  // Boutons "Ajouter" par section
  document.getElementById('btn-add-rune-forgemagie')?.addEventListener('click', () => openNewTypeModal('forgemagie'));
  document.getElementById('btn-add-rune-astrale')?.addEventListener('click',    () => openNewTypeModal('astrale'));
  document.getElementById('btn-add-rune-transcendance')?.addEventListener('click', () => openNewTypeModal('transcendance'));
  document.getElementById('btn-add-legende-songe-type')?.addEventListener('click',  () => openNewTypeModal('legende-songe'));
}

// ══════════════════════════════════════════════════════════════
// ONGLET PANOPLIES (créateur de stuff via API DofusDude)
// ══════════════════════════════════════════════════════════════

function panoKey(slot, idx) { return `${slot}:${idx}`; }

// ══════════════════════════════════════════════════════════════
// INFO-BULLE D'ITEM (survol → stats au max)
// ══════════════════════════════════════════════════════════════
const _itemDetailCache = {}; // { "path:id": detail }

async function fetchItemDetail(id, path) {
  const key = `${path || 'equipment'}:${id}`;
  if (_itemDetailCache[key]) return _itemDetailCache[key];
  const detail = await api('GET', `/dofusdb/item/${id}?path=${encodeURIComponent(path || 'equipment')}`);
  if (detail) _itemDetailCache[key] = detail;
  return detail;
}

function ensureItemTooltip() {
  let tip = document.getElementById('item-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'item-tooltip';
    tip.className = 'item-tooltip hidden';
    document.body.appendChild(tip);
  }
  return tip;
}

// Construit le HTML de l'info-bulle à partir d'un item (avec effects)
function buildTooltipHtml(item) {
  const effs = (item.effects || []).filter(e => e.name);
  const lines = effs.length
    ? effs.map(e => {
        const val = (e.max && e.max !== 0) ? e.max : e.min;
        return `<div class="tip-line"><span><span class="stat-ico">${statIcon(e.name)}</span>${escHtml(e.name)}</span><span class="tip-val">${val > 0 ? '+' : ''}${val}</span></div>`;
      }).join('')
    : '<div class="tip-empty">Pas de caractéristiques.</div>';
  const setLine = item.setName
    ? `<div class="tip-set">🔗 ${escHtml(item.setName)}</div>` : '';
  // Section Forgemagie (exos ajoutés à l'item)
  const fm = (item.fm || []).filter(f => f.name);
  const fmHtml = fm.length
    ? `<div class="tip-fm"><div class="tip-fm-title">⚒️ Forgemagie</div>`
      + fm.map(f => `<div class="tip-line"><span><span class="stat-ico">${statIcon(f.name)}</span>${escHtml(f.name)}</span><span class="tip-val">${f.val > 0 ? '+' : ''}${f.val}</span></div>`).join('')
      + `</div>`
    : '';
  return `
    <div class="tip-head">
      <img src="${escHtml(item.image)}" alt=""/>
      <div>
        <div class="tip-name">${escHtml(item.name)}</div>
        <div class="tip-meta">${escHtml(item.type || '')} · Niv. ${item.level || 0}</div>
      </div>
    </div>
    <div class="tip-effects">${lines}</div>
    ${fmHtml}
    ${setLine}`;
}

function positionTooltip(tip, evt) {
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > window.innerWidth - 8)  x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

/**
 * Attache une info-bulle "stats au max" à un élément.
 * @param el        élément survolé
 * @param baseItem  { id, name, type, level, image, path, effects? }
 *                  Si effects absents, ils sont chargés au 1er survol.
 */
function attachItemTooltip(el, baseItem) {
  const tip = ensureItemTooltip();
  let hovering = false;

  el.addEventListener('mouseenter', async (e) => {
    hovering = true;
    // Si on a déjà les effets, affichage immédiat ; sinon on charge.
    let data = baseItem;
    if (!Array.isArray(baseItem.effects)) {
      tip.innerHTML = `<div class="tip-loading">⏳ ${escHtml(baseItem.name || '')}</div>`;
      tip.classList.remove('hidden');
      positionTooltip(tip, e);
      try {
        const detail = await fetchItemDetail(baseItem.id, baseItem.path);
        if (detail) { detail.effects = detail.effects || []; data = detail; baseItem.effects = detail.effects; }
      } catch { /* on affiche quand même le peu qu'on a */ }
      if (!hovering) return; // souris déjà partie
    }
    tip.innerHTML = buildTooltipHtml(data);
    tip.classList.remove('hidden');
    positionTooltip(tip, e);
  });
  el.addEventListener('mousemove', (e) => { if (hovering) positionTooltip(tip, e); });
  el.addEventListener('mouseleave', () => { hovering = false; tip.classList.add('hidden'); });
}

/**
 * Crée le modal de recherche d'item s'il n'existe pas déjà dans le DOM.
 * Sécurité : garantit que le clic sur un slot fonctionne même si le
 * app.html n'a pas été mis à jour avec le modal.
 */
function ensureItemModal() {
  const existing = document.getElementById('modal-item-overlay');
  // Si un modal existe déjà MAIS sans la nouvelle structure (onglets +
  // grille "Parcourir"), on le supprime pour le recréer proprement.
  // Évite le crash "Cannot set innerHTML of null" quand un ancien modal
  // (version précédente en cache) traîne dans le DOM.
  if (existing) {
    if (existing.querySelector('#modal-item-browse') &&
        existing.querySelector('.pano-modal-tabs')) {
      return; // structure à jour, rien à faire
    }
    existing.remove();
  }
  const div = document.createElement('div');
  div.id = 'modal-item-overlay';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal" style="max-width:620px">
      <h3 id="modal-item-title">Chercher un équipement</h3>

      <div class="pano-modal-tabs">
        <button class="pano-modal-tab active" data-mtab="search" id="mtab-search">🔍 Recherche</button>
        <button class="pano-modal-tab" data-mtab="browse" id="mtab-browse">📜 Parcourir</button>
      </div>

      <!-- Onglet Recherche -->
      <div id="mpane-search" class="pano-modal-pane active">
        <div class="form-group">
          <input type="text" id="modal-item-search" placeholder="Tape le nom d'un item (min. 2 lettres)..." autocomplete="off"/>
        </div>
        <div id="modal-item-results" class="pano-search-results">
          <p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Commence à taper pour chercher.</p>
        </div>
      </div>

      <!-- Onglet Parcourir (grille d'items du slot) -->
      <div id="mpane-browse" class="pano-modal-pane">
        <div id="modal-browse-subtypes" class="pano-subtype-bar"></div>
        <div class="pano-browse-filter">
          <label>Filtrer par stats&nbsp;:</label>
          <select id="modal-browse-stat">
            <option value="">+ Ajouter une stat</option>
          </select>
        </div>
        <div id="modal-browse-stat-chips" class="pano-stat-chips"></div>
        <div id="modal-item-browse" class="pano-browse-grid">
          <p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Chargement...</p>
        </div>
        <div class="pano-browse-more">
          <button class="btn-secondary" id="modal-browse-more" style="display:none">Charger plus</button>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" id="modal-item-cancel">Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(div);

  // Brancher les listeners internes du modal ICI, pour qu'ils soient
  // (re)posés à chaque (re)création du modal.
  let deb;
  const searchInput = div.querySelector('#modal-item-search');
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(deb);
    deb = setTimeout(() => searchItems(e.target.value.trim()), 350);
  });
  div.querySelectorAll('.pano-modal-tab').forEach(btn => {
    btn.addEventListener('click', () => switchItemModalTab(btn.dataset.mtab));
  });
  div.querySelector('#modal-browse-more')?.addEventListener('click', () => {
    state.panoBrowse.page += 1;
    browseItems(false);
  });
  div.querySelector('#modal-item-cancel')?.addEventListener('click', closeItemSearch);
  div.addEventListener('click', (e) => {
    if (e.target === div) closeItemSearch();
  });

  // Sélecteur de stats (onglet Parcourir) — multi-stats via chips
  const statSel = div.querySelector('#modal-browse-stat');
  if (statSel) {
    statSel.innerHTML = '<option value="">+ Ajouter une stat</option>' +
      BROWSE_STATS.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    statSel.addEventListener('change', () => {
      const v = statSel.value;
      statSel.value = '';
      if (!v) return;
      state.panoBrowse.stats = state.panoBrowse.stats || [];
      if (!state.panoBrowse.stats.includes(v)) state.panoBrowse.stats.push(v);
      state.panoBrowse.page = 1;
      renderStatChips();
      browseItems(true);
    });
  }
}

// Sous-types proposés pour affiner la recherche des slots multi-types.
// value = typeId envoyé à l'API (identifiant anglais), label = affichage FR.
const SLOT_SUBTYPES = {
  dofus: [
    { value: '',             label: 'Tout' },
    { value: 'dofus',        label: 'Dofus' },
    { value: 'trophy',       label: 'Trophée' },
    { value: 'prysmaradite', label: 'Prysmaradite' },
  ],
  familier: [
    { value: '',           label: 'Tout' },
    { value: 'pet',        label: 'Familier' },
    { value: 'petsmount',  label: 'Montilier' },
    { value: 'dragoturkey',label: 'Dragodinde' },
    { value: 'seemyool',   label: 'Muldo' },
    { value: 'rhineetle',  label: 'Volkorne' },
  ],
  arme: [
    { value: '',            label: 'Tout' },
    { value: 'sword',       label: 'Épée' },
    { value: 'axe',         label: 'Hache' },
    { value: 'staff',       label: 'Bâton' },
    { value: 'bow',         label: 'Arc' },
    { value: 'dagger',      label: 'Dague' },
    { value: 'hammer',      label: 'Marteau' },
    { value: 'wand',        label: 'Baguette' },
    { value: 'scythe',      label: 'Faux' },
    { value: 'shovel',      label: 'Pelle' },
    { value: 'pickaxe',     label: 'Pioche' },
    { value: 'lance',       label: 'Lance' },
    { value: 'magic-weapon',label: 'Arme magique' },
  ],
};

// Affiche la barre de sous-types pour le slot courant (si multi-types)
function renderSubtypeBar() {
  const bar = document.getElementById('modal-browse-subtypes');
  if (!bar) return;
  const slot = state.panoBrowse.slot;
  const subs = SLOT_SUBTYPES[slot];
  if (!subs) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const cur = state.panoBrowse.typeId || '';
  bar.innerHTML = subs.map(s =>
    `<button class="pano-subtype-btn ${s.value === cur ? 'active' : ''}" data-typeid="${escHtml(s.value)}">${escHtml(s.label)}</button>`
  ).join('');
  bar.querySelectorAll('.pano-subtype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.panoBrowse.typeId = btn.dataset.typeid;
      state.panoBrowse.page = 1;
      renderSubtypeBar();
      browseItems(true);
    });
  });
}

// Affiche les stats sélectionnées sous forme de puces (avec retrait)
function renderStatChips() {
  const wrap = document.getElementById('modal-browse-stat-chips');
  if (!wrap) return;
  const stats = state.panoBrowse.stats || [];
  if (!stats.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = stats.map((s, i) =>
    `<span class="pano-stat-chip"><span class="stat-ico">${statIcon(s)}</span>${escHtml(s)}`
    + `<button class="pano-stat-chip-x" data-i="${i}" title="Retirer">✕</button></span>`
  ).join('');
  wrap.querySelectorAll('.pano-stat-chip-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i, 10);
      state.panoBrowse.stats.splice(i, 1);
      state.panoBrowse.page = 1;
      renderStatChips();
      browseItems(true);
    });
  });
}

// Stats filtrables dans l'onglet Parcourir (noms tels que renvoyés par l'API)
const BROWSE_STATS = [
  'Vitalité', 'Sagesse', 'PA', 'PM', 'Portée', 'Initiative',
  'Force', 'Intelligence', 'Chance', 'Agilité',
  'Puissance', '% Critique', 'Invocation', 'Prospection', 'Soin', 'Pods',
  'Dommage Neutre', 'Dommage Terre', 'Dommage Eau', 'Dommage Feu', 'Dommage Air',
  'Résistance Neutre', 'Résistance Terre', 'Résistance Eau', 'Résistance Feu', 'Résistance Air',
  'Fuite', 'Tacle', 'Retrait PA', 'Retrait PM', 'Esquive PA', 'Esquive PM',
];

// Icônes (emoji) associées aux caractéristiques, avec correspondance par
// ══════════════════════════════════════════════════════════════
// ICÔNES DE STATS — SVG intégrés (style Dofus, sans dépendance externe)
// Couleurs par élément : Terre/Force=marron, Feu/Intelligence=rouge,
// Eau/Chance=bleu, Air/Agilité=vert. + PA=bleu, PM=vert, Vita=cœur, etc.
// ══════════════════════════════════════════════════════════════
const STAT_COLORS = {
  terre:'#c98a3b', feu:'#e05a3a', eau:'#3b9ce0', air:'#5fbf5f',
  neutre:'#c9c4b0', vita:'#e0503a', sagesse:'#b06fe0', pa:'#3b7ce0',
  pm:'#4caf50', portee:'#d8b24a', ini:'#e0c23a', crit:'#e0b23a',
  soin:'#5fbf7f', pods:'#b9a06a', prospe:'#e0b83a', invo:'#8a7fd8',
  domm:'#e0503a', resist:'#8a93b8', dodge:'#3b7ce0', misc:'#9d6fff',
};
// Éclaircit une couleur hex (pour l'effet dégradé "verre" des icônes)
function _lighten(hex, amt) {
  const h = hex.replace('#', '');
  const r = Math.min(255, parseInt(h.slice(0,2),16) + amt);
  const g = Math.min(255, parseInt(h.slice(2,4),16) + amt);
  const b = Math.min(255, parseInt(h.slice(4,6),16) + amt);
  return `rgb(${r},${g},${b})`;
}

// Formes SVG (chemins dans un viewBox 0..20) inspirées des icônes du jeu
const _SHAPES = {
  heart:  'M10 17.5 C2 12 3 5.5 7 5.5 C9 5.5 10 7 10 7 C10 7 11 5.5 13 5.5 C17 5.5 18 12 10 17.5 Z',
  star:   'M10 2 L12.2 7.3 L18 7.8 L13.6 11.5 L15 17.2 L10 14 L5 17.2 L6.4 11.5 L2 7.8 L7.8 7.3 Z',
  diamond:'M10 1.5 L18.5 10 L10 18.5 L1.5 10 Z',
  drop:   'M10 2 C10 2 4.5 9 4.5 12.5 A5.5 5.5 0 0 0 15.5 12.5 C15.5 9 10 2 10 2 Z',
  leaf:   'M4 16 C4 8 10 3 16 3 C16 11 10 16 4 16 Z',
  moon:   'M14 3 A8 8 0 1 0 14 17 A6 6 0 1 1 14 3 Z',
  bolt:   'M11 1.5 L4 11 H9 L8 18.5 L16 8 H10.5 Z',
  shield: 'M10 1.5 L17.5 4 V10 Q17.5 16 10 18.5 Q2.5 16 2.5 10 V4 Z',
  eye:    'M10 6 C4 6 1.5 10 1.5 10 C1.5 10 4 14 10 14 C16 14 18.5 10 18.5 10 C18.5 10 16 6 10 6 Z',
  circle: 'M10 1 A9 9 0 1 1 9.99 1 Z',
};

/**
 * Icône de stat en SVG, dessinée avec une vraie forme (style Dofus).
 * @param color  couleur principale
 * @param shape  clé de _SHAPES (heart, star, diamond, drop, leaf, moon, bolt, shield, eye, circle)
 * @param glyph  petit symbole/texte optionnel au centre (ex: '%', '+', 'PA')
 * @param inner  détail SVG interne optionnel (ex: pupille de l'œil)
 */
function svgStat(color, shape, glyph, inner) {
  const gid = 'g' + Math.random().toString(36).slice(2, 8);
  const grad = `<defs><radialGradient id="${gid}" cx="36%" cy="28%" r="80%">`
    + `<stop offset="0%" stop-color="${_lighten(color, 70)}"/>`
    + `<stop offset="100%" stop-color="${color}"/></radialGradient></defs>`;
  const path = _SHAPES[shape] || _SHAPES.circle;
  const body = `<path d="${path}" fill="url(#${gid})" stroke="rgba(0,0,0,.4)" stroke-width="1" stroke-linejoin="round"/>`;
  let txt = '';
  if (glyph) {
    const len = String(glyph).length;
    const fs = len >= 2 ? 7 : 10;
    txt = `<text x="10" y="${len >= 2 ? 13 : 13.5}" text-anchor="middle" font-size="${fs}" `
        + `font-weight="800" fill="#fff" stroke="rgba(0,0,0,.3)" stroke-width=".3" paint-order="stroke">${glyph}</text>`;
  }
  return `<svg viewBox="0 0 20 20" class="stat-svg" aria-hidden="true">${grad}${body}${inner || ''}${txt}</svg>`;
}

// Table stat → [couleur, forme, glyphe?] — calquée sur les icônes du jeu
const STAT_GLYPH = {
  'vitalité':      [STAT_COLORS.vita,    'heart'],
  'sagesse':       [STAT_COLORS.sagesse, 'moon'],
  'pa':            [STAT_COLORS.pa,      'star'],
  'pm':            [STAT_COLORS.pm,      'diamond'],
  'portée':        [STAT_COLORS.portee,  'eye'],
  'initiative':    [STAT_COLORS.ini,     'circle', 'i'],
  'puissance':     [STAT_COLORS.ini,     'bolt'],
  '% critique':    [STAT_COLORS.crit,    'circle', '!'],
  'critique':      [STAT_COLORS.crit,    'circle', '!'],
  'coups critiques':[STAT_COLORS.crit,   'circle', '!'],
  'invocation':    [STAT_COLORS.invo,    'circle', '&'],
  'invocations':   [STAT_COLORS.invo,    'circle', '&'],
  'prospection':   [STAT_COLORS.prospe,  'circle', 'PP'],
  'soin':          [STAT_COLORS.soin,    'circle', '+'],
  'soins':         [STAT_COLORS.soin,    'circle', '+'],
  'pods':          [STAT_COLORS.pods,    'circle', '◇'],
  'tacle':         [STAT_COLORS.terre,   'circle', 'T'],
  'fuite':         [STAT_COLORS.air,     'circle', 'F'],
  'retrait pa':    [STAT_COLORS.pa,      'star',   '−'],
  'retrait pm':    [STAT_COLORS.pm,      'diamond','−'],
  'esquive pa':    [STAT_COLORS.pa,      'star',   '↯'],
  'esquive pm':    [STAT_COLORS.pm,      'diamond','↯'],
};
// Caractéristiques primaires liées à un élément → forme dédiée + couleur
const PRIMARY_ELEM = {
  'force':        [STAT_COLORS.terre, 'leaf'],   // Terre
  'intelligence': [STAT_COLORS.feu,   'drop'],   // Feu (goutte inversée = flamme stylisée)
  'chance':       [STAT_COLORS.eau,   'drop'],   // Eau
  'agilité':      [STAT_COLORS.air,   'leaf'],   // Air (plume)
};

// ── Correspondance stat → nom de fichier PNG (dans public/image/stats/) ──
// Si le fichier existe, on affiche l'icône OFFICIELLE ; sinon fallback SVG.
function statIconFile(n) {
  const map = {
    'vitalité':'vitalite', 'sagesse':'sagesse', 'pa':'pa', 'pm':'pm',
    'portée':'portee', 'initiative':'initiative',
    'force':'force', 'intelligence':'intelligence', 'chance':'chance', 'agilité':'agilite',
    'puissance':'puissance', '% critique':'critique', 'critique':'critique', 'coups critiques':'critique',
    'invocation':'invocation', 'invocations':'invocation',
    'prospection':'prospection', 'soin':'soin', 'soins':'soin', 'pods':'pods',
    'tacle':'tacle', 'fuite':'fuite',
    'retrait pa':'retrait-pa', 'retrait pm':'retrait-pm',
    'esquive pa':'esquive-pa', 'esquive pm':'esquive-pm',
  };
  if (map[n]) return map[n];
  // Dommages / résistances par élément
  const el = n.includes('feu') ? 'feu' : n.includes('terre') ? 'terre'
    : n.includes('eau') ? 'eau' : n.includes('air') ? 'air'
    : n.includes('neutre') ? 'neutre' : null;
  if (n.includes('dommage')) return el ? `dommage-${el}` : null;
  if (n.includes('résistance') || n.includes('resistance')) return el ? `resistance-${el}` : null;
  return null;
}

/**
 * Icône d'une stat. Essaie d'abord le PNG officiel (image/stats/<fichier>.png) ;
 * si le fichier n'existe pas, bascule automatiquement sur l'icône SVG intégrée.
 * L'attribut onerror est autorisé par la CSP (scriptSrc 'unsafe-inline').
 */
function statIcon(name) {
  const n = String(name || '').toLowerCase().trim();
  const file = statIconFile(n);
  const svg = statIconSvg(name);
  if (!file) return svg;
  // Fallback : si l'image 404, on la remplace par le SVG (encodé pour l'attribut).
  const svgAttr = svg.replace(/"/g, '&quot;');
  return `<img src="image/stats/${file}.png" alt="" class="stat-img"`
    + ` onerror="this.outerHTML='${svgAttr.replace(/'/g, "\\'")}'"/>`;
}

// Couleur + forme par élément (Neutre/Terre/Feu/Eau/Air)
function _elemStyle(n) {
  if (n.includes('feu'))    return [STAT_COLORS.feu,    'drop'];
  if (n.includes('terre'))  return [STAT_COLORS.terre,  'leaf'];
  if (n.includes('eau'))    return [STAT_COLORS.eau,    'drop'];
  if (n.includes('air'))    return [STAT_COLORS.air,    'leaf'];
  if (n.includes('neutre')) return [STAT_COLORS.neutre, 'circle'];
  return null;
}

// Renvoie le HTML SVG de l'icône d'une caractéristique (fallback / défaut)
function statIconSvg(name) {
  const n = String(name || '').toLowerCase().trim();
  if (PRIMARY_ELEM[n]) return svgStat(PRIMARY_ELEM[n][0], PRIMARY_ELEM[n][1]);
  if (STAT_GLYPH[n]) {
    const g = STAT_GLYPH[n];
    // Pupille pour l'œil (Portée)
    const inner = g[1] === 'eye'
      ? '<circle cx="10" cy="10" r="2.6" fill="#12152a"/><circle cx="9.2" cy="9.2" r="0.9" fill="#fff" opacity=".8"/>'
      : '';
    return svgStat(g[0], g[1], g[2], inner);
  }

  const elem = _elemStyle(n);

  // Dommages par élément → écusson coloré avec une épée
  if (n.includes('dommage')) {
    const c = elem ? elem[0] : STAT_COLORS.domm;
    return svgStat(c, 'shield', '⚔');
  }
  // Résistances par élément → écusson (bouclier) coloré
  if (n.includes('résistance') || n.includes('resistance')) {
    const c = elem ? elem[0] : STAT_COLORS.resist;
    return svgStat(c, 'shield');
  }
  // Élément seul → forme dédiée
  if (elem) return svgStat(elem[0], elem[1]);
  if (n.includes('soin'))   return svgStat(STAT_COLORS.soin, 'circle', '+');
  if (n.includes('critique')) return svgStat(STAT_COLORS.crit, 'circle', '!');
  return svgStat(STAT_COLORS.misc, 'circle', '✦');
}

let _panoDelegated = false;
function initPano() {
  loadPanoDraft();
  ensureItemModal();
  // Clic sur un emplacement → ouvrir la recherche.
  // Délégation globale (robuste) : fonctionne même si les slots sont
  // recréés et quelle que soit l'ordre d'initialisation.
  if (!_panoDelegated) {
    _panoDelegated = true;
    document.addEventListener('click', (e) => {
      // Ne pas déclencher sur le bouton "retirer"
      if (e.target.closest('.pano-remove')) return;
      const slotEl = e.target.closest('.pano-slot');
      if (!slotEl) return;
      openItemSearch(slotEl.dataset.slot, slotEl.dataset.idx);
    });
  }

  // (Les listeners internes du modal — recherche, onglets, "charger plus",
  //  fermeture — sont posés dans ensureItemModal() à chaque création.)

  // Choix de la classe via les pastilles en haut (plus de menu déroulant)
  ensureClassStrip();
  renderPanoClass();

  // Score local et configurable : les pondérations restent propres à l'utilisateur.
  try {
    const saved = JSON.parse(localStorage.getItem('st_pano_score_weights'));
    if (saved && typeof saved === 'object') Object.assign(state.panoScoreWeights, saved);
  } catch {}
  const scoreInputs = {
    damage: document.getElementById('score-damage'), resist: document.getElementById('score-resist'),
    initiative: document.getElementById('score-initiative'), prospecting: document.getElementById('score-prospecting'),
    apmpo: document.getElementById('score-apmpo'), vitality: document.getElementById('score-vitality'),
  };
  Object.entries(scoreInputs).forEach(([key, input]) => {
    if (!input) return;
    input.value = state.panoScoreWeights[key];
    input.addEventListener('input', () => {
      state.panoScoreWeights[key] = Math.max(0, Number(input.value) || 0);
      localStorage.setItem('st_pano_score_weights', JSON.stringify(state.panoScoreWeights));
      renderPanoStats();
    });
  });

  // Onglets du panneau de droite : Stats / Panoplies / Forgemagie
  document.querySelectorAll('.pano-stats-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.stab;
      document.querySelectorAll('.pano-stats-tab').forEach(b =>
        b.classList.toggle('active', b === btn));
      document.getElementById('pano-stats-list')?.classList.toggle('active', t === 'stats');
      document.getElementById('pano-set-bonus')?.classList.toggle('active', t === 'sets');
      document.getElementById('pano-fm-pane')?.classList.toggle('active', t === 'fm');
      if (t === 'fm') renderFmPane();
    });
  });

  // Niveau → recalcule le total (le niveau n'affecte pas les stats fixes ici,
  // mais on le garde pour usage futur / affichage)
  document.getElementById('pano-level')?.addEventListener('input', renderPanoStats);

  // Vider la panoplie
  document.getElementById('btn-pano-reset')?.addEventListener('click', () => {
    if (!confirm('Vider toute la panoplie ?')) return;
    state.panoItems = {};
    state.panoGlobalFm = [];
    persistPanoDraft();
    renderPano();
  });

  // Boutons : recherche de panoplies, sauvegarde, comparaison, communauté
  document.getElementById('btn-pano-sets')?.addEventListener('click', openSetSearch);
  document.getElementById('btn-pano-save')?.addEventListener('click', openSaveBuildModal);
  document.getElementById('btn-pano-compare')?.addEventListener('click', openCompare);
  document.getElementById('btn-pano-community')?.addEventListener('click', openCommunityModal);
  initSaveBuildModal();
  initCommunityModal();

  // Recherche live de panoplies (debounce)
  let setDeb;
  document.getElementById('modal-set-search')?.addEventListener('input', (e) => {
    clearTimeout(setDeb);
    setDeb = setTimeout(() => searchSets(e.target.value.trim()), 350);
  });
  document.getElementById('modal-set-more')?.addEventListener('click', () => {
    setBrowse.page += 1;
    loadSetsList(false);
  });
  document.getElementById('modal-set-cancel')?.addEventListener('click', () =>
    document.getElementById('modal-set-overlay')?.classList.add('hidden'));
  document.getElementById('modal-set-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
  document.getElementById('modal-compare-cancel')?.addEventListener('click', () =>
    document.getElementById('modal-compare-overlay')?.classList.add('hidden'));
  document.getElementById('modal-compare-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  renderPano();
}

// ══════════════════════════════════════════════════════════════
// RECHERCHE DE PANOPLIES PAR NOM
// ══════════════════════════════════════════════════════════════
// État de la liste des panoplies (mode "liste complète" vs "recherche")
const setBrowse = { page: 1, mode: 'list' };

function openSetSearch() {
  const ov = document.getElementById('modal-set-overlay');
  if (!ov) return;
  document.getElementById('modal-set-search').value = '';
  document.getElementById('modal-set-detail').innerHTML =
    '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Sélectionne une panoplie.</p>';
  ov.classList.remove('hidden');
  // Affiche directement TOUTES les panoplies (page 1)
  setBrowse.page = 1;
  setBrowse.mode = 'list';
  loadSetsList(true);
  setTimeout(() => document.getElementById('modal-set-search')?.focus(), 50);
}

// Rendu compact des bonus d'une panoplie (toutes les tranches d'items)
function renderSetBonusInline(bonusByCount) {
  const counts = Object.keys(bonusByCount || {}).map(n => parseInt(n, 10))
    .filter(n => n >= 2 && (bonusByCount[String(n)] || []).length)
    .sort((a, b) => a - b);
  if (!counts.length) return '';
  return `<div class="pano-set-row-bonus">` + counts.map(n => {
    const lines = (bonusByCount[String(n)] || []).filter(b => b.name)
      .map(b => `<span class="set-bonus-chip">${statIcon(b.name)}${b.min > 0 ? '+' : ''}${b.min}</span>`)
      .join('');
    return `<div class="set-bonus-tier"><span class="set-bonus-n">${n} items</span>${lines}</div>`;
  }).join('') + `</div>`;
}

// Bandeau d'images des items d'une panoplie
function renderSetItemsStrip(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return `<div class="set-item-strip">` + items.map(it =>
    `<img src="${escHtml(it.image)}" alt="" title="${escHtml(it.name)} · ${escHtml(it.type)}" class="set-item-ico" loading="lazy"/>`
  ).join('') + `</div>`;
}

// Crée une ligne de panoplie cliquable (avec items + bonus inline)
function makeSetRow(s, box) {
  const row = document.createElement('div');
  row.className = 'pano-set-row';
  const meta = [s.count ? `${s.count} items` : null, s.level ? `Niv. ${s.level}` : null]
    .filter(Boolean).join(' · ');
  const itemsHtml = renderSetItemsStrip(s.items);
  const bonusHtml = s.bonusByCount ? renderSetBonusInline(s.bonusByCount) : '';
  row.innerHTML = `<div class="pano-set-row-name">${escHtml(s.name)}</div>
    ${meta ? `<div class="pano-set-row-meta">${meta}</div>` : ''}
    ${itemsHtml}
    ${bonusHtml}`;
  row.addEventListener('click', () => {
    box.querySelectorAll('.pano-set-row').forEach(r => r.classList.remove('active'));
    row.classList.add('active');
    showSetDetail(s.id);
  });
  return row;
}

// Charge la liste complète (paginée) de toutes les panoplies
async function loadSetsList(reset) {
  const box = document.getElementById('modal-set-results');
  const moreBtn = document.getElementById('modal-set-more');
  if (!box) return;
  if (reset) box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">⏳ Chargement...</p>';
  if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = '⏳ ...'; }
  try {
    const data = await api('GET', `/dofusdb/sets/list?page=${setBrowse.page}&bonus=1`, null, beginAbortable('sets-list', ['sets-search']));
    if (!data) return;
    if (reset) box.innerHTML = '';
    (data.items || []).forEach(s => box.appendChild(makeSetRow(s, box)));
    if (moreBtn) {
      moreBtn.disabled = false;
      moreBtn.textContent = 'Charger plus';
      moreBtn.style.display = data.hasMore ? 'inline-block' : 'none';
    }
  } catch (err) {
    if (isAbortError(err)) return;
    if (reset) box.innerHTML = `<p class="empty-msg" style="color:var(--red);font-size:.82rem">Erreur : ${escHtml(err.message)}</p>`;
    if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = 'Réessayer'; }
  }
}

// Recherche par nom si ≥2 lettres, sinon réaffiche la liste complète
async function searchSets(q) {
  const box = document.getElementById('modal-set-results');
  const moreBtn = document.getElementById('modal-set-more');
  if (!box) return;

  // Champ vidé → retour à la liste complète
  if (!q || q.length < 2) {
    setBrowse.mode = 'list';
    setBrowse.page = 1;
    loadSetsList(true);
    return;
  }

  setBrowse.mode = 'search';
  if (moreBtn) moreBtn.style.display = 'none';
  box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">⏳ Recherche...</p>';
  try {
    const sets = await api('GET', `/dofusdb/sets/search?q=${encodeURIComponent(q)}`, null, beginAbortable('sets-search', ['sets-list']));
    if (!sets || !sets.length) {
      box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Aucune panoplie trouvée.</p>';
      return;
    }
    box.innerHTML = '';
    sets.forEach(s => box.appendChild(makeSetRow(s, box)));
  } catch (err) {
    if (isAbortError(err)) return;
    box.innerHTML = `<p class="empty-msg" style="color:var(--red);font-size:.82rem">Erreur : ${escHtml(err.message)}</p>`;
  }
}

async function showSetDetail(setId) {
  const box = document.getElementById('modal-set-detail');
  box.style.display = 'block';
  box.innerHTML = '<p class="empty-msg" style="font-size:.9rem;padding:.5rem 0">⏳ Chargement...</p>';
  try {
    const set = await fetchSetDetail(setId, true);
    if (!set) return;
    const counts = Object.keys(set.bonusByCount || {}).map(n => parseInt(n, 10))
      .filter(n => n >= 2).sort((a, b) => a - b);
    const bonusHtml = counts.map(n => {
      const lines = (set.bonusByCount[String(n)] || []).filter(b => b.name)
        .map(b => `<div class="pano-set-line"><span><span class="stat-ico">${statIcon(b.name)}</span>${escHtml(b.name)}</span><span>+${b.min}</span></div>`).join('');
      return `<div class="pano-set-step reached"><div class="pano-set-step-head">${n} items</div>${lines}</div>`;
    }).join('');
    const itemsHtml = (set.items || []).map(it =>
      `<img src="${escHtml(it.image)}" alt="" title="${escHtml(it.name)}" class="pano-set-item-ico" loading="lazy"/>`).join('');
    box.innerHTML = `
      <div class="pano-set-detail-title">🔗 ${escHtml(set.name)}</div>
      <div class="pano-set-items">${itemsHtml || '—'}</div>
      <button class="btn-primary" id="btn-equip-set" style="width:100%;margin:.5rem 0">⬇️ Équiper cette panoplie</button>
      <div class="pano-set-bonus-list">${bonusHtml}</div>`;
    box.querySelector('#btn-equip-set')?.addEventListener('click', () => equipWholeSet(set));
  } catch (err) {
    box.innerHTML = `<p class="empty-msg" style="color:var(--red);font-size:.82rem">Erreur : ${escHtml(err.message)}</p>`;
  }
}

// Équipe automatiquement tous les items d'une panoplie dans les bons slots
function equipWholeSet(set) {
  // Map type d'item (FR) → slot du site
  const TYPE_TO_SLOT = {
    'Chapeau':'chapeau', 'Cape':'cape', 'Sac à dos':'cape', 'Amulette':'amulette',
    'Anneau':'anneau', 'Ceinture':'ceinture', 'Bottes':'bottes', 'Bouclier':'bouclier',
    'Familier':'familier', 'Montilier':'familier', 'Dragodinde':'familier', 'Muldo':'familier',
    'Volkorne':'familier', 'Dofus':'dofus', 'Trophée':'dofus', 'Prysmaradite':'dofus',
  };
  const WEAPON_TYPES = ['Épée','Hache','Bâton','Arc','Dague','Marteau','Baguette','Faux','Pelle','Pioche','Lance','Arme magique'];
  const usedIdx = {}; // pour gérer 2 anneaux / 6 dofus
  (set.items || []).forEach(it => {
    let slot = TYPE_TO_SLOT[it.type] || (WEAPON_TYPES.includes(it.type) ? 'arme' : null);
    if (!slot) return;
    const maxIdx = slot === 'dofus' ? 6 : (slot === 'anneau' ? 2 : 1);
    let idx = usedIdx[slot] || 0;
    if (idx >= maxIdx) return; // slot plein
    usedIdx[slot] = idx + 1;
    state.panoItems[panoKey(slot, String(idx))] = it;
  });
  document.getElementById('modal-set-overlay')?.classList.add('hidden');
  renderPano();
  toast(`Panoplie « ${set.name} » équipée.`);
}

// ══════════════════════════════════════════════════════════════
// SAUVEGARDE & COMPARAISON DE BUILDS
// ══════════════════════════════════════════════════════════════
// Builds sauvegardés en base (liés au compte) via /api/pano-builds
// ── Catégories (miroir de routes/panobuilds.js CATEGORIES) ────
const PANO_CATEGORIES = ['PvM', 'PvP', 'Farm / Ressources', 'Leveling', 'Craft / Multi', 'Autre'];

async function loadPanoBuilds() {
  try { return (await api('GET', '/pano-builds')) || []; }
  catch { return []; }
}

// ══════════════════════════════════════════════════════════════
// SAUVEGARDE DE BUILD — nom + visibilité (privé/public) + catégorie
// ══════════════════════════════════════════════════════════════
let _panoSaveVisibility = 'private';

function initSaveBuildModal() {
  const catSel = document.getElementById('pano-save-category');
  if (catSel && !catSel.options.length) {
    catSel.innerHTML = PANO_CATEGORIES.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }
  document.querySelectorAll('.pano-vis-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      _panoSaveVisibility = btn.dataset.vis;
      document.querySelectorAll('.pano-vis-opt').forEach(b => b.classList.toggle('active', b === btn));
      const catWrap = document.getElementById('pano-save-category-wrap');
      if (catWrap) catWrap.style.display = _panoSaveVisibility === 'public' ? 'block' : 'none';
    });
  });
  document.getElementById('modal-pano-save-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-pano-save-overlay')?.classList.add('hidden');
  });
  document.getElementById('modal-pano-save-confirm')?.addEventListener('click', confirmSaveBuild);
}

function openSaveBuildModal() {
  if (!Object.keys(state.panoItems).length) { toast('Équipe des items avant de sauvegarder.', 'error'); return; }
  const nameInput = document.getElementById('pano-save-name');
  if (nameInput) nameInput.value = state.panoClass ? `Build ${state.panoClass}` : 'Mon build';
  _panoSaveVisibility = 'private';
  document.querySelectorAll('.pano-vis-opt').forEach(b => b.classList.toggle('active', b.dataset.vis === 'private'));
  const catWrap = document.getElementById('pano-save-category-wrap');
  if (catWrap) catWrap.style.display = 'none';
  document.getElementById('modal-pano-save-overlay')?.classList.remove('hidden');
  nameInput?.focus();
}

async function confirmSaveBuild() {
  const nameInput = document.getElementById('pano-save-name');
  const name = (nameInput?.value || '').trim();
  if (!name) { toast('Donne un nom à ton build.', 'error'); return; }
  const category = document.getElementById('pano-save-category')?.value || 'Autre';

  try {
    await api('POST', '/pano-builds', {
      name: name.slice(0, 40),
      class: state.panoClass || '',
      items: state.panoItems,          // snapshot des items (avec effets + fm)
      globalFm: state.panoGlobalFm || [],
      visibility: _panoSaveVisibility,
      category,
    });
    document.getElementById('modal-pano-save-overlay')?.classList.add('hidden');
    toast(_panoSaveVisibility === 'public'
      ? `Build « ${name} » publié dans la Communauté.`
      : `Build « ${name} » sauvegardé.`);
  } catch (err) {
    toast(err.message || 'Erreur de sauvegarde.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// COMMUNAUTÉ — galerie de builds publics (parcourir / cloner)
// ══════════════════════════════════════════════════════════════
const communityBrowse = { page: 1 };

function initCommunityModal() {
  const catSel = document.getElementById('community-category');
  if (catSel && catSel.options.length <= 1) {
    catSel.innerHTML += PANO_CATEGORIES.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }
  const clsSel = document.getElementById('community-class');
  if (clsSel && clsSel.options.length <= 1) {
    clsSel.innerHTML += DOFUS_CLASSES.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }
  document.getElementById('modal-community-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-community-overlay')?.classList.add('hidden');
  });
  document.getElementById('community-refresh')?.addEventListener('click', () => loadCommunityResults(true));
  document.getElementById('community-category')?.addEventListener('change', () => loadCommunityResults(true));
  document.getElementById('community-class')?.addEventListener('change', () => loadCommunityResults(true));
  document.getElementById('community-more')?.addEventListener('click', () => loadCommunityResults(false));
  let deb;
  document.getElementById('community-search')?.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => loadCommunityResults(true), 300);
  });
}

function openCommunityModal() {
  document.getElementById('modal-community-overlay')?.classList.remove('hidden');
  loadCommunityResults(true);
}

async function loadCommunityResults(reset) {
  const box = document.getElementById('community-results');
  const moreBtn = document.getElementById('community-more');
  if (!box) return;
  if (reset) { communityBrowse.page = 1; box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">⏳ Chargement...</p>'; }
  if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = '⏳ ...'; }

  const q        = document.getElementById('community-search')?.value.trim() || '';
  const category = document.getElementById('community-category')?.value || '';
  const cls      = document.getElementById('community-class')?.value || '';
  const params = [`page=${communityBrowse.page}`];
  if (q) params.push(`q=${encodeURIComponent(q)}`);
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (cls) params.push(`class=${encodeURIComponent(cls)}`);

  try {
    const data = await api('GET', `/pano-builds/public?${params.join('&')}`, null, beginAbortable('community'));
    if (!data) return;
    if (reset) box.innerHTML = '';
    if (reset && !data.items.length) {
      box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Aucun build public pour ces filtres.</p>';
    } else {
      const cards = await Promise.all(data.items.map(renderCommunityCard));
      cards.forEach(el => box.appendChild(el));
    }
    if (moreBtn) {
      moreBtn.disabled = false;
      moreBtn.textContent = 'Charger plus';
      moreBtn.style.display = data.hasMore ? 'inline-block' : 'none';
    }
    communityBrowse.page++;
  } catch (err) {
    if (isAbortError(err)) return;
    if (reset) box.innerHTML = `<p class="empty-msg" style="color:var(--red);font-size:.82rem">Erreur : ${escHtml(err.message)}</p>`;
    if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = 'Réessayer'; }
  }
}

async function renderCommunityCard(build) {
  const el = document.createElement('div');
  el.className = 'community-card';
  const items = Object.values(build.items || {});
  const totals = await computeBuildTotals(build.items, build.globalFm);
  const score = Math.round(computePanoScore(totals).total);
  const itemsHtml = items.slice(0, 8).map(it =>
    `<img src="${escHtml(it.image || '')}" alt="" title="${escHtml(it.name || '')}" loading="lazy"/>`).join('');

  el.innerHTML = `
    <div class="community-card-head">
      <span class="community-card-name">${escHtml(build.name)}</span>
      <span class="community-card-score">⚡ ${score.toLocaleString('fr-FR')}</span>
    </div>
    <div class="community-card-meta">
      ${build.class ? `<span class="community-badge">${escHtml(build.class)}</span>` : ''}
      ${build.category ? `<span class="community-badge cat">${escHtml(build.category)}</span>` : ''}
    </div>
    <div class="community-card-author">👤 ${escHtml(build.username || 'Anonyme')} · ${items.length} item${items.length > 1 ? 's' : ''}</div>
    <div class="community-card-items">${itemsHtml}</div>
    <div class="community-card-actions">
      <button class="btn-secondary btn-community-load" data-id="${escHtml(build.id)}">⬇️ Charger</button>
    </div>`;

  el.querySelector('.btn-community-load')?.addEventListener('click', () => cloneCommunityBuild(build));
  return el;
}

function cloneCommunityBuild(build) {
  if (Object.keys(state.panoItems).length && !confirm('Charger ce build remplacera ta panoplie actuelle. Continuer ?')) return;
  state.panoItems = JSON.parse(JSON.stringify(build.items || {}));
  state.panoClass = build.class || '';
  state.panoGlobalFm = JSON.parse(JSON.stringify(build.globalFm || []));
  persistPanoDraft();
  document.getElementById('modal-community-overlay')?.classList.add('hidden');
  const clsSel = document.getElementById('pano-class');
  if (clsSel) clsSel.value = state.panoClass;
  renderPanoClass();
  renderPano();
  toast(`Build « ${build.name} » chargé dans ton éditeur.`);
}

async function savePanoBuild() {
  // Conservé pour compatibilité — redirige vers la nouvelle modale.
  openSaveBuildModal();
}

// Calcule les stats totales d'un ensemble d'items (avec bonus de panoplie)
async function computeBuildTotals(itemsMap, globalFm) {
  const items = Object.values(itemsMap || {});
  const totals = {};
  items.forEach(item => {
    (item.effects || []).forEach(e => {
      if (!e.name) return;
      const val = (e.max && e.max !== 0) ? e.max : e.min;
      totals[e.name] = (totals[e.name] || 0) + Number(val || 0);
    });
    // Exos FM par item
    (item.fm || []).forEach(f => {
      if (f.name) totals[f.name] = (totals[f.name] || 0) + Number(f.val || 0);
    });
  });
  // Exos FM globaux du build
  (globalFm || []).forEach(f => {
    if (f.name) totals[f.name] = (totals[f.name] || 0) + Number(f.val || 0);
  });
  // Bonus de panoplie selon le nombre d'items par set
  const setCounts = {};
  items.forEach(item => {
    if (item.setId) {
      setCounts[item.setId] = setCounts[item.setId] || { count: 0 };
      setCounts[item.setId].count++;
    }
  });
  await Promise.all(Object.entries(setCounts).map(async ([setId, info]) => {
    if (info.count < 2) return;
    try {
      const set = await fetchSetDetail(setId);
      const bonus = set?.bonusByCount?.[String(info.count)];
      if (Array.isArray(bonus)) bonus.forEach(b => {
        if (b.name) totals[b.name] = (totals[b.name] || 0) + Number(b.min || 0);
      });
    } catch {}
  }));
  return totals;
}

async function openCompare() {
  const ov = document.getElementById('modal-compare-overlay');
  const body = document.getElementById('modal-compare-body');
  if (!ov || !body) return;
  ov.classList.remove('hidden');

  body.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">⏳ Chargement des builds...</p>';
  const builds = await loadPanoBuilds();
  // On ajoute le build courant comme colonne "Actuel" s'il contient des items
  const current = Object.keys(state.panoItems).length
    ? [{ name: '● Actuel', class: state.panoClass || '', items: state.panoItems, globalFm: state.panoGlobalFm || [], current: true }]
    : [];
  const all = current.concat(builds);

  if (!all.length) {
    body.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Aucun build. Équipe des items puis clique 💾 Sauver.</p>';
    return;
  }

  body.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">⏳ Calcul des stats...</p>';

  // Calcule les totaux de chaque build (items + FM par item + FM global)
  const totalsList = await Promise.all(all.map(b => computeBuildTotals(b.items, b.globalFm)));

  // Union ordonnée des stats
  const ORDER = ['Vitalité','PA','PM','Portée','Sagesse','Force','Intelligence','Chance','Agilité',
                 'Puissance','% Critique','Initiative','Prospection','Invocation','Soin','Pods'];
  const statSet = new Set();
  totalsList.forEach(t => Object.keys(t).forEach(k => statSet.add(k)));
  const stats = [...statSet].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1; if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  // En-têtes de colonnes (avec bouton supprimer pour les builds sauvegardés)
  const headCells = all.map((b) => {
    const del = b.current ? '' :
      `<button class="pano-cmp-del" data-bid="${escHtml(b.id)}" title="Supprimer">✕</button>`;
    return `<th><div class="pano-cmp-head">${escHtml(b.name)}${del}</div>
      <div class="pano-cmp-sub">${escHtml(b.class || '—')}</div></th>`;
  }).join('');

  // Score + différences par rapport au premier build (le build actuel si présent).
  const scoreVals = totalsList.map(t => computePanoScore(t).total);
  const scoreMax = Math.max(...scoreVals);
  const scoreCells = scoreVals.map((value, index) => {
    const delta = index ? Math.round(value - scoreVals[0]) : null;
    return `<td class="${value === scoreMax && value !== 0 ? 'best' : ''}">${Math.round(value)}${delta !== null ? `<small class="pano-cmp-delta ${delta >= 0 ? 'pos' : 'neg'}">Δ ${delta >= 0 ? '+' : ''}${delta}</small>` : ''}</td>`;
  }).join('');
  // Lignes de stats : meilleure valeur et écart surlignés.
  const rows = `<tr class="pano-cmp-score"><th class="pano-cmp-stat">Score configuré</th>${scoreCells}</tr>` + stats.map(stat => {
    const vals = totalsList.map(t => t[stat] || 0);
    const max = Math.max(...vals);
    const cells = vals.map((v, index) => {
      const delta = index ? v - vals[0] : null;
      return `<td class="${v === max && v !== 0 ? 'best' : ''} ${v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v}${delta !== null ? `<small class="pano-cmp-delta ${delta >= 0 ? 'pos' : 'neg'}">Δ ${delta >= 0 ? '+' : ''}${delta}</small>` : ''}</td>`;
    }).join('');
    return `<tr><th class="pano-cmp-stat"><span class="stat-ico">${statIcon(stat)}</span>${escHtml(stat)}</th>${cells}</tr>`;
  }).join('');

  body.innerHTML = `
    <div class="pano-cmp-scroll">
      <table class="pano-cmp-table">
        <thead><tr><th></th>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Suppression d'un build sauvegardé (via API)
  body.querySelectorAll('.pano-cmp-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bid = btn.dataset.bid;
      if (!bid) return;
      if (!confirm('Supprimer ce build ?')) return;
      try {
        await api('DELETE', `/pano-builds/${encodeURIComponent(bid)}`);
        openCompare(); // recharge
      } catch (err) { toast(err.message || 'Erreur suppression.', 'error'); }
    });
  });
}

// ── Classes Dofus (sélecteur visuel) ──────────────────────────
const DOFUS_CLASSES = [
  'Iop','Crâ','Eniripsa','Sadida','Enutrof','Sram','Xélor','Ecaflip',
  'Feca','Osamodas','Sacrieur','Pandawa','Roublard','Zobal','Steamer',
  'Eliotrope','Huppermage','Ouginak','Forgelance',
];

// ── Onglets du modal (recherche / parcourir) ──────────────────
function switchItemModalTab(tab) {
  document.querySelectorAll('.pano-modal-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mtab === tab));
  document.getElementById('mpane-search')?.classList.toggle('active', tab === 'search');
  document.getElementById('mpane-browse')?.classList.toggle('active', tab === 'browse');
  if (tab === 'browse') {
    // (Re)charge la liste si on change de slot ou première ouverture
    const slot = state.panoCurrentSlot?.slot || '';
    if (state.panoBrowse.slot !== slot || !state.panoBrowse.loaded) {
      state.panoBrowse = { slot, page: 1, loaded: false, stats: state.panoBrowse.stats || [], typeId: '' };
      renderSubtypeBar();
      renderStatChips();
      browseItems(true);
    } else {
      renderSubtypeBar();
    }
  } else {
    setTimeout(() => document.getElementById('modal-item-search')?.focus(), 50);
  }
}

// Couleur + portrait officiel (encyclopédie Dofus / Ankama)
const CLASS_AVATAR_BASE = 'https://static.ankama.com/dofus/ng/modules/mmorpg/encyclopedia/unity/breeds/assets/avatar';
const CLASS_THEME = {
  'Feca':       { color: '#4a90d9', emblem: '🛡️', breed: 1 },
  'Osamodas':   { color: '#6fbf8f', emblem: '🐲', breed: 2 },
  'Enutrof':    { color: '#e0b83a', emblem: '💰', breed: 3 },
  'Sram':       { color: '#8a7fd8', emblem: '🗡️', breed: 4 },
  'Xélor':      { color: '#3b9ce0', emblem: '⏳', breed: 5 },
  'Ecaflip':    { color: '#e0603a', emblem: '🎲', breed: 6 },
  'Eniripsa':   { color: '#f0a6c8', emblem: '➕', breed: 7 },
  'Iop':        { color: '#e0503a', emblem: '⚔️', breed: 8 },
  'Crâ':        { color: '#5fbf5f', emblem: '🏹', breed: 9 },
  'Sadida':     { color: '#7fbf3f', emblem: '🌿', breed: 10 },
  'Sacrieur':   { color: '#c0392b', emblem: '🩸', breed: 11 },
  'Pandawa':    { color: '#e0c23a', emblem: '🍶', breed: 12 },
  'Roublard':   { color: '#7a869a', emblem: '💣', breed: 13 },
  'Zobal':      { color: '#c98a3b', emblem: '🎭', breed: 14 },
  'Steamer':    { color: '#3bb0b0', emblem: '⚙️', breed: 15 },
  'Eliotrope':  { color: '#9d6fff', emblem: '🌀', breed: 16 },
  'Huppermage': { color: '#5f8fd8', emblem: '🔮', breed: 17 },
  'Ouginak':    { color: '#b06a3a', emblem: '🐺', breed: 18 },
  'Forgelance': { color: '#c0a050', emblem: '🔱', breed: 20 },
};

function classAvatarUrl(cls) {
  const id = CLASS_THEME[cls]?.breed;
  // On passe par notre proxy serveur (Ankama bloque le hotlinking par Referer)
  return id ? `/api/dofusdb/avatar/${id}` : '';
}

function ensureClassStrip() {
  const strip = document.getElementById('pano-class-strip');
  if (!strip || strip.dataset.ready === '1') return;
  strip.dataset.ready = '1';
  DOFUS_CLASSES.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pano-class-chip';
    btn.title = c;
    btn.dataset.class = c;
    btn.setAttribute('role', 'option');
    btn.innerHTML = `<img src="${escHtml(classAvatarUrl(c))}" alt="${escHtml(c)}" loading="lazy"/>`;
    btn.addEventListener('click', () => {
      // Re-cliquer sur la classe active la désélectionne
      state.panoClass = (state.panoClass === c) ? '' : c;
      persistPanoDraft();
      renderPanoClass();
    });
    strip.appendChild(btn);
  });
}

// ── Affiche la classe sélectionnée dans l'en-tête + avatar central ────
function renderPanoClass() {
  const cls = state.panoClass || '';
  const theme = CLASS_THEME[cls];

  // Met en évidence la pastille de classe active
  document.querySelectorAll('.pano-class-chip').forEach(ch =>
    ch.classList.toggle('active', ch.dataset.class === cls));

  const badge = document.getElementById('pano-class-badge');
  if (badge) badge.textContent = cls || '';

  const charLabel = document.getElementById('pano-char-label');
  if (charLabel) charLabel.textContent = cls || 'Aventurier';

  const charEl = document.getElementById('pano-char');
  const img = document.getElementById('pano-char-img');
  const svg = charEl?.querySelector('.pano-char-svg');
  const emblemEl = document.getElementById('pano-char-emblem');
  const url = classAvatarUrl(cls);

  if (charEl) charEl.style.color = theme ? theme.color : '';

  if (img) {
    if (url) {
      img.onload = () => {
        img.classList.remove('hidden');
        svg?.classList.add('hidden');
      };
      img.onerror = () => {
        img.classList.add('hidden');
        svg?.classList.remove('hidden');
        if (emblemEl) emblemEl.textContent = theme ? theme.emblem : '';
      };
      if (img.getAttribute('src') !== url) img.src = url;
      else {
        img.classList.remove('hidden');
        svg?.classList.add('hidden');
      }
      img.alt = cls;
      if (emblemEl) emblemEl.textContent = '';
    } else {
      img.removeAttribute('src');
      img.alt = '';
      img.classList.add('hidden');
      svg?.classList.remove('hidden');
      if (emblemEl) emblemEl.textContent = '';
    }
  }

  document.querySelectorAll('.pano-class-chip').forEach(b => {
    const on = b.dataset.class === cls;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// ── Ouvrir / fermer le modal de recherche ────────────────────
const SLOT_LABELS = {
  amulette:'Amulette', chapeau:'Chapeau', arme:'Arme', anneau:'Anneau',
  cape:'Cape', ceinture:'Ceinture', bouclier:'Bouclier', bottes:'Bottes',
  familier:'Familier', dofus:'Dofus / Trophée',
};

function openItemSearch(slot, idx) {
  ensureItemModal();
  state.panoCurrentSlot = { slot, idx };
  // Réinitialise l'état "Parcourir" pour ce slot (stats + sous-type remis à zéro)
  state.panoBrowse = { slot, page: 1, loaded: false, stats: [], typeId: '' };
  const statSel = document.getElementById('modal-browse-stat');
  if (statSel) statSel.value = '';
  renderSubtypeBar();
  renderStatChips();

  const overlay = document.getElementById('modal-item-overlay');
  if (!overlay) return; // sécurité : le modal n'a pas pu être créé

  const set = (id, prop, val) => {
    const el = document.getElementById(id);
    if (el) el[prop] = val;
  };
  set('modal-item-title', 'textContent', `${SLOT_LABELS[slot] || slot}`);
  set('modal-item-search', 'value', '');
  set('modal-item-results', 'innerHTML',
    '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Commence à taper pour chercher.</p>');
  set('modal-item-browse', 'innerHTML',
    '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Chargement...</p>');

  // Revient sur l'onglet Recherche par défaut
  switchItemModalTab('search');
  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-item-search')?.focus(), 50);
}
function closeItemSearch() {
  document.getElementById('modal-item-overlay').classList.add('hidden');
  state.panoCurrentSlot = null;
}

// ── Recherche via le proxy ────────────────────────────────────
async function searchItems(q) {
  const box = document.getElementById('modal-item-results');
  if (!q || q.length < 2) {
    _abortCtrls['item-search']?.abort();
    box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Min. 2 lettres.</p>';
    return;
  }
  box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">⏳ Recherche...</p>';

  const slot = state.panoCurrentSlot?.slot || '';
  try {
    const results = await api('GET', `/dofusdb/search?q=${encodeURIComponent(q)}&slot=${encodeURIComponent(slot)}`, null, beginAbortable('item-search'));
    if (!results) return;
    if (!results.length) {
      box.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Aucun item trouvé.</p>';
      return;
    }
    box.innerHTML = '';
    results.forEach(it => {
      const row = document.createElement('div');
      row.className = 'pano-result';
      row.innerHTML = `
        <img src="${escHtml(it.image)}" alt="" loading="lazy"/>
        <div class="pano-result-info">
          <div class="pano-result-name">${escHtml(it.name)}</div>
          <div class="pano-result-meta">${escHtml(it.type)} · Niv. ${it.level}</div>
        </div>`;
      row.addEventListener('click', () => equipItem(it));
      attachItemTooltip(row, it);   // info-bulle stats au survol
      box.appendChild(row);
    });
  } catch (err) {
    if (isAbortError(err)) return;
    box.innerHTML = `<p class="empty-msg" style="color:var(--red);font-size:.82rem">Erreur : ${escHtml(err.message)}</p>`;
  }
}

// ── Parcourir les items d'un slot (grille avec images) ────────
async function browseItems(reset) {
  const grid = document.getElementById('modal-item-browse');
  const moreBtn = document.getElementById('modal-browse-more');
  const slot = state.panoBrowse.slot;
  if (!slot) {
    grid.innerHTML = '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Slot inconnu.</p>';
    return;
  }
  const stats = state.panoBrowse.stats || [];
  const loadingMsg = stats.length
    ? `⏳ Recherche des items avec ${stats.map(s => `« ${escHtml(s)} »`).join(' + ')}...`
    : '⏳ Chargement...';
  if (reset) grid.innerHTML = `<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">${loadingMsg}</p>`;
  if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = '⏳ ...'; }

  try {
    let url = `/dofusdb/browse?slot=${encodeURIComponent(slot)}&page=${state.panoBrowse.page}`;
    if (stats.length) url += `&stat=${encodeURIComponent(stats.join(','))}`;
    if (state.panoBrowse.typeId) url += `&typeId=${encodeURIComponent(state.panoBrowse.typeId)}`;
    const data = await api('GET', url, null, beginAbortable('item-browse'));
    if (!data) return;
    const items = data.items || [];

    if (reset) grid.innerHTML = '';
    if (reset && !items.length) {
      const msg = stats.length
        ? `Aucun item avec ${stats.map(s => `« ${escHtml(s)} »`).join(' + ')}.`
        : 'Aucun item.';
      grid.innerHTML = `<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">${msg}</p>`;
    }

    items.forEach(it => {
      const cell = document.createElement('div');
      cell.className = 'pano-browse-cell';
      // Valeurs des stats sélectionnées (si présentes)
      let statLine = `Niv. ${it.level}`;
      if (stats.length && Array.isArray(it.effects)) {
        const parts = stats.map(s => {
          const eff = it.effects.find(e => (e.name || '').toLowerCase() === s.toLowerCase());
          return eff ? `${statIcon(s)} ${eff.max || eff.min}` : '';
        }).filter(Boolean);
        if (parts.length) statLine = parts.join(' ');
      }
      cell.innerHTML = `
        <img src="${escHtml(it.image)}" alt="" loading="lazy"/>
        <div class="pano-browse-name">${escHtml(it.name)}</div>
        <div class="pano-browse-lvl">${statLine}</div>`;
      cell.addEventListener('click', () => equipItem(it));
      attachItemTooltip(cell, it);   // info-bulle stats au survol
      grid.appendChild(cell);
    });

    state.panoBrowse.loaded = true;
    if (moreBtn) {
      moreBtn.disabled = false;
      moreBtn.textContent = 'Charger plus';
      moreBtn.style.display = data.hasMore ? 'inline-block' : 'none';
    }
  } catch (err) {
    if (isAbortError(err)) {
      if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = 'Charger plus'; }
      return;
    }
    if (reset) grid.innerHTML = `<p class="empty-msg" style="color:var(--red);font-size:.82rem">Erreur : ${escHtml(err.message)}</p>`;
    if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = 'Réessayer'; }
  }
}

// ── Équiper un item (récupère le détail complet puis le pose) ─
async function equipItem(searchResult) {
  if (!state.panoCurrentSlot) return;
  const { slot, idx } = state.panoCurrentSlot;
  try {
    const detail = await api('GET', `/dofusdb/item/${searchResult.id}?path=${encodeURIComponent(searchResult.path || 'equipment')}`);
    if (!detail) return;
    state.panoItems[panoKey(slot, idx)] = detail;
    closeItemSearch();
    renderPano();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Retirer un item ───────────────────────────────────────────
function unequipItem(slot, idx) {
  delete state.panoItems[panoKey(slot, idx)];
  renderPano();
}

// ── Rendu global de la panoplie ───────────────────────────────
function renderPano() {
  // Remplir chaque slot visuellement
  document.querySelectorAll('.pano-slot').forEach(el => {
    const slot = el.dataset.slot, idx = el.dataset.idx;
    const item = state.panoItems[panoKey(slot, idx)];

    if (item) {
      el.classList.add('filled');
      const fmBadge = (item.fm && item.fm.length)
        ? `<span class="pano-fm-badge" title="${item.fm.length} exo(s) de forgemagie">⚒️</span>` : '';
      el.innerHTML = `
        <button class="pano-remove" title="Retirer">✕</button>
        ${fmBadge}
        <div class="pano-item">
          <img src="${escHtml(item.image)}" alt="" loading="lazy"/>
          <span class="pano-item-name">${escHtml(item.name)}</span>
        </div>`;
      el.querySelector('.pano-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        unequipItem(slot, idx);
      });
      attachItemTooltip(el, item);   // info-bulle stats de l'item équipé
    } else {
      el.classList.remove('filled');
      // Restaurer le placeholder d'origine selon le slot
      const label = SLOT_LABELS[slot] || slot;
      const icons = { amulette:'🔮', chapeau:'🎩', arme:'⚔️', anneau:'💍', cape:'🧥',
                      ceinture:'🎗️', bouclier:'🛡️', bottes:'👢', familier:'🐾', dofus:'🥚' };
      el.innerHTML = `<span class="pano-ph"><span class="pano-ico">${icons[slot]||'?'}</span><span class="pano-lbl">${escHtml(label)}</span></span>`;
    }
  });

  persistPanoDraft();
  renderPanoStats();
}

// ── Calcul + affichage des caractéristiques totales ──────────
async function renderPanoStats() {
  const listEl = document.getElementById('pano-stats-list');
  const items  = Object.values(state.panoItems);
  const gen = ++_panoStatsGen;

  // Additionner les effets de tous les items équipés
  const totals = {}; // { statName: valeur }
  items.forEach(item => {
    (item.effects || []).forEach(e => {
      // On prend le max (jet parfait) — sinon min si max=0
      const val = e.max && e.max !== 0 ? e.max : e.min;
      if (!e.name) return;
      totals[e.name] = (totals[e.name] || 0) + Number(val || 0);
    });
  });

  // ── Bonus de panoplie : compter les items par set ──────────
  const setCounts = {}; // { setId: { name, count } }
  items.forEach(item => {
    if (item.setId) {
      if (!setCounts[item.setId]) setCounts[item.setId] = { name: item.setName, count: 0 };
      setCounts[item.setId].count++;
    }
  });

  // Récupérer les bonus de set (async, en parallèle).
  // On garde TOUTE la progression par nombre d'items (bonusByCount) pour
  // pouvoir l'afficher, et on applique le palier actif aux stats totales.
  const setBlocks = [];
  await Promise.all(Object.entries(setCounts).map(async ([setId, info]) => {
    if (info.count < 2) return; // bonus panoplie dès 2 items
    try {
      const set = await fetchSetDetail(setId);
      if (!set) return;
      // Applique le palier correspondant au nombre d'items équipés
      const active = set.bonusByCount[String(info.count)];
      if (Array.isArray(active)) {
        active.forEach(b => {
          if (!b.name) return;
          totals[b.name] = (totals[b.name] || 0) + Number(b.min || 0);
        });
      }
      // Construit la progression complète (2 items → max) pour l'affichage
      const progression = Object.keys(set.bonusByCount || {})
        .map(n => parseInt(n, 10))
        .filter(n => n >= 2 && Array.isArray(set.bonusByCount[String(n)]) && set.bonusByCount[String(n)].length)
        .sort((a, b) => a - b)
        .map(n => ({ count: n, bonus: set.bonusByCount[String(n)] }));
      setBlocks.push({ name: set.name, count: info.count, progression });
    } catch {}
  }));
  if (gen !== _panoStatsGen) return;

  // ── Forgemagie : exos par item ──────────────────────────────
  items.forEach(item => {
    (item.fm || []).forEach(f => {
      if (!f.name) return;
      totals[f.name] = (totals[f.name] || 0) + Number(f.val || 0);
    });
  });
  // ── Forgemagie : exos globaux (toute la panoplie) ───────────
  (state.panoGlobalFm || []).forEach(f => {
    if (!f.name) return;
    totals[f.name] = (totals[f.name] || 0) + Number(f.val || 0);
  });

  renderPanoScore(totals);

  // Rendu des stats
  if (!Object.keys(totals).length) {
    listEl.innerHTML = '<p class="empty-msg" style="padding:1rem 0">Équipe des items pour voir les stats.</p>';
  } else {
    // Trier : stats principales d'abord
    const ORDER = ['Vitalité','PA','PM','Portée','Sagesse','Force','Intelligence','Chance','Agilité',
                   'Puissance','Dommages','Critique','Invocations','Prospection','Initiative'];
    const entries = Object.entries(totals).sort((a, b) => {
      const ia = ORDER.indexOf(a[0]); const ib = ORDER.indexOf(b[0]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a[0].localeCompare(b[0]);
    });
    listEl.innerHTML = entries.map(([name, val]) => `
      <div class="pano-stat-row">
        <span class="stat-name"><span class="stat-ico">${statIcon(name)}</span>${escHtml(name)}</span>
        <span class="stat-val ${val < 0 ? 'neg' : ''}">${val > 0 ? '+' : ''}${val}</span>
      </div>`).join('');
  }

  // Rendu des bonus de panoplie
  const bonusEl = document.getElementById('pano-set-bonus');
  if (setBlocks.length) {
    bonusEl.innerHTML = setBlocks.map(sb => `
      <div class="pano-set-block">
        <div class="pano-set-title">🔗 ${escHtml(sb.name)}
          <span class="pano-set-count">${sb.count} / ${sb.progression.length ? sb.progression[sb.progression.length-1].count : sb.count} équipés</span>
        </div>
        ${sb.progression.map(step => {
          const isActive = step.count === sb.count;
          const isReached = step.count <= sb.count;
          const lines = step.bonus
            .filter(b => b.name)
            .map(b => `<div class="pano-set-line"><span><span class="stat-ico">${statIcon(b.name)}</span>${escHtml(b.name)}</span><span>+${b.min}</span></div>`)
            .join('');
          return `
            <div class="pano-set-step ${isActive ? 'active' : ''} ${isReached ? 'reached' : ''}">
              <div class="pano-set-step-head">
                <span>${step.count} items ${isActive ? '✓ actif' : (isReached ? '✓' : '')}</span>
              </div>
              ${lines}
            </div>`;
        }).join('')}
      </div>`).join('');
  } else {
    bonusEl.innerHTML = '<p class="empty-msg" style="padding:1rem 0;font-size:.82rem">Équipe au moins 2 items d\'une même panoplie pour voir ses bonus.</p>';
  }

  // Si l'onglet FM est ouvert, on le rafraîchit aussi
  if (document.getElementById('pano-fm-pane')?.classList.contains('active')) renderFmPane();
}

function renderPanoScore(totals) {
  const target = document.getElementById('pano-score-value');
  const breakdownEl = document.getElementById('pano-score-breakdown');
  if (!target) return;
  const { total, damage, resist, initiative, prospecting, apmpo, vitality } = computePanoScore(totals);
  target.textContent = Math.round(total).toLocaleString('fr-FR');
  if (breakdownEl) {
    const parts = [
      ['⚔️ Dégâts',      damage],
      ['🛡 Résist.',      resist],
      ['⚡ Initiative',   initiative],
      ['🍀 Prospection',  prospecting],
      ['🏃 PA/PM/PO',     apmpo],
      ['❤️ Vitalité',     vitality],
    ].filter(([, v]) => Math.abs(v) > 0.01);
    breakdownEl.innerHTML = parts.length
      ? parts.map(([lbl, v]) => `<span>${lbl} <b>${Math.round(v).toLocaleString('fr-FR')}</b></span>`).join('')
      : '';
  }
}

// Score global du build : combine dégâts, résistances et stats
// secondaires selon les pondérations réglables par l'utilisateur.
// Renvoie le détail par catégorie pour affichage (pas juste le total).
function computePanoScore(totals) {
  const w = state.panoScoreWeights;
  let damage = 0, resist = 0;
  Object.entries(totals).forEach(([name, value]) => {
    const n = name.toLowerCase();
    if (n.includes('dommage')) damage += Number(value) || 0;
    if (n.includes('résistance') || n.includes('resistance')) resist += Number(value) || 0;
  });
  const initiativeRaw = Number(totals.Initiative) || 0;
  const prospectingRaw = Number(totals.Prospection) || 0;
  // PA/PM/PO sont des stats rares et à très forte valeur relative en jeu :
  // on les compte séparément avec un poids dédié plutôt que de les noyer
  // dans "dégâts". La vitalité contribue à la survie, poids faible par défaut.
  const apmpoRaw = (Number(totals.PA) || 0) + (Number(totals.PM) || 0) + (Number(totals.PO) || 0);
  const vitalityRaw = Number(totals.Vitalité) || 0;

  const scoredDamage      = damage * w.damage;
  const scoredResist      = resist * w.resist;
  const scoredInitiative  = initiativeRaw * w.initiative;
  const scoredProspecting = prospectingRaw * w.prospecting;
  const scoredApmpo       = apmpoRaw * (w.apmpo ?? 0);
  const scoredVitality    = vitalityRaw * (w.vitality ?? 0);

  return {
    total: scoredDamage + scoredResist + scoredInitiative + scoredProspecting + scoredApmpo + scoredVitality,
    damage: scoredDamage, resist: scoredResist, initiative: scoredInitiative,
    prospecting: scoredProspecting, apmpo: scoredApmpo, vitality: scoredVitality,
  };
}

// ══════════════════════════════════════════════════════════════
// FORGEMAGIE : exos par item + exos globaux
// ══════════════════════════════════════════════════════════════
// Options de stat pour le sélecteur FM (réutilise BROWSE_STATS)
function fmStatOptions(selected) {
  return '<option value="">— Stat —</option>' +
    BROWSE_STATS.map(s => `<option value="${escHtml(s)}"${s === selected ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
}

// Rendu de l'onglet Forgemagie
function renderFmPane() {
  const pane = document.getElementById('pano-fm-pane');
  if (!pane) return;

  // Bloc "exo global" + un bloc par item équipé
  const equipped = Object.entries(state.panoItems); // [ [key, item], ... ]

  const globalRows = (state.panoGlobalFm || []).map((f, i) =>
    `<div class="fm-row"><span class="stat-ico">${statIcon(f.name)}</span>
       <span class="fm-row-name">${escHtml(f.name)}</span>
       <span class="fm-row-val">${f.val > 0 ? '+' : ''}${f.val}</span>
       <button class="fm-del" data-scope="global" data-i="${i}" title="Retirer">✕</button></div>`).join('');

  const itemBlocks = equipped.map(([key, item]) => {
    const rows = (item.fm || []).map((f, i) =>
      `<div class="fm-row"><span class="stat-ico">${statIcon(f.name)}</span>
         <span class="fm-row-name">${escHtml(f.name)}</span>
         <span class="fm-row-val">${f.val > 0 ? '+' : ''}${f.val}</span>
         <button class="fm-del" data-scope="item" data-key="${escHtml(key)}" data-i="${i}" title="Retirer">✕</button></div>`).join('');
    return `
      <div class="fm-block">
        <div class="fm-block-head">
          <img src="${escHtml(item.image)}" alt="" class="fm-item-ico"/>
          <span>${escHtml(item.name)}</span>
        </div>
        <div class="fm-rows">${rows || '<span class="fm-empty">Aucun exo</span>'}</div>
        <div class="fm-add">
          <select class="fm-add-stat">${fmStatOptions()}</select>
          <input type="number" class="fm-add-val" placeholder="+/-" />
          <button class="btn-secondary fm-add-btn" data-scope="item" data-key="${escHtml(key)}">＋</button>
        </div>
      </div>`;
  }).join('');

  pane.innerHTML = `
    <div class="fm-block fm-block-global">
      <div class="fm-block-head">🌐 Exos généraux (toute la panoplie)</div>
      <div class="fm-rows">${globalRows || '<span class="fm-empty">Aucun exo global</span>'}</div>
      <div class="fm-add">
        <select class="fm-add-stat">${fmStatOptions()}</select>
        <input type="number" class="fm-add-val" placeholder="+/-" />
        <button class="btn-secondary fm-add-btn" data-scope="global">＋</button>
      </div>
    </div>
    ${equipped.length
      ? `<div class="fm-section-title">Par item</div>${itemBlocks}`
      : '<p class="empty-msg" style="font-size:.82rem;padding:.5rem 0">Équipe des items pour leur ajouter des exos.</p>'}`;

  // Ajout d'un exo
  pane.querySelectorAll('.fm-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.fm-add');
      const name = wrap.querySelector('.fm-add-stat').value;
      const val  = parseInt(wrap.querySelector('.fm-add-val').value, 10);
      if (!name) { toast('Choisis une stat.', 'error'); return; }
      if (!Number.isFinite(val) || val === 0) { toast('Entre une valeur (ex: 1, -1, 50).', 'error'); return; }
      if (btn.dataset.scope === 'global') {
        state.panoGlobalFm.push({ name, val });
      } else {
        const item = state.panoItems[btn.dataset.key];
        if (!item) return;
        item.fm = item.fm || [];
        item.fm.push({ name, val });
      }
      renderPano();       // recalcule les stats
      renderFmPane();     // rafraîchit la liste FM
    });
  });

  // Suppression d'un exo
  pane.querySelectorAll('.fm-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i, 10);
      if (btn.dataset.scope === 'global') {
        state.panoGlobalFm.splice(i, 1);
      } else {
        const item = state.panoItems[btn.dataset.key];
        if (item && Array.isArray(item.fm)) item.fm.splice(i, 1);
      }
      renderPano();
      renderFmPane();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// ONGLET AIDE / ENTRAIDE
// ══════════════════════════════════════════════════════════════
const AIDE_TYPE_INFO = {
  donjon    : { icon: '🏰', label: 'Donjon' },
  combat    : { icon: '⚔️', label: 'Combat' },
  forgemagie: { icon: '⚒️', label: 'Forgemagie' },
  autre     : { icon: '💬', label: 'Autre' },
};

function initAide() {
  // Sélecteur de type dans le formulaire
  document.querySelectorAll('.aide-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.aide-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.aideType = btn.dataset.type;
    });
  });

  // Publier une demande
  document.getElementById('btn-aide-submit')?.addEventListener('click', async () => {
    const title = document.getElementById('aide-title').value.trim();
    if (!title) { toast('Donne un titre à ta demande !', 'error'); return; }
    const btn = document.getElementById('btn-aide-submit');
    btn.disabled = true; btn.textContent = '⏳...';
    try {
      await api('POST', '/requests', {
        type       : state.aideType,
        title,
        description: document.getElementById('aide-desc').value.trim(),
        reward     : document.getElementById('aide-reward').value.trim(),
      });
      document.getElementById('aide-title').value  = '';
      document.getElementById('aide-desc').value   = '';
      document.getElementById('aide-reward').value = '';
      await renderAideList();
      await updateAideBadge();
      toast('🤝 Demande publiée !');
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '🤝 Publier la demande'; }
  });

  // Filtres statut
  document.querySelectorAll('[data-filter-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.aideFilterStatus = btn.dataset.filterStatus;
      renderAideList();
    });
  });
  // Filtres type
  document.querySelectorAll('[data-filter-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.aideFilterType = btn.dataset.filterType;
      renderAideList();
    });
  });

  // Recherche
  let deb;
  document.getElementById('aide-search')?.addEventListener('input', () => {
    clearTimeout(deb); deb = setTimeout(renderAideList, 350);
  });
}

async function renderAideList() {
  const container = document.getElementById('aide-list');
  if (!container) return;
  container.innerHTML = '<p class="empty-msg">⏳ Chargement...</p>';

  try {
    const params = [];
    if (state.aideFilterStatus !== 'all') params.push('status=' + state.aideFilterStatus);
    if (state.aideFilterType   !== 'all') params.push('type='   + state.aideFilterType);
    const q = document.getElementById('aide-search')?.value.trim();
    if (q) params.push('q=' + encodeURIComponent(q));
    const url = '/requests' + (params.length ? '?' + params.join('&') : '');

    const list = await api('GET', url);
    if (!list) return;

    // Résumé (toujours calculé sur l'ensemble, pas le filtre)
    const all = await api('GET', '/requests');
    if (all) {
      document.getElementById('aide-stat-ouvert').textContent = all.filter(r => r.status==='ouvert').length;
      document.getElementById('aide-stat-pris').textContent   = all.filter(r => r.status==='pris').length;
      document.getElementById('aide-stat-resolu').textContent = all.filter(r => r.status==='resolu').length;
    }

    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<p class="empty-msg">Aucune demande trouvée.</p>';
      return;
    }

    const myId       = null; // le serveur gère les permissions; on affiche tous les boutons pertinents
    const myUsername = getUsername();

    list.forEach(r => {
      const info = AIDE_TYPE_INFO[r.type] || AIDE_TYPE_INFO.autre;
      const d    = new Date(r.date);
      const isOwner = r.username === myUsername;
      const isTaker = r.takenByName === myUsername;

      // Tag statut
      let statusTag = '';
      if (r.status === 'ouvert') statusTag = '<span class="aide-tag tag-ouvert">🟢 Ouvert</span>';
      else if (r.status === 'pris') statusTag = `<span class="aide-tag tag-pris">🟡 Pris par ${escHtml(r.takenByName||'?')}</span>`;
      else statusTag = '<span class="aide-tag tag-resolu">✅ Résolu</span>';

      // Boutons d'action selon statut
      let actions = '';
      if (r.status === 'ouvert') {
        actions += `<button class="btn-aide-take" data-act="take" data-id="${r.id}">🙋 Je m'en occupe</button>`;
      } else if (r.status === 'pris') {
        actions += `<button class="btn-aide-resolve" data-act="resolve" data-id="${r.id}">✅ Résolu</button>`;
        actions += `<button class="btn-aide-release" data-act="release" data-id="${r.id}">↩ Relâcher</button>`;
      }
      if (isOwner) {
        actions += `<button class="btn-aide-del" data-act="del" data-id="${r.id}">🗑 Supprimer</button>`;
      }

      const el = document.createElement('div');
      el.className = `aide-item status-${r.status}`;
      el.innerHTML = `
        <div class="aide-icon">${info.icon}</div>
        <div class="aide-body">
          <div class="aide-title">${escHtml(r.title)}</div>
          <div class="aide-meta">
            <span>👤 ${escHtml(r.username)}</span>
            <span>📅 ${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>
            <span>${info.label}</span>
            ${statusTag}
          </div>
          ${r.description ? `<div class="aide-desc">${escHtml(r.description)}</div>` : ''}
          ${r.reward ? `<div class="aide-reward">🎁 ${escHtml(r.reward)}</div>` : ''}
        </div>
        <div class="aide-actions">${actions || '<span style="font-size:.72rem;color:var(--text-dim)">—</span>'}</div>`;
      container.appendChild(el);
    });

    // Brancher les actions
    container.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id, act = btn.dataset.act;
        try {
          if (act === 'del') {
            if (!confirm('Supprimer cette demande ?')) return;
            await api('DELETE', `/requests/${id}`);
          } else {
            await api('PATCH', `/requests/${id}/${act}`);
          }
          await renderAideList();
          await updateAideBadge();
        } catch (err) { toast(err.message, 'error'); }
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="empty-msg" style="color:var(--red)">Erreur : ${escHtml(err.message)}</p>`;
  }
}

/** Met à jour le badge du nombre de demandes ouvertes sur l'onglet */
async function updateAideBadge() {
  try {
    const { open } = await api('GET', '/requests/count');
    const badge = document.getElementById('aide-badge');
    if (!badge) return;
    if (open > 0) { badge.textContent = open; badge.style.display = 'inline-block'; }
    else badge.style.display = 'none';
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// ONGLET COMPTE
// ══════════════════════════════════════════════════════════════
async function renderCompte() {
  try{
    const me=await api('GET','/auth/me');
    if(!me)return;
    document.getElementById('compte-username').value=me.username||'';
    const created=document.getElementById('compte-created');
    if(created){
      created.value = me.createdAt
        ? new Date(me.createdAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' })
        : '—';
    }
  }catch{}
}

function initCompte() {
  document.getElementById('btn-change-pwd')?.addEventListener('click',async()=>{
    const cur=document.getElementById('cur-pwd').value;
    const nw =document.getElementById('new-pwd').value;
    const nw2=document.getElementById('new-pwd2').value;

    const errEl=document.getElementById('pwd-err');
    const okEl =document.getElementById('pwd-ok');
    errEl.style.display='none'; okEl.style.display='none';

    if(!cur||!nw||!nw2){errEl.textContent='Remplis tous les champs.';errEl.style.display='block';return;}
    if(nw!==nw2){errEl.textContent='Les nouveaux mots de passe ne correspondent pas.';errEl.style.display='block';return;}

    const btn=document.getElementById('btn-change-pwd');
    btn.disabled=true;
    try{
      await api('PUT','/auth/password',{currentPassword:cur,newPassword:nw});
      ['cur-pwd','new-pwd','new-pwd2'].forEach(id=>{document.getElementById(id).value='';});
      okEl.textContent='✓ Mot de passe changé avec succès !'; okEl.style.display='block';
    }catch(err){errEl.textContent=err.message;errEl.style.display='block';}
    finally{btn.disabled=false;}
  });
}

// ══════════════════════════════════════════════════════════════
// EXPORT CSV SESSIONS + FORGEMAGIE
// ══════════════════════════════════════════════════════════════
function injectExportButtons() {
  const actions=document.querySelector('.history-actions');
  if(actions&&!document.getElementById('btn-export-csv')){
    const btn=document.createElement('button');
    btn.id='btn-export-csv'; btn.className='btn-secondary'; btn.textContent='📥 Export CSV';
    btn.addEventListener('click',()=>exportFile('/sessions/export','songe'));
    actions.appendChild(btn);
  }
}

async function exportFile(endpoint, prefix) {
  try{
    const res=await fetch('/api'+endpoint,{headers:{'Authorization':'Bearer '+getToken()}});
    if(!res.ok)throw new Error('Erreur export');
    const blob=await res.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`${prefix}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast('📥 Export téléchargé !');
  }catch(err){toast(err.message,'error');}
}

// ══════════════════════════════════════════════════════════════
// BOUTON UTILISATEUR / DÉCONNEXION
// ══════════════════════════════════════════════════════════════
function injectUserButton() {
  const hs=document.querySelector('.header-stats');
  if(!hs)return;

  // Bouton panel admin (visible seulement si admin)
  if(localStorage.getItem('st_admin')==='1') {
    const adminBtn=document.createElement('button');
    adminBtn.className='btn-secondary';
    adminBtn.style.cssText='font-size:.75rem;padding:.3rem .8rem;white-space:nowrap;border-color:var(--gold-dim);color:var(--gold);';
    adminBtn.textContent='🛡️ Admin';
    adminBtn.addEventListener('click',()=>{ window.location.href='/admin.html'; });
    hs.appendChild(adminBtn);
  }

  const btn=document.createElement('button');
  btn.className='btn-secondary';
  btn.style.cssText='font-size:.75rem;padding:.3rem .8rem;white-space:nowrap;';
  btn.innerHTML=`👤 ${escHtml(getUsername()||'')} · <span style="color:var(--red)">Déco</span>`;
  btn.addEventListener('click',()=>{
    if(!confirm('Se déconnecter ?'))return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem('st_admin');
    window.location.replace('/');
  });
  hs.appendChild(btn);
}

// ══════════════════════════════════════════════════════════════
// INITIALISATION
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded',async()=>{

  if(!getToken()){ window.location.replace('/'); return; }

  // Vérifier token + rediriger admin
  try{
    const me=await api('GET','/auth/me');
    if(!me)return;
    // L'admin peut utiliser l'app normalement — stocker le flag pour afficher le lien admin
    if(me.isAdmin) localStorage.setItem('st_admin','1');
  }catch{ window.location.replace('/'); return; }

  // Init modules — chaque module isolé : une erreur dans l'un
  // ne doit jamais empêcher les autres (ex: les clics panoplie).
  const safeInit = (name, fn) => {
    try { fn(); }
    catch (err) { console.error(`[init ${name}]`, err); }
  };
  safeInit('tabs', initTabs);
  safeInit('timer', initTimer);
  safeInit('modal', initModal);
  safeInit('newTypeModal', initNewTypeModal);
  safeInit('saveSession', initSaveSession);
  safeInit('history', initHistory);
  safeInit('pricesTab', initPricesTab);
  safeInit('forgemagie', initForgemagie);
  safeInit('compte', initCompte);
  safeInit('aide', initAide);
  safeInit('pano', initPano);
  safeInit('previewListeners', bindPreviewListeners);
  safeInit('exportButtons', injectExportButtons);
  safeInit('userButton', injectUserButton);
  safeInit('chartResize', initChartResize);
  safeInit('forgeChartResize', initForgeChartResize);

  // Rendu initial en parallèle
  await Promise.all([
    renderItemList('legendes-songe-list', state.currentLegendes, 'pill-legende'),
    renderItemList('runes-list',          state.currentRunes,    'pill-rune'),
    renderPricesTab(),
    updateHeaderStats(),
    updateAideBadge(),
  ]);
  await updatePreview();

  window.addEventListener('resize',()=>{
    if(document.getElementById('tab-stats')?.classList.contains('active')) renderStats();
  });
});
