// 백그라운드 서비스 워커
// 역할 1) 툴바 아이콘을 누르면 설정 페이지를 연다.
// 역할 2) 페이지 안의 패널(최상위 프레임)이 보낸 "채우기" 요청을
//        같은 탭의 모든 프레임(iframe 포함)에 전달한다.
//        각 프레임은 자기 안에서 입력칸을 찾아 채운 뒤 'fill-result'로 결과를 보고하고,
//        그 결과는 다시 최상위 프레임 패널로 전달된다.

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !sender.tab) return;
  const tabId = sender.tab.id;

  if (msg.type === 'relay-fill') {
    // frameId를 지정하지 않으면 탭의 모든 프레임에 전달된다.
    chrome.tabs.sendMessage(tabId, { type: 'do-fill', payload: msg.payload }, () => {
      void chrome.runtime.lastError;
    });
  } else if (msg.type === 'relay-pick') {
    chrome.tabs.sendMessage(tabId, { type: 'start-pick', kind: msg.kind }, () => {
      void chrome.runtime.lastError;
    });
  } else if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
  } else if (msg.type === 'fill-result') {
    // 최상위 프레임(frameId 0)에만 결과 전달
    chrome.tabs.sendMessage(tabId, { type: 'fill-result', result: msg.result }, { frameId: 0 }, () => {
      void chrome.runtime.lastError;
    });
  }
});
