// 로그인 페이지 위에 뜨는 자동입력 패널 (최상위 프레임에서만 표시)
// 모든 프레임: 'do-fill' 메시지를 받으면 자기 문서 안의 입력칸을 채운다.

(function () {
  'use strict';
  const F = window.NRFill;
  const isTop = window.top === window;

  const DEFAULTS = {
    users: [],            // [{ name, phone }]
    lastUser: '',
    orgsOverride: null,   // 시트에서 새로 받아온 기관 목록 (없으면 번들 데이터 사용)
    orgsUpdatedAt: '',
    bizSelector: '',      // 사용자가 직접 지정한 셀렉터
    phoneSelector: '',
    bizFormat: 'auto',    // auto | hyphen | digits
    phoneFormat: 'auto',
    panelCollapsed: false,
    panelPos: null,       // { right, bottom }
    showOnlyLogin: true,  // login.do 를 포함한 주소에서만 패널 표시
  };

  let settings = { ...DEFAULTS };
  let orgs = [];
  let selectedOrg = null;

  // ---------- 모든 프레임 공통: 채우기 명령 수신 ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'do-fill') {
      if (isTop) return; // 최상위 프레임은 doFill()에서 이미 직접 채웠으므로 중복 방지
      const p = msg.payload;
      const r = { biz: 0, phone: 0, frame: location.href };
      if (p.bno) r.biz = F.fillBiz(document, p.bno, p.opts);
      if (p.phone) r.phone = F.fillPhone(document, p.phone, p.opts);
      if (r.biz || r.phone) chrome.runtime.sendMessage({ type: 'fill-result', result: r });
    } else if (msg.type === 'fill-result' && isTop) {
      onFillResult(msg.result);
    } else if (msg.type === 'start-pick') {
      startPick(msg.kind);
    }
  });

  // 필드 직접 지정 모드: 어느 프레임에서든 클릭한 입력칸의 셀렉터를 저장
  let picking = null;
  function startPick(kind) {
    if (picking) return;
    picking = kind;
    document.body.classList.add('nrfill-picking');
    const handler = (e) => {
      if (e.target.tagName !== 'INPUT' || e.target.closest('#nrfill-panel')) return;
      e.preventDefault(); e.stopPropagation();
      const sel = F.selectorFor(e.target);
      const key = kind === 'biz' ? 'bizSelector' : 'phoneSelector';
      chrome.storage.sync.set({ [key]: sel }, () => {
        chrome.runtime.sendMessage({ type: 'fill-result', result: { picked: kind, selector: sel } });
      });
      document.body.classList.remove('nrfill-picking');
      document.removeEventListener('click', handler, true);
      picking = null;
    };
    document.addEventListener('click', handler, true);
  }

  if (!isTop) return; // 아래는 최상위 프레임 전용 (패널 UI)

  // ---------- 설정/데이터 로드 ----------
  function loadSettings() {
    return new Promise((res) => {
      chrome.storage.sync.get(DEFAULTS, (sync) => {
        chrome.storage.local.get({ orgsOverride: null, orgsUpdatedAt: '' }, (local) => {
          settings = { ...DEFAULTS, ...sync, ...local };
          res(settings);
        });
      });
    });
  }

  async function loadOrgs() {
    if (settings.orgsOverride && settings.orgsOverride.length) { orgs = settings.orgsOverride; return; }
    const url = chrome.runtime.getURL('data/orgs.json');
    const j = await (await fetch(url)).json();
    orgs = j.orgs || [];
  }

  // ---------- 패널 UI ----------
  let panel, $q, $list, $sel, $user, $status, $count;

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'nrfill-panel';
    panel.innerHTML = `
      <div class="nrfill-head">
        <strong>로그인 자동입력</strong>
        <button type="button" data-act="settings" title="설정">설정</button>
        <button type="button" data-act="toggle" title="접기/펼치기">－</button>
      </div>
      <div class="nrfill-body">
        <div>
          <label class="nrfill-lbl" for="nrfill-q">기관(사업자) 검색 → 사업자등록번호</label>
          <input type="text" id="nrfill-q" placeholder="기관명 또는 사업자번호 일부 입력" autocomplete="off">
          <ul class="nrfill-results" id="nrfill-list"></ul>
          <div class="nrfill-selected" id="nrfill-sel"></div>
        </div>
        <div>
          <label class="nrfill-lbl" for="nrfill-user">사용자 선택 → 휴대폰 번호</label>
          <select id="nrfill-user"></select>
        </div>
        <div class="nrfill-actions">
          <button type="button" class="nrfill-btn" data-act="fill">사업자번호 + 휴대폰 채우기</button>
        </div>
        <div class="nrfill-actions">
          <button type="button" class="nrfill-btn secondary" data-act="fill-biz">사업자번호만</button>
          <button type="button" class="nrfill-btn secondary" data-act="fill-phone">휴대폰만</button>
        </div>
        <div class="nrfill-status" id="nrfill-status"></div>
        <div class="nrfill-foot">
          <span id="nrfill-count"></span>
          <span><a data-act="pick-biz">사업자칸 지정</a> · <a data-act="pick-phone">휴대폰칸 지정</a></span>
        </div>
      </div>`;
    document.documentElement.appendChild(panel);

    $q = panel.querySelector('#nrfill-q');
    $list = panel.querySelector('#nrfill-list');
    $sel = panel.querySelector('#nrfill-sel');
    $user = panel.querySelector('#nrfill-user');
    $status = panel.querySelector('#nrfill-status');
    $count = panel.querySelector('#nrfill-count');

    if (settings.panelCollapsed) collapse(true);
    if (settings.panelPos) { panel.style.right = settings.panelPos.right + 'px'; panel.style.bottom = settings.panelPos.bottom + 'px'; }

    panel.addEventListener('click', onClick);
    $q.addEventListener('input', () => renderResults($q.value));
    $q.addEventListener('keydown', onKey);
    $user.addEventListener('change', () => {
      chrome.storage.sync.set({ lastUser: $user.value });
      if ($user.value) doFill({ phone: currentPhone() });
    });
    makeDraggable(panel.querySelector('.nrfill-head'));
    renderUsers();
    $count.textContent = `기관 ${orgs.length}곳` + (settings.orgsUpdatedAt ? ` (시트 ${settings.orgsUpdatedAt})` : ' (내장 데이터)');
  }

  function collapse(on) {
    panel.classList.toggle('nrfill-collapsed', on);
    panel.querySelector('[data-act="toggle"]').textContent = on ? '＋' : '－';
    chrome.storage.sync.set({ panelCollapsed: on });
  }

  function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    e.preventDefault();
    switch (act) {
      case 'settings': chrome.runtime.sendMessage({ type: 'open-options' }); break;
      case 'toggle': collapse(!panel.classList.contains('nrfill-collapsed')); break;
      case 'fill': doFill({ bno: selectedOrg?.bno, phone: currentPhone() }); break;
      case 'fill-biz': doFill({ bno: selectedOrg?.bno }); break;
      case 'fill-phone': doFill({ phone: currentPhone() }); break;
      case 'copy': if (selectedOrg) navigator.clipboard.writeText(selectedOrg.bno).then(() => status('사업자번호를 복사했습니다.', 'ok')); break;
      case 'pick-biz': beginPick('biz'); break;
      case 'pick-phone': beginPick('phone'); break;
      case 'clear': selectOrg(null); break;
    }
  }

  function beginPick(kind) {
    status(kind === 'biz' ? '페이지에서 사업자등록번호 입력칸을 클릭하세요.' : '페이지에서 휴대폰 번호 입력칸을 클릭하세요.');
    // 백그라운드가 탭의 모든 프레임(이 프레임 포함)에 'start-pick'을 전달한다
    chrome.runtime.sendMessage({ type: 'relay-pick', kind });
  }

  // ---------- 검색 ----------
  let results = [], active = -1;
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');

  function renderResults(q) {
    const nq = norm(q);
    const nd = F.digits(q);
    results = [];
    if (nq.length >= 1) {
      for (const o of orgs) {
        if (norm(o.name).includes(nq) || (nd.length >= 3 && F.digits(o.bno).includes(nd))) {
          results.push(o);
          if (results.length >= 30) break;
        }
      }
    }
    active = results.length ? 0 : -1;
    $list.innerHTML = '';
    if (nq.length >= 1 && !results.length) {
      const li = document.createElement('li'); li.className = 'nrfill-empty'; li.textContent = '검색 결과가 없습니다.';
      $list.appendChild(li);
    }
    results.forEach((o, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="name"></span><span class="bno"></span>`;
      li.querySelector('.name').textContent = o.name;
      li.querySelector('.bno').textContent = o.bno;
      if (i === active) li.classList.add('nrfill-active');
      li.addEventListener('mousedown', (e) => { e.preventDefault(); selectOrg(o); });
      $list.appendChild(li);
    });
  }

  function onKey(e) {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, results.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) selectOrg(results[active]); return; }
    else return;
    [...$list.children].forEach((li, i) => li.classList.toggle('nrfill-active', i === active));
    $list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function selectOrg(o) {
    selectedOrg = o;
    $list.innerHTML = ''; results = [];
    if (!o) { $sel.innerHTML = ''; return; }
    $q.value = o.name;
    $sel.innerHTML = `<span class="grow"></span><b></b><button type="button" class="nrfill-mini" data-act="copy">복사</button><button type="button" class="nrfill-mini" data-act="clear">✕</button>`;
    $sel.querySelector('.grow').textContent = o.name;
    $sel.querySelector('b').textContent = o.bno;
    doFill({ bno: o.bno }); // 선택 즉시 사업자번호 채우기
  }

  // ---------- 사용자 ----------
  function renderUsers() {
    const users = settings.users || [];
    $user.innerHTML = '';
    const opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = users.length ? '사용자를 선택하세요' : '등록된 사용자가 없습니다 (설정에서 등록)';
    $user.appendChild(opt0);
    users.forEach((u, i) => {
      const opt = document.createElement('option');
      opt.value = String(i); opt.textContent = `${u.name}  ${u.phone}`;
      $user.appendChild(opt);
    });
    if (settings.lastUser !== '' && users[Number(settings.lastUser)]) $user.value = settings.lastUser;
  }
  function currentPhone() {
    const u = (settings.users || [])[Number($user.value)];
    return u ? u.phone : '';
  }

  // ---------- 채우기 ----------
  let lastResult = null, resultTimer = null;
  function doFill({ bno, phone }) {
    if (!bno && !phone) { status('먼저 기관을 검색하거나 사용자를 선택하세요.', 'err'); return; }
    lastResult = { biz: 0, phone: 0 };
    const opts = { bizSelector: settings.bizSelector, phoneSelector: settings.phoneSelector, bizFormat: settings.bizFormat, phoneFormat: settings.phoneFormat };
    // 1) 이 프레임에서 직접 시도
    if (bno) lastResult.biz += F.fillBiz(document, bno, opts);
    if (phone) lastResult.phone += F.fillPhone(document, phone, opts);
    // 2) iframe 들에도 전달
    chrome.runtime.sendMessage({ type: 'relay-fill', payload: { bno, phone, opts } });
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => report(bno, phone), 400);
  }
  function onFillResult(r) {
    if (r.picked) {
      status(`${r.picked === 'biz' ? '사업자번호' : '휴대폰'} 입력칸을 저장했습니다: ${r.selector}`, 'ok');
      loadSettings();
      return;
    }
    if (!lastResult) return;
    lastResult.biz += r.biz || 0; lastResult.phone += r.phone || 0;
  }
  function report(bno, phone) {
    const msgs = [];
    if (bno) msgs.push(lastResult.biz ? `사업자번호 입력 완료(${lastResult.biz}칸)` : '사업자번호 입력칸을 찾지 못했습니다. 아래 "사업자칸 지정"을 눌러 직접 지정하세요.');
    if (phone) msgs.push(lastResult.phone ? `휴대폰 입력 완료(${lastResult.phone}칸)` : '휴대폰 입력칸을 찾지 못했습니다. 아래 "휴대폰칸 지정"을 눌러 직접 지정하세요.');
    const fail = (bno && !lastResult.biz) || (phone && !lastResult.phone);
    status(msgs.join(' / '), fail ? 'err' : 'ok');
  }
  function status(t, cls) { $status.textContent = t; $status.className = 'nrfill-status ' + (cls || ''); }

  // ---------- 드래그 이동 ----------
  function makeDraggable(handle) {
    let sx, sy, sr, sb, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      sr = parseFloat(getComputedStyle(panel).right); sb = parseFloat(getComputedStyle(panel).bottom);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.right = Math.max(0, sr - (e.clientX - sx)) + 'px';
      panel.style.bottom = Math.max(0, sb - (e.clientY - sy)) + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return; dragging = false;
      chrome.storage.sync.set({ panelPos: { right: parseFloat(panel.style.right), bottom: parseFloat(panel.style.bottom) } });
    });
  }

  // ---------- 시작 ----------
  (async function init() {
    await loadSettings();
    if (settings.showOnlyLogin && !/login/i.test(location.pathname)) return;
    await loadOrgs();
    buildPanel();
  })();

  chrome.storage.onChanged.addListener(() => { loadSettings().then(() => { if (panel) renderUsers(); }); });
})();
