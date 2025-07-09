function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('AI 스쿼트 코치')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function logSquatData(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SquatData') || ss.insertSheet('SquatData');

  // 헤더가 없으면 추가
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Squat Count', 'Total Score', 'Depth Score', 'Posture Score']);
  }

  // 데이터 추가
  sheet.appendRow([
    new Date(),
    data.squatCount,
    data.totalScore,
    data.depthScore,
    data.backPosture
  ]);

  return 'Data logged successfully';
}
