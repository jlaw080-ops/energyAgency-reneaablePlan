// 백그라운드 서비스 워커
// 역할 1) 툴바 아이콘을 누르면 설정 페이지를 연다.
// 역할 2) 페이지 안의 패널(최상위 프레임)이 보낸 "채우기" 요청을
//        같은 탭의 모든 프레임(iframe 포함)에 전달한다.
//        각 프레임은 자기 안에서 입력칸을 찾아 채운 뒤 'fill-result'로 결과를 보고하고,
//        그 결과는 다시 최상위 프레임 패널로 전달된다.
// 역할 3) 크롤링: 다 읽은 팝업 창을 닫고, 구글 시트(Apps Script 웹 앱)에 행을 보낸다.

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function sheetRequest(payload) {
  const s = await chrome.storage.sync.get({ sheetUrl: '', sheetToken: '', sheetName: '설치계획' });
  if (!s.sheetUrl) return { ok: false, error: '시트 웹 앱 URL이 설정되지 않았습니다' };
  try {
    const res = await fetch(s.sheetUrl, {
      method: 'POST',
      // text/plain 으로 보내야 Apps Script 가 추가 확인(preflight) 없이 받는다
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: s.sheetToken, sheet: s.sheetName, ...payload }),
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) {
      return { ok: false, error: `시트 응답을 읽을 수 없습니다 (HTTP ${res.status}). 배포 시 액세스 권한을 "모든 사용자"로 했는지 확인하세요.` };
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // 탭이 없어도 되는 요청 (설정 페이지 등)
  if (msg.type === 'sheet-append') {
    sheetRequest({ action: 'append', rows: msg.rows }).then(sendResponse);
    return true;
  }
  if (msg.type === 'sheet-ping') {
    sheetRequest({ action: 'ping' }).then(sendResponse);
    return true;
  }
  if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (!sender.tab) return;
  const tabId = sender.tab.id;

  if (msg.type === 'main-click') {
    // 사이트의 링크가 javascript: 형식이면 확장 프로그램 쪽에서 직접 누를 수 없어서,
    // 페이지 자신의 실행 환경(MAIN world)에서 눌러 준다.
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [sender.frameId || 0] },
      world: 'MAIN',
      func: (tok) => {
        const el = document.querySelector(`[data-nrcrawl-click="${tok}"]`);
        if (!el) return false;
        el.removeAttribute('data-nrcrawl-click');
        el.click();
        return true;
      },
      args: [msg.token],
    }).then((r) => sendResponse({ ok: !!(r && r[0] && r[0].result) }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }

  if (msg.type === 'close-me') {
    chrome.tabs.remove(tabId, () => { void chrome.runtime.lastError; });
  } else if (msg.type === 'relay-fill') {
    // frameId를 지정하지 않으면 탭의 모든 프레임에 전달된다.
    chrome.tabs.sendMessage(tabId, { type: 'do-fill', payload: msg.payload }, () => {
      void chrome.runtime.lastError;
    });
  } else if (msg.type === 'relay-pick') {
    chrome.tabs.sendMessage(tabId, { type: 'start-pick', kind: msg.kind }, () => {
      void chrome.runtime.lastError;
    });
  } else if (msg.type === 'fill-result') {
    // 최상위 프레임(frameId 0)에만 결과 전달
    chrome.tabs.sendMessage(tabId, { type: 'fill-result', result: msg.result }, { frameId: 0 }, () => {
      void chrome.runtime.lastError;
    });
  }
});
