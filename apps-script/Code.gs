const RESPONSE_SHEET_NAME = '대플폼 응답';
const CONNECTION_COLLECTION = 'sheetConnections';

function doGet() {
  return jsonResponse_({ ok: true, service: 'daepulform-sheets-sync' });
}

function doPost(event) {
  try {
    const request = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    const action = String(request.action || '');
    const formId = validateFormId_(request.formId);
    const user = verifyFirebaseUser_(request.idToken);
    assertCanEditForm_(formId, user.localId);

    if (action === 'status') {
      return jsonResponse_({ ok: true, data: connectionStatus_(formId) });
    }
    if (action === 'connect') {
      return jsonResponse_({ ok: true, data: connectSpreadsheet_(formId, user) });
    }
    if (action === 'disconnect') {
      deleteFirestoreDocument_(`${CONNECTION_COLLECTION}/${formId}`);
      return jsonResponse_({ ok: true, data: { status: 'disconnected' } });
    }
    throw appError_('invalid-argument', '지원하지 않는 요청입니다.');
  } catch (error) {
    console.error(error);
    const quota = /quota|too many times|service invoked too many/i.test(String(error && error.message));
    return jsonResponse_({
      ok: false,
      code: quota ? 'apps-script/quota' : (error && error.code) || 'apps-script/failed',
      error: quota ? 'Google 자동 저장 사용량을 초과했습니다.' : String((error && error.message) || error),
    });
  }
}

/**
 * Run once from the Apps Script editor after setting these script properties:
 * FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY.
 */
function installDaepulFormSync() {
  requiredProperty_('FIREBASE_PROJECT_ID');
  requiredProperty_('FIREBASE_WEB_API_KEY');
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'syncDaepulFormResponses')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncDaepulFormResponses').timeBased().everyMinutes(1).create();
  syncDaepulFormResponses();
}

function syncDaepulFormResponses() {
  listFirestoreDocuments_(CONNECTION_COLLECTION).forEach((connection) => {
    if (connection.status !== 'connected' || !connection.formId || !connection.spreadsheetId) return;
    try {
      syncConnection_(connection);
      patchFirestoreDocument_(`${CONNECTION_COLLECTION}/${connection.formId}`, {
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: '',
      });
    } catch (error) {
      console.error(`Sync failed for ${connection.formId}`, error);
      patchFirestoreDocument_(`${CONNECTION_COLLECTION}/${connection.formId}`, {
        lastSyncError: String((error && error.message) || error).slice(0, 500),
      });
    }
  });
}

function connectSpreadsheet_(formId, user) {
  const existing = getFirestoreDocument_(`${CONNECTION_COLLECTION}/${formId}`, true);
  if (existing && existing.status === 'connected' && existing.spreadsheetId) {
    return connectionStatus_(formId);
  }

  const form = getFirestoreDocument_(`forms/${formId}`);
  const title = `${String((form.program && form.program.programName) || '대플폼')} 응답`;
  const spreadsheet = SpreadsheetApp.create(title);
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName(RESPONSE_SHEET_NAME);
  prepareSheet_(sheet, form.questions || []);

  if (user.email) spreadsheet.addEditor(user.email);
  const connection = {
    formId,
    ownerUid: user.localId,
    ownerEmail: user.email || '',
    status: 'connected',
    spreadsheetId: spreadsheet.getId(),
    spreadsheetTitle: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    createdAt: new Date().toISOString(),
    lastSyncedAt: '',
    lastSyncError: '',
  };
  patchFirestoreDocument_(`${CONNECTION_COLLECTION}/${formId}`, connection);
  syncConnection_(connection);
  return publicConnection_(connection);
}

function connectionStatus_(formId) {
  const connection = getFirestoreDocument_(`${CONNECTION_COLLECTION}/${formId}`, true);
  return connection && connection.status === 'connected'
    ? publicConnection_(connection)
    : { status: 'disconnected' };
}

function publicConnection_(connection) {
  return {
    status: 'connected',
    spreadsheetId: connection.spreadsheetId,
    spreadsheetTitle: connection.spreadsheetTitle,
    spreadsheetUrl: connection.spreadsheetUrl,
  };
}

