function doGet(e) {
  // index.html 파일을 템플릿으로 불러와 처리합니다.
  let template = HtmlService.createTemplateFromFile('index.html');
  let htmlOutput = template.evaluate();
 
  // 외부 라이브러리 호환성을 위해 샌드박스 모드를 설정합니다.
  htmlOutput.setSandboxMode(HtmlService.SandboxMode.IFRAME);
  htmlOutput.setTitle("AI 스쿼트 코치 v1.0");
  return htmlOutput;
}

// 다른 HTML 파일(CSS, JS)을 불러오기 위한 도우미 함수입니다.
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// 구글 시트에 데이터를 기록하는 함수입니다.
function logSquatData(data) {
  try {
    // const 대신 let으로 변경하여 시트가 없을 경우 재할당 가능하도록 함
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("운동기록");
    if (!sheet) {
      // 시트가 없으면 새로 만듭니다.
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("운동기록");
      sheet.appendRow(["타임스탬프", "스쿼트 횟수", "최종 점수", "깊이 점수", "허리 자세 점수"]);
    }
    sheet.appendRow([
      new Date(),
      data.squatCount,
      data.totalScore,
      data.depthScore,
      data.backPosture
    ]);
    return "데이터 기록 성공";
  } catch (e) {
    console.error("logSquatData Error: " + e.toString());
    // 사용자에게 더 친숙한 오류 메시지를 반환
    throw new Error("시트에 데이터를 기록하는 데 실패했습니다. '운동기록' 시트의 접근 권한 또는 이름/존재 여부를 확인해주세요.");
  }
}
