// --- Supabase init (from /api/config) ---
let supabase = null;

async function initSupabase() {
  // 1) config 가져오기
  const res = await fetch("/api/config", { cache: "no-store" });
  if (!res.ok) throw new Error(`/api/config failed: ${res.status}`);
  const cfg = await res.json();
  if (!cfg.url || !cfg.key) throw new Error("Missing url/key from /api/config");

  // 2) supabase-js 로드 + client 생성
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  supabase = createClient(cfg.url, cfg.key);

  // 3) 익명 로그인 세션 확보
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }

  console.log("✅ Supabase ready:", cfg.url);
}
// ---------------------------------------

function updateSettingsVersionText(){
  try{
    const el=document.getElementById('settingsVersionText');
    const v = (window.__TS_APP_VERSION || 'v22.24.63');
    if(el) el.textContent = "버전 정보 : " + v;
  }catch(_e){}
}

/* Tennis Scoreboard PWA - app.js (v22)
   - Works with index.v14.html layout/IDs
   - Adds NO-AD option, set+game history table, tiebreak superscript, and fixes history snapshot bug
*/
(()=> {
  "use strict";

  // ✅ NOTE: 이 파일 세트(app.js / index.html / service-worker.js)는 v22 최종본
  const APP_VERSION = "v22.24.63";
  // expose for non-module helper functions / UI
  try{ window.__TS_APP_VERSION = APP_VERSION; }catch(_e){}

  const BUILD_ID = APP_VERSION;
  // Hard refresh helper for PWA cache mismatch (service worker old cache / HTML new DOM etc.)
  try{
    const prev = localStorage.getItem("ts_build_id");
    if(prev && prev !== BUILD_ID){
      // clear cached state that may mismatch DOM ids
      // keep user settings in localStorage (state) but clear SW caches to force update
      if(window.caches && caches.keys){
        caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
      }
    }
    localStorage.setItem("ts_build_id", BUILD_ID);
  }catch(_e){}

  const STORAGE_KEY = "tennis_score_state_v14";     // keep existing key
  const HISTORY_KEY = "tennis_score_history_v14";   // keep existing key
  const SCORE_TABLE = ["0","15","30","40"];
  const $ = (id)=>document.getElementById(id);


  // ---------- Responsive scale (mobile portrait/landscape fit) ----------
  // Goal: keep the SAME layout (2-column board) but scale to fit viewport width/height,
  // especially inside iOS/Android "Add to Home Screen" PWA where zoom/viewport can behave oddly.
  const _scaleWrapIds = { setup:"__scaleWrapSetup", board:"__scaleWrapBoard" };

  function ensureScaleWrap(el, key){
    if(!el) return null;
    const wid = _scaleWrapIds[key];
    // If already wrapped, return existing wrapper
    if(el.parentElement && el.parentElement.id === wid) return el.parentElement;

    const wrap = document.createElement("div");
    wrap.id = wid;
    wrap.style.width = "100%";
    wrap.style.display = "flex";
    wrap.style.justifyContent = "center";
    wrap.style.alignItems = "flex-start";
    wrap.style.padding = "0";
    wrap.style.margin = "0";
    wrap.style.overflow = "visible"; // we fit via scale
    // Insert wrap in place of el
    const parent = el.parentElement;
    if(parent){
      parent.insertBefore(wrap, el);
      wrap.appendChild(el);
    }
    return wrap;
  }

  function getViewportBox(){
    const vv = window.visualViewport;
    const w = Math.max(320, Math.floor((vv && vv.width) ? vv.width : window.innerWidth || document.documentElement.clientWidth || 360));
    const h = Math.max(320, Math.floor((vv && vv.height) ? vv.height : window.innerHeight || document.documentElement.clientHeight || 640));
    return { w, h };
  }

  function applyScaleTo(el, key){
    if(!el) return;
    const wrap = ensureScaleWrap(el, key);
    // Temporarily clear transform to measure natural size
    const prevT = el.style.transform;
    const prevO = el.style.transformOrigin;
    el.style.transform = "none";
    el.style.transformOrigin = "top left";

    // Force reflow
    void el.offsetWidth;

    const r = el.getBoundingClientRect();
    const naturalW = Math.max(1, r.width);
    const naturalH = Math.max(1, r.height);

    const { w:vw, h:vh } = getViewportBox();
    const pad = 16; // breathing room
    // Scale to fit both width & height, allow slight upscale on wide landscape
    let s = Math.min((vw - pad) / naturalW, (vh - pad) / naturalH);
    s = Math.max(0.52, Math.min(s, 1.20));

    el.style.transformOrigin = "top left";
    el.style.transform = `scale(${s})`;

    // Reserve scaled height so following content doesn't overlap
    if(wrap){
      wrap.style.height = `${Math.ceil(naturalH * s)}px`;
    }

    // Restore origin var (transform already set)
    if(prevO) el.style.transformOrigin = "top left";
    // keep transform
  }

  
  // ---------- Responsive "fit to screen" (iOS PWA friendly) ----------
  // Goal:
  // - Keep the SAME desktop-like layout (2 columns) on mobile, but scale the whole app to fit.
  // - DO NOT rescale smaller when keyboard opens (typing names) → freeze scale while editing.
  // - Center the scaled UI in both portrait & landscape.
  function applyResponsiveScale(){
    // v22.17: 스케일(축소/중앙정렬) 방식 제거 (board도 포함) → 회전 시 "가운데 작게" / "상단 짤림" 원인
    // 이제는 CSS(반응형) + 스크롤(필요 시)로 화면을 채우고, 어떤 회전 상태에서도 1:1로 맞춥니다.
    const wrap = document.querySelector(".wrap");
    if(!wrap) return;

    wrap.style.transform = "none";
    wrap.style.transformOrigin = "";
    wrap.style.left = "";
    wrap.style.top = "";
    wrap.style.width = "100%";
    wrap.style.maxWidth = "none";
    wrap.style.height = "auto";
    wrap.style.minHeight = "";

    try{ window.scrollTo(0,0); }catch(_e){}
  }



  // Run on resize/orientation/visualViewport changes (iOS needs multiple ticks)
  function scheduleResponsiveScale(){
    updateViewportUnits();
    applyResponsiveScale();
    // iOS: viewport settles late after rotation
    setTimeout(applyResponsiveScale, 60);
    setTimeout(applyResponsiveScale, 180);
    setTimeout(applyResponsiveScale, 360);
  }

  // ---------- Safe localStorage ----------
  const storage = {
    get(key){
      try{ return localStorage.getItem(key); }catch{ return null; }
    },
    set(key, val){
      try{ localStorage.setItem(key, val); }catch{}
    },
    del(key){
      try{ localStorage.removeItem(key); }catch{}
    }
  };

  const deepClone = (o)=>JSON.parse(JSON.stringify(o));

  // ---------- Viewport unit fix (PWA orientation) ----------
  
  // ===== iOS Safari (브라우저) 하단 주소창/툴바가 콘텐츠를 덮는 경우 보정 =====
  function updateSafariBarPadding() {
    try {
      const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
      // Safari에서 display-mode가 불안정할 수 있어 navigator.standalone도 함께 체크
      const standalone = isStandalone || (typeof navigator !== 'undefined' && navigator.standalone);
      if (standalone) {
        document.documentElement.style.setProperty('--safariBar', '0px');
        return;
      }

  // ===== v22.17: 보드 화면 레이아웃 강제 재정렬(세로/가로 전환 & 시작 직후) =====
  function forceBoardLayout() {
    try {
      const board = document.getElementById('boardCard');
      if (!board || board.style.display === 'none') return;
      const inner = board.querySelector('.panelInner');
      if (inner) {
        inner.scrollTop = 0;
        // reflow
        void inner.offsetHeight;
      }
    } catch (e) {}
  }

      // 브라우저 모드: visualViewport가 있으면 innerHeight - visualViewport.height 차이를 하단 바 보정으로 사용
      if (window.visualViewport) {
        const diff = Math.max(0, window.innerHeight - window.visualViewport.height);
        // 너무 과도한 값 방지 (대략 0~140px 범위)
        const bar = Math.min(diff, 140);
        document.documentElement.style.setProperty('--safariBar', `${bar}px`);
      } else {
        // fallback: 보수적으로 80px
        document.documentElement.style.setProperty('--safariBar', '80px');
      }
    } catch (e) {}
  }

function updateViewportUnits(){
    const vv = window.visualViewport;
    const h = vv ? Math.round(vv.height) : window.innerHeight;
    const w = vv ? Math.round(vv.width)  : window.innerWidth;

    const vh = h * 0.01;
    const vw = w * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
    document.documentElement.style.setProperty("--vw", `${vw}px`);
    document.documentElement.style.setProperty("--appH", `${h}px`);
    // keyboard inset (iOS): allow extra bottom padding when keyboard is visible
    try{
      const vv2 = window.visualViewport;
      const kb = vv2 ? Math.max(0, Math.round(window.innerHeight - vv2.height - vv2.offsetTop)) : 0;
      document.documentElement.style.setProperty("--kb", `${kb}px`);
    }catch(_e){}


    // ensure fixed containers match (iOS PWA rotation glitch fix)
    try{
      document.body.style.height = `${h}px`;
      const wrap = document.querySelector(".wrap");
      if(wrap) wrap.style.height = `${h}px`;
      // overflow container scroll reset on major viewport changes
      if(wrap) wrap.scrollTo({top:0, left:0, behavior:"instant"});
    }catch(_e){}

    // Patch viewport meta at runtime (avoid iOS PWA zoom on rotate)
    try{
      const meta = document.querySelector('meta[name="viewport"]');
      if(meta){
        let c = meta.getAttribute("content")||"";
        if(!/viewport-fit=cover/.test(c)) c += (c? ",":"") + "viewport-fit=cover";
        if(!/maximum-scale=1/.test(c)) c += (c? ",":"") + "maximum-scale=1";
        if(!/user-scalable=no/.test(c)) c += (c? ",":"") + "user-scalable=no";
        meta.setAttribute("content", c);
      }
    }catch(_e){}
  }
  
  // ---- Tap helper (iOS PWA / fast click) ----
  let __lastPointerUp = 0;
  function bindTap(el, fn){
    if(!el) return;
    const run = (e)=>{
      try{ fn(e); }catch(err){ showErr("TAP 처리 중 오류:", err); }
    };
    el.addEventListener("pointerup",(e)=>{
      __lastPointerUp = Date.now();
      e.preventDefault();
      run(e);
    }, {passive:false});
    el.addEventListener("touchend",(e)=>{
    // ✅ pointerup이 이미 처리했으면 touchend는 무시 (모바일 2번 실행 방지)
    if(Date.now() - __lastPointerUp < 600){
      e.preventDefault();
      return;
    }
    __lastPointerUp = Date.now();
    e.preventDefault();
    run(e);
    }, {passive:false});  
    el.addEventListener("click",(e)=>{
      if(Date.now()-__lastPointerUp < 600){ e.preventDefault(); return; }
      run(e);
    });
  }

function debounce(fn, ms=120){
    let t=null;
    return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  }


  // ---------- DOM ----------
  const setupCard = $("setupCard");
  const boardCard = $("boardCard");
  const runtimeError = $("runtimeError");

  // setup fields
  const modeSel = $("mode");
  const bestOfSel = $("bestOf");
  const gamesToWinSel = $("gamesToWin");
  const noAdChk = $("noAd");
  const tbOnChk = $("tbOn");

  const singlesInputs = $("singlesInputs");
  const doublesInputs = $("doublesInputs");

  const pA = $("pA");
  const pB = $("pB");
  const pA1 = $("pA1");
  const pA2 = $("pA2");
  const pB1 = $("pB1");
  const pB2 = $("pB2");

  const firstServerSinglesHidden = $("firstServerSingles");
  const firstServerSinglesBtns = $("firstServerSinglesBtns");
  const btnSS_A = $("btnSS_A");
  const btnSS_B = $("btnSS_B");

  const firstServerDoublesHidden = $("firstServerDoubles");
  const firstServerDoublesBtns = $("firstServerDoublesBtns");

  // doubles serve order prefs (per team)
  const doublesStartTeamHidden = $("doublesStartTeam");
  const doublesFirstAHidden = $("doublesFirstA");
  const doublesFirstBHidden = $("doublesFirstB");
  const doublesStartTeamBtns = $("doublesStartTeamBtns");
  const doublesFirstABtns = $("doublesFirstABtns");
  const doublesFirstBBtns = $("doublesFirstBBtns");

  const btnFS_A1 = $("btnFS_A1");
  const btnFS_A2 = $("btnFS_A2");
  const btnFS_B1 = $("btnFS_B1");
  const btnFS_B2 = $("btnFS_B2");

  const startBtn = $("startBtn");
  const loadBtn  = $("loadBtn");

  // board fields
  const nameA = $("nameA");
  const nameB = $("nameB");

  const flapFaceTopA = $("flapFaceTopA");
  const flapFaceTopB = $("flapFaceTopB");
  const flapFaceBottomA = $("flapFaceBottomA");
  const flapFaceBottomB = $("flapFaceBottomB");
  const tbSupA = $("tbSupA");
  const tbSupB = $("tbSupB");

  const gamesA = $("gamesA");
  const gamesB = $("gamesB");
  const setsA  = $("setsA");
  const setsB  = $("setsB");

  const modeBadge  = $("modeBadge");
  const noAdBadge  = $("noAdBadge");
  const tbBadge    = $("tbBadge");
  const courtBadge = $("courtBadge");
  const setNoBadge = $("setNoBadge");
  const awakeBadge = $("awakeBadge");
  const awakeSelect = $("awakeSelect");
  const soundBadge = $("soundBadge");
  const swapBadge  = $("swapBadge");
  const winnerText = $("winnerText");

  // ✅ 중앙 코트 변경(좌/우 스왑) 버튼
  const courtSwapBtn = $("courtSwapBtn");

  const serverLine = $("serverLine");

  const btnPointA = $("btnPointA");
  const btnPointB = $("btnPointB");
  const undoBtn   = $("undoBtn");
  const resetBtn  = $("resetBtn");
  const backBtn   = $("backBtn");

  // history table (index.v14 ids)
  const ghTeamA = $("ghTeamA");
  const ghTeamB = $("ghTeamB");

  const shA = [ $("shA1"), $("shA2"), $("shA3"), $("shA4"), $("shA5") ];
  const shB = [ $("shB1"), $("shB2"), $("shB3"), $("shB4"), $("shB5") ];

  const ghA = Array.from({length:13}, (_,i)=> $("ghA"+(i+1)));
  const ghB = Array.from({length:13}, (_,i)=> $("ghB"+(i+1)));

  // ---------- Small runtime CSS (winner highlight for NO-AD deuce) ----------
  (()=> {
    const st = document.createElement("style");
    st.textContent = `
      .noAdWin40{ color: rgba(61,220,132,1) !important; font-weight: 900; text-shadow: 0 0 12px rgba(61,220,132,.35); }
      .mutedCell{ color: rgba(255,255,255,.55); }
      .srvOn{ color: rgba(61,220,132,1) !important; font-weight: 950; text-shadow: 0 0 10px rgba(61,220,132,.25); }
      .srvOff{ color: rgba(255,255,255,.82) !important; font-weight: 850; text-shadow: none; }
      .srvSep{ color: rgba(255,255,255,.55) !important; font-weight: 800; text-shadow:none; }
            .jsBadge{ position:fixed; right:10px; bottom:10px; z-index:9999; padding:6px 8px; border-radius:10px;
                background:rgba(0,0,0,.55); color:#fff; font:700 12px/1 system-ui; pointer-events:none; }
    `;
    document.head.appendChild(st);
    // version pill (single)
    const vp = document.getElementById('versionPill');
    if(vp){ vp.textContent = 'JS ' + APP_VERSION; }
// ===== v22.17: Modal + Top Buttons Wiring (stable) =====
  function showModal(id){
    const m=document.getElementById(id);
    if(!m) return;
    m.style.display='block';
  }
  function hideModal(id){
    const m=document.getElementById(id);
    if(!m) return;
    m.style.display='none';
  }
  function openSettings(){ showModal('settingsModal'); syncSettingsModalFromState(); }
  function closeSettings(){ hideModal('settingsModal'); }
  function openResetChoice(){ showModal('resetChoiceModal'); }
  function closeResetChoice(){ hideModal('resetChoiceModal'); }

  function onTap(el, fn){
    if(!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('pointerup', (e)=>{ try{ fn(e); }catch(_e){} });
    el.addEventListener('touchend', (e)=>{ e.preventDefault(); try{ fn(e); }catch(_e){} }, {passive:false});
  }

  function syncSettingsModalFromState(){
    // ✅ 설정 모달은 현재 모드(단식/복식)에 맞춰 선수/첫서브를 그대로 표시
    try{
      const isDoubles = (state.mode === 'doubles');
      const sBox = document.getElementById('m_singlesBox');
      const dBox = document.getElementById('m_doublesBox');
      if(sBox) sBox.style.display = isDoubles ? 'none' : 'block';
      if(dBox) dBox.style.display = isDoubles ? 'block' : 'none';

      if(!isDoubles){
        // ---- Singles ----
        const a=document.getElementById('m_pA');
        const b=document.getElementById('m_pB');
        if(a){ a.value = (state.names?.A ?? (state.players?.A ?? state.pA ?? '')); a.readOnly = false; }
        if(b){ b.value = (state.names?.B ?? (state.players?.B ?? state.pB ?? '')); b.readOnly = false; }

        // first server (singles A/B)
        const fsRaw = (state.firstServerSingles || state.firstServer || (Array.isArray(state.serverOrder) ? state.serverOrder[0] : 'A') || 'A');
        const fs = (fsRaw === 'B') ? 'B' : 'A';
        const hid=document.getElementById('m_firstServerSingles');
        if(hid) hid.value = fs;
        const btnA=document.getElementById('m_btnSS_A');
        const btnB=document.getElementById('m_btnSS_B');
        if(btnA) btnA.classList.toggle('on', fs==='A');
        if(btnB) btnB.classList.toggle('on', fs==='B');
        const row=document.getElementById('m_firstServerSinglesBtns');
        if(row) row.style.pointerEvents = '';
      }else{
        // ---- Doubles (표시만: 이름/첫서브는 설정 화면에서 변경) ----
        const a1=document.getElementById('m_pA1');
        const a2=document.getElementById('m_pA2');
        const b1=document.getElementById('m_pB1');
        const b2=document.getElementById('m_pB2');

        const nA1 = (state.names?.A1 ?? state.players?.A1 ?? 'A1');
        const nA2 = (state.names?.A2 ?? state.players?.A2 ?? 'A2');
        const nB1 = (state.names?.B1 ?? state.players?.B1 ?? 'B1');
        const nB2 = (state.names?.B2 ?? state.players?.B2 ?? 'B2');
        if(a1){ a1.value = nA1; a1.readOnly = true; }
        if(a2){ a2.value = nA2; a2.readOnly = true; }
        if(b1){ b1.value = nB1; b1.readOnly = true; }
        if(b2){ b2.value = nB2; b2.readOnly = true; }

        // doubles: 설정 화면(4개 한줄)과 동일하게
        //  - 첫 선택(녹색) = 시작팀의 1st 서버
        //  - 두 번째 선택(파랑) = 상대팀 1st 서버
        // ※ 모달은 표시용(클릭 변경 없음)
        const allowed = new Set(['A1','A2','B1','B2']);

        // Prefer the actual serverOrder (it already encodes A/B 1st/2nd + starting team)
        let order = Array.isArray(state.serverOrder)
          ? state.serverOrder.map(x=>String(x||'').toUpperCase()).filter(k=>allowed.has(k))
          : [];

        // Fallback: rotate base order from stored firstServerDoubles
        if(order.length < 4){
          let base = ['A1','B1','A2','B2'];
          const fs0 = String(state.firstServerDoubles || 'A1').toUpperCase();
          const idx = base.indexOf(fs0);
          if(idx >= 0) base = base.slice(idx).concat(base.slice(0, idx));
          order = base;
        }

        let green = order[0] || 'A1';
        // blue must be the other team's 1st server (normally order[1])
        let blue = order.find(k=>k && k[0] !== green[0]) || (green[0] === 'A' ? 'B1' : 'A1');

        const hid=document.getElementById('m_firstServerDoubles');
        if(hid) hid.value = green;

        const btnA1=document.getElementById('m_btnFS_A1');
        const btnA2=document.getElementById('m_btnFS_A2');
        const btnB1=document.getElementById('m_btnFS_B1');
        const btnB2=document.getElementById('m_btnFS_B2');
        if(btnA1) btnA1.textContent = nA1 || 'A1';
        if(btnA2) btnA2.textContent = nA2 || 'A2';
        if(btnB1) btnB1.textContent = nB1 || 'B1';
        if(btnB2) btnB2.textContent = nB2 || 'B2';

        // highlight: green(on) + blue(onB)
        [btnA1,btnA2,btnB1,btnB2].forEach(btn=>{
          if(!btn) return;
          btn.classList.remove('on');
          btn.classList.remove('onB');
        });
        const row=document.getElementById('m_firstServerDoublesBtns');
        const btnGreen = row ? row.querySelector(`.serverBtn[data-server="${green}"]`) : null;
        const btnBlue  = row ? row.querySelector(`.serverBtn[data-server="${blue}"]`)  : null;
        btnGreen?.classList.add('on');
        btnBlue?.classList.add('onB');

        // 표시만 (클릭으로 값 변경 방지)
        if(row) row.style.pointerEvents = 'none';
      }
    }catch(_e){}
  }

  function applySinglesFromSettingsModal(){
    try{
      const a=document.getElementById('m_pA');
      const b=document.getElementById('m_pB');
      const nameA = a ? a.value.trim() : '';
      const nameB = b ? b.value.trim() : '';
      // keep compatibility with existing state schema
      if(state.players){
        state.players.A = nameA || state.players.A || 'A';
        state.players.B = nameB || state.players.B || 'B';
      }else{
        state.pA = nameA || state.pA || 'A';
        state.pB = nameB || state.pB || 'B';
      }
      const hid=document.getElementById('m_firstServerSingles');
      const fs = hid ? hid.value : 'A';
      state.firstServerSingles = fs;
      // If using generic server state
      if(typeof state.server !== 'undefined'){
        state.server = fs; // singles
      }else{
        state.firstServer = fs;
      }
      saveState(state);
      render(true);
    }catch(_e){}
  }

  function wireSettingsModal(){
    onTap(document.getElementById('settingsBtn'), openSettings);
    onTap(document.getElementById('settingsCloseBtn'), closeSettings);
    onTap(document.getElementById('settingsBackdrop'), closeSettings);

    // in-modal actions
    onTap(document.getElementById('undoBtn'), ()=>{ closeSettings(); undo(); });
    onTap(document.getElementById('resetBtn'), ()=>{ closeSettings(); openResetChoice(); });

    // 운영설정 toggles
    onTap(document.getElementById('tbBadge'), ()=>{ state.tiebreakOn = !state.tiebreakOn; saveState(state); render(true); });
    onTap(document.getElementById('soundBadge'), ()=>{ state.soundOn = !state.soundOn; saveState(state); render(true); });

    // singles name inputs apply
    const a=document.getElementById('m_pA');
    const b=document.getElementById('m_pB');
    if(a) a.addEventListener('change', applySinglesFromSettingsModal);
    if(b) b.addEventListener('change', applySinglesFromSettingsModal);

    // first server buttons
    const hid=document.getElementById('m_firstServerSingles');
    const btnA=document.getElementById('m_btnSS_A');
    const btnB=document.getElementById('m_btnSS_B');
    onTap(btnA, ()=>{ if(hid) hid.value='A'; if(btnA) btnA.classList.add('on'); if(btnB) btnB.classList.remove('on'); applySinglesFromSettingsModal(); });
    onTap(btnB, ()=>{ if(hid) hid.value='B'; if(btnB) btnB.classList.add('on'); if(btnA) btnA.classList.remove('on'); applySinglesFromSettingsModal(); });
  }

  
  // v22.18: reset helpers
  function resetScoresOnly(){
    try{
      closeMatchResultModal();
      _lastMatchResultWinner = null;
      _completedSaveKey = null;
      _completedSavePromise = null;
      _completedSavedKey = null;
      _completedSavedRowId = null;
      clearPendingCompletionPhoto();
      _completedSavedKey = null;
      _completedSavedRowId = null;
      clearPendingCompletionPhoto();
      state.sets = {A:0,B:0};
      state.games = {A:0,B:0};
      resetPoints();
      resetTiebreak();
      state.completedSets = [];
      state.gameHistory = [];
      state.setGameHistories = [];
      state.winner = null;
      undoHistory = [];
      saveUndoHistory(undoHistory);
      saveState(state);
      render(true);
    }catch(err){
      showErr("리셋 오류:", err);
    }
  }

  function resetFullToSetup(){
    try{
      // full reset: clear everything and return to setup screen
      closeMatchResultModal();
      _lastMatchResultWinner = null;
      _completedSaveKey = null;
      _completedSavePromise = null;
      _completedSavedKey = null;
      _completedSavedRowId = null;
      clearCompletionPhotoCache();
      state = defaultState();
      undoHistory = [];
      saveUndoHistory(undoHistory);
      saveState(state);
      showSetup(true);
      render(true);
      try{ window.scrollTo(0,0); }catch(_e){}
    }catch(err){
      showErr("초기화 오류:", err);
    }
  }
  
  let _lastMatchResultWinner = null;
  let _completedSaveKey = null;
  let _completedSavePromise = null;
  let _completedSavedKey = null;
  let _completedSavedRowId = null;
  let _pendingCompletionPhoto = null;
  let _pendingCompletionPhotoSaved = false;
  const COMPLETION_PHOTO_CACHE_KEY = "tennis_completion_photo_cache_v1";
  const COMPLETION_PHOTO_LATEST_BY_MATCH_KEY = "tennis_completion_photo_latest_by_match_v1";

  function getPendingCompletionPhoto(){
    return _pendingCompletionPhoto ? JSON.parse(JSON.stringify(_pendingCompletionPhoto)) : null;
  }

  function isPendingCompletionPhotoSaved(){
    return !!(_pendingCompletionPhoto && _pendingCompletionPhotoSaved);
  }

  function getCompletionPhotoCache(){
    try{
      const raw = localStorage.getItem(COMPLETION_PHOTO_CACHE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(_e){
      return null;
    }
  }

  function setCompletionPhotoCache(patch={}){
    try{
      const base = getCompletionPhotoCache() || {};
      const next = Object.assign({}, base, patch);
      if(!next.photo && !next.rowId && !next.matchKey){
        localStorage.removeItem(COMPLETION_PHOTO_CACHE_KEY);
        return null;
      }
      localStorage.setItem(COMPLETION_PHOTO_CACHE_KEY, JSON.stringify(next));
      return next;
    }catch(_e){
      return null;
    }
  }

  function clearCompletionPhotoCache(){
    try{ localStorage.removeItem(COMPLETION_PHOTO_CACHE_KEY); }catch(_e){}
  }


  function getLatestCompletionPhotosByMatch(){
    try{
      const raw = localStorage.getItem(COMPLETION_PHOTO_LATEST_BY_MATCH_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return (parsed && typeof parsed === 'object') ? parsed : {};
    }catch(_e){ return {}; }
  }

  function getLatestCompletionPhotoForMatchKey(matchKey){
    if(!matchKey) return null;
    try{
      const map = getLatestCompletionPhotosByMatch();
      const photo = map[String(matchKey)] || null;
      return photo && photo.dataUrl ? photo : null;
    }catch(_e){ return null; }
  }

  function setLatestCompletionPhotoForMatchKey(matchKey, photo){
    if(!matchKey || !photo?.dataUrl) return;
    try{
      const map = getLatestCompletionPhotosByMatch();
      map[String(matchKey)] = JSON.parse(JSON.stringify(photo));
      localStorage.setItem(COMPLETION_PHOTO_LATEST_BY_MATCH_KEY, JSON.stringify(map));
    }catch(_e){}
  }

  function clearPendingCompletionPhoto(){
    _pendingCompletionPhoto = null;
    _pendingCompletionPhotoSaved = false;
    clearCompletionPhotoCache();
    try{
      const input = document.getElementById("matchResultPhotoInput");
      if(input) input.value = "";
    }catch(_e){}
    updateMatchResultPhotoUI();
  }

  function setPendingCompletionPhoto(photo){
    _pendingCompletionPhoto = photo ? JSON.parse(JSON.stringify(photo)) : null;
    _pendingCompletionPhotoSaved = false;
    if(_pendingCompletionPhoto){
      const nowIso = new Date().toISOString();
      _pendingCompletionPhoto.updatedAt = nowIso;
      _pendingCompletionPhoto.savedAt = null;
      _pendingCompletionPhoto.versionToken = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      setCompletionPhotoCache({
        photo: _pendingCompletionPhoto,
        rowId: _completedSavedRowId || null,
        matchKey: getCompletedMatchSaveKey() || null,
        saved: false,
        synced: false,
        updatedAt: nowIso
      });
    } else {
      clearCompletionPhotoCache();
    }
    updateMatchResultPhotoUI();
  }

  function _maybeParseJson(value){
    if(value == null) return value;
    if(typeof value !== "string") return value;
    const t = value.trim();
    if(!t) return null;
    if((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))){
      try{ return JSON.parse(t); }catch(_e){ return value; }
    }
    return value;
  }

  function _normalizeCompletionPhotoCandidate(candidate){
    const c = _maybeParseJson(candidate);
    if(!c) return null;
    if(typeof c === "string"){
      if(c.startsWith("data:image/")){
        return {
          name: `match-photo-${Date.now()}.jpg`,
          mimeType: c.slice(5, c.indexOf(';')) || 'image/jpeg',
          sizeBytes: Math.round((c.length * 3) / 4),
          width: null,
          height: null,
          dataUrl: c,
          capturedAt: null,
          createdAt: null,
          updatedAt: null,
          savedAt: null,
          storedAt: null,
          versionToken: null
        };
      }
      return null;
    }
    if(!c.dataUrl) return null;
    return {
      name: c.name || `match-photo-${Date.now()}.jpg`,
      mimeType: c.mimeType || 'image/jpeg',
      sizeBytes: Number.isFinite(c.sizeBytes) ? c.sizeBytes : Math.round((String(c.dataUrl || '').length * 3) / 4),
      width: c.width || null,
      height: c.height || null,
      dataUrl: c.dataUrl,
      capturedAt: c.capturedAt || null,
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null,
      savedAt: c.savedAt || null,
      storedAt: c.storedAt || null,
      versionToken: c.versionToken || null
    };
  }

  function _findCompletionPhotoDeep(root, seen = new Set()){
    if(root == null) return null;

    if(typeof root === 'string'){
      const trimmed = root.trim();
      if(trimmed.startsWith('data:image/')){
        return _normalizeCompletionPhotoCandidate(trimmed);
      }
      const parsed = _maybeParseJson(trimmed);
      if(parsed && parsed !== root){
        return _findCompletionPhotoDeep(parsed, seen);
      }
      return null;
    }

    if(typeof root !== 'object') return null;
    if(seen.has(root)) return null;
    seen.add(root);

    const direct = _normalizeCompletionPhotoCandidate(root);
    if(direct?.dataUrl) return direct;

    const directCandidates = [
      root.completionPhoto,
      root.media?.completionPhoto,
      root.state?.media?.completionPhoto,
      root.state?.completionPhoto,
      root.data?.media?.completionPhoto,
      root.data?.state?.media?.completionPhoto,
      root.data?.completionPhoto
    ];
    for(const candidate of directCandidates){
      const normalized = _normalizeCompletionPhotoCandidate(candidate);
      if(normalized?.dataUrl) return normalized;
    }

    for(const value of Object.values(root)){
      const nested = _findCompletionPhotoDeep(value, seen);
      if(nested?.dataUrl) return nested;
    }
    return null;
  }

  function _collectCompletionPhotosDeep(root, seen = new Set(), out = []){
    if(root == null) return out;

    if(typeof root === 'string'){
      const trimmed = root.trim();
      if(trimmed.startsWith('data:image/')){
        const normalized = _normalizeCompletionPhotoCandidate(trimmed);
        if(normalized?.dataUrl) out.push(normalized);
        return out;
      }
      const parsed = _maybeParseJson(trimmed);
      if(parsed && parsed !== root){
        return _collectCompletionPhotosDeep(parsed, seen, out);
      }
      return out;
    }

    if(typeof root !== 'object') return out;
    if(seen.has(root)) return out;
    seen.add(root);

    const direct = _normalizeCompletionPhotoCandidate(root);
    if(direct?.dataUrl) out.push(direct);

    const directCandidates = [
      root.completionPhoto,
      root.media?.completionPhoto,
      root.state?.media?.completionPhoto,
      root.state?.completionPhoto,
      root.data?.media?.completionPhoto,
      root.data?.state?.media?.completionPhoto,
      root.data?.completionPhoto
    ];
    for(const candidate of directCandidates){
      const normalized = _normalizeCompletionPhotoCandidate(candidate);
      if(normalized?.dataUrl) out.push(normalized);
    }

    for(const value of Object.values(root)){
      _collectCompletionPhotosDeep(value, seen, out);
    }
    return out;
  }

  function getSavedCompletionPhotoFromRow(row){
    const rawData = _maybeParseJson(row?.data) || {};
    const d = (rawData && typeof rawData === 'object') ? rawData : {};
    const s = _maybeParseJson(d?.state) || {};
    const media = _maybeParseJson(d?.media) || {};
    const stateMedia = _maybeParseJson(s?.media) || {};

    const candidates = [
      media?.completionPhoto,
      stateMedia?.completionPhoto,
      s?.completionPhoto,
      d?.completionPhoto,
      row?.media?.completionPhoto,
      row?.completionPhoto,
      d,
      s,
      rawData,
      row
    ];

    const photos = [];
    const seenKeys = new Set();
    for(const candidate of candidates){
      const list = _collectCompletionPhotosDeep(candidate, new Set(), []);
      list.forEach((photo)=>{
        if(!photo?.dataUrl) return;
        const key = `${photo.dataUrl.slice(0,80)}|${photo.versionToken || ''}|${photo.savedAt || photo.updatedAt || photo.capturedAt || ''}`;
        if(seenKeys.has(key)) return;
        seenKeys.add(key);
        photos.push(photo);
      });
    }
    if(!photos.length) return null;
    photos.sort((a,b)=>{
      const ta = _photoTimestampValue(a);
      const tb = _photoTimestampValue(b);
      if(tb !== ta) return tb - ta;
      const va = String(a?.versionToken || '');
      const vb = String(b?.versionToken || '');
      return vb.localeCompare(va);
    });
    return photos[0] || null;
  }

  async function loadRecordById(recordId){
    if(!recordId) return null;
    if (!supabase) await initSupabase();

    const { data, error } = await supabase
      .from("match_records")
      .select("id, created_at, app_version, data")
      .eq("id", recordId)
      .limit(1);

    if(error) throw error;
    return pickSingleRow(data);
  }

  function updateMatchResultPhotoUI(){
    try{
      const wrap = document.getElementById("matchResultPhotoPreviewWrap");
      const img = document.getElementById("matchResultPhotoPreview");
      const meta = document.getElementById("matchResultPhotoMeta");
      const removeBtn = document.getElementById("removeMatchResultPhotoBtn");
      const saveBtn = document.getElementById("saveMatchResultPhotoBtn");
      const statusEl = document.getElementById("matchResultPhotoSaveStatus");
      const photo = getPendingCompletionPhoto();
      const saved = isPendingCompletionPhotoSaved();
      if(!wrap || !img || !meta || !removeBtn) return;
      if(photo?.dataUrl){
        wrap.classList.add("hasPhoto");
        img.src = photo.dataUrl;
        const sizeText = Number.isFinite(photo.sizeBytes) ? ` · ${Math.round(photo.sizeBytes/1024)}KB` : "";
        const dimText = (photo.width && photo.height) ? ` · ${photo.width}×${photo.height}` : "";
        const saveText = saved ? " · 저장 완료" : " · 저장 전";
        meta.textContent = `${photo.name || 'captured-photo.jpg'}${dimText}${sizeText}${saveText}`;
        removeBtn.style.display = "inline-flex";
        if(saveBtn){
          saveBtn.style.display = "inline-flex";
          saveBtn.disabled = !!saved;
          saveBtn.textContent = saved ? "사진 저장 완료" : "사진 저장";
          saveBtn.style.opacity = saved ? "0.62" : "1";
          saveBtn.style.cursor = saved ? "default" : "pointer";
          saveBtn.style.filter = saved ? "grayscale(.08)" : "none";
        }
        if(statusEl){
          statusEl.textContent = saved ? "완료 사진이 경기 기록에 저장되었습니다." : "사진 미리보기 상태입니다. '사진 저장'을 눌러야 경기 기록에 저장됩니다.";
        }
      }else{
        wrap.classList.remove("hasPhoto");
        img.removeAttribute("src");
        meta.textContent = "";
        removeBtn.style.display = "none";
        if(saveBtn){
          saveBtn.style.display = "inline-flex";
          saveBtn.disabled = true;
          saveBtn.textContent = "사진 저장";
          saveBtn.style.opacity = "0.48";
          saveBtn.style.cursor = "not-allowed";
          saveBtn.style.filter = "grayscale(.12)";
        }
        if(statusEl){
          statusEl.textContent = "사진을 촬영하거나 선택한 뒤 저장할 수 있습니다.";
        }
      }
    }catch(_e){}
  }

  function fileToDataURL(file){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = ()=> reject(reader.error || new Error("사진 읽기 실패"));
      reader.readAsDataURL(file);
    });
  }

  function loadImageFromDataUrl(dataUrl){
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload = ()=> resolve(img);
      img.onerror = ()=> reject(new Error("이미지 로드 실패"));
      img.src = dataUrl;
    });
  }

  async function normalizeCompletionPhoto(file){
    const raw = await fileToDataURL(file);
    const img = await loadImageFromDataUrl(raw);
    const maxSide = 1600;
    let { width, height } = img;
    const ratio = Math.min(1, maxSide / Math.max(width, height));
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if(dataUrl.length > 2_800_000){
      dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    }

    return {
      name: (file?.name || `match-photo-${Date.now()}.jpg`).replace(/\.[^.]+$/, ".jpg"),
      mimeType: "image/jpeg",
      sizeBytes: Math.round((dataUrl.length * 3) / 4),
      width,
      height,
      dataUrl,
      capturedAt: new Date().toISOString()
    };
  }

  async function applyCompletionPhotoFile(file){
    if(!file) return null;
    const photo = await normalizeCompletionPhoto(file);
    setPendingCompletionPhoto(photo);
    return photo;
  }

  function pickSingleRow(data){
    if(Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  function _photoTimestampValue(photo){
    if(!photo) return 0;
    const candidates = [photo.savedAt, photo.updatedAt, photo.capturedAt, photo.createdAt, photo.storedAt];
    for(const c of candidates){
      const t = c ? new Date(c).getTime() : 0;
      if(Number.isFinite(t) && t > 0) return t;
    }
    return 0;
  }

  function _rowPhotoTimestampValue(row){
    const photo = getSavedCompletionPhotoFromRow(row);
    const photoTs = _photoTimestampValue(photo);
    if(photoTs > 0) return photoTs;
    const d = _maybeParseJson(row?.data) || {};
    const candidates = [d?.saved_at, row?.updated_at, row?.created_at];
    for(const c of candidates){
      const t = c ? new Date(c).getTime() : 0;
      if(Number.isFinite(t) && t > 0) return t;
    }
    return 0;
  }

  function _stripCompletionPhotoDeep(root, seen = new Set()){
    if(root == null || typeof root !== 'object') return;
    if(seen.has(root)) return;
    seen.add(root);

    if(Array.isArray(root)){
      root.forEach((item)=>_stripCompletionPhotoDeep(item, seen));
      return;
    }

    if(Object.prototype.hasOwnProperty.call(root, 'completionPhoto')){
      try{ delete root.completionPhoto; }catch(_e){ root.completionPhoto = undefined; }
    }

    for(const [key, value] of Object.entries(root)){
      if(key === 'completionPhoto'){
        try{ delete root[key]; }catch(_e){ root[key] = undefined; }
        continue;
      }
      _stripCompletionPhotoDeep(value, seen);
    }
  }

  function buildPhotoMergedRecord(baseRecord, explicitPhoto=null){
    const base = _maybeParseJson(baseRecord) || {};
    const record = (base && typeof base === 'object') ? JSON.parse(JSON.stringify(base)) : {};
    _stripCompletionPhotoDeep(record);
    const cache = getCompletionPhotoCache() || null;
    const photo = explicitPhoto || getPendingCompletionPhoto() || (((cache?.saved || cache?.synced) && cache?.photo?.dataUrl) ? cache.photo : null);
    if(!photo?.dataUrl) return record;
    const photoCopy = JSON.parse(JSON.stringify(photo));
    const nowIso = new Date().toISOString();
    photoCopy.updatedAt = nowIso;
    photoCopy.savedAt = nowIso;
    if(!photoCopy.versionToken) photoCopy.versionToken = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    if(!record.media || typeof record.media !== 'object') record.media = {};
    record.media.completionPhoto = JSON.parse(JSON.stringify(photoCopy));
    record.completionPhoto = JSON.parse(JSON.stringify(photoCopy));
    if(!record.state || typeof record.state !== 'object'){
      const snap = window.__TS_SNAPSHOT?.();
      record.state = JSON.parse(JSON.stringify(snap?.state || state || {}));
    }
    if(!record.state.media || typeof record.state.media !== 'object') record.state.media = {};
    record.state.media.completionPhoto = JSON.parse(JSON.stringify(photoCopy));
    record.state.completionPhoto = JSON.parse(JSON.stringify(photoCopy));
    const matchKey = record.match_key || record.state?.matchKey || getCompletedMatchSaveKey() || null;
    if(matchKey){
      record.match_key = matchKey;
      record.state.matchKey = matchKey;
    }
    record.status = record.state?.winner ? 'completed' : (record.status || 'completed');
    record.save_reason = 'completed_photo_update';
    record.saved_at = new Date().toISOString();
    return record;
  }

  async function repairCompletionPhotoForRow(row){
    try{
      const cache = getCompletionPhotoCache();
      if(!row?.id || !cache?.photo?.dataUrl || !(cache?.saved || cache?.synced)) return row;
      if(cache.rowId && String(cache.rowId) !== String(row.id)) return row;
      const existing = getSavedCompletionPhotoFromRow(row);
      if(existing?.dataUrl) return row;
      const latest = await loadRecordById(row.id).catch(()=> row);
      if(getSavedCompletionPhotoFromRow(latest)?.dataUrl) return latest;
      if (!supabase) await initSupabase();
      const merged = buildPhotoMergedRecord((_maybeParseJson(latest?.data) || latest?.data || latest));
      const { data, error } = await supabase
        .from('match_records')
        .update({ app_version: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'v-current'), data: merged })
        .eq('id', row.id)
        .select('id, created_at, app_version, data');
      if(error) throw error;
      const updated = pickSingleRow(data) || row;
      setCompletionPhotoCache({ synced: true, rowId: row.id, updatedAt: new Date().toISOString() });
      return updated;
    }catch(err){
      console.warn('repairCompletionPhotoForRow failed', err);
      return row;
    }
  }

  async function persistCompletionPhotoToSavedRecord(){
    const cachePhoto = getCompletionPhotoCache()?.photo || null;
    if(!_pendingCompletionPhoto && cachePhoto?.dataUrl){
      _pendingCompletionPhoto = JSON.parse(JSON.stringify(cachePhoto));
    }
    const currentPhoto = getPendingCompletionPhoto();
    if(!currentPhoto?.dataUrl) return null;
    if(!_completedSavedRowId){
      await ensureCompletedMatchSaved();
    }
    if(!_completedSavedRowId) return null;
    if (!supabase) await initSupabase();

    const saveRowId = _completedSavedRowId;
    const latestRow = await loadRecordById(saveRowId).catch(()=>null);
    const latestRecord = _maybeParseJson(latestRow?.data) || null;
    const mergedRecord = buildPhotoMergedRecord(latestRecord || buildRecordPayload('completed_photo_update'), currentPhoto);

    const updateOnce = async (recordToSave)=>{
      const { data, error } = await supabase
        .from("match_records")
        .update({
          app_version: (typeof APP_VERSION !== "undefined" ? APP_VERSION : "v-current"),
          data: recordToSave
        })
        .eq("id", saveRowId)
        .select("id, created_at, app_version, data");
      if(error) throw error;
      return pickSingleRow(data) || null;
    };

    let row = await updateOnce(mergedRecord) || latestRow || null;
    let verifiedRow = await loadRecordById(saveRowId).catch(()=> row) || row;
    let verifiedPhoto = getSavedCompletionPhotoFromRow(verifiedRow);

    if(!verifiedPhoto?.dataUrl){
      const retryBase = _maybeParseJson(verifiedRow?.data) || verifiedRow?.data || mergedRecord;
      row = await updateOnce(buildPhotoMergedRecord(retryBase, currentPhoto)) || row;
      verifiedRow = await loadRecordById(saveRowId).catch(()=> row) || row;
      verifiedPhoto = getSavedCompletionPhotoFromRow(verifiedRow);
    }

    if(!verifiedPhoto?.dataUrl){
      const fallbackRecord = buildPhotoMergedRecord(buildRecordPayload('completed_photo_insert_fallback'), currentPhoto);
      const { data: inserted, error: insertError } = await supabase
        .from("match_records")
        .insert({ app_version: (typeof APP_VERSION !== "undefined" ? APP_VERSION : "v-current"), data: fallbackRecord })
        .select("id, created_at, app_version, data");
      if(insertError) throw insertError;
      verifiedRow = pickSingleRow(inserted) || verifiedRow || row;
      verifiedPhoto = getSavedCompletionPhotoFromRow(verifiedRow);
    }

    if(!verifiedPhoto?.dataUrl){
      throw new Error("사진 저장 확인 실패");
    }

    if(verifiedRow?.id) _completedSavedRowId = verifiedRow.id;
    _pendingCompletionPhotoSaved = true;
    const savedPhoto = Object.assign({}, getPendingCompletionPhoto() || {}, {
      updatedAt: verifiedPhoto?.updatedAt || new Date().toISOString(),
      savedAt: verifiedPhoto?.savedAt || new Date().toISOString(),
      versionToken: verifiedPhoto?.versionToken || getPendingCompletionPhoto()?.versionToken || `${Date.now()}_${Math.random().toString(36).slice(2,8)}`
    });
    _pendingCompletionPhoto = JSON.parse(JSON.stringify(savedPhoto));
    const latestMatchKey = getCompletedMatchSaveKey() || null;
    setCompletionPhotoCache({
      photo: JSON.parse(JSON.stringify(savedPhoto)),
      rowId: _completedSavedRowId || saveRowId || null,
      matchKey: latestMatchKey,
      saved: true,
      synced: true,
      updatedAt: savedPhoto.savedAt || savedPhoto.updatedAt || new Date().toISOString()
    });
    setLatestCompletionPhotoForMatchKey(latestMatchKey, savedPhoto);
    updateMatchResultPhotoUI();
    return verifiedRow;
  }

  function openPhotoViewer(photo){
    try{
      if(!photo?.dataUrl) return;
      const old = document.getElementById("completionPhotoViewerBackdrop");
      if(old) old.remove();
      const backdrop = document.createElement("div");
      backdrop.id = "completionPhotoViewerBackdrop";
      backdrop.style.cssText = `position:fixed; inset:0; z-index:11000; background:rgba(0,0,0,.78); display:flex; align-items:center; justify-content:center; padding:16px;`;
      const card = document.createElement("div");
      card.style.cssText = `width:min(92vw, 900px); max-height:90vh; overflow:auto; border-radius:16px; background:#111214; border:1px solid rgba(255,255,255,.12); color:#fff;`;
      const head = document.createElement("div");
      head.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.08);`;
      const fileName = photo.name || 'match-photo.jpg';
      head.innerHTML = `<div style="font-weight:800;">완료 사진</div><div style="display:flex; gap:8px; align-items:center;"><a href="${photo.dataUrl}" download="${fileName}" style="padding:8px 10px; border-radius:10px; background:rgba(59,130,246,.24); border:1px solid rgba(59,130,246,.45); color:#eaf3ff; text-decoration:none;">다운로드</a><button id="completionPhotoViewerCloseBtn" style="border:0; background:transparent; color:#fff; font-size:18px; cursor:pointer;">✕</button></div>`;
      const body = document.createElement("div");
      body.style.cssText = `padding:14px;`;
      body.innerHTML = `<img src="${photo.dataUrl}" alt="완료 사진" style="display:block; width:100%; height:auto; border-radius:12px; border:1px solid rgba(255,255,255,.10); background:#0f1012;" />`;
      card.appendChild(head);
      card.appendChild(body);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);
      document.getElementById("completionPhotoViewerCloseBtn")?.addEventListener("click", ()=>backdrop.remove());
      backdrop.addEventListener("click", (e)=>{ if(e.target === backdrop) backdrop.remove(); });
    }catch(err){
      console.error(err);
      alert("사진 보기 중 오류가 발생했습니다.");
    }
  }

  function getCompletedMatchSaveKey(){
    try{
      if(!state || !state.winner) return null;
      const names = state.names || {};
      return JSON.stringify({
        winner: state.winner,
        mode: state.mode,
        bestOf: state.bestOf,
        gamesToWin: state.gamesToWin,
        sets: state.sets,
        games: state.games,
        completedSets: state.completedSets,
        names: [names.A, names.B, names.A1, names.A2, names.B1, names.B2]
      });
    }catch(_e){
      return String(Date.now());
    }
  }

  function buildRecordPayload(saveReason="manual"){
    const now = new Date().toISOString();
    const snap = window.__TS_SNAPSHOT?.();
    if(!snap) throw new Error("__TS_SNAPSHOT이 없습니다");

    const snapState = JSON.parse(JSON.stringify(snap.state || state || {}));
    const snapUndo  = JSON.parse(JSON.stringify(snap.undoHistory || []));
    const isCompleted = !!snapState.winner;
    const completedKey = isCompleted ? (snapState.matchKey || getCompletedMatchSaveKey() || null) : null;
    if(isCompleted && !snapState.completedAt) snapState.completedAt = now;
    if(completedKey) snapState.matchKey = completedKey;

    const media = {};
    const completionPhoto = (isCompleted && isPendingCompletionPhotoSaved()) ? getPendingCompletionPhoto() : null;
    if(completionPhoto && isCompleted){
      media.completionPhoto = JSON.parse(JSON.stringify(completionPhoto));
      if(!snapState.media || typeof snapState.media !== "object") snapState.media = {};
      snapState.media.completionPhoto = JSON.parse(JSON.stringify(completionPhoto));
      snapState.completionPhoto = JSON.parse(JSON.stringify(completionPhoto));
    }

    return {
      schema_version: "match_v1",
      saved_at: now,
      status: isCompleted ? "completed" : "in_progress",
      save_reason: saveReason,
      completed_at: isCompleted ? (snapState.completedAt || now) : null,
      match_key: completedKey,
      completionPhoto: completionPhoto ? JSON.parse(JSON.stringify(completionPhoto)) : null,
      state: snapState,
      undoHistory: snapUndo,
      media
    };
  }

  async function saveCurrentRecord(saveReason="manual"){
    if (!supabase) await initSupabase();
    const record = buildRecordPayload(saveReason);
    const { data, error } = await supabase
      .from("match_records")
      .insert({ app_version: (typeof APP_VERSION !== "undefined" ? APP_VERSION : "v-current"), data: record })
      .select("id, data");
    if (error) throw error;
    const row = pickSingleRow(data);
    return { rowId: row?.id || null, record: row?.data || record };
  }

  async function ensureCompletedMatchSaved(){
    if(!state || !state.winner) return null;
    const key = getCompletedMatchSaveKey();
    if(!key) return null;

    if(_completedSavedKey === key) return { alreadySaved:true, key };
    if(_completedSaveKey === key && _completedSavePromise) return _completedSavePromise;

    _completedSaveKey = key;
    _completedSavePromise = (async ()=>{
      try{
        const result = await saveCurrentRecord("auto_completed");
        _completedSavedKey = key;
        _completedSavedRowId = result?.rowId || _completedSavedRowId;
        setCompletionPhotoCache({ rowId: _completedSavedRowId || null, matchKey: key, updatedAt: new Date().toISOString() });
        return result;
      }catch(err){
        _completedSaveKey = null;
        throw err;
      }finally{
        _completedSavePromise = null;
      }
    })();
    return _completedSavePromise;
  }

  function showMatchResultModal(){
    try{
      const modal = document.getElementById("matchResultModal");
      const textEl = document.getElementById("matchResultWinText");
      if(!modal || !textEl || !state?.winner) return;

      textEl.textContent = `${state.winner} 승리!`;
      updateMatchResultPhotoUI();
      modal.style.display = "block";
      modal.setAttribute("aria-hidden", "false");
    }catch(err){
      showErr("결과 모달 표시 오류:", err);
    }
  }

  function closeMatchResultModal(){
    const modal = document.getElementById("matchResultModal");
    if(modal){
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }
  }

  async function regameFromMatchResult(){
    try{
      await ensureCompletedMatchSaved();
      await persistCompletionPhotoToSavedRecord();
      closeMatchResultModal();
      resetScoresOnly();
      state.started = true;
      state.winner = null;
      saveState(state);
      render(true);
      try{ document.querySelector(".wrap")?.scrollTo({top:0, left:0, behavior:"auto"}); }catch(_e){}
    }catch(err){
      showErr("REGAME 처리 오류:", err);
    }
  }

  async function goSetupFromMatchResult(){
    try{
      await ensureCompletedMatchSaved();
      await persistCompletionPhotoToSavedRecord();
      closeMatchResultModal();
      resetFullToSetup();
    }catch(err){
      showErr("설정창 이동 오류:", err);
    }
  }

  function wireMatchResultModal(){
    const backdrop = document.getElementById("matchResultBackdrop");
    const regameBtn = document.getElementById("regameBtn");
    const setupBtn = document.getElementById("goSetupAfterMatchBtn");
    const takePhotoBtn = document.getElementById("takeMatchResultPhotoBtn");
    const savePhotoBtn = document.getElementById("saveMatchResultPhotoBtn");
    const removePhotoBtn = document.getElementById("removeMatchResultPhotoBtn");
    const photoInput = document.getElementById("matchResultPhotoInput");

    if(backdrop && !backdrop.__matchResultWired){
      backdrop.__matchResultWired = true;
      backdrop.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); });
    }
    if(regameBtn && !regameBtn.__matchResultWired){
      regameBtn.__matchResultWired = true;
      regameBtn.addEventListener("click", async (e)=>{
        e.preventDefault(); e.stopPropagation();
        await regameFromMatchResult();
      });
    }
    if(setupBtn && !setupBtn.__matchResultWired){
      setupBtn.__matchResultWired = true;
      setupBtn.addEventListener("click", async (e)=>{
        e.preventDefault(); e.stopPropagation();
        await goSetupFromMatchResult();
      });
    }
    if(takePhotoBtn && !takePhotoBtn.__matchResultWired){
      takePhotoBtn.__matchResultWired = true;
      takePhotoBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();
        photoInput?.click();
      });
    }
    if(removePhotoBtn && !removePhotoBtn.__matchResultWired){
      removePhotoBtn.__matchResultWired = true;
      removePhotoBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();
        clearPendingCompletionPhoto();
      });
    }
    if(savePhotoBtn && !savePhotoBtn.__matchResultWired){
      savePhotoBtn.__matchResultWired = true;
      savePhotoBtn.addEventListener("click", async (e)=>{
        e.preventDefault();
        e.stopPropagation();
        try{
          if(!getPendingCompletionPhoto()?.dataUrl) return;
          await ensureCompletedMatchSaved();
          await persistCompletionPhotoToSavedRecord();
        }catch(err){
          console.error(err);
          alert("사진 저장 실패: " + (err?.message || err));
        }
      });
    }
    if(photoInput && !photoInput.__matchResultWired){
      photoInput.__matchResultWired = true;
      photoInput.addEventListener("change", async ()=>{
        try{
          const file = photoInput.files?.[0];
          if(!file) return;
          await applyCompletionPhotoFile(file);
        }catch(err){
          console.error(err);
          alert("사진 처리 실패: " + (err?.message || err));
        }
      });
    }
    updateMatchResultPhotoUI();
  }

function wireResetChoiceModal(){

    onTap(document.getElementById('resetChoiceCloseBtn'), closeResetChoice);
    onTap(document.getElementById('resetChoiceBackdrop'), closeResetChoice);

    onTap(document.getElementById('resetFullBtn'), ()=>{ closeResetChoice(); resetFullToSetup(); });
    onTap(document.getElementById('resetScoreOnlyBtn'), ()=>{ closeResetChoice(); resetScoresOnly(); });
  }

  function wireTopButtons(){
    onTap(document.getElementById('undoMiniBtn'), ()=>undo());
    onTap(document.getElementById('resetMiniBtn'), ()=>openResetChoice());
    // settingsBtn handled in wireSettingsModal
  }



  // ---------- State ----------
  function defaultState(){
    return {
      started:false,
      mode:"doubles",
      bestOf:1,
      gamesToWin:4,
      noAd:true,
  
      // preference: whether to play a tiebreak game at 3:3 or 6:6
      // default: 4게임=OFF, 6게임=ON
      tiebreakOn:false,

      names:{ A:"Player A", B:"Player B", A1:"A1", A2:"A2", B1:"B1", B2:"B2" },

      sets:{A:0,B:0},
      games:{A:0,B:0},
      points:{A:0,B:0},

      // runtime: whether the current game is a tiebreak
      tiebreak:false,
      tbPoints:{A:0,B:0},

      // serving
      serverOrder:["A1","B1","A2","B2"],     // singles: ["A","B"] or ["B","A"]; doubles: rotated ["A1","B1","A2","B2"]
      serverIndex:0,             // index in serverOrder for the current game (and first point of TB)

      completedSets: [],         // [{A:6,B:4,tbA:undefined,tbB:undefined}, ...]
      gameHistory: [],           // length <=13, elements: {A:"40",B:"30", noAdDeuceWinner:"A"|"B"|null}
      setGameHistories: [],     // ✅ 세트별 게임기록 누적(마지막 게임 누락 방지)
      
      keepAwakeMins:0,
      soundOn:false,
      winner:null,
      swapSides:false
    };
  }

  function migrateState(raw){
    const d = defaultState();
    if(!raw || typeof raw !== "object") return d;

    // allow old keys (v14) to load, but don't trust shape too much
    const s = deepClone(d);

    const pick = (k)=> raw[k] !== undefined ? raw[k] : undefined;

    if(typeof pick("mode")==="string") s.mode = pick("mode");
    if(typeof pick("bestOf")==="number") s.bestOf = pick("bestOf");
    if(typeof pick("gamesToWin")==="number") s.gamesToWin = pick("gamesToWin");
    if(typeof pick("noAd")==="boolean") s.noAd = pick("noAd");
    if(typeof pick("started")==="boolean") s.started = pick("started");

    if(pick("names") && typeof pick("names")==="object") s.names = {...s.names, ...pick("names")};

    if(pick("sets") && typeof pick("sets")==="object") s.sets = {A: +pick("sets").A||0, B:+pick("sets").B||0};
    if(pick("games") && typeof pick("games")==="object") s.games = {A: +pick("games").A||0, B:+pick("games").B||0};
    if(pick("points") && typeof pick("points")==="object") s.points = {A: +pick("points").A||0, B:+pick("points").B||0};

    // preference: play tiebreak at 3:3 / 6:6
    if(typeof pick("tiebreakOn")==="boolean") s.tiebreakOn = pick("tiebreakOn");
    else s.tiebreakOn = (s.gamesToWin === 6);

    if(typeof pick("tiebreak")==="boolean") s.tiebreak = pick("tiebreak");
    if(pick("tbPoints") && typeof pick("tbPoints")==="object") s.tbPoints = {A: +pick("tbPoints").A||0, B:+pick("tbPoints").B||0};

    if(Array.isArray(pick("serverOrder")) && pick("serverOrder").length>=2) s.serverOrder = pick("serverOrder");
    if(typeof pick("serverIndex")==="number") s.serverIndex = Math.max(0, Math.min(s.serverOrder.length-1, pick("serverIndex")|0));

    if(Array.isArray(pick("completedSets"))) s.completedSets = pick("completedSets").slice(0,5);
    if(Array.isArray(pick("gameHistory"))) s.gameHistory = pick("gameHistory").slice(0,13);

    // screen keep-awake setting (minutes). 0 = unlimited, 5/10 = release after inactivity minutes
    if(typeof pick("keepAwakeMins")==="number") s.keepAwakeMins = pick("keepAwakeMins");
    else if(typeof pick("keepAwake")==="boolean") s.keepAwakeMins = 0; // v22.24.26+: default to unlimited
    if(typeof pick("soundOn")==="boolean") s.soundOn = pick("soundOn");
    if(typeof pick("winner")==="string" || pick("winner")===null) s.winner = pick("winner");
    if(typeof pick("swapSides")==="boolean") s.swapSides = pick("swapSides");

    // sanity
    if(s.mode !== "doubles") s.mode = "singles";
    // bestOf: 1/3/5만 허용
    if (![1,3,5].includes(s.bestOf)) s.bestOf = 1;
    // gamesToWin: 4/6만 허용 (추가)
    if(![4,6].includes(s.gamesToWin)) s.gamesToWin = 4;
    if(s.completedSets.length > 5) s.completedSets = s.completedSets.slice(0,5);
    if(s.gameHistory.length > 13) s.gameHistory = s.gameHistory.slice(0,13);
    if(Array.isArray(pick("setGameHistories"))) {
      s.setGameHistories = pick("setGameHistories")
        .slice(0,5)
        .map(arr => Array.isArray(arr) ? arr.slice(0,13) : []);
    }

    return s;
  }

  function loadState(){
    try{
      const txt = storage.get(STORAGE_KEY);
      if(!txt) return defaultState();
      return migrateState(JSON.parse(txt));
    }catch{
      return defaultState();
    }
  }
  function saveState(s){
    storage.set(STORAGE_KEY, JSON.stringify(s));
  }

  function loadUndoHistory(){
    try{
      const txt = storage.get(HISTORY_KEY);
      if(!txt) return [];
      const arr = JSON.parse(txt);
      return Array.isArray(arr) ? arr : [];
    }catch{ return []; }
  }
  function saveUndoHistory(h){
    storage.set(HISTORY_KEY, JSON.stringify(h));
  }

  let state = loadState();
  let undoHistory = loadUndoHistory();
  // ✅ Cloud save용: 현재 경기 상태 스냅샷 노출
  try{
    window.__TS_SNAPSHOT = () => ({
      app_version: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : (window.__TS_APP_VERSION || null)),
      state: JSON.parse(JSON.stringify(state)),
      undoHistory: JSON.parse(JSON.stringify(undoHistory))
    });
  }catch(_e){}

  // ---------- Helpers ----------
  function bestOfWinTarget(bestOf){ return Math.floor(bestOf/2)+1; }

  function teamForSide(side){
    if(!state.swapSides) return (side==="L") ? "A" : "B";
    return (side==="L") ? "B" : "A";
  }

  function teamName(team){
    if(state.mode==="doubles"){
      return team==="A"
        ? `${state.names.A1} & ${state.names.A2}`
        : `${state.names.B1} & ${state.names.B2}`;
    }
    return state.names[team] || team;
  }

  function serverKeyToName(key){
    // key: A,B,A1,A2,B1,B2
    return state.names[key] || key;
  }

  function currentSetNo(){
    // 1-based
    const played = Array.isArray(state.completedSets) ? state.completedSets.length : 0;
  
    // ✅ 경기 종료면 "다음 세트"가 아니라 마지막 세트 번호를 유지
    if(state.winner) return Math.max(1, Math.min(5, played));
  
    return Math.min(5, played + 1);
  }

  function currentGameNo(){
    if(state.tiebreak) return 13;
  
    const total = (state.games?.A || 0) + (state.games?.B || 0);
  
    // ✅ 경기 종료면 "다음 게임"이 아니라 마지막 게임 번호를 유지
    if(state.winner) return Math.min(13, Math.max(1, total));
  
    return Math.min(13, Math.max(1, total + 1));
  }

  function showErr(title, err){
    if(!runtimeError) return;
    runtimeError.style.display = "block";
    runtimeError.textContent = `JS 오류: ${title} ${err ? (err.message || err) : ""}`;
    console.error(title, err);
  }
  function clearErr(){
    if(!runtimeError) return;
    runtimeError.style.display = "none";
    runtimeError.textContent = "";
  }

  function clickSound(){
    if(!state.soundOn) return;
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 660;
      g.gain.value = 0.06;
      o.start();
      setTimeout(()=>{ o.stop(); ctx.close(); }, 60);
    }catch{}
  }

  // ---------- Points / win logic ----------
  function displayPointForTeam(team){
    if(state.tiebreak) return String(state.tbPoints[team] || 0);

    const p = state.points[team] || 0;
    const o = state.points[team==="A" ? "B" : "A"] || 0;

    if(isNoAdEffective()){
      return SCORE_TABLE[Math.min(p,3)] || "0";
    }

    // normal AD tennis
    if(p>=3 && o>=3){
      if(p===o) return "40";
      if(p===o+1) return "AD";
      return "40";
    }
    return SCORE_TABLE[p] || "0";
  }

  // Snapshot used for game history when a game ends (fix: winner at 40 stays "40", not "0")
  function historyPointForTeam(team){
    if(state.tiebreak) return String(state.tbPoints[team] || 0);

    const p = state.points[team] || 0;
    const o = state.points[team==="A" ? "B" : "A"] || 0;

    if(isNoAdEffective()){
      return SCORE_TABLE[Math.min(p,3)] || "0";
    }

    // never write "AD" in history; keep "40"
    if(p>=3 && o>=3) return "40";
    return SCORE_TABLE[Math.min(p,3)] || "0";
  }

  
  // NO-AD effective flag
  // Source of truth is `state.noAd` (설정창 표시와 동일).
  // Setup 화면의 토글은 state.noAd로 저장/동기화되므로, 게임 판정은 state만 보도록 고정.
  function isNoAdEffective(){
    return !!state.noAd;
  }

function checkWinTiebreak(){
    const a=state.tbPoints.A, b=state.tbPoints.B;
    if(a>=7 && a-b>=2) return "A";
    if(b>=7 && b-a>=2) return "B";
    return null;
  }

  function checkWinGameNormal(){
    const a=state.points.A, b=state.points.B;

    if(isNoAdEffective()){
      // sudden-death at deuce (40:40)
      if(a>=3 && b>=3){
        if(a-b>=1) return "A";
        if(b-a>=1) return "B";
        return null;
      }
      if(a>=4 && a-b>=2) return "A";
      if(b>=4 && b-a>=2) return "B";
      return null;
    }

    if(a>=4 && a-b>=2) return "A";
    if(b>=4 && b-a>=2) return "B";
    return null;
  }

  function checkEnterTiebreak(){
  const t = getTbTrigger();
  return !!state.tiebreakOn && state.games.A===t && state.games.B===t;
  }

  function getGamesToWin(){
  return (state.gamesToWin === 4) ? 4 : 6;
  }
  function getTbTrigger(){
    // 4게임이면 3-3에서 TB, 6게임이면 6-6에서 TB
    return (getGamesToWin() === 4) ? 3 : 6;
  }  
    
  function checkWinSet(){
    const a = state.games.A, b = state.games.B;
    const gtw = getGamesToWin();
    const tbBase = getTbTrigger(); // 4게임=3, 6게임=6
  
    // TB로 끝난 세트: 4-3 또는 7-6 (tiebreakOn일 때)
    if (a === tbBase + 1 && b === tbBase) return "A";
    if (b === tbBase + 1 && a === tbBase) return "B";
  
    // 일반 세트 승리: 4(or6) 이상 + 2게임 차
    if (a >= gtw && a - b >= 2) return "A";
    if (b >= gtw && b - a >= 2) return "B";
    return null;
  }

  function checkWinMatch(){
    const t = bestOfWinTarget(state.bestOf);
    if(state.sets.A>=t) return "A";
    if(state.sets.B>=t) return "B";
    return null;
  }

  function resetPoints(){ state.points.A=0; state.points.B=0; }

  function resetTiebreak(){
    state.tbPoints.A=0; state.tbPoints.B=0;
    state.tiebreak=false;
  }

  function advanceServerAfterGame(){
    state.serverIndex = (state.serverIndex + 1) % state.serverOrder.length;
  }

  function currentServerKey(){
    const order = state.serverOrder;
    const baseIdx = state.serverIndex % order.length;

    if(!state.tiebreak){
      return order[baseIdx];
    }

    // tiebreak: 1st point by current server, then rotate every 2 points, starting with next server
    const n = (state.tbPoints.A + state.tbPoints.B); // already played points count
    if(n===0) return order[baseIdx];
    const k = 1 + Math.floor((n-1)/2);
    return order[(baseIdx + k) % order.length];
  }

  function currentCourtLabel(){
    const total = state.tiebreak
      ? (state.tbPoints.A + state.tbPoints.B)
      : (state.points.A + state.points.B);
    return (total % 2 === 0) ? "듀스" : "애드";
  }

  // ---------- Undo ----------
  function pushUndo(){
    undoHistory.push(deepClone(state));
    if(undoHistory.length>200) undoHistory.shift();
    saveUndoHistory(undoHistory);
  }

  function undo(){
    if(undoHistory.length===0) return;
    state = migrateState(undoHistory.pop());
    saveUndoHistory(undoHistory);
    saveState(state);
    clickSound();
    render(true);
    try{ document.querySelector(".wrap")?.scrollTo({top:0, left:0, behavior:"auto"}); }catch(_e){}
    try{ updateViewportUnits(); }catch(_e){}
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 60);
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 220);
    scheduleResponsiveScale();
    syncWakeLock();
  }

  // ---------- History table ----------
  function renderHistoryTable(){
    if(!ghTeamA || !ghTeamB) return;

    ghTeamA.textContent = "A";
    ghTeamB.textContent = "B";

    // set cols: completed sets + current set games
    for(let i=0;i<5;i++){
      shA[i].textContent = "";
      shB[i].textContent = "";
    }

    const played = state.completedSets || [];
    for(let i=0;i<Math.min(played.length,5);i++){
      shA[i].textContent = String(played[i].A ?? "");
      shB[i].textContent = String(played[i].B ?? "");
    }

    const curSet = currentSetNo();
    if(!state.winner && curSet>=1 && curSet<=5){
      shA[curSet-1].textContent = String(state.games.A);
      shB[curSet-1].textContent = String(state.games.B);
      shA[curSet-1].classList.add("mutedCell");
      shB[curSet-1].classList.add("mutedCell");
    }
    for(let i=0;i<5;i++){
      if(i !== (curSet-1)){
        shA[i].classList.remove("mutedCell");
        shB[i].classList.remove("mutedCell");
      }
    }

    // game cols: snapshot per game in current set
    const gNo = currentGameNo();

    for(let i=0;i<13;i++){
      if(ghA[i]){
        ghA[i].textContent = "";
        ghA[i].classList.remove("noAdWin40");
        ghA[i].classList.remove("mutedCell");
      }
      if(ghB[i]){
        ghB[i].textContent = "";
        ghB[i].classList.remove("noAdWin40");
        ghB[i].classList.remove("mutedCell");
      }
    }

    const recs = state.gameHistory || [];
    for(let i=0;i<Math.min(recs.length,13);i++){
      const r = recs[i];
      if(ghA[i]) ghA[i].textContent = r?.A ?? "";
      if(ghB[i]) ghB[i].textContent = r?.B ?? "";
      // winner highlight rules
      // - NO-AD ON: 40:40에서 단 1포인트로 게임 종료 → 승자 셀(40)을 강조
      // - NO-AD OFF: 듀스/AD 구간에서 승리 → 승자 셀(AD)을 기록하고 강조
      if(r && r.noAdDeuceWinner){
        const win = r.noAdDeuceWinner;
        if(win==="A" && ghA[i] && (r.A==="40")) ghA[i].classList.add("noAdWin40");
        if(win==="B" && ghB[i] && (r.B==="40")) ghB[i].classList.add("noAdWin40");
      }
      if(r && r.adDeuceWinner){
        const win = r.adDeuceWinner;
        if(win==="A" && ghA[i] && (r.A==="AD")) ghA[i].classList.add("noAdWin40");
        if(win==="B" && ghB[i] && (r.B==="AD")) ghB[i].classList.add("noAdWin40");
      }
    }

    // current game live point display
    const liveIdx = gNo - 1;
    if(!state.winner && liveIdx>=0 && liveIdx<13){
      if(!recs[liveIdx]){
        if(ghA[liveIdx]){ ghA[liveIdx].textContent = displayPointForTeam("A"); ghA[liveIdx].classList.add("mutedCell"); }
        if(ghB[liveIdx]){ ghB[liveIdx].textContent = displayPointForTeam("B"); ghB[liveIdx].classList.add("mutedCell"); }
      }
    }
  }

  function recordGameSnapshot(winnerTeam){
    const idx = currentGameNo() - 1;
    let aTxt = historyPointForTeam("A");
    let bTxt = historyPointForTeam("B");

    const endedOnNoAdDeuce = !!(state.noAd && state.points.A>=3 && state.points.B>=3);
    const endedOnAdDeuce = !!(!state.noAd && state.points.A>=3 && state.points.B>=3);

    // NO-AD OFF + 듀스/AD 구간에서 게임이 끝난 경우: 승자 셀을 AD로 기록
    let adDeuceWinner = null;
    if(endedOnAdDeuce && (winnerTeam==="A" || winnerTeam==="B")){
      adDeuceWinner = winnerTeam;
      if(winnerTeam==="A"){
        aTxt = "AD";
        bTxt = "40";
      }else{
        aTxt = "40";
        bTxt = "AD";
      }
    }

    const rec = {
      A: aTxt,
      B: bTxt,
      noAdDeuceWinner: endedOnNoAdDeuce ? winnerTeam : null,
      adDeuceWinner: adDeuceWinner
    };

    state.gameHistory[idx] = rec;
    
    // ✅ 세트별 누적 기록 (세트 마지막 게임 누락 방지)
    const setNo = (Array.isArray(state.completedSets) ? state.completedSets.length : 0) + 1;
    state.setGameHistories = Array.isArray(state.setGameHistories) ? state.setGameHistories : [];
    if (!Array.isArray(state.setGameHistories[setNo-1])) state.setGameHistories[setNo-1] = [];
    state.setGameHistories[setNo-1].push(rec);
    if (state.setGameHistories[setNo-1].length > 13) state.setGameHistories[setNo-1] = state.setGameHistories[setNo-1].slice(0,13);
  }

  function recordTiebreakSnapshot(){
    const idx = 12; // 13th game
    state.gameHistory[idx] = {
      A: String(state.tbPoints.A),
      B: String(state.tbPoints.B),
      noAdDeuceWinner: null
    };
    const tbRec = state.gameHistory[idx];

    // ✅ TB도 세트별 누적
    const setNo = (Array.isArray(state.completedSets) ? state.completedSets.length : 0) + 1;
    state.setGameHistories = Array.isArray(state.setGameHistories) ? state.setGameHistories : [];
    if (!Array.isArray(state.setGameHistories[setNo-1])) state.setGameHistories[setNo-1] = [];
    state.setGameHistories[setNo-1].push(tbRec);
  }

  function pushCompletedSet(a,b,tbA,tbB){
    const obj = {A:a, B:b};
    if(typeof tbA==="number" && typeof tbB==="number"){
      obj.tbA = tbA;
      obj.tbB = tbB;
    }
    state.completedSets.push(obj);
    if(state.completedSets.length>5) state.completedSets = state.completedSets.slice(0,5);
  }

  function upsertSetGameHistory(setNo){
    state.setGameHistories = Array.isArray(state.setGameHistories) ? state.setGameHistories : [];
    const gh = JSON.parse(JSON.stringify(state.gameHistory || []));
    // 세트별 기록은 배열 슬롯 기준으로만 유지 (중복 저장 방지)
    state.setGameHistories[setNo - 1] = gh;
    // 혹시 남아있는 구버전 객체형 항목은 같은 세트 번호 기준으로 제거
    state.setGameHistories = state.setGameHistories.filter((item, idx) => {
      if(idx === setNo - 1) return true;
      return !(item && typeof item === "object" && !Array.isArray(item) && Number(item.set) === Number(setNo));
    });
  } 
    
  function startNewSet(){
    state.games.A = 0; state.games.B = 0;
    resetPoints();
    resetTiebreak();
    state.gameHistory = [];
    state.winner = null;
  }

  
  // v22.24.1: serve indicator (serving team highlight + right-side court badge)
  // - Serving team card only: highlighted
  // - Right side badge: 듀스/애드 표시
  // - Doubles: serving side shows the current server name (partner/receiver 제외)
  function updateServeUI(serverKey=null, courtLabel=null){
    try{
      const sKey = serverKey || currentServerKey();
      const servingTeam = String(sKey).startsWith('B') ? 'B' : 'A';
      const label = courtLabel || currentCourtLabel();

      const leftTeam  = teamForSide('L');
      const rightTeam = teamForSide('R');

      const cardL   = document.getElementById('cardA');
      const cardR   = document.getElementById('cardB');
      const cornerL = document.getElementById('cornerInfoA');
      const cornerR = document.getElementById('cornerInfoB');

      const servingLeft  = (leftTeam === servingTeam);
      const servingRight = (rightTeam === servingTeam);

      if(cardL) cardL.classList.toggle('serving', servingLeft);
      if(cardR) cardR.classList.toggle('serving', servingRight);

      if(cornerL) cornerL.textContent = servingLeft ? label : '';
      if(cornerR) cornerR.textContent = servingRight ? label : '';

      // Doubles: always show "A1 & A2" (or custom names) and highlight the current server name
      if(state.mode === 'doubles'){
        const esc = (v)=>String(v ?? '').replace(/[&<>"']/g, (c)=>({
          '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
        }[c]));
        const teamLabel = (team, curKey)=>{
          const k1 = (team==='A') ? 'A1' : 'B1';
          const k2 = (team==='A') ? 'A2' : 'B2';
          const n1 = esc(serverKeyToName(k1) || k1);
          const n2 = esc(serverKeyToName(k2) || k2);
          const cur = String(curKey||'');
          const h1 = (cur===k1) ? `<span class="srvOn">${n1}</span>` : `<span class="srvOff">${n1}</span>`;
          const h2 = (cur===k2) ? `<span class="srvOn">${n2}</span>` : `<span class="srvOff">${n2}</span>`;
          return `${h1} <span class="srvSep">&amp;</span> ${h2}`;
        };
        if(nameA) nameA.innerHTML = teamLabel(leftTeam, sKey);
        if(nameB) nameB.innerHTML = teamLabel(rightTeam, sKey);
      }
    }catch(_e){}
  }

  // v22.24.6: 코트변경 오버레이 버튼 위치 고정
  // - 카드 높이가 변해도(서브권 표시/이름 줄바꿈/히스토리 갱신 등) 항상 '점수(paper) 중앙' 기준으로 위치
  let _swapBtnRAF = 0;

  function syncCourtSwapBtnPosition(){
    try{
      if(!courtSwapBtn) return;
      if(!state.started) return;

      // ✅ 오버레이 컨테이너(있으면)를 기준으로 좌표를 잡아, 렌더/서브 변경으로 레이아웃이 바뀌어도 X축이 틀어지지 않게 함
      const overlay = courtSwapBtn.offsetParent || document.getElementById('scoreOverlay') || document.querySelector('.scoreGrid');
      const paperL = document.getElementById('paperA');
      const paperR = document.getElementById('paperB');
      if(!overlay || !paperL || !paperR) return;

      const og = overlay.getBoundingClientRect();
      if(og.width <= 0 || og.height <= 0) return;

      const r1 = paperL.getBoundingClientRect();
      const r2 = paperR.getBoundingClientRect();
      const centerY = ((r1.top + (r1.height/2)) + (r2.top + (r2.height/2))) / 2;

      // X축은 CSS의 50%로 고정(항상 카드 사이 중앙). Y축만 'paper 중앙'으로 동기화.
      courtSwapBtn.style.left = '50%';
      courtSwapBtn.style.top  = `${centerY - og.top}px`;
      courtSwapBtn.style.transform = 'translate(-50%, -50%)';
    }catch(_e){}
  }

  function scheduleCourtSwapBtnPosition(){
    try{
      if(_swapBtnRAF) cancelAnimationFrame(_swapBtnRAF);
      _swapBtnRAF = requestAnimationFrame(()=>{ _swapBtnRAF = 0; syncCourtSwapBtnPosition(); });
    }catch(_e){
      syncCourtSwapBtnPosition();
    }
  }

// ---------- Rendering ----------
  const prev = { pointL:null, pointR:null, gamesL:null, gamesR:null, setsL:null, setsR:null };

  function applyWarn(el, on){
    if(!el) return;
    el.classList.toggle("warn", !!on);
  }

  function shouldWarnPoint(txt){
    if(state.tiebreak) return true;
    // highlight AD only in normal mode
    return (!isNoAdEffective() && txt==="AD");
  }

  function render(full=false){
    clearErr();

    // screen control: always show setup first unless started
    if(state.started){
      setupCard.style.display = "none";
      boardCard.style.display = "grid";
      document.body.classList.add("board-mode");
    }else{
      setupCard.style.display = "grid";
      boardCard.style.display = "none";
      document.body.classList.remove("board-mode");
    }

    // setup UI sync
    if(modeSel){
      modeSel.value = state.mode;
      bestOfSel.value = String(state.bestOf || 1);
      if(gamesToWinSel) gamesToWinSel.value = String(state.gamesToWin || 4);
      if(noAdChk) noAdChk.checked = !!state.noAd;
      if(tbOnChk) tbOnChk.checked = !!state.tiebreakOn;

      if(state.mode==="doubles"){
        singlesInputs.style.display = "none";
        doublesInputs.style.display = "block";
      }else{
        singlesInputs.style.display = "block";
        doublesInputs.style.display = "none";
      }
    }

    // board UI
    const leftTeam = teamForSide("L");
    const rightTeam = teamForSide("R");

    // ✅ 득점 버튼: 현재 좌/우에 표시된 팀 기준으로 라벨 갱신(스왑 시 헷갈림 방지)
    if(btnPointA) btnPointA.textContent = `⬆ ${teamName(leftTeam)} 득점`;
    if(btnPointB) btnPointB.textContent = `⬆ ${teamName(rightTeam)} 득점`;

    // team labels on cards
    if(state.mode === "doubles"){
      const leftLabel = (leftTeam === "A")
        ? `${state.names?.A1 || "A1"} & ${state.names?.A2 || "A2"}`
        : `${state.names?.B1 || "B1"} & ${state.names?.B2 || "B2"}`;
    
      const rightLabel = (rightTeam === "A")
        ? `${state.names?.A1 || "A1"} & ${state.names?.A2 || "A2"}`
        : `${state.names?.B1 || "B1"} & ${state.names?.B2 || "B2"}`;
    
      nameA.textContent = leftLabel;
      nameB.textContent = rightLabel;
    }else{
      nameA.textContent = teamName(leftTeam);
      nameB.textContent = teamName(rightTeam);
    }

    const pL = displayPointForTeam(leftTeam);
    const pR = displayPointForTeam(rightTeam);

    const gL = state.games[leftTeam];
    const gR = state.games[rightTeam];

    const sL = state.sets[leftTeam];
    const sR = state.sets[rightTeam];

    flapFaceTopA.textContent = pL;
    flapFaceTopB.textContent = pR;
    if(flapFaceBottomA) flapFaceBottomA.textContent = pL;
    if(flapFaceBottomB) flapFaceBottomB.textContent = pR;

    gamesA.textContent = String(gL);
    gamesB.textContent = String(gR);
    setsA.textContent  = String(sL);
    setsB.textContent  = String(sR);

    // tiebreak superscript shown while TB at 6:6
    if(state.tiebreak && state.games.A===6 && state.games.B===6){
      tbSupA.textContent = String(state.tbPoints[leftTeam] ?? 0);
      tbSupB.textContent = String(state.tbPoints[rightTeam] ?? 0);
    }else{
      tbSupA.textContent = "";
      tbSupB.textContent = "";
    }

    if(modeBadge) modeBadge.textContent = "Set " + currentSetNo();
    if(noAdBadge) noAdBadge.textContent = "NO-AD: " + (state.noAd ? "ON" : "OFF");
    if(tbBadge) tbBadge.textContent = "TB: " + (state.tiebreakOn ? "ON" : "OFF");
    if(setNoBadge) setNoBadge.textContent = "Set " + currentSetNo();
    if(courtBadge) courtBadge.textContent = "코트: " + currentCourtLabel();
    if(awakeSelect){
      const m = (typeof state.keepAwakeMins === "number") ? state.keepAwakeMins : 0;
      awakeSelect.value = String(m);
    }
    if(awakeBadge){
      const m = (typeof state.keepAwakeMins === "number") ? state.keepAwakeMins : 0;
      awakeBadge.textContent = "화면 유지: " + (m===0 ? "제한 없음" : (m + "분"));
    }
    if(soundBadge) soundBadge.textContent = "사운드: " + (state.soundOn ? "ON" : "OFF");

    // ✅ 코트 변경 힌트: 1,3,5,7... 게임 종료 후(총 게임 수가 홀수) 표시
    try{
      if(courtSwapBtn){
        const totalGames = (state.games.A + state.games.B) || 0;
        const showHint = !!(state.started && !state.tiebreak && totalGames > 0 && (totalGames % 2 === 1));
        courtSwapBtn.classList.toggle("hint", showHint);
        courtSwapBtn.title = showHint ? "코트 변경 타이밍(1,3,5...)" : "코트 변경";
      }
    }catch(_e){}


    // server line
    const sKey = currentServerKey();
    updateServeUI(sKey, currentCourtLabel());
    // 코트 변경 버튼을 '점수판 사이'에 고정 (게임/서브 변경으로 레이아웃이 바뀌어도 흔들리지 않게)
    scheduleCourtSwapBtnPosition();

    // winner
    if(state.winner){
      winnerText.style.display = "block";
      winnerText.textContent = `WINNER: ${state.winner}`;

      if(_lastMatchResultWinner !== state.winner){
        _lastMatchResultWinner = state.winner;
      }
      const modalEl = document.getElementById("matchResultModal");
      if(modalEl && modalEl.style.display !== "block"){
        setTimeout(()=>{ try{ showMatchResultModal(); }catch(_e){} }, 0);
      }
      Promise.resolve().then(()=>ensureCompletedMatchSaved()).catch(err=>console.error("auto save failed:", err));
    }else{
      winnerText.style.display = "none";
      winnerText.textContent = "";
      _lastMatchResultWinner = null;
      closeMatchResultModal();
    }

    // warn styles
    const warnL = shouldWarnPoint(pL);
    const warnR = shouldWarnPoint(pR);
    applyWarn(flapFaceTopA, warnL);
    applyWarn(flapFaceTopB, warnR);
    applyWarn(flapFaceBottomA, warnL);
    applyWarn(flapFaceBottomB, warnR);

    renderHistoryTable();

    // remember previous (used by some animations in older versions)
    prev.pointL = pL; prev.pointR = pR;
    prev.gamesL = gL; prev.gamesR = gR;
    prev.setsL  = sL; prev.setsR  = sR;
  }

  // ---------- Gameplay actions ----------
  function pointWon(team){
    if(state.winner) return;
    if(!state.started) return;

    pushUndo();

    // keep NO-AD state consistent with UI toggle
    state.noAd = isNoAdEffective();

    if(state.tiebreak){
      state.tbPoints[team] += 1;
      clickSound();

      const tbW = checkWinTiebreak();
      if(tbW){
        // record final TB score in game history (13g)
        recordTiebreakSnapshot();

        // winner gets 7-6 set
        const base = getTbTrigger();          // 4게임=3, 6게임=6
        const finalA = (tbW==="A") ? (base + 1) : base;
        const finalB = (tbW==="B") ? (base + 1) : base;

        pushCompletedSet(finalA, finalB, state.tbPoints.A, state.tbPoints.B);
        upsertSetGameHistory(state.completedSets.length);
        
        state.sets[tbW] += 1;

        // next set: server should be the next in rotation after the first TB server
        state.serverIndex = (state.serverIndex + 1) % state.serverOrder.length;

        const mW = checkWinMatch();
        if(mW){
          state.winner = teamName(mW);
        }else{
          startNewSet();
        }

        saveState(state);
        render(true);
        syncWakeLock();
        return;
      }

      saveState(state);
      render();
      syncWakeLock();
      return;
    }

    // normal game
    state.points[team] += 1;
    clickSound();

    const gW = checkWinGameNormal();
    if(gW){
      // snapshot points BEFORE reset
      recordGameSnapshot(gW);

      state.games[gW] += 1;
      resetPoints();

      // advance server for next game (including if it becomes TB)
      advanceServerAfterGame();

      // enter TB?
      if(checkEnterTiebreak()){
        state.tiebreak = true;
        state.tbPoints.A = 0; state.tbPoints.B = 0;
      }

      const sW = checkWinSet();
      if(sW){
        // completed set (non-tb: just games)
        pushCompletedSet(state.games.A, state.games.B);
        upsertSetGameHistory(state.completedSets.length); // ✅ 추가 (세트 마지막 게임 포함 저장)
        state.sets[sW] += 1;

        const mW = checkWinMatch();
        if(mW){
          state.winner = teamName(mW);
        }else{
          startNewSet();
        }
      }
    }

    saveState(state);
    render();
    syncWakeLock();
  }

  function swapCourtSides(){
    if(!state.started) return;
    pushUndo();
    state.swapSides = !state.swapSides;
    clickSound();
    saveState(state);
    render(true);
  }

    // ---------- Wake Lock ----------
  // - Uses Screen Wake Lock API when available.
  // - Setting: keepAwakeMins (0=unlimited, 5..60=keep awake; releases after inactivity)
  let wakeLockSentinel = null;
  let wakeLockTimer = null;
  let wakeLockExpiryAt = 0; // 0=unlimited, >0=timestamp(ms) until which we should keep awake
  let lastUserActivityAt = Date.now();
  let wakeTimedOut = false; // timed mode expired; block auto-reacquire until user interacts
  let wakeLockInterval = null;
  let wakeLockRequestInFlight = false;
  let wakeLockReleaseInFlight = false;

  function ensureWakeInterval(){
    if(wakeLockInterval) return;
    wakeLockInterval = setInterval(()=>{
      try{
        const mins = getKeepAwakeMins();
        if(!state.started || mins<=0) return;
        const due = _wakeDueAt();
        if(!wakeTimedOut && Date.now() >= due){
          wakeTimedOut = true;
          wakeLockExpiryAt = Date.now() - 1;
          releaseWakeLock();
        }
      }catch(_e){}
    }, 5000);
  }

  function getKeepAwakeMins(){
    const m = (typeof state.keepAwakeMins === "number") ? state.keepAwakeMins : 0;
    // allow only supported values
    return (m===0 || (m%5===0 && m>=5 && m<=60)) ? m : 0;
  }

  function _wakeDueAt(){
    const mins = getKeepAwakeMins();
    if(mins<=0) return 0;
    return lastUserActivityAt + mins * 60 * 1000;
  }

  function clearWakeTimer(){
    if(wakeLockTimer){
      clearTimeout(wakeLockTimer);
      wakeLockTimer = null;
    }
  }

  function armWakeTimer(){
    clearWakeTimer();
    const mins = getKeepAwakeMins();
    if(!state.started || mins<=0) return;

    const due = _wakeDueAt();
    wakeLockExpiryAt = due;

    const delay = Math.max(0, due - Date.now());
    wakeLockTimer = setTimeout(async ()=>{
      // Re-check against lastUserActivityAt so internal renders/resizes do NOT extend the timer.
      const minsNow = getKeepAwakeMins();
      if(!state.started || minsNow<=0){
        return;
      }
      const dueNow = _wakeDueAt();
      wakeLockExpiryAt = dueNow;

      if(Date.now() < dueNow){
        armWakeTimer();
        return;
      }

      // Expired: release and DO NOT auto-reacquire until user interacts again.
      wakeTimedOut = true;
      wakeLockExpiryAt = Date.now() - 1;
      await releaseWakeLock();
    }, delay);
  }

  async function requestWakeLock(){
    try{
      if(!state.started) return;
      if(!("wakeLock" in navigator)) return;
      if(wakeLockSentinel || wakeLockRequestInFlight || wakeLockReleaseInFlight) return;

      wakeLockRequestInFlight = true;
      const localSentinel = await navigator.wakeLock.request("screen");

      // If a release started while request was in-flight, release immediately and do not keep it.
      if(wakeLockReleaseInFlight || wakeTimedOut || !state.started){
        try{ await localSentinel.release(); }catch(_e){}
        return;
      }

      wakeLockSentinel = localSentinel;
      localSentinel.addEventListener("release", ()=>{
        // Ignore stale release events from an older sentinel.
        if(wakeLockSentinel === localSentinel){
          wakeLockSentinel = null;
        }

        // Reacquire only when it's still desired, not timed out, and no active sentinel exists.
        try{
          if(wakeTimedOut) return;
          if(wakeLockSentinel) return;
          const mins = getKeepAwakeMins();
          const withinWindow = (mins===0) || (mins>0 && Date.now() < wakeLockExpiryAt);
          if(state.started && document.visibilityState === "visible" && withinWindow){
            requestWakeLock();
          }
        }catch(_e){}
      });
    }catch(_e){
      // no-op
    }finally{
      wakeLockRequestInFlight = false;
    }
  }

  async function releaseWakeLock(){
    try{
      clearWakeTimer();
      wakeLockReleaseInFlight = true;
      const s = wakeLockSentinel;
      wakeLockSentinel = null; // block auto-reacquire from stale release events
      if(s){
        try{ await s.release(); }catch(_e){}
      }
    }catch(_e){
      // Keep it safe: if anything goes wrong, drop reference.
      wakeLockSentinel = null;
    }finally{
      wakeLockReleaseInFlight = false;
    }
  }

  async function syncWakeLock(){
    const mins = getKeepAwakeMins();

    if(!state.started){
      wakeTimedOut = false;
      wakeLockExpiryAt = 0;
      await releaseWakeLock();
      return;
    }

    if(mins > 0){
      ensureWakeInterval();
      // time-limited mode: timer is based on lastUserActivityAt; sync does NOT extend it
      const due = _wakeDueAt();
      wakeLockExpiryAt = due;

      if(Date.now() >= due){
        wakeTimedOut = true;
        // already expired: remain released until user interacts
        await releaseWakeLock();
        return;
      }

      if(wakeTimedOut){
        // Expired: remain released until user interacts or setting changes.
        await releaseWakeLock();
        return;
      }

      await requestWakeLock();
      armWakeTimer();
      return;
    }

    // unlimited
    wakeTimedOut = false;
    wakeLockExpiryAt = 0;
    clearWakeTimer();
    await requestWakeLock();
  }

  // Any user interaction while match is running refreshes the inactivity window.
  function markUserActivity(){
    try{
      if(!state.started) return;
      wakeTimedOut = false;
      lastUserActivityAt = Date.now();

      const mins = getKeepAwakeMins();
      if(mins > 0){
        ensureWakeInterval();
        wakeLockExpiryAt = _wakeDueAt();
        armWakeTimer();
      }

      // If wake lock was released due to timeout, acquire again on interaction.
      requestWakeLock();
    }catch(_e){}
  }

  document.addEventListener("pointerdown", markUserActivity, {passive:true});
  document.addEventListener("touchstart", markUserActivity, {passive:true});
  document.addEventListener("keydown", markUserActivity);

  document.addEventListener("visibilitychange", ()=>{
    try{
      if(document.visibilityState === "visible"){
        syncWakeLock();
      }else{
        releaseWakeLock();
      }
    }catch(_e){}
  });

// ---------- Setup screen logic ----------
  function setServerBtnOn(container, targetBtn){
    if(!container || !targetBtn) return;
    container.querySelectorAll(".serverBtn").forEach(b=>b.classList.remove("on"));
    targetBtn.classList.add("on");
  }

  function setFirstServerSingles(val){
    if(firstServerSinglesHidden) firstServerSinglesHidden.value = val;
    if(val==="B") setServerBtnOn(firstServerSinglesBtns, btnSS_B);
    else setServerBtnOn(firstServerSinglesBtns, btnSS_A);
  }

  function updateFirstServerButtonLabels(){
    // singles buttons
    if(btnSS_A) btnSS_A.textContent = (pA?.value||"").trim() || "A";
    if(btnSS_B) btnSS_B.textContent = (pB?.value||"").trim() || "B";

    // doubles buttons
    if(!btnFS_A1) return;

    const nA1 = (pA1?.value||"").trim() || "A1";
    const nA2 = (pA2?.value||"").trim() || "A2";
    const nB1 = (pB1?.value||"").trim() || "B1";
    const nB2 = (pB2?.value||"").trim() || "B2";

    // ✅ v22.24.12: 복식 첫 서브 선택은 4개 버튼(한줄)에서
    // 1번 선택(녹색) / 2번 선택(파랑)으로만 표시하고, "-1st/-2nd" 표기는 제거
    btnFS_A1.textContent = nA1;
    btnFS_A2.textContent = nA2;
    btnFS_B1.textContent = nB1;
    btnFS_B2.textContent = nB2;
  }

  function setFirstServerDoubles(key){
    // legacy entry point: treat `key` as "overall first server" selection
    const k = String(key||"A1");
    const isA = k.startsWith("A");
    if(doublesStartTeamHidden) doublesStartTeamHidden.value = isA ? "A" : "B";
    if(isA){
      if(doublesFirstAHidden) doublesFirstAHidden.value = _normKey(k, "A1", "A2");
    }else{
      if(doublesFirstBHidden) doublesFirstBHidden.value = _normKey(k, "B1", "B2");
    }
    // defaults for the other team
    if(doublesFirstAHidden) doublesFirstAHidden.value = _normKey(doublesFirstAHidden.value, "A1", "A2");
    if(doublesFirstBHidden) doublesFirstBHidden.value = _normKey(doublesFirstBHidden.value, "B1", "B2");
    refreshDoublesServeUI();
  }

  // ---- Doubles serve order preferences ----
  // Goal: 기존 4개 버튼(한줄)에서
  //  - 1번째 선택 = 녹색(전체 1st 서버)
  //  - 2번째 선택 = 파랑(상대팀 1st 서버)
  //  ※ "-1st/-2nd" 표기는 제거
  let doublesPickStage = 0; // 0: next=green, 1: next=blue
  function _normKey(val, a, b){
    const v = String(val||"").toUpperCase();
    return (v===a || v===b) ? v : a;
  }

  function getDoublesServePrefs(){
    const startTeam = (doublesStartTeamHidden && doublesStartTeamHidden.value === "B") ? "B" : "A";
    const firstA = _normKey(doublesFirstAHidden?.value, "A1", "A2");
    const firstB = _normKey(doublesFirstBHidden?.value, "B1", "B2");
    const secondA = (firstA === "A1") ? "A2" : "A1";
    const secondB = (firstB === "B1") ? "B2" : "B1";
    const overallFirst = (startTeam === "A") ? firstA : firstB;
    return { startTeam, firstA, secondA, firstB, secondB, overallFirst };
  }

  function getDoublesGreenBlue(){
    const p = getDoublesServePrefs();
    const green = p.overallFirst; // startTeam의 1st 서버
    const blue  = (p.startTeam === 'A') ? p.firstB : p.firstA; // 상대팀 1st 서버
    return { p, green, blue };
  }

  function setDoublesServePrefsFromServerOrder(order){
    try{
      if(!Array.isArray(order) || order.length < 4) return false;
      const first = String(order[0]||"");
      const startTeam = first.startsWith("B") ? "B" : "A";
      let firstA, firstB;
      if(startTeam === "A"){
        firstA = String(order[0]||"A1");
        firstB = String(order[1]||"B1");
      }else{
        firstB = String(order[0]||"B1");
        firstA = String(order[1]||"A1");
      }
      if(doublesStartTeamHidden) doublesStartTeamHidden.value = startTeam;
      if(doublesFirstAHidden) doublesFirstAHidden.value = _normKey(firstA, "A1", "A2");
      if(doublesFirstBHidden) doublesFirstBHidden.value = _normKey(firstB, "B1", "B2");
      return true;
    }catch(_e){ return false; }
  }

  function refreshDoublesServeUI(){
    const { p, green, blue } = getDoublesGreenBlue();

    // keep hidden updated (overall first server)
    if(firstServerDoublesHidden) firstServerDoublesHidden.value = green;

    // highlight: green = overall first, blue = other team's first
    [btnFS_A1,btnFS_A2,btnFS_B1,btnFS_B2].forEach(b=>{
      if(b){ b.classList.remove('on'); b.classList.remove('onB'); }
    });
    const btnGreen = document.querySelector(`.serverBtn[data-server="${green}"]`);
    const btnBlue  = document.querySelector(`.serverBtn[data-server="${blue}"]`);
    btnGreen?.classList.add('on');
    btnBlue?.classList.add('onB');

    updateFirstServerButtonLabels();
  }

  function pickDoublesServe(key){
    if(!key) return;
    const kRaw = String(key).toUpperCase();
    const isA = kRaw.startsWith('A');
    const k = isA ? _normKey(kRaw, 'A1', 'A2') : _normKey(kRaw, 'B1', 'B2');

    // ensure hidden defaults
    if(doublesStartTeamHidden && !doublesStartTeamHidden.value) doublesStartTeamHidden.value = 'A';
    if(doublesFirstAHidden && !doublesFirstAHidden.value) doublesFirstAHidden.value = 'A1';
    if(doublesFirstBHidden && !doublesFirstBHidden.value) doublesFirstBHidden.value = 'B1';

    if(doublesPickStage === 0){
      // 1) GREEN: overall first server (and start team)
      if(doublesStartTeamHidden) doublesStartTeamHidden.value = isA ? 'A' : 'B';
      if(isA){
        if(doublesFirstAHidden) doublesFirstAHidden.value = k;
      }else{
        if(doublesFirstBHidden) doublesFirstBHidden.value = k;
      }
      doublesPickStage = 1; // next pick = BLUE
    }else{
      // 2) BLUE: other team's first server
      const startTeam = (doublesStartTeamHidden && doublesStartTeamHidden.value === 'B') ? 'B' : 'A';
      const clickedTeam = isA ? 'A' : 'B';

      if(clickedTeam === startTeam){
        // same team clicked again → still GREEN 변경
        if(startTeam === 'A') doublesFirstAHidden.value = _normKey(k, 'A1', 'A2');
        else doublesFirstBHidden.value = _normKey(k, 'B1', 'B2');
        doublesPickStage = 1; // still waiting for BLUE
      }else{
        // opposite team → BLUE 설정
        if(startTeam === 'A') doublesFirstBHidden.value = _normKey(k, 'B1', 'B2');
        else doublesFirstAHidden.value = _normKey(k, 'A1', 'A2');
        doublesPickStage = 0; // next pick = GREEN
      }
    }

    // normalize
    if(doublesFirstAHidden) doublesFirstAHidden.value = _normKey(doublesFirstAHidden.value, 'A1', 'A2');
    if(doublesFirstBHidden) doublesFirstBHidden.value = _normKey(doublesFirstBHidden.value, 'B1', 'B2');

    refreshDoublesServeUI();
  }

  function buildServerOrder(mode, fsSingles, fsDoubles){
    if(mode==="doubles"){
      // Prefer per-team serve order (A 1st/2nd, B 1st/2nd) if prefs exist
      try{
        if(typeof getDoublesServePrefs === "function"){
          const p = getDoublesServePrefs();
          return (p.startTeam==="B")
            ? [p.firstB, p.firstA, p.secondB, p.secondA]
            : [p.firstA, p.firstB, p.secondA, p.secondB];
        }
      }catch(_e){}
      // fallback (legacy rotation by overall first server)
      const base = ["A1","B1","A2","B2"];
      const start = base.indexOf(fsDoubles);
      if(start<0) return base;
      return base.slice(start).concat(base.slice(0,start));
    }
    // singles
    return (fsSingles==="B") ? ["B","A"] : ["A","B"];
  }

  function showSetup(){
    state.started = false;
    saveState(state);
    render(true);
    syncWakeLock();
    // Apply responsive scaling (portrait fit / landscape expand)
    try{ applyResponsiveScale(); }catch(_e){}
  }

  function showBoard(){
    state.started = true;
    saveState(state);
    render(true);
    try{ document.querySelector(".wrap")?.scrollTo({top:0, left:0, behavior:"auto"}); }catch(_e){}
    try{ updateViewportUnits(); }catch(_e){}
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 60);
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 220);
    scheduleResponsiveScale();
    syncWakeLock();
  }

  function startNewMatchFromSetup(){
    const next = defaultState();
    next.started = true;

    next.mode = modeSel.value;
    next.bestOf = parseInt(bestOfSel.value,10) || 1;
    next.gamesToWin = parseInt(gamesToWinSel?.value, 10) || 4;
    next.noAd = !!noAdChk?.checked;
    next.tiebreakOn = !!tbOnChk?.checked;

    if(next.mode==="doubles"){
      next.names.A1=(pA1.value||"").trim()||"A1";
      next.names.A2=(pA2.value||"").trim()||"A2";
      next.names.B1=(pB1.value||"").trim()||"B1";
      next.names.B2=(pB2.value||"").trim()||"B2";

      const fs = (firstServerDoublesHidden?.value || "A1");
      // serverOrder is built from per-team prefs (A/B 1st/2nd + starting team)
      next.serverOrder = buildServerOrder("doubles", "A", fs);
      next.serverIndex = 0; // first element serves
    }else{
      next.names.A=(pA.value||"").trim()||"Player A";
      next.names.B=(pB.value||"").trim()||"Player B";

      const ss = (firstServerSinglesHidden?.value || "A");
      next.serverOrder = buildServerOrder("singles", ss, "A1");
      next.serverIndex = 0;
    }

    // preserve toggles from current state
    next.keepAwakeMins = (typeof state.keepAwakeMins === "number") ? state.keepAwakeMins : 0;
    next.soundOn = !!state.soundOn;

    // clear undo history
    undoHistory = [];
    saveUndoHistory(undoHistory);

    state = next;
    saveState(state);

    render(true);
    try{ document.querySelector(".wrap")?.scrollTo({top:0, left:0, behavior:"auto"}); }catch(_e){}
    try{ updateViewportUnits(); }catch(_e){}
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 60);
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 220);
    scheduleResponsiveScale();
    syncWakeLock();
  }

  function loadMatch(){
    const loaded = loadState();
    state = loaded;
    state.started = true; // when explicitly loaded, show board
    saveState(state);
    undoHistory = loadUndoHistory();
    render(true);
    try{ document.querySelector(".wrap")?.scrollTo({top:0, left:0, behavior:"auto"}); }catch(_e){}
    try{ updateViewportUnits(); }catch(_e){}
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 60);
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 220);
    scheduleResponsiveScale();
    syncWakeLock();
  }

   // ===== Cloud Load UI (불러오기) =====
  function _isInProgressState(s){
    if(!s) return false;
    // winner가 있으면 완료로 간주
    if(s.winner) return false;
    // started가 false면 복원대상 아님(설정 화면 상태)
    if(s.started === false) return false;
    return true;
  }
  
  function _applyCloudState(cloudState, cloudUndo){
    state = cloudState;
    state.started = true;            // 로드하면 보드 화면으로
    saveState(state);
  
    undoHistory = Array.isArray(cloudUndo) ? cloudUndo : [];
    saveUndoHistory(undoHistory);
  
    render(true);
  
    try{ document.querySelector(".wrap")?.scrollTo({top:0, left:0, behavior:"auto"}); }catch(_e){}
    try{ updateViewportUnits(); }catch(_e){}
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 60);
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 220);
    scheduleResponsiveScale();
    syncWakeLock();
  }
  
  function _closeCloudLoad(){
    const el = document.getElementById('cloudLoadBackdrop');
    if(el) el.remove();
  }

  function getCloudRowMatchKey(row){
    const d = _maybeParseJson(row?.data) || {};
    const s = _maybeParseJson(d?.state) || {};
    if(_isInProgressState(s)) return null;
    return d?.match_key || s?.matchKey || getCompletedMatchSaveKeyFromSnapshot?.(s, d) || null;
  }

  function getCompletedMatchSaveKeyFromSnapshot(s, d){
    try{
      const names = s?.names || {};
      return JSON.stringify({
        winner: s?.winner || d?.winner || null,
        mode: s?.mode || d?.match?.mode || null,
        bestOf: s?.bestOf ?? d?.bestOf ?? null,
        gamesToWin: s?.gamesToWin ?? d?.gamesToWin ?? null,
        sets: s?.sets || null,
        games: s?.games || null,
        completedSets: s?.completedSets || null,
        names: [names.A, names.B, names.A1, names.A2, names.B1, names.B2]
      });
    }catch(_e){
      return null;
    }
  }

  function dedupeCloudRows(rows){
    if(!Array.isArray(rows)) return [];
    const keep = new Map();
    const passthrough = [];
    const score = (row)=>{
      const key = getCloudRowMatchKey(row);
      const cache = getCompletionPhotoCache();
      const latestMatchPhoto = getLatestCompletionPhotoForMatchKey(key);
      const cachePhoto = !!((cache?.saved || cache?.synced) && cache?.photo?.dataUrl && key && cache?.matchKey && String(cache.matchKey) === String(key));
      const photo = !!getSavedCompletionPhotoFromRow(row)?.dataUrl || cachePhoto || !!latestMatchPhoto?.dataUrl;
      const t = Math.max(_rowPhotoTimestampValue(row), _photoTimestampValue(latestMatchPhoto)) || (row?.created_at ? new Date(row.created_at).getTime() : 0);
      return { photo, t };
    };
    const chooseBetter = (a,b)=>{
      const sa = score(a), sb = score(b);
      if(sa.photo !== sb.photo) return sb.photo ? b : a;
      return sb.t > sa.t ? b : a;
    };
    rows.forEach((row)=>{
      const key = getCloudRowMatchKey(row);
      if(!key){
        passthrough.push(row);
        return;
      }
      const prev = keep.get(key);
      keep.set(key, prev ? chooseBetter(prev, row) : row);
    });
    return [...passthrough, ...keep.values()].sort((a,b)=>{
      const at = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });
  }

  async function findRecentPhotoRowForMatchKey(matchKey, limit = 80){
    if(!matchKey) return null;
    const rows = await loadRecentRecords(limit);
    const same = (rows || []).filter((row)=> String(getCloudRowMatchKey(row) || '') === String(matchKey));
    let best = null;
    same.forEach((row)=>{
      if(!getSavedCompletionPhotoFromRow(row)?.dataUrl) return;
      if(!best){ best = row; return; }
      const bt = _rowPhotoTimestampValue(best) || (best?.created_at ? new Date(best.created_at).getTime() : 0);
      const rt = _rowPhotoTimestampValue(row) || (row?.created_at ? new Date(row.created_at).getTime() : 0);
      if(rt >= bt) best = row;
    });
    return best;
  }

  async function openCloudLoad(){
    try{
      // supabase 준비
      if(!supabase) await initSupabase();
  
      // 최근 기록 조회
      const rows = dedupeCloudRows(await loadRecentRecords(30)); // 사진 저장 fallback row 포함해도 1건으로 표시
  
      // 모달 생성
      _closeCloudLoad();
      const backdrop = document.createElement('div');
      backdrop.id = 'cloudLoadBackdrop';
      backdrop.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,.55);
        display: flex; align-items: center; justify-content: center;
        padding: 16px;
      `;
  
      const card = document.createElement('div');
      card.style.cssText = `
        width: min(720px, 96vw);
        max-height: 80vh;
        overflow: hidden;
        border-radius: 14px;
        background: rgba(20,20,24,.96);
        border: 1px solid rgba(255,255,255,.10);
        box-shadow: 0 10px 30px rgba(0,0,0,.45);
      `;
  
      const head = document.createElement('div');
      head.style.cssText = `
        display:flex; align-items:center; justify-content:space-between;
        padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,.08);
        color: #fff; font-weight: 700;
      `;
      head.innerHTML = `
        <div>불러오기 (클라우드)</div>
        <button id="cloudLoadCloseBtn" style="
          border:0; background:transparent; color:#fff; font-size:18px; cursor:pointer;
        ">✕</button>
      `;
  
      const body = document.createElement('div');
      body.style.cssText = `padding: 10px 10px 12px 10px; overflow:auto; max-height: calc(80vh - 48px);`;
  
      if(!rows || rows.length === 0){
        body.innerHTML = `<div style="color:rgba(255,255,255,.75); padding:10px;">저장된 기록이 없습니다.</div>`;
      } else {
        const list = document.createElement('div');
        list.style.cssText = `display:flex; flex-direction:column; gap:8px;`;
  
        rows.forEach((r)=>{
          const d = r?.data || {};
          const s = d.state; // 우리가 저장한 실제 상태
          const inProg = _isInProgressState(s);
  
          const created = r.created_at ? new Date(r.created_at).toLocaleString() : '';
          const mode = s?.mode || d.match?.mode || 'unknown';
  
          // 점수 요약(있으면 표시)
          const setsA = s?.sets?.A ?? '-';
          const setsB = s?.sets?.B ?? '-';
          const gamesA = s?.games?.A ?? '-';
          const gamesB = s?.games?.B ?? '-';
  
          // 이름 요약(있으면 표시)
          const names = s?.names || {};
          const leftName  = (mode === 'doubles') ? `${names.A1||'A1'}&${names.A2||'A2'}` : (names.A||'A');
          const rightName = (mode === 'doubles') ? `${names.B1||'B1'}&${names.B2||'B2'}` : (names.B||'B');
  
          const item = document.createElement('button');
          item.type = 'button';
          item.style.cssText = `
            text-align:left; width:100%;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,.10);
            background: rgba(255,255,255,.06);
            color:#fff;
            padding: 10px 12px;
            cursor: pointer;
          `;
  
          const hasPhoto = !!getSavedCompletionPhotoFromRow(r)?.dataUrl;
          const tag = inProg
            ? `<span style="padding:2px 8px; border-radius:999px; background: rgba(59,130,246,.25); border:1px solid rgba(59,130,246,.5); color:#eaf3ff; font-size:12px;">진행중 · 복원가능</span>`
            : `<span style="padding:2px 8px; border-radius:999px; background: rgba(16,185,129,.20); border:1px solid rgba(16,185,129,.45); color:#eafff6; font-size:12px;">완료</span>`;
          const photoTag = hasPhoto
            ? `<span style="padding:2px 8px; border-radius:999px; background: rgba(245,158,11,.18); border:1px solid rgba(245,158,11,.40); color:#fff2d2; font-size:12px;">사진</span>`
            : ``;
  
          item.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
              <div style="font-weight:700; min-width:0; flex:1;">${leftName}  vs  ${rightName}</div>
              <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px; flex:0 0 auto; flex-wrap:nowrap;">
                ${photoTag}
                ${tag}
              </div>
            </div>
            <div style="margin-top:6px; color: rgba(255,255,255,.80); font-size:13px;">
              세트 ${setsA}-${setsB} · 게임 ${gamesA}-${gamesB} · ${created}
            </div>
          `;
  
          item.addEventListener('click', async ()=>{
            // 진행중만 복원
            if(inProg){
              const ok = confirm('이 경기는 진행중 기록입니다. 복원할까요?');
              if(ok){
                try{
                  _applyCloudState(d.state, d.undoHistory);
                  _closeCloudLoad();
                }catch(e){
                  console.error(e);
                  alert('복원 실패 (콘솔 확인)');
                }
              }
            } else {
              await openMatchSummary(r);
            }
          });
  
          list.appendChild(item);
        });
  
        body.appendChild(list);
      }
  
      card.appendChild(head);
      card.appendChild(body);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);
  
      document.getElementById('cloudLoadCloseBtn')?.addEventListener('click', _closeCloudLoad);
      backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) _closeCloudLoad(); });
  
    }catch(err){
      console.error(err);
      alert('불러오기 실패 (콘솔 확인)');
    }
    async function openMatchSummary(row){
    let summaryRow = row;
    let completionPhoto = getSavedCompletionPhotoFromRow(summaryRow);
    if(!completionPhoto?.dataUrl && row?.id){
      try{
        const latestRow = await loadRecordById(row.id);
        if(latestRow) {
          summaryRow = latestRow;
          completionPhoto = getSavedCompletionPhotoFromRow(summaryRow);
        }
        if(!completionPhoto?.dataUrl){
          summaryRow = await repairCompletionPhotoForRow(summaryRow);
          completionPhoto = getSavedCompletionPhotoFromRow(summaryRow);
        }
      }catch(err){
        console.warn('summary latest fetch failed', err);
      }
    }
    const summaryMatchKey = getCloudRowMatchKey(summaryRow);
    const cache = getCompletionPhotoCache();
    const cacheMatchesRowId = !!(summaryRow?.id && cache?.rowId && String(cache.rowId) === String(summaryRow.id));
    const cacheMatchesMatchKey = !!(summaryMatchKey && cache?.matchKey && String(cache.matchKey) === String(summaryMatchKey));
    if((cache?.saved || cache?.synced) && cache?.photo?.dataUrl && (cacheMatchesRowId || cacheMatchesMatchKey || (!summaryRow?.id && !summaryMatchKey))){
      const cacheTs = _photoTimestampValue(cache.photo);
      const rowTs = _photoTimestampValue(completionPhoto);
      if(!completionPhoto?.dataUrl || cacheTs >= rowTs){
        completionPhoto = cache.photo;
      }
    }
    const latestMatchPhoto = getLatestCompletionPhotoForMatchKey(summaryMatchKey);
    if(latestMatchPhoto?.dataUrl){
      const latestMatchTs = _photoTimestampValue(latestMatchPhoto);
      const rowTs = _photoTimestampValue(completionPhoto);
      if(!completionPhoto?.dataUrl || latestMatchTs >= rowTs){
        completionPhoto = latestMatchPhoto;
      }
    }
    if(summaryMatchKey){
      try{
        const photoRow = await findRecentPhotoRowForMatchKey(summaryMatchKey, 80);
        if(photoRow){
          const rowPhoto = getSavedCompletionPhotoFromRow(photoRow);
          const rowPhotoTs = _photoTimestampValue(rowPhoto);
          const currentTs = _photoTimestampValue(completionPhoto);
          if(rowPhoto?.dataUrl && (!completionPhoto?.dataUrl || rowPhotoTs >= currentTs)){
            completionPhoto = rowPhoto;
          }
        }
      }catch(err){
        console.warn('summary photo row lookup failed', err);
      }
    }

    const d = _maybeParseJson(summaryRow?.data) || {};
    const s = _maybeParseJson(d.state) || {};
    const created = summaryRow?.created_at ? new Date(summaryRow.created_at).toLocaleString() : '-';
    const savedAt = d.saved_at ? new Date(d.saved_at).toLocaleString() : created;
  
    const mode = s.mode || d.match?.mode || 'unknown';
    const names = s.names || {};
  
    const leftName  = (mode === 'doubles')
      ? `${names.A1 || 'A1'}&${names.A2 || 'A2'}`
      : (names.A || 'A');
  
    const rightName = (mode === 'doubles')
      ? `${names.B1 || 'B1'}&${names.B2 || 'B2'}`
      : (names.B || 'B');
  
    const setScore = `${s.sets?.A ?? '-'}-${s.sets?.B ?? '-'}`;
    const gameScore = `${s.games?.A ?? '-'}-${s.games?.B ?? '-'}`;
  
    const setLines = Array.isArray(s.completedSets)
      ? s.completedSets.map((x, i)=>`세트${i+1}: ${x?.A ?? '-'}-${x?.B ?? '-'}`).join(' · ')
      : '세트 상세 없음';
  
    const winner = s.winner || '(미기록)';
    const noAd = (typeof s.noAd === 'boolean') ? (s.noAd ? 'ON' : 'OFF') : '-';
    const tbOn = (typeof s.tiebreakOn === 'boolean') ? (s.tiebreakOn ? 'ON' : 'OFF') : '-';
    const swapped = (typeof s.swapSides === 'boolean') ? (s.swapSides ? 'YES' : 'NO') : '-';
    const gameHistoryHtml = buildGameHistoryHtml(s, d.undoHistory);
    const photoHtml = `
        <div style="margin-top:12px;">
          <div style="font-weight:800; margin-bottom:8px;">완료 사진</div>
          ${completionPhoto?.dataUrl ? `
            <button id="cloudSummaryPhotoBtn" type="button" style="display:block; width:100%; padding:0; border:0; background:transparent; cursor:pointer;">
              <img src="${completionPhoto.dataUrl}" alt="완료 사진 미리보기" style="display:block; width:100%; max-height:min(42vh, 260px); object-fit:contain; border-radius:12px; border:1px solid rgba(255,255,255,.10); background:#0f1012;" />
            </button>
            <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
              <button id="cloudSummaryPhotoViewBtn" type="button" style="border-radius:10px; border:1px solid rgba(255,255,255,.12); background: rgba(245,158,11,.22); color:#fff5de; padding:8px 10px; cursor:pointer;">사진 보기</button>
              <a id="cloudSummaryPhotoDownloadBtn" href="${completionPhoto.dataUrl}" download="${completionPhoto.name || 'match-photo.jpg'}" style="border-radius:10px; border:1px solid rgba(255,255,255,.12); background: rgba(59,130,246,.22); color:#eaf3ff; padding:8px 10px; text-decoration:none;">다운로드</a>
            </div>
          ` : `
            <div style="padding:12px 14px; border-radius:12px; border:1px dashed rgba(255,255,255,.18); background:rgba(255,255,255,.03); color:rgba(255,255,255,.72); font-size:13px;">
              저장된 완료 사진이 없습니다.
            </div>
          `}
        </div>`;
      
    // 기존 요약 모달 닫고 새로 생성
    const old = document.getElementById('cloudSummaryBackdrop');
    if(old) old.remove();
  
    const backdrop = document.createElement('div');
    backdrop.id = 'cloudSummaryBackdrop';
    backdrop.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.55);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    `;
  
    const card = document.createElement('div');
    card.style.cssText = `
      width: min(720px, 96vw);
      max-height: 80vh;
      overflow: hidden;
      border-radius: 14px;
      background: rgba(20,20,24,.96);
      border: 1px solid rgba(255,255,255,.10);
      box-shadow: 0 10px 30px rgba(0,0,0,.45);
      color:#fff;
    `;
  
    const head = document.createElement('div');
    head.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,.08);
      font-weight:700;
    `;
    head.innerHTML = `
      <div>경기 요약</div>
      <button id="cloudSummaryCloseBtn" style="
        border:0; background:transparent; color:#fff; font-size:18px; cursor:pointer;
      ">✕</button>
    `;
  
    const body = document.createElement('div');
    body.style.cssText = `padding: 12px 14px; overflow:auto; max-height: calc(80vh - 48px);`;
  
    body.innerHTML = `
      <div style="font-size:16px; font-weight:800; margin-bottom:8px;">
        ${leftName}  vs  ${rightName}
      </div>
  
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        <span style="padding:2px 8px; border-radius:999px; background: rgba(16,185,129,.20); border:1px solid rgba(16,185,129,.45); font-size:12px;">완료</span>
        <span style="padding:2px 8px; border-radius:999px; background: rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.10); font-size:12px;">NO-AD ${noAd}</span>
        <span style="padding:2px 8px; border-radius:999px; background: rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.10); font-size:12px;">TB ${tbOn}</span>
        <span style="padding:2px 8px; border-radius:999px; background: rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.10); font-size:12px;">SWAP ${swapped}</span>
      </div>
  
      
      ${photoHtml}

      <div style="line-height:1.6; color: rgba(255,255,255,.88);">
        <div><b>세트</b>: ${setScore} / <b>게임</b>: ${gameScore}</div>
        <div style="margin-top:4px;"><b>세트 상세</b>: ${setLines}</div>
        <div style="margin-top:6px;"><b>승자</b>: ${winner}</div>
        ${gameHistoryHtml}
        
        <div style="margin-top:6px; font-size:13px; color: rgba(255,255,255,.70);">
          저장시간: ${savedAt}<br/>
          row 생성시간: ${created}
        </div>
      </div>
  
      <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
        <button id="cloudSummaryCopyBtn" style="
          border-radius:10px; border:1px solid rgba(255,255,255,.12);
          background: rgba(59,130,246,.22);
          color:#eaf3ff; padding:8px 10px; cursor:pointer;
        ">요약 복사</button>
      </div>
    `;
  
    card.appendChild(head);
    card.appendChild(body);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
  
    document.getElementById('cloudSummaryCloseBtn')?.addEventListener('click', ()=>backdrop.remove());
    backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) backdrop.remove(); });
  
    document.getElementById('cloudSummaryPhotoBtn')?.addEventListener('click', ()=> openPhotoViewer(completionPhoto));
    document.getElementById('cloudSummaryPhotoViewBtn')?.addEventListener('click', ()=> openPhotoViewer(completionPhoto));

    document.getElementById('cloudSummaryCopyBtn')?.addEventListener('click', async ()=>{
      const text =
  `[경기 요약]
  ${leftName} vs ${rightName}
  세트: ${setScore} / 게임: ${gameScore}
  세트 상세: ${setLines}
  승자: ${winner}
  저장시간: ${savedAt}`;
      try{
        await navigator.clipboard.writeText(text);
        alert('복사 완료');
      }catch{
        alert('복사 실패(브라우저 권한 확인)');
      }
    });
  }
  function buildGameHistoryHtml(s, undoHistory){
  try{
    const canonical = new Map();
    const putRow = (setNo, gameNo, g)=>{
      const sNo = Number(setNo) || 0;
      const gNo = Number(gameNo) || 0;
      if(sNo <= 0 || gNo <= 0) return;
      canonical.set(`${sNo}:${gNo}`, { set: sNo, game: gNo, g });
    };

    const sgh = s?.setGameHistories;
    if (Array.isArray(sgh) && sgh.length > 0) {
      sgh.forEach((item, idx) => {
        if (Array.isArray(item)) {
          item.forEach((g, gi) => putRow(idx + 1, gi + 1, g));
          return;
        }
        if (item && typeof item === 'object') {
          const setNo = Number(item.set) || (idx + 1);
          const gh = Array.isArray(item.gameHistory) ? item.gameHistory : [];
          gh.forEach((g, gi) => putRow(setNo, gi + 1, g));
          return;
        }
      });
    }

    if (canonical.size === 0 && Array.isArray(undoHistory) && undoHistory.length > 0) {
      let prevLen = 0;
      for (let i = 0; i < undoHistory.length; i++) {
        const st = undoHistory[i] || {};
        const gh = Array.isArray(st.gameHistory) ? st.gameHistory : [];
        const setNo = (Array.isArray(st.completedSets) ? st.completedSets.length : 0) + 1;

        if (i === 0) {
          gh.forEach((g, k) => putRow(setNo, k + 1, g));
          prevLen = gh.length;
          continue;
        }

        if (gh.length > prevLen) {
          for (let k = prevLen; k < gh.length; k++) {
            putRow(setNo, k + 1, gh[k]);
          }
          prevLen = gh.length;
        } else if (gh.length < prevLen) {
          prevLen = gh.length;
        }
      }
    }

    if (canonical.size === 0) {
      const gh = Array.isArray(s?.gameHistory) ? s.gameHistory : [];
      const lastSetNo = (Array.isArray(s?.completedSets) ? s.completedSets.length : 0) + 1;
      gh.forEach((g, i) => putRow(lastSetNo, i + 1, g));
    }

    const rows = Array.from(canonical.values())
      .sort((a,b)=> (a.set - b.set) || (a.game - b.game));

    if (rows.length === 0) {
      return `<div style="margin-top:10px; color:rgba(255,255,255,.7); font-size:13px;">게임 기록이 없습니다.</div>`;
    }

    const tr = rows.map(r => {
      const g = r.g;

      let scoreText = '-';
      if (g && typeof g === 'object') {
        const A = g.A ?? '-';
        const B = g.B ?? '-';
        scoreText = `${A}:${B}`;
      } else if (typeof g === 'string' || typeof g === 'number') {
        scoreText = String(g);
      }

      const note =
        (g && typeof g === 'object' && g.noAdDeuceWinner) ? `NO-AD ${g.noAdDeuceWinner}` :
        (g && typeof g === 'object' && g.adDeuceWinner)   ? `AD ${g.adDeuceWinner}` : '';

      return `
        <tr>
          <td style="padding:6px 4px; border-top:1px solid rgba(255,255,255,.08); text-align:center;">${r.set}</td>
          <td style="padding:6px 4px; border-top:1px solid rgba(255,255,255,.08); text-align:center;">${r.game}</td>
          <td style="padding:6px 4px; border-top:1px solid rgba(255,255,255,.08); font-weight:700; text-align:center;">${scoreText}</td>
          <td style="padding:6px 4px; border-top:1px solid rgba(255,255,255,.08); color:rgba(255,255,255,.75); font-size:11px; text-align:left;">${note}</td>
        </tr>
      `;
    }).join('');

    return `
      <details style="margin-top:12px;">
        <summary style="cursor:pointer; user-select:none; color:#eaf3ff;">
          게임 기록 보기
        </summary>
        <div style="margin-top:10px; overflow:auto; max-height:260px; border:1px solid rgba(255,255,255,.10); border-radius:12px;">
          <table style="width:100%; min-width:240px; border-collapse:collapse; table-layout:fixed; font-size:11px;">
            <colgroup>
              <col style="width:30px;" />
              <col style="width:30px;" />
              <col style="width:56px;" />
              <col style="width:auto;" />
            </colgroup>
            <thead>
              <tr style="background:rgba(255,255,255,.06);">
                <th style="text-align:center; padding:6px 4px;">세트</th>
                <th style="text-align:center; padding:6px 4px;">게임</th>
                <th style="text-align:center; padding:6px 4px;">점수</th>
                <th style="text-align:left; padding:6px 4px;">비고</th>
              </tr>
            </thead>
            <tbody>${tr}</tbody>
          </table>
        </div>
      </details>
    `;
  } catch (e) {
    console.error(e);
    return `<div style="margin-top:10px; color:rgba(255,180,180,.9); font-size:13px;">게임 기록 표시 중 오류가 발생했습니다. (콘솔 확인)</div>`;
  }
}
  }
  // ===================================    
    
  // ---------- Event binding ----------
  function bindEvents(){
    // setup mode toggle
    modeSel?.addEventListener("change", ()=>{
      const v = modeSel.value;
    
      state.mode = v;
      saveState(state);
    
      if(singlesInputs) singlesInputs.style.display = (v === "singles") ? "block" : "none";
      if(doublesInputs) doublesInputs.style.display = (v === "doubles") ? "block" : "none";
    
      updateFirstServerButtonLabels();
      setFirstServerSingles(firstServerSinglesHidden?.value || "A");
    
      if(v === "doubles"){
        try{ doublesPickStage = 0; }catch(_e){}
        if(doublesStartTeamHidden && !doublesStartTeamHidden.value) doublesStartTeamHidden.value = "A";
        if(doublesFirstAHidden && !doublesFirstAHidden.value) doublesFirstAHidden.value = "A1";
        if(doublesFirstBHidden && !doublesFirstBHidden.value) doublesFirstBHidden.value = "B1";
        refreshDoublesServeUI();
      }
    
      render(true);
    });

    bestOfSel?.addEventListener("change", ()=>{
      const v = parseInt(bestOfSel.value,10) || 1;
      state.bestOf = ([1,3,5].includes(v) ? v : 1);
      saveState(state);
    });
    
    gamesToWinSel?.addEventListener("change", ()=>{
      const v = parseInt(gamesToWinSel.value, 10) || 4;
      state.gamesToWin = ([4,6].includes(v) ? v : 4);
      state.tiebreakOn = (state.gamesToWin === 6);

      const trigger = getTbTrigger();
      const noPointStarted = ((state.points.A|0) + (state.points.B|0) === 0);

      if(!state.tiebreakOn && state.tiebreak){
        state.tiebreak = false;
        state.tbPoints = {A:0, B:0};
        resetPoints();
      }

      if(state.tiebreakOn && !state.tiebreak &&
         state.games.A===trigger && state.games.B===trigger && noPointStarted){
        state.tiebreak = true;
        state.tbPoints = {A:0, B:0};
      }

      if(tbOnChk) tbOnChk.checked = !!state.tiebreakOn;
      saveState(state);
      render(true);
    });
    
    noAdChk?.addEventListener("change", ()=>{
      state.noAd = !!noAdChk.checked;
      saveState(state);
      render(true);
    });
    
    tbOnChk?.addEventListener("change", ()=>{
      state.tiebreakOn = !!tbOnChk.checked;

      const trigger = getTbTrigger();
      const noPointStarted = ((state.points.A|0) + (state.points.B|0) === 0);

      if(!state.tiebreakOn && state.tiebreak){
        state.tiebreak = false;
        state.tbPoints = {A:0, B:0};
        resetPoints();
      }

      if(state.tiebreakOn && !state.tiebreak &&
         state.games.A===trigger && state.games.B===trigger && noPointStarted){
        state.tiebreak = true;
        state.tbPoints = {A:0, B:0};
        resetPoints();
      }

      saveState(state);
      render(true);
    });


    // singles first server
    bindTap(btnSS_A, ()=>setFirstServerSingles("A"));
    bindTap(btnSS_B, ()=>setFirstServerSingles("B"));
    // doubles: 4 buttons in one row (1st pick=GREEN, 2nd pick=BLUE)
    firstServerDoublesBtns?.addEventListener("click",(e)=>{
      const btn = e.target.closest(".serverBtn");
      if(!btn) return;
      const key = btn.dataset.server;
      if(!key) return;
      pickDoublesServe(key);
    });

    // update serve button labels live (singles+doubles)
    [pA,pB,pA1,pA2,pB1,pB2].forEach(inp=>{
      inp?.addEventListener("input", ()=>{
        // sync names to state to prevent snapping on resize/keyboard
        try{
          state.names = state.names || {};
          if(pA) state.names.A = pA.value || "A";
          if(pB) state.names.B = pB.value || "B";
          if(pA1) state.names.A1 = pA1.value || "";
          if(pA2) state.names.A2 = pA2.value || "";
          if(pB1) state.names.B1 = pB1.value || "";
          if(pB2) state.names.B2 = pB2.value || "";
          saveState(state);
        }catch(_e){}
        updateFirstServerButtonLabels();
      });
    });


    bindTap(startBtn, (e)=>{
      e.preventDefault();
      try{
        startNewMatchFromSetup();
      }catch(err){
        showErr("START 처리 중 오류:", err);
      }
    });
    
    bindTap(loadBtn, async (e)=>{
      e.preventDefault();
      await openCloudLoad();
    });
    
    // Use bindTap for match controls too (prevents mobile double-tap zoom on rapid scoring taps)
    bindTap(btnPointA, ()=> pointWon(teamForSide("L")));
    bindTap(btnPointB, ()=> pointWon(teamForSide("R")));

    bindTap(undoBtn, ()=> undo());

    bindTap(resetBtn, ()=> openResetChoice());

    bindTap(backBtn, ()=>{
      // go to setup (do not destroy state)
      state.started = false;
      saveState(state);
      render(true);
      syncWakeLock();
    });

    awakeSelect?.addEventListener("change", async ()=>{


      const v = parseInt(awakeSelect.value, 10);


      state.keepAwakeMins = (Number.isFinite(v) ? v : 0);
      wakeTimedOut = false;

      // treat changing this setting as user activity (helps timed mode start counting immediately)
      try{ lastUserActivityAt = Date.now(); }catch(_e){}


      saveState(state);


      render(true);


      await syncWakeLock();


    });


    awakeBadge?.addEventListener("click", async ()=>{


      // fallback (older HTML): cycle through 0,5,10,...60


      const opts = [0].concat(Array.from({length:12}, (_,i)=> (i+1)*5));


      const cur = (typeof state.keepAwakeMins === "number") ? state.keepAwakeMins : 0;


      const idx = opts.indexOf(cur);


      const next = opts[(idx>=0 ? idx+1 : 0) % opts.length];


      state.keepAwakeMins = next;
      wakeTimedOut = false;

      try{ lastUserActivityAt = Date.now(); }catch(_e){}


      saveState(state);


      render(true);


      await syncWakeLock();


    });
    soundBadge?.addEventListener("click", ()=>{
      state.soundOn = !state.soundOn;
      saveState(state);
      render(true);
      if(state.soundOn) clickSound();
    });

    // ✅ 코트 변경: 중앙 버튼(권장) + 기존 배지(있을 경우)
    bindTap(courtSwapBtn, ()=>swapCourtSides());
    swapBadge?.addEventListener("click", ()=>swapCourtSides());
  }

  // ---------- Init ----------
  function initSetupDefaults(){
    // default first server UI
    setFirstServerSingles(firstServerSinglesHidden?.value || "A");

    // doubles: try to restore prefs from saved serverOrder (if doubles)
    try{
      if(state && state.mode==="doubles" && Array.isArray(state.serverOrder) && state.serverOrder.length>=4){
        setDoublesServePrefsFromServerOrder(state.serverOrder);
      }
    }catch(_e){}
    updateFirstServerButtonLabels();
    // ensure hidden defaults exist
    if(doublesStartTeamHidden && !doublesStartTeamHidden.value) doublesStartTeamHidden.value = "A";
    if(doublesFirstAHidden && !doublesFirstAHidden.value) doublesFirstAHidden.value = "A1";
    if(doublesFirstBHidden && !doublesFirstBHidden.value) doublesFirstBHidden.value = "B1";
    refreshDoublesServeUI();
  }

  
  // ===== v22.17: Stable wiring (no dependency on removed badges) =====
  function _onTap(el, fn){
    if(!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('touchend', (e)=>{ e.preventDefault(); fn(e); }, {passive:false});
  }
  function _show(id){ const m=document.getElementById(id); if(m) m.style.display='block'; }
  function _hide(id){ const m=document.getElementById(id); if(m) m.style.display='none'; }

  function wireTopButtons_v2217(){
    _onTap(document.getElementById('undoMiniBtn'), ()=>{ try{ undo(); }catch(e){} });
    _onTap(document.getElementById('resetMiniBtn'), ()=>{ _show('resetChoiceModal'); });
    _onTap(document.getElementById('settingsBtn'), ()=>{ syncSettingsModalFromState_v2217(); _show('settingsModal'); });
  }

  function syncSettingsModalFromState_v2217(){
  try{
    const tb=document.getElementById('tbBadge');
    if(tb) tb.textContent = "TB: " + (state.tiebreakOn ? "ON" : "OFF");
    const snd=document.getElementById('soundBadge');
    if(snd) snd.textContent = "사운드: " + (state.soundOn ? "ON" : "OFF");

    const mode=document.getElementById('modeBadge');
    if(mode) mode.textContent = (state.mode==="doubles") ? "복식" : "단식";
    const setNo=document.getElementById('setNoBadge');
    if(setNo){
    setNo.textContent =
      (state.bestOf===1) ? "1세트 1선승" :
      (state.bestOf===5) ? "5세트 3선승" : "3세트 2선승";
    }
    const noAd=document.getElementById('noAdBadge');
    if(noAd) noAd.textContent = "NO-AD: " + (state.noAd ? "ON" : "OFF");

    // ✅ 선수/첫서브: 현재 모드(단식/복식)에 맞춰 "설정 화면" 값 그대로 표시
    const isDoubles = (state.mode === 'doubles');
    const sBox = document.getElementById('m_singlesBox');
    const dBox = document.getElementById('m_doublesBox');
    if(sBox) sBox.style.display = isDoubles ? 'none' : 'block';
    if(dBox) dBox.style.display = isDoubles ? 'block' : 'none';

    if(!isDoubles){
      // ---- Singles ----
      const a=document.getElementById('m_pA');
      const b=document.getElementById('m_pB');
      if(a){ a.value = (state.names?.A ?? "Player A"); a.readOnly = false; }
      if(b){ b.value = (state.names?.B ?? "Player B"); b.readOnly = false; }

      const hid=document.getElementById('m_firstServerSingles');
      const fs=(Array.isArray(state.serverOrder) && (state.serverOrder[0]==="A" || state.serverOrder[0]==="B")) ? state.serverOrder[0] : 'A';
      if(hid) hid.value = fs;

      const btnA=document.getElementById('m_btnSS_A');
      const btnB=document.getElementById('m_btnSS_B');
      if(btnA) btnA.classList.toggle('on', (hid?hid.value:fs)==='A');
      if(btnB) btnB.classList.toggle('on', (hid?hid.value:fs)==='B');
      const row=document.getElementById('m_firstServerSinglesBtns');
      if(row) row.style.pointerEvents = '';
    }else{
      // ---- Doubles (표시만) ----
      const a1=document.getElementById('m_pA1');
      const a2=document.getElementById('m_pA2');
      const b1=document.getElementById('m_pB1');
      const b2=document.getElementById('m_pB2');

      const nA1 = (state.names?.A1 ?? 'A1');
      const nA2 = (state.names?.A2 ?? 'A2');
      const nB1 = (state.names?.B1 ?? 'B1');
      const nB2 = (state.names?.B2 ?? 'B2');
      if(a1){ a1.value = nA1; a1.readOnly = true; }
      if(a2){ a2.value = nA2; a2.readOnly = true; }
      if(b1){ b1.value = nB1; b1.readOnly = true; }
      if(b2){ b2.value = nB2; b2.readOnly = true; }

      // ✅ Doubles: 설정 화면(4개 한줄)과 동일한 표시
      //  - 첫 선택(녹색) = 시작팀의 1st 서버 (overall first)
      //  - 두 번째 선택(파랑) = 상대팀 1st 서버
      const allowed = new Set(['A1','A2','B1','B2']);
      let order = Array.isArray(state.serverOrder)
        ? state.serverOrder.map(x=>String(x||'').toUpperCase()).filter(k=>allowed.has(k))
        : [];
      if(order.length < 4){
        order = ['A1','B1','A2','B2'];
      }
      const green = order[0] || 'A1';
      const blue  = order.find(k=>k && k[0] !== green[0]) || (green[0] === 'A' ? 'B1' : 'A1');

      const hid=document.getElementById('m_firstServerDoubles');
      if(hid) hid.value = green;

      const btnA1=document.getElementById('m_btnFS_A1');
      const btnA2=document.getElementById('m_btnFS_A2');
      const btnB1=document.getElementById('m_btnFS_B1');
      const btnB2=document.getElementById('m_btnFS_B2');

      [btnA1,btnA2,btnB1,btnB2].forEach(btn=>{
        if(!btn) return;
        btn.classList.remove('on');
        btn.classList.remove('onB');
      });

      const row=document.getElementById('m_firstServerDoublesBtns');
      const btnGreen = row ? row.querySelector(`.serverBtn[data-server="${green}"]`) : null;
      const btnBlue  = row ? row.querySelector(`.serverBtn[data-server="${blue}"]`)  : null;
      btnGreen?.classList.add('on');
      btnBlue?.classList.add('onB');

      // 표시만 (모달에서 변경 방지)
      if(row) row.style.pointerEvents = 'none';
    }

    const undoRow=document.getElementById('miscUndoRow');
    const resetRow=document.getElementById('miscResetRow');
    if(undoRow) undoRow.style.display='none';
    if(resetRow) resetRow.style.display='none';
  }catch(_e){}
}

  function applySinglesFromSettingsModal_v2217(){
  try{
    if(state.mode==="doubles") return;
    if(!state.names) state.names = {};
    const a=document.getElementById('m_pA');
    const b=document.getElementById('m_pB');
    state.names.A = (a && a.value.trim()) ? a.value.trim() : (state.names.A || "Player A");
    state.names.B = (b && b.value.trim()) ? b.value.trim() : (state.names.B || "Player B");

    const hid=document.getElementById('m_firstServerSingles');
    const fs=(hid && (hid.value==='A' || hid.value==='B')) ? hid.value : 'A';
    state.serverOrder = (fs==='B') ? ['B','A'] : ['A','B'];
    state.serverIndex = 0;

    saveState(state);
    render(true);
  }catch(_e){}
}

  function wireSettingsModal_v2217(){
  _onTap(document.getElementById('settingsCloseBtn'), ()=>_hide('settingsModal'));
  _onTap(document.getElementById('settingsBackdrop'), ()=>_hide('settingsModal'));

  // 모달 내 되돌리기/리셋은 숨김(메인 버튼 사용)
  const u=document.getElementById('undoBtn'); if(u) u.style.display='none';
  const r=document.getElementById('resetBtn'); if(r) r.style.display='none';

  // 경기운영 설정 토글
  _onTap(document.getElementById('tbBadge'), ()=>{
    try{
      state.tiebreakOn = !state.tiebreakOn;

      const trigger = getTbTrigger();
      const noPointStarted = ((state.points.A|0) + (state.points.B|0) === 0);

      if(!state.tiebreakOn && state.tiebreak){
        state.tiebreak = false;
        state.tbPoints = {A:0,B:0};
        resetPoints();
      }

      if(state.tiebreakOn && !state.tiebreak && state.games.A===trigger && state.games.B===trigger && noPointStarted){
        state.tiebreak = true;
        state.tbPoints = {A:0,B:0};
        resetPoints();
      }

      if(tbOnChk) tbOnChk.checked = !!state.tiebreakOn;
      saveState(state); render(true); syncSettingsModalFromState_v2217();
    }catch(_e){}
  });
  _onTap(document.getElementById('soundBadge'), ()=>{
    try{
      state.soundOn = !state.soundOn;
      saveState(state); render(true); syncSettingsModalFromState_v2217();
    }catch(_e){}
  });

  const a=document.getElementById('m_pA');
  const b=document.getElementById('m_pB');
  if(a){ a.addEventListener('change', applySinglesFromSettingsModal_v2217); a.addEventListener('blur', applySinglesFromSettingsModal_v2217); }
  if(b){ b.addEventListener('change', applySinglesFromSettingsModal_v2217); b.addEventListener('blur', applySinglesFromSettingsModal_v2217); }

  const hid=document.getElementById('m_firstServerSingles');
  _onTap(document.getElementById('m_btnSS_A'), ()=>{ if(hid) hid.value='A'; applySinglesFromSettingsModal_v2217(); syncSettingsModalFromState_v2217(); });
  _onTap(document.getElementById('m_btnSS_B'), ()=>{ if(hid) hid.value='B'; applySinglesFromSettingsModal_v2217(); syncSettingsModalFromState_v2217(); });

  const go=document.getElementById('matchConfigGoSetupBtn');
  if(go){
    _onTap(go, ()=>{
      _hide('settingsModal');
      try{ showSetup(); }catch(_e){}
    });
  }
}

  function wireResetChoiceModal_v2217(){
    _onTap(document.getElementById('resetChoiceCloseBtn'), ()=>_hide('resetChoiceModal'));
    _onTap(document.getElementById('resetChoiceBackdrop'), ()=>_hide('resetChoiceModal'));
    _onTap(document.getElementById('resetFullBtn'), ()=>{ _hide('resetChoiceModal'); try{ resetFullToSetup(); }catch(e){} });
    _onTap(document.getElementById('resetScoreOnlyBtn'), ()=>{ _hide('resetChoiceModal'); try{ resetScoresOnly(); }catch(e){} });
  }

try{
    bindEvents();
    initSetupDefaults();
    
    // v22.17: wire top buttons + modals
    try{ wireSettingsModal_v2217(); }catch(_e){}
    try{ wireResetChoiceModal_v2217(); }catch(_e){}
    try{ wireTopButtons_v2217(); }catch(_e){}
    try{ wireMatchResultModal(); }catch(_e){}
setTimeout(()=>{ try{ updateFirstServerButtonLabels(); }catch(_e){} }, 50);

    // Move point buttons above history (without touching HTML)
    try{
      const histBox = document.querySelector("#boardCard .histBox");
      const pointRow = btnPointA?.closest(".actionRow");
      if(histBox && pointRow && histBox.parentNode){
        histBox.parentNode.insertBefore(pointRow, histBox);
      }
    }catch(_e){}



    // viewport vars
    updateViewportUnits();
    const onVV = debounce(()=>{ updateViewportUnits(); render(true); scheduleResponsiveScale(); }, 140);
    window.addEventListener("resize", onVV);
    window.addEventListener("orientationchange", ()=>{ setTimeout(onVV, 50); setTimeout(onVV, 250); setTimeout(onVV, 600); });
    if(window.visualViewport){
      window.visualViewport.addEventListener("resize", onVV);
      window.visualViewport.addEventListener("scroll", onVV);
    }

    // IMPORTANT: always show setup first on load
    state.started = false;
    saveState(state);
    render(true);
    try{ document.querySelector(".wrap")?.scrollTo({top:0, left:0, behavior:"auto"}); }catch(_e){}
    try{ updateViewportUnits(); }catch(_e){}
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 60);
    setTimeout(()=>{ try{ updateViewportUnits(); }catch(_e){} }, 220);
    scheduleResponsiveScale();
    syncWakeLock();
  }catch(err){
    showErr("초기화 오류:", err);
  }
})()
})();

// ===== Supabase init (from /api/config) =====

async function initSupabase() {
  const res = await fetch("/api/config", { cache: "no-store" });
  if (!res.ok) throw new Error(`/api/config failed: ${res.status}`);
  const cfg = await res.json();

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  supabase = createClient(cfg.url, cfg.key);

  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }

  console.log("✅ Supabase ready");
}
  // ===========================================
  
  async function saveTestRecord() {
    return await saveCurrentRecord("manual");
  }

async function loadRecentRecords(limit = 10) {
  if (!supabase) await initSupabase();

  const { data, error } = await supabase
    .from("match_records")
    .select("id, created_at, app_version, data")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  console.log("✅ recent records:", data);
  return data;
}

window.addEventListener('load', async ()=>{
  try { await initSupabase(); }
  catch(e){ console.error('❌ Supabase init failed:', e); }

  // 1) version pill 이동(기존 로직)
  try{
    const vb = document.getElementById('versionPill');
    const sb = document.getElementById('settingsBtn');
    if(vb && sb && vb.parentElement !== sb){
      sb.style.position = 'relative';
      sb.appendChild(vb);
    }
  }catch(_e){}
  
  // 2) ✅ 저장 버튼 이벤트는 항상 등록
  const saveBtn = document.getElementById('saveMiniBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          await saveTestRecord(); // ✅ 이미 있는 함수 사용
          // 간단 피드백(알림 대신 버튼 텍스트 잠깐 변경)
          const txt = saveBtn.querySelector('.btnTxt');
          if (txt) {
            const prev = txt.textContent;
            txt.textContent = 'SAVED';
            setTimeout(() => (txt.textContent = prev), 900);
          }
        } catch (e) {
          console.error(e);
          alert('저장 실패: ' + (e?.message || e));
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
});


