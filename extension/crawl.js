// 설치계획서 크롤링 (로그인 후 신청서 목록 페이지에서 동작)
//
// 흐름
//   목록 페이지: 각 행의 건물명을 클릭 → 팝업이 열림
//   팝업 페이지: 기관명·담당부서·건물명·주소·착공/준공예정일·에너지원 표를 읽어 저장소(crawlInbox)에 넣고 닫힘
//   목록 페이지: 준공예정일이 오늘보다 이전이면 제외, 아니면 구글 시트에 한 행 추가
//   작업 기록(crawlLog)에 남긴 건은 다음 실행 때 건너뜀
//   한 페이지가 끝나면 다음 페이지 번호를 눌러 계속 진행

(function () {
  'use strict';
  if (window.__nrCrawlLoaded) return;
  window.__nrCrawlLoaded = true;

  const isTop = window.top === window;
  const STATE = 'crawlState';     // { running, awaiting, page, stats, startedAt }
  const LOG = 'crawlLog';         // { [key]: { status, org, name, at } }
  const RESULTS = 'crawlResults'; // 수집한 시트 행 목록 (복사용 백업)
  const INBOX = 'crawlInbox';     // 팝업 → 목록 페이지 전달용

  const norm = (s) => String(s || '').replace(/[\s*:：]/g, '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = (k, d) => new Promise((r) => chrome.storage.local.get({ [k]: d }, (v) => r(v[k])));
  const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));
  const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, (resp) => { void chrome.runtime.lastError; r(resp); }));

  async function getState() { return (await get(STATE, null)) || { running: false }; }
  async function patchState(p) { const s = await getState(); const n = { ...s, ...p }; await set({ [STATE]: n }); return n; }

  // =====================================================================
  // 1) 팝업(설치계획서 상세)에서 값 읽기
  // =====================================================================
  const FIELD_SEL = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=image]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea';

  function fieldValue(el) {
    if (el.tagName === 'SELECT') return (el.selectedOptions[0]?.textContent || '').trim();
    return String(el.value || '').trim();
  }

  // 화면 글자 중 label 과 같은 것(공백·*·: 무시)을 문서 순서대로 찾는다
  function findLabels(label) {
    const want = norm(label);
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (norm(n.nodeValue) === want && !n.parentElement.closest('#nrfill-panel, #nrcrawl-panel')) out.push(n);
    }
    if (!out.length) {
      // 글자가 여러 조각으로 나뉜 경우: 요소 전체 글자로 다시 찾기
      for (const el of document.querySelectorAll('th, td, label, span, dt, div, strong, b')) {
        if (el.children.length < 4 && norm(el.textContent) === want && !el.closest('#nrfill-panel, #nrcrawl-panel')) out.push(el);
      }
    }
    return out;
  }

  // 라벨 뒤에 오는 입력칸들. 라벨만 있는 표 칸이면 바로 옆 칸 안에서만 찾는다.
  function fieldsAfter(node) {
    const cell = (node.nodeType === 3 ? node.parentElement : node).closest('th, td');
    if (cell && norm(cell.textContent) === norm(node.textContent) && cell.nextElementSibling) {
      const inNext = [...cell.nextElementSibling.querySelectorAll(FIELD_SEL)];
      if (inNext.length) return inNext;
    }
    return [...document.querySelectorAll(FIELD_SEL)].filter(
      (e) => node.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function getField(label, nth = 0) {
    const n = findLabels(label)[nth];
    if (!n) return '';
    const f = fieldsAfter(n)[0];
    return f ? fieldValue(f) : '';
  }

  function getAddress() {
    const n = findLabels('건물주소')[0];
    if (!n) return '';
    const parts = fieldsAfter(n).slice(0, 4).map(fieldValue)
      .filter((v) => v && !/^\d{5,6}$/.test(v)); // 우편번호 제외
    // 다음 라벨(건물형태 등) 값이 섞이지 않도록 앞쪽 주소 칸 2개까지만 사용
    return parts.slice(0, 2).join(' ').trim();
  }

  function cellText(td) {
    const f = td.querySelector(FIELD_SEL);
    return (f ? fieldValue(f) : td.textContent).replace(/\s+/g, ' ').trim();
  }

  // "설치될 신·재생 에너지 설비의 개요" 표: 에너지원 / 에너지원형태 / 설치의무용량
  function getEnergy() {
    for (const t of document.querySelectorAll('table')) {
      const rows = [...t.rows];
      const hi = rows.findIndex((r) => {
        const tx = [...r.cells].map((c) => norm(c.textContent));
        return tx.includes('에너지원') && tx.some((x) => x.startsWith('설치의무용량'));
      });
      if (hi < 0) continue;
      const head = [...rows[hi].cells].map((c) => norm(c.textContent));
      const iSrc = head.indexOf('에너지원');
      const iForm = head.findIndex((x) => x.startsWith('에너지원형태'));
      const iCap = head.findIndex((x) => x.startsWith('설치의무용량'));
      const out = [];
      for (const r of rows.slice(hi + 1)) {
        const c = [...r.cells];
        if (c.length <= Math.max(iSrc, iCap)) continue;
        const src = cellText(c[iSrc]);
        const form = iForm >= 0 ? cellText(c[iForm]) : '';
        const cap = cellText(c[iCap]);
        if (!src || !cap) continue;
        out.push(`${src}${form ? ' ' + form : ''}: ${cap} kW`);
      }
      return out;
    }
    return [];
  }

  function extract() {
    return {
      org: getField('기관명'),
      dept: getField('담당자부서', 0), // 첫 번째 = 의무기관 담당자 부서 (두 번째는 대행업체)
      name: getField('건물명'),
      addr: getAddress(),
      start: getField('착공예정일'),
      end: getField('준공예정일'),
      energy: getEnergy(),
    };
  }

  async function popupMode() {
    const st = await getState();
    if (!st.running || !st.awaiting) return false;
    const looksPopup = window.opener || /pop\.do/i.test(location.pathname);
    if (!looksPopup) return false;
    // 화면이 다 그려질 때까지 최대 15초 기다림
    const t0 = Date.now();
    let data = null;
    while (Date.now() - t0 < 15000) {
      if (findLabels('준공예정일').length) {
        data = extract();
        if (data.name && data.end) break;
      }
      await sleep(400);
    }
    if (!data) return false;
    data.url = location.href;
    await set({ [INBOX]: { key: st.awaiting, data, at: Date.now() } });
    await sleep(200);
    send({ type: 'close-me' });
    return true;
  }

  // =====================================================================
  // 2) 목록 페이지: 표 읽기, 페이지 넘기기
  // =====================================================================
  function findList() {
    for (const t of document.querySelectorAll('table')) {
      const rows = [...t.rows];
      const hi = rows.findIndex((r) => {
        const tx = [...r.cells].map((c) => norm(c.textContent));
        return tx.includes('건물명') && tx.includes('신청번호');
      });
      if (hi < 0) continue;
      const head = [...rows[hi].cells].map((c) => norm(c.textContent));
      const idx = (h) => head.indexOf(h);
      const I = { no: idx('신청번호'), org: idx('기관명'), name: idx('건물명'), kind: idx('신청서구분'), first: idx('최초신청일자') };
      const items = [];
      for (const r of rows.slice(hi + 1)) {
        const c = [...r.cells];
        if (c.length <= I.name) continue;
        const txt = (i) => (i >= 0 && c[i] ? c[i].textContent.replace(/\s+/g, ' ').trim() : '');
        const link = c[I.name].querySelector('a') || c[I.name];
        const no = txt(I.no);
        const name = txt(I.name);
        if (!name) continue;
        const key = /^\d{6,}$/.test(no) ? no : `${txt(I.org)}|${name}|${txt(I.kind)}|${txt(I.first)}`;
        items.push({ key, no, org: txt(I.org), name, kind: txt(I.kind), link });
      }
      return { table: t, items };
    }
    return null;
  }

  function signature() {
    const l = findList();
    return l ? l.items.map((x) => x.key).join(',') : '';
  }

  // 페이지 번호 묶음(1 2 3 …)을 찾는다
  function findPager(table) {
    const nums = [...document.querySelectorAll('a, span, strong, em, button, li')].filter((e) => {
      if (table.contains(e)) return false;
      if (e.closest('#nrfill-panel, #nrcrawl-panel')) return false;
      return /^\d{1,3}$/.test(e.textContent.trim()) && e.children.length === 0;
    });
    const groups = new Map();
    for (const e of nums) {
      const box = e.closest('div, p, ul, nav, td') || e.parentElement;
      if (!groups.has(box)) groups.set(box, []);
      groups.get(box).push(e);
    }
    let best = null;
    for (const [box, list] of groups) if (!best || list.length > best.list.length) best = { box, list };
    if (!best) return null;
    const isCur = (e) => e.tagName !== 'A' && e.tagName !== 'BUTTON'
      || /(^|\s)(on|active|current|sel|selected)(\s|$)/i.test(e.className + ' ' + (e.parentElement?.className || ''))
      || e.getAttribute('aria-current');
    const curEl = best.list.find(isCur);
    const cur = curEl ? Number(curEl.textContent.trim()) : 1;
    const clickable = (e) => e.closest('a, button') || e;
    const nextNum = best.list.find((e) => Number(e.textContent.trim()) === cur + 1);
    let next = nextNum ? clickable(nextNum) : null;
    if (!next) {
      next = [...best.box.querySelectorAll('a, button')].find((a) => {
        const t = (a.textContent + ' ' + (a.title || '') + ' ' + (a.getAttribute('aria-label') || '') + ' ' +
          [...a.querySelectorAll('img')].map((i) => i.alt).join(' ')).toLowerCase();
        return /다음|next|›|»|>/.test(t) && !/마지막|last|끝/.test(t);
      }) || null;
    }
    return { cur, next };
  }

  // =====================================================================
  // 3) 크롤링 실행
  // =====================================================================
  const ymd = (s) => {
    const d = String(s || '').replace(/\D/g, '');
    if (d.length !== 8) return null;
    return new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  };
  const fmtDate = (s) => {
    const d = String(s || '').replace(/\D/g, '');
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : String(s || '');
  };
  const todayStart = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };

  function toSheetRow(d, key) {
    return {
      _key: key,
      A: d.org,
      B: d.name,
      C: d.addr,
      H: fmtDate(d.start),
      I: fmtDate(d.end),
      J: d.dept,
      R: (d.energy || []).join('\n'),
    };
  }

  async function waitInbox(key, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const box = await get(INBOX, null);
      if (box && box.key === key) return box;
      const st = await getState();
      if (!st.running) return null;
      await sleep(300);
    }
    return null;
  }

  // 사이트 링크를 페이지 자신의 실행 환경에서 누른다 (javascript: 링크 대응)
  async function pageClick(el) {
    const tok = Math.random().toString(36).slice(2);
    el.setAttribute('data-nrcrawl-click', tok);
    const r = await send({ type: 'main-click', token: tok });
    if (!r || !r.ok) { el.removeAttribute('data-nrcrawl-click'); el.click(); }
  }

  let running = false;
  async function runCrawl() {
    if (running) return;
    running = true;
    try {
      while (true) {
        const list = findList();
        if (!list) { await finish('신청서 목록 표를 찾지 못했습니다.'); return; }
        const settings = await new Promise((r) => chrome.storage.sync.get({ sheetUrl: '', crawlDelay: 1000 }, r));

        for (const it of list.items) {
          let st = await getState();
          if (!st.running) { ui(); return; }
          const log = await get(LOG, {});
          if (log[it.key]) continue; // 이미 처리한 건

          ui(`열기: ${it.name}`);
          await set({ [INBOX]: null });
          await patchState({ awaiting: it.key });
          await pageClick(it.link);
          const box = await waitInbox(it.key, 30000);
          st = await patchState({ awaiting: null });
          if (!st.running) { ui(); return; }
          const stats = st.stats || {};

          if (!box) {
            stats.error = (stats.error || 0) + 1;
            await patchState({ stats, lastError: `팝업 응답 없음: ${it.name}` });
            ui(`팝업이 열리지 않았습니다: ${it.name} (팝업 차단 해제 필요)`);
            await sleep(500);
            continue;
          }
          const d = box.data;
          const end = ymd(d.end);
          const entry = { org: d.org || it.org, name: d.name || it.name, end: fmtDate(d.end), at: new Date().toISOString() };

          if (end && end < todayStart()) {
            log[it.key] = { ...entry, status: 'past' };
            stats.past = (stats.past || 0) + 1;
          } else {
            const row = toSheetRow(d, it.key);
            const results = await get(RESULTS, []);
            results.push(row);
            await set({ [RESULTS]: results });
            if (settings.sheetUrl) {
              const resp = await send({ type: 'sheet-append', rows: [row] });
              const r = resp && resp.ok && resp.results && resp.results[0];
              if (r && (r.status === 'written' || r.status === 'exists')) {
                log[it.key] = { ...entry, status: r.status, row: r.row };
                stats[r.status] = (stats[r.status] || 0) + 1;
              } else {
                stats.error = (stats.error || 0) + 1;
                await patchState({ stats, lastError: `시트 저장 실패: ${(resp && resp.error) || '응답 없음'}` });
                ui(`시트 저장 실패: ${(resp && resp.error) || '응답 없음'}`);
                await sleep(500);
                continue; // 기록하지 않음 → 다음 실행 때 다시 시도
              }
            } else {
              log[it.key] = { ...entry, status: 'collected' };
              stats.collected = (stats.collected || 0) + 1;
            }
          }
          await set({ [LOG]: log });
          await patchState({ stats });
          ui();
          await sleep(Number(settings.crawlDelay) || 1000);
        }

        // 다음 페이지
        const pager = findPager(list.table);
        if (!pager || !pager.next) { await finish('모든 페이지를 처리했습니다.'); return; }
        const sig = signature();
        await patchState({ page: pager.cur + 1 });
        ui(`${pager.cur + 1}페이지로 이동`);
        await pageClick(pager.next);
        const t0 = Date.now();
        let changed = false;
        while (Date.now() - t0 < 20000) {
          await sleep(500);
          if (signature() !== sig) { changed = true; break; }
        }
        if (!changed) { await finish('다음 페이지로 넘어가지 않아 종료했습니다.'); return; }
      }
    } finally {
      running = false;
    }
  }

  async function finish(msg) {
    await patchState({ running: false, awaiting: null, endedAt: new Date().toISOString(), lastMessage: msg });
    try { sessionStorage.removeItem('nrcrawl'); } catch (e) { /* ignore */ }
    ui(msg);
  }

  // =====================================================================
  // 4) 목록 페이지 위 작은 패널
  // =====================================================================
  let panel = null;
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'nrcrawl-panel';
    panel.innerHTML = `
      <div class="nrcrawl-head"><strong>설치계획 크롤링</strong><button type="button" data-act="settings">설정</button></div>
      <div class="nrcrawl-body">
        <div class="nrcrawl-actions">
          <button type="button" class="nrcrawl-btn" data-act="start">크롤링 시작</button>
          <button type="button" class="nrcrawl-btn secondary" data-act="stop">중지</button>
        </div>
        <div class="nrcrawl-stats" id="nrcrawl-stats"></div>
        <div class="nrcrawl-msg" id="nrcrawl-msg"></div>
        <div class="nrcrawl-foot" id="nrcrawl-foot"></div>
      </div>`;
    document.documentElement.appendChild(panel);
    panel.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'settings') send({ type: 'open-options' });
      if (act === 'start') start();
      if (act === 'stop') { await patchState({ running: false, awaiting: null, lastMessage: '사용자가 중지했습니다.' }); try { sessionStorage.removeItem('nrcrawl'); } catch (er) { /* */ } ui('중지했습니다.'); }
    });
    ui();
  }

  async function start() {
    const { sheetUrl } = await new Promise((r) => chrome.storage.sync.get({ sheetUrl: '' }, r));
    if (!sheetUrl && !confirm('구글 시트 연결(설정 4번)이 아직 없습니다.\n시트에 쓰지 않고 수집만 할까요? (설정 페이지에서 결과를 복사할 수 있습니다)')) return;
    try { sessionStorage.setItem('nrcrawl', '1'); } catch (e) { /* ignore */ }
    await set({ [STATE]: { running: true, awaiting: null, page: 1, stats: {}, startedAt: new Date().toISOString() } });
    ui('시작합니다.');
    runCrawl();
  }

  async function ui(msg) {
    if (!panel) return;
    const st = await getState();
    const s = st.stats || {};
    const log = await get(LOG, {});
    panel.querySelector('[data-act="start"]').disabled = !!st.running;
    panel.querySelector('[data-act="stop"]').disabled = !st.running;
    panel.querySelector('#nrcrawl-stats').innerHTML =
      `<span>시트 작성 <b>${s.written || 0}</b></span><span>수집 <b>${s.collected || 0}</b></span>` +
      `<span>준공 경과 제외 <b>${s.past || 0}</b></span><span>시트에 이미 있음 <b>${s.exists || 0}</b></span><span>오류 <b>${s.error || 0}</b></span>`;
    const m = panel.querySelector('#nrcrawl-msg');
    m.textContent = msg || st.lastMessage || (st.running ? '진행 중…' : '대기 중');
    panel.querySelector('#nrcrawl-foot').textContent = `작업 기록 ${Object.keys(log).length}건 (기록된 건은 다시 열지 않습니다)`;
  }

  // =====================================================================
  // 시작점
  // =====================================================================
  (async function init() {
    // 팝업이면 값 읽고 끝
    if (await popupMode()) return;
    if (!isTop) return;
    // 목록 페이지가 늦게 그려질 수 있어 잠시 기다림
    let list = null;
    for (let i = 0; i < 20 && !(list = findList()); i++) await sleep(300);
    if (!list) return;
    buildPanel();
    const st = await getState();
    let mine = false;
    try { mine = sessionStorage.getItem('nrcrawl') === '1'; } catch (e) { /* ignore */ }
    if (st.running && mine) { ui('이어서 진행합니다.'); runCrawl(); }
    else if (st.running && !mine) { ui('다른 탭에서 진행 중입니다.'); }
  })();

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && panel && (ch[STATE] || ch[LOG])) ui();
  });

  // 테스트·디버그용
  window.__nrCrawl = { extract, findList, findPager };
})();
