/**
 * 신재생에너지센터 설치계획 크롤링 → 구글 시트 기록용 Apps Script
 *
 * 설치 방법 (확장 프로그램 설정 페이지 4번에도 같은 안내가 있습니다)
 *  1. 기록할 구글 시트를 연다 → 메뉴 [확장 프로그램] → [Apps Script]
 *  2. 편집기의 기존 내용을 모두 지우고 이 코드를 붙여넣고 저장
 *  3. [배포] → [새 배포] → 유형 선택(톱니바퀴) [웹 앱]
 *     - 다음 사용자 인증정보로 실행: 나
 *     - 액세스 권한이 있는 사용자: 모든 사용자
 *  4. [배포] → 권한 승인 → 나오는 "웹 앱 URL"을 복사해 확장 프로그램 설정에 붙여넣기
 *
 * TOKEN 은 확장 프로그램과 이 스크립트만 아는 비밀 값입니다. 바꾸면 양쪽을 같이 바꾸세요.
 */
const TOKEN = '__TOKEN__';
const DEFAULT_SHEET = '__SHEET__';

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return json_({ ok: true, title: ss.getName(), sheets: ss.getSheets().map(function (s) { return s.getName(); }) });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '잘못된 요청' }); }
  if (body.token !== TOKEN) return json_({ ok: false, error: '토큰이 맞지 않습니다' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(body.sheet || DEFAULT_SHEET);
  if (!sh) return json_({ ok: false, error: '시트 탭을 찾을 수 없습니다: ' + (body.sheet || DEFAULT_SHEET) });
  if (body.action === 'ping') return json_({ ok: true, sheet: sh.getName(), lastRow: lastDataRow_(sh) });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var last = lastDataRow_(sh);
    var seen = {};
    if (last >= 2) {
      sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) { seen[key_(r[0], r[1])] = true; });
    }
    var next = last + 1;
    var results = [];
    (body.rows || []).forEach(function (row) {
      var k = key_(row.A, row.B);
      if (seen[k]) { results.push({ key: row._key, status: 'exists' }); return; }
      Object.keys(row).forEach(function (col) {
        if (col.charAt(0) === '_' || !/^[A-Z]{1,2}$/.test(col)) return;
        sh.getRange(col + next).setValue(row[col]);
      });
      seen[k] = true;
      results.push({ key: row._key, status: 'written', row: next });
      next++;
    });
    return json_({ ok: true, results: results });
  } finally {
    lock.releaseLock();
  }
}

// A~B열(기관명·건물명) 기준으로 마지막으로 값이 있는 행
function lastDataRow_(sh) {
  var last = sh.getLastRow();
  if (last < 1) return 1;
  var v = sh.getRange(1, 1, last, 2).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0]).trim() || String(v[i][1]).trim()) return i + 1;
  }
  return 1;
}

function key_(a, b) { return String(a || '').replace(/\s/g, '') + '|' + String(b || '').replace(/\s/g, ''); }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
