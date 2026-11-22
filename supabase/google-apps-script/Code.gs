function onMembershipFormSubmit(event) {
  if (!event || !event.range || !event.source) {
    throw new Error('This function must be run by the spreadsheet form-submit trigger.');
  }
  syncMembershipResponse_(event.source, event.range.getSheet(), event.range.getRow());
}

function syncExistingMembershipResponses() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  for (let row = 2; row <= lastRow; row += 1) {
    syncMembershipResponse_(spreadsheet, sheet, row);
  }
}

function syncMembershipResponse_(spreadsheet, sheet, rowNumber) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
  const answers = {};

  headers.forEach((header, index) => {
    const key = String(header).trim();
    const value = values[index];
    if (!key || value === '' || value === null) return;
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (/(password|passcode|(^| )pin($| )|cvv|cvc|security code|card number|credit card|debit card|bank login|bank account|account number|routing number)/.test(normalizedKey)) return;
    answers[key] = value instanceof Date ? value.toISOString() : String(value).trim();
  });
  if (Object.keys(answers).length === 0) return;

  const properties = PropertiesService.getScriptProperties();
  const endpoint = properties.getProperty('UPSA_SYNC_URL');
  const secret = properties.getProperty('UPSA_WEBHOOK_SECRET');
  const sourceFormKey = properties.getProperty('UPSA_FORM_KEY');
  if (!endpoint || !secret || !sourceFormKey) {
    throw new Error('Set UPSA_SYNC_URL, UPSA_WEBHOOK_SECRET, and UPSA_FORM_KEY in Script Properties.');
  }

  const timestampIndex = headers.findIndex(header =>
    /timestamp|submitted at|submission date/i.test(String(header))
  );
  const timestampValue = timestampIndex >= 0 ? values[timestampIndex] : null;
  const submittedAt = timestampValue instanceof Date
    ? timestampValue.toISOString()
    : timestampValue && Number.isFinite(Date.parse(String(timestampValue)))
      ? new Date(String(timestampValue)).toISOString()
      : new Date().toISOString();

  const payload = {
    external_submission_id: `${spreadsheet.getId()}:${sheet.getSheetId()}:${rowNumber}`,
    source_form_key: sourceFormKey,
    submitted_at: submittedAt,
    answers
  };
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-upsa-webhook-secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`Membership sync failed with HTTP ${response.getResponseCode()}.`);
  }
}
