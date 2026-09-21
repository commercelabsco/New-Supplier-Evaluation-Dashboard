/**
 * Bridge that lets the Supplier Onboarding dashboard (a static HTML page
 * with no backend) read and write its data in this spreadsheet.
 *
 * Setup:
 *   1. Open the target Google Sheet.
 *   2. Extensions -> Apps Script.
 *   3. Replace the default Code.gs contents with this file, save.
 *   4. Deploy -> New deployment -> type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the deployment URL and paste it into SHEET_WEBAPP_URL near
 *      the top of the dashboard's <script> block (in index.html).
 *
 * Data model: each row's "data" column holds the full JSON record, so
 * the dashboard round-trips every field (including nested QC/procurement
 * answers) without loss. The other columns are just for readability when
 * looking at the Sheet directly.
 */

var EVAL_HEADERS = ["id", "refNumber", "supplier", "product", "status", "totalScore", "rating", "updatedAt", "data"];
var COMPARISON_HEADERS = ["id", "product", "savedAt", "bestSupplier", "bestScore", "data"];

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function findRowById_(sh, id) {
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function upsertRow_(sh, id, row) {
  var rowIdx = findRowById_(sh, id);
  if (rowIdx > 0) {
    sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}

function deleteRow_(sh, id) {
  var rowIdx = findRowById_(sh, id);
  if (rowIdx > 0) sh.deleteRow(rowIdx);
}

/** GET ?type=evaluations | comparisons -> full JSON array of records. */
function doGet(e) {
  var type = (e.parameter && e.parameter.type) || "evaluations";
  var sh, headers;
  if (type === "comparisons") {
    sh = getSheet_("Comparisons", COMPARISON_HEADERS);
    headers = COMPARISON_HEADERS;
  } else {
    sh = getSheet_("Evaluations", EVAL_HEADERS);
    headers = EVAL_HEADERS;
  }
  var values = sh.getDataRange().getValues();
  values.shift(); // header row
  var dataIdx = headers.indexOf("data");
  var out = [];
  values.forEach(function (r) {
    if (!r[0]) return;
    try {
      out.push(JSON.parse(r[dataIdx]));
    } catch (err) {
      // skip a row whose data column isn't valid JSON
    }
  });
  return jsonOut_(out);
}

/**
 * POST body (JSON):
 *   {action:"save", type:"evaluation"|"comparison", record:{...}}
 *   {action:"delete", type:"evaluation"|"comparison", id:"..."}
 *   {action:"nextRef"} -> {next: N}, an auto-incrementing eval ref counter
 */
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var action = body.action;

  if (action === "nextRef") {
    var props = PropertiesService.getScriptProperties();
    var current = parseInt(props.getProperty("evalCounter") || "0", 10);
    var next = current + 1;
    props.setProperty("evalCounter", String(next));
    return jsonOut_({ next: next });
  }

  var type = body.type || "evaluation";
  var sh, headers;
  if (type === "comparison") {
    sh = getSheet_("Comparisons", COMPARISON_HEADERS);
    headers = COMPARISON_HEADERS;
  } else {
    sh = getSheet_("Evaluations", EVAL_HEADERS);
    headers = EVAL_HEADERS;
  }

  if (action === "delete") {
    deleteRow_(sh, body.id);
    return jsonOut_({ ok: true });
  }

  var record = body.record;
  var row;
  if (type === "comparison") {
    row = [
      record.id,
      record.product || "",
      record.savedAt || "",
      record.bestSupplier || "",
      record.bestScore == null ? "" : record.bestScore,
      JSON.stringify(record),
    ];
  } else {
    row = [
      record.id,
      record.refNumber || "",
      record.supplier || "",
      record.product || "",
      record.status || "",
      record.computed && record.computed.totalScore != null ? record.computed.totalScore : "",
      record.computed ? record.computed.rating || "" : "",
      record.updatedAt || "",
      JSON.stringify(record),
    ];
  }

  upsertRow_(sh, record.id, row);
  return jsonOut_({ ok: true });
}
