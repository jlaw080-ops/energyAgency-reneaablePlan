// 입력 필드를 찾아서 값을 넣는 공통 모듈 (모든 프레임에서 실행됨)
// content.js 보다 먼저 로드되어 window.NRFill 로 노출된다.

(function () {
  'use strict';

  const BIZ_KEYWORDS = ['사업자', '사업자등록', '사업자번호', 'bizno', 'biz_no', 'bizrno', 'brno', 'bsno', 'bsnno', 'bsnm', 'busino', 'busi_no', 'bizregno', 'saup', 'saeop', 'comp_no', 'compno', 'entrno', 'entr_no', 'ent_no', 'corp_no', 'corpno', 'regno', 'reg_no', 'bizr'];
  const PHONE_KEYWORDS = ['휴대폰', '휴대전화', '핸드폰', '전화번호', '연락처', 'hp', 'hpno', 'hp_no', 'mobile', 'mobno', 'mob_no', 'cell', 'phone', 'tel', 'telno', 'tel_no', 'mphone', 'mbtl', 'moblphon', 'moblphonno'];
  const PHONE_EXCLUDE = ['fax', '팩스', 'email', '이메일'];

  const digits = (s) => String(s || '').replace(/\D/g, '');

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // 입력 필드와 관련된 모든 텍스트(아이디, 이름, placeholder, 라벨, 앞쪽 셀 제목 등)를 모아 소문자로 반환
  function describe(el) {
    const parts = [el.id, el.name, el.placeholder, el.title, el.getAttribute('aria-label'), el.className];
    if (el.labels) for (const l of el.labels) parts.push(l.textContent);
    if (el.id) {
      const lab = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) parts.push(lab.textContent);
    }
    // 표 형태(th → td)나 dl 형태(dt → dd)에서 제목 셀의 글자도 포함
    const cell = el.closest('td, dd, div, li');
    if (cell) {
      const prev = cell.previousElementSibling;
      if (prev && prev.textContent.length < 40) parts.push(prev.textContent);
      const tr = el.closest('tr');
      if (tr) {
        const th = tr.querySelector('th');
        if (th) parts.push(th.textContent);
      }
    }
    // 바로 앞에 있는 짧은 텍스트 노드
    let p = el.previousSibling, hops = 0;
    while (p && hops < 4) {
      if (p.nodeType === 3 && p.textContent.trim()) { parts.push(p.textContent); break; }
      if (p.nodeType === 1 && p.textContent.trim() && p.textContent.length < 40) { parts.push(p.textContent); break; }
      p = p.previousSibling; hops++;
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function candidates(doc) {
    return [...doc.querySelectorAll('input')].filter((i) => {
      const t = (i.type || 'text').toLowerCase();
      if (i.closest('#nrfill-panel')) return false; // 확장 프로그램 자체 패널은 제외
      return ['text', 'tel', 'number', 'search', ''].includes(t) && !i.disabled && !i.readOnly && isVisible(i);
    });
  }

  function matchByKeyword(doc, keywords, exclude = []) {
    const out = [];
    for (const el of candidates(doc)) {
      const d = describe(el);
      if (exclude.some((k) => d.includes(k))) continue;
      if (keywords.some((k) => d.includes(k))) out.push(el);
    }
    return out;
  }

  // 사용자가 설정에서 직접 지정한 셀렉터(쉼표로 여러 개 가능) 우선 사용
  function bySelectors(doc, selectorText) {
    if (!selectorText) return [];
    const out = [];
    for (const sel of selectorText.split(',').map((s) => s.trim()).filter(Boolean)) {
      try { for (const el of doc.querySelectorAll(sel)) if (el.tagName === 'INPUT') out.push(el); } catch (e) { /* 잘못된 셀렉터는 무시 */ }
    }
    return out;
  }

  // 프레임워크(React/Vue/jQuery 등)가 변경을 인식하도록 네이티브 setter + 이벤트 발생
  function setValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.classList.add('nrfill-flash');
    setTimeout(() => el.classList.remove('nrfill-flash'), 1500);
  }

  // 값을 한 칸 또는 여러 칸(예: 000-00-00000 → 3칸)에 나누어 넣는다.
  // parts: 분할 자릿수 배열. formatMode: 'auto' | 'hyphen' | 'digits'
  function fillInto(els, value, parts, formatMode) {
    const d = digits(value);
    if (!els.length) return 0;

    // 분할 입력칸 (칸 수가 parts 길이와 같으면 순서대로 채움)
    if (els.length >= parts.length && parts.length > 1) {
      // 같은 부모/같은 줄에 있는 연속된 칸을 골라냄
      const group = pickGroup(els, parts.length);
      if (group) {
        let pos = 0;
        group.forEach((el, i) => { setValue(el, d.substr(pos, parts[i])); pos += parts[i]; });
        return group.length;
      }
    }

    // 단일 입력칸
    const el = els[0];
    const max = parseInt(el.maxLength, 10);
    let v;
    if (formatMode === 'digits') v = d;
    else if (formatMode === 'hyphen') v = hyphenate(d, parts);
    else v = (max > 0 && max < hyphenate(d, parts).length) ? d : hyphenate(d, parts); // auto: maxlength로 판단
    setValue(el, v);
    return 1;
  }

  function hyphenate(d, parts) {
    const out = []; let pos = 0;
    for (const n of parts) { out.push(d.substr(pos, n)); pos += n; }
    return out.filter(Boolean).join('-');
  }

  function pickGroup(els, n) {
    // maxlength가 정확히 맞는 순서쌍이 있으면 우선
    for (let i = 0; i + n <= els.length; i++) {
      const slice = els.slice(i, i + n);
      const sameParent = slice.every((e) => e.closest('tr, dd, div, p, li') === slice[0].closest('tr, dd, div, p, li'));
      if (sameParent) return slice;
    }
    return els.length === n ? els : null;
  }

  function findBizFields(doc, overrideSelector) {
    const manual = bySelectors(doc, overrideSelector);
    return manual.length ? manual : matchByKeyword(doc, BIZ_KEYWORDS);
  }
  function findPhoneFields(doc, overrideSelector) {
    const manual = bySelectors(doc, overrideSelector);
    return manual.length ? manual : matchByKeyword(doc, PHONE_KEYWORDS, PHONE_EXCLUDE);
  }

  // 요소를 다시 찾을 수 있는 CSS 셀렉터 만들기 (필드 직접 지정 기능용)
  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) {
      const same = el.ownerDocument.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`);
      if (same.length === 1) return `input[name="${el.name}"]`;
      return `input[name="${el.name}"]:nth-of-type(${[...same].indexOf(el) + 1})`;
    }
    const path = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== el.ownerDocument.body) {
      let seg = cur.tagName.toLowerCase();
      if (cur.parentElement) {
        const sibs = [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      path.unshift(seg);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  window.NRFill = {
    digits, hyphenate, setValue, fillInto, findBizFields, findPhoneFields, selectorFor, isVisible,
    BIZ_PARTS: [3, 2, 5],
    PHONE_PARTS: [3, 4, 4],
    fillBiz(doc, bno, opts) {
      return fillInto(findBizFields(doc, opts.bizSelector), bno, [3, 2, 5], opts.bizFormat || 'auto');
    },
    fillPhone(doc, phone, opts) {
      return fillInto(findPhoneFields(doc, opts.phoneSelector), phone, [3, 4, 4], opts.phoneFormat || 'auto');
    },
  };
})();
