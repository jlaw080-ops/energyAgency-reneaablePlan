// 설정 페이지 동작
(function () {
  'use strict';
  const DEFAULT_SHEET_ID = '1aIUyHK8FrLSot9zL4Z-j9W0C6KQNDL5dz45tdC40elc';
  const $ = (s) => document.querySelector(s);
  const digits = (s) => String(s || '').replace(/\D/g, '');

  let users = [];
  let orgs = [];       // 현재 사용 중인 기관 목록 (시트 동기화본 또는 내장)
  let bundled = [];    // 내장 데이터

  function msg(sel, text, cls) { const el = $(sel); el.textContent = text; el.className = 'msg ' + (cls || ''); }

  // ---------- 사용자 ----------
  function fmtPhone(p) {
    const d = digits(p);
    if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return p.trim();
  }
  function renderUsers() {
    const tb = $('#u-table tbody');
    tb.innerHTML = '';
    if (!users.length) { tb.innerHTML = '<tr><td colspan="4" class="empty">등록된 사용자가 없습니다.</td></tr>'; return; }
    users.forEach((u, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td class="n"></td><td class="p"></td>
        <td style="text-align:right"><button data-act="up" data-i="${i}" title="위로">▲</button> <button data-act="down" data-i="${i}" title="아래로">▼</button> <button data-act="del" data-i="${i}" class="danger">삭제</button></td>`;
      tr.querySelector('.n').textContent = u.name;
      tr.querySelector('.p').textContent = u.phone;
      tb.appendChild(tr);
    });
  }
  function saveUsers(note) {
    chrome.storage.sync.set({ users }, () => { renderUsers(); if (note) msg('#u-msg', note, 'ok'); });
  }
  $('#u-add').addEventListener('click', () => {
    const name = $('#u-name').value.trim();
    const phone = fmtPhone($('#u-phone').value);
    if (!name) return msg('#u-msg', '이름을 입력하세요.', 'err');
    if (digits(phone).length < 10) return msg('#u-msg', '휴대폰 번호를 확인하세요 (숫자 10~11자리).', 'err');
    users.push({ name, phone });
    $('#u-name').value = ''; $('#u-phone').value = '';
    saveUsers(`${name} 님을 추가했습니다.`);
  });
  $('#u-phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#u-add').click(); });
  $('#u-table').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.act === 'del') { if (!confirm(`${users[i].name} 님을 삭제할까요?`)) return; users.splice(i, 1); }
    if (b.dataset.act === 'up' && i > 0) [users[i - 1], users[i]] = [users[i], users[i - 1]];
    if (b.dataset.act === 'down' && i < users.length - 1) [users[i + 1], users[i]] = [users[i], users[i + 1]];
    saveUsers();
  });

  // ---------- 기관 데이터 ----------
  function parseSheetId(v) {
    v = (v || '').trim();
    const m = v.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : v;
  }
  // 간단한 CSV 파서 (따옴표/쉼표/줄바꿈 처리)
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function rowsToOrgs(rows) {
    // 헤더에서 "기관명", "사업자번호" 열 위치를 찾고, 없으면 2·3번째 열 사용
    const header = rows[0] ? rows[0].map((h) => h.trim()) : [];
    let ni = header.findIndex((h) => /기관명|기관|업체명|사업자명|name/i.test(h));
    let bi = header.findIndex((h) => /사업자/.test(h) || /biz|bno/i.test(h));
    if (ni < 0) ni = 1; if (bi < 0) bi = 2;
    const seen = new Set(); const out = [];
    for (const r of rows.slice(header.length ? 1 : 0)) {
      const name = (r[ni] || '').trim(); const raw = (r[bi] || '').trim();
      const d = digits(raw);
      if (!name || d.length !== 10) continue;
      const bno = `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
      const k = name + bno; if (seen.has(k)) continue; seen.add(k);
      out.push({ name, bno });
    }
    return out;
  }
  function renderOrgInfo() {
    chrome.storage.local.get({ orgsUpdatedAt: '' }, ({ orgsUpdatedAt }) => {
      $('#org-info').textContent = `현재 ${orgs.length}곳 · ` + (orgsUpdatedAt ? `시트 동기화 ${orgsUpdatedAt}` : '내장 데이터 사용 중');
    });
    renderOrgTable($('#org-q').value);
  }
  function renderOrgTable(q) {
    const tb = $('#org-table tbody'); tb.innerHTML = '';
    const nq = (q || '').replace(/\s+/g, '').toLowerCase();
    if (!nq) return;
    const hits = orgs.filter((o) => o.name.replace(/\s+/g, '').toLowerCase().includes(nq)).slice(0, 20);
    if (!hits.length) { tb.innerHTML = '<tr><td class="empty">검색 결과 없음</td></tr>'; return; }
    for (const o of hits) {
      const tr = document.createElement('tr'); tr.innerHTML = '<td></td><td style="width:140px"></td>';
      tr.children[0].textContent = o.name; tr.children[1].textContent = o.bno; tb.appendChild(tr);
    }
  }
  $('#org-q').addEventListener('input', (e) => renderOrgTable(e.target.value));

  $('#org-sync').addEventListener('click', async () => {
    const id = parseSheetId($('#sheet-id').value) || DEFAULT_SHEET_ID;
    const gid = $('#sheet-gid').value.trim();
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`;
    msg('#org-msg', '시트에서 불러오는 중...');
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (/<html/i.test(text.slice(0, 200))) throw new Error('CSV 대신 웹페이지가 반환되었습니다. 시트 공유 설정(링크가 있는 모든 사용자)을 확인하세요.');
      const list = rowsToOrgs(parseCSV(text));
      if (!list.length) throw new Error('기관명/사업자번호 열을 찾지 못했습니다. 시트의 열 제목을 확인하세요.');
      const when = new Date().toLocaleString('ko-KR', { hour12: false });
      chrome.storage.local.set({ orgsOverride: list, orgsUpdatedAt: when }, () => {
        chrome.storage.sync.set({ sheetId: id, sheetGid: gid });
        orgs = list; renderOrgInfo();
        msg('#org-msg', `${list.length}곳을 불러왔습니다.`, 'ok');
      });
    } catch (e) {
      msg('#org-msg', '불러오기 실패: ' + e.message, 'err');
    }
  });
  $('#org-reset').addEventListener('click', () => {
    chrome.storage.local.remove(['orgsOverride', 'orgsUpdatedAt'], () => { orgs = bundled; renderOrgInfo(); msg('#org-msg', '내장 데이터로 되돌렸습니다.', 'ok'); });
  });

  // ---------- 고급 ----------
  $('#adv-save').addEventListener('click', () => {
    chrome.storage.sync.set({
      bizSelector: $('#biz-sel').value.trim(),
      phoneSelector: $('#phone-sel').value.trim(),
      bizFormat: $('#biz-fmt').value,
      phoneFormat: $('#phone-fmt').value,
      showOnlyLogin: $('#only-login').value === '1',
    }, () => msg('#adv-msg', '저장했습니다.', 'ok'));
  });

  // ---------- 초기화 ----------
  async function init() {
    const j = await (await fetch(chrome.runtime.getURL('data/orgs.json'))).json();
    bundled = j.orgs || [];
    chrome.storage.sync.get({ users: [], sheetId: DEFAULT_SHEET_ID, sheetGid: '', bizSelector: '', phoneSelector: '', bizFormat: 'auto', phoneFormat: 'auto', showOnlyLogin: true }, (s) => {
      users = s.users; renderUsers();
      $('#sheet-id').value = s.sheetId; $('#sheet-gid').value = s.sheetGid;
      $('#biz-sel').value = s.bizSelector; $('#phone-sel').value = s.phoneSelector;
      $('#biz-fmt').value = s.bizFormat; $('#phone-fmt').value = s.phoneFormat;
      $('#only-login').value = s.showOnlyLogin ? '1' : '0';
    });
    chrome.storage.local.get({ orgsOverride: null }, ({ orgsOverride }) => {
      orgs = orgsOverride && orgsOverride.length ? orgsOverride : bundled;
      renderOrgInfo();
    });
    // 로그인 화면에서 "입력칸 지정"으로 저장된 값이 바뀌면 즉시 반영
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      if (ch.bizSelector) $('#biz-sel').value = ch.bizSelector.newValue || '';
      if (ch.phoneSelector) $('#phone-sel').value = ch.phoneSelector.newValue || '';
    });
  }
  init();
})();