function syncConnection_(connection) {
  const form = getFirestoreDocument_(`forms/${connection.formId}`);
  const questions = Array.isArray(form.questions) ? form.questions : [];
  const responses = listFirestoreDocuments_(`forms/${connection.formId}/responses`);
  const spreadsheet = SpreadsheetApp.openById(connection.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(RESPONSE_SHEET_NAME) || spreadsheet.insertSheet(RESPONSE_SHEET_NAME);
  prepareSheet_(sheet, questions);

  const lastRow = sheet.getLastRow();
  const syncedIds = new Set(
    lastRow < 2
      ? []
      : sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat().filter(Boolean),
  );
  const rows = responses
    .filter((response) => response.responseId && !syncedIds.has(String(response.responseId)))
    .sort((left, right) => String(left.submittedAt || '').localeCompare(String(right.submittedAt || '')))
    .map((response) => responseRow_(response, questions));

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function prepareSheet_(sheet, questions) {
  const headers = [
    '응답 ID',
    '제출 시각',
    '이메일',
    '이름',
    '학번',
    ...questions.map((question, index) => String(question.label || `${index + 1}번 질문`)),
  ];
  const currentColumns = sheet.getMaxColumns();
  if (currentColumns < headers.length) sheet.insertColumnsAfter(currentColumns, headers.length - currentColumns);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#0B6B55')
    .setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  if (!sheet.isColumnHiddenByUser(1)) sheet.hideColumns(1);
}

function responseRow_(response, questions) {
  const answers = response.answers && typeof response.answers === 'object' ? response.answers : {};
  return [
    String(response.responseId || response.__documentId || ''),
    response.submittedAt ? new Date(response.submittedAt) : '',
    String(response.respondentEmail || ''),
    String(response.respondentName || ''),
    String(response.studentId || ''),
    ...questions.map((question) => cellValue_(answers[String(question.id)])),
  ];
}

function cellValue_(value) {
  if (Array.isArray(value)) return value.map(cellValue_).join(', ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function verifyFirebaseUser_(idToken) {
  if (!idToken) throw appError_('unauthenticated', '제작자 로그인이 필요합니다.');
  const apiKey = requiredProperty_('FIREBASE_WEB_API_KEY');
  const response = UrlFetchApp.fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: String(idToken) }),
      muteHttpExceptions: true,
    },
  );
  if (response.getResponseCode() !== 200) {
    throw appError_('unauthenticated', '로그인 정보를 확인하지 못했습니다.');
  }
  const users = JSON.parse(response.getContentText()).users || [];
  if (!users[0] || !users[0].localId) throw appError_('unauthenticated', '제작자 로그인이 필요합니다.');
  return users[0];
}

function assertCanEditForm_(formId, uid) {
  const form = getFirestoreDocument_(`forms/${formId}`);
  const collaborators = form.collaborators || {};
  if (form.ownerUid !== uid && collaborators[uid] !== 'editor') {
    throw appError_('permission-denied', '이 폼을 수정할 권한이 없습니다.');
  }
}

function validateFormId_(value) {
  const formId = String(value || '');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(formId)) {
    throw appError_('invalid-argument', '폼 주소가 올바르지 않습니다.');
  }
  return formId;
}

function firestoreBaseUrl_() {
  const projectId = requiredProperty_('FIREBASE_PROJECT_ID');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function firestoreFetch_(path, options) {
  const response = UrlFetchApp.fetch(`${firestoreBaseUrl_()}/${path}`, {
    muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    ...options,
  });
  return response;
}

function getFirestoreDocument_(path, optional) {
  const response = firestoreFetch_(path, { method: 'get' });
  if (optional && response.getResponseCode() === 404) return null;
  assertFirestoreResponse_(response);
  const document = JSON.parse(response.getContentText());
  return firestoreDocumentToObject_(document);
}

function listFirestoreDocuments_(collectionPath) {
  const documents = [];
  let pageToken = '';
  do {
    const query = `?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const response = firestoreFetch_(`${collectionPath}${query}`, { method: 'get' });
    if (response.getResponseCode() === 404) return documents;
    assertFirestoreResponse_(response);
    const body = JSON.parse(response.getContentText());
    (body.documents || []).forEach((document) => documents.push(firestoreDocumentToObject_(document)));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return documents;
}

function patchFirestoreDocument_(path, value) {
  const response = firestoreFetch_(path, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ fields: objectToFirestoreFields_(value) }),
  });
  assertFirestoreResponse_(response);
}

function deleteFirestoreDocument_(path) {
  const response = firestoreFetch_(path, { method: 'delete' });
  if (response.getResponseCode() !== 404) assertFirestoreResponse_(response);
}

function assertFirestoreResponse_(response) {
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw appError_('firestore-error', `Firestore 요청 실패 (${code}): ${response.getContentText().slice(0, 300)}`);
  }
}

function firestoreDocumentToObject_(document) {
  const value = firestoreFieldsToObject_(document.fields || {});
  value.__documentId = String(document.name || '').split('/').pop();
  return value;
}

function firestoreFieldsToObject_(fields) {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, firestoreValueToJs_(fields[key])]));
}

function firestoreValueToJs_(value) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreValueToJs_);
  if ('mapValue' in value) return firestoreFieldsToObject_(value.mapValue.fields || {});
  return '';
}

function objectToFirestoreFields_(value) {
  return Object.fromEntries(Object.keys(value).map((key) => [key, jsToFirestoreValue_(value[key])]));
}

function jsToFirestoreValue_(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(jsToFirestoreValue_) } };
  if (typeof value === 'object') return { mapValue: { fields: objectToFirestoreFields_(value) } };
  return { stringValue: String(value) };
}

function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw appError_('apps-script/not-configured', `${name} 설정이 필요합니다.`);
  return value;
}

function appError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
