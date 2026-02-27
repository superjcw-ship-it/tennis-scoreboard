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
    const v = (window.__TS_APP_VERSION || 'v22.24.28');
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
  const APP_VERSION = "v22.24.28";
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
  const noAdChk = $("noAd");

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
      // keep match configuration (mode/bestOf/noAd/names/firstServer etc)
      state.sets = {A:0,B:0};
      state.games = {A:0,B:0};
      resetPoints();
      resetTiebreak();
      state.completedSets = [];
      state.gameHistory = [];
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
      bestOf:3,
      noAd:true,

      // preference: whether to play a tiebreak game at 6:6 (default ON)
      tiebreakOn:true,

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
    if(typeof pick("noAd")==="boolean") s.noAd = pick("noAd");
    if(typeof pick("started")==="boolean") s.started = pick("started");

    if(pick("names") && typeof pick("names")==="object") s.names = {...s.names, ...pick("names")};

    if(pick("sets") && typeof pick("sets")==="object") s.sets = {A: +pick("sets").A||0, B:+pick("sets").B||0};
    if(pick("games") && typeof pick("games")==="object") s.games = {A: +pick("games").A||0, B:+pick("games").B||0};
    if(pick("points") && typeof pick("points")==="object") s.points = {A: +pick("points").A||0, B:+pick("points").B||0};

    // preference: play tiebreak at 6:6
    if(typeof pick("tiebreakOn")==="boolean") s.tiebreakOn = pick("tiebreakOn");

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
    if(s.bestOf !== 5) s.bestOf = 3;
    if(s.completedSets.length > 5) s.completedSets = s.completedSets.slice(0,5);
    if(s.gameHistory.length > 13) s.gameHistory = s.gameHistory.slice(0,13);

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
    return Math.min(5, state.completedSets.length + 1);
  }

  function currentGameNo(){
    if(state.tiebreak) return 13;
    const g = state.games.A + state.games.B + 1;
    return Math.min(13, Math.max(1, g));
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

  function checkEnterTiebreak(){ return !!state.tiebreakOn && state.games.A===6 && state.games.B===6; }

  function checkWinSet(){
    const a=state.games.A, b=state.games.B;
    if(a===7 && b===6) return "A";
    if(b===7 && a===6) return "B";
    if(a>=6 && a-b>=2) return "A";
    if(b>=6 && b-a>=2) return "B";
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
    if(curSet>=1 && curSet<=5){
      // show current set games (even during TB)
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
    if(liveIdx>=0 && liveIdx<13){
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
  }

  function recordTiebreakSnapshot(){
    const idx = 12; // 13th game
    state.gameHistory[idx] = {
      A: String(state.tbPoints.A),
      B: String(state.tbPoints.B),
      noAdDeuceWinner: null
    };
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
      bestOfSel.value = String(state.bestOf);
      if(noAdChk) noAdChk.checked = !!state.noAd;

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
    nameA.textContent = teamName(leftTeam);
    nameB.textContent = teamName(rightTeam);

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
    }else{
      winnerText.style.display = "none";
      winnerText.textContent = "";
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
        const finalA = (tbW==="A") ? 7 : 6;
        const finalB = (tbW==="B") ? 7 : 6;

        pushCompletedSet(finalA, finalB, state.tbPoints.A, state.tbPoints.B);

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
    next.bestOf = parseInt(bestOfSel.value,10) || 3;
    next.noAd = !!noAdChk?.checked;

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

  // ---------- Event binding ----------
  function bindEvents(){
    // setup mode toggle
    modeSel?.addEventListener("change", ()=>{
      const v = modeSel.value;
      // keep state in sync immediately (rotation/keyboard triggers render)
      state.mode = v;
      saveState(state);

      singlesInputs.style.display = (v==="doubles") ? "none" : "block";
      doublesInputs.style.display = (v==="doubles") ? "block" : "none";
      updateFirstServerButtonLabels();
      // keep selected server button visible
      setFirstServerSingles(firstServerSinglesHidden?.value || "A");
      // doubles serve picks (green/blue)
      if(v==="doubles"){
        // reset pick cycle so next click becomes GREEN
        try{ doublesPickStage = 0; }catch(_e){}
        // ensure hidden defaults exist
        if(doublesStartTeamHidden && !doublesStartTeamHidden.value) doublesStartTeamHidden.value = "A";
        if(doublesFirstAHidden && !doublesFirstAHidden.value) doublesFirstAHidden.value = "A1";
        if(doublesFirstBHidden && !doublesFirstBHidden.value) doublesFirstBHidden.value = "B1";
        refreshDoublesServeUI();
      }
    });

    bestOfSel?.addEventListener("change", ()=>{
      const v = parseInt(bestOfSel.value,10) || 3;
      state.bestOf = v;
      saveState(state);
    });

    noAdChk?.addEventListener("change", ()=>{
      state.noAd = !!noAdChk.checked;
      saveState(state);
      // if NO-AD changed mid game, keep it applied immediately
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
    bindTap(loadBtn, (e)=>{
      e.preventDefault();
      try{
        loadMatch();
      }catch(err){
        showErr("LOAD 처리 중 오류:", err);
      }
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
    if(setNo) setNo.textContent = (state.bestOf===5 ? "5세트 3선승" : "3세트 2선승");
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
      // Toggle preference: play a tiebreak game at 6:6
      state.tiebreakOn = !state.tiebreakOn;

      // If the user turns TB OFF while a TB game is active, switch back to normal game.
      if(!state.tiebreakOn && state.tiebreak){
        state.tiebreak = false;
        state.tbPoints = {A:0,B:0};
        // Normal game scoring uses state.points (TB uses tbPoints). Start clean.
        resetPoints();
      }

      // If the user turns TB ON at 6:6 before the next game has started (0-0), start TB immediately.
      if(state.tiebreakOn && !state.tiebreak && state.games.A===6 && state.games.B===6 && ((state.points.A|0)+(state.points.B|0)===0)){
        state.tiebreak = true;
        state.tbPoints = {A:0,B:0};
      }

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
let supabase = null;

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

window.addEventListener('load', async ()=>{
  try { await initSupabase(); }
  catch(e){ console.error('❌ Supabase init failed:', e); }

  // 기존 코드 그대로
  try{
    const vb = document.getElementById('versionPill');
    const sb = document.getElementById('settingsBtn');
    if(vb && sb && vb.parentElement !== sb){
      sb.style.position = 'relative';
      sb.appendChild(vb);
    }
  }catch(_e){}
});

async function saveTestRecord() {
  const now = new Date().toISOString();

  const record = {
    schema_version: "match_v1",
    match: {
      match_id: (crypto.randomUUID?.() ?? `local-${Date.now()}`),
      started_at: now,
      ended_at: null,
      mode: "doubles",
      best_of: 3,
      rules: { tiebreak_at_6_6: true, final_set_tiebreak: true }
    },
    teams: {
      A: { name: "A팀", players: ["A1", "A2"] },
      B: { name: "B팀", players: ["B1", "B2"] }
    },
    log: { events: [] },
    result: { winner: null, final_sets: null, duration_sec: null }
  };

  const { error } = await supabase
    .from("match_records")
    .insert({ app_version: "v-test", data: record });

  if (error) throw error;
  console.log("✅ insert ok");
}
