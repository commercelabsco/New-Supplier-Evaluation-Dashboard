/**
 * Bridge that lets the Supplier Onboarding dashboard (a static HTML page
 * with no backend) read and write its data in this spreadsheet, shared
 * by every user regardless of device or location.
 *
 * Setup:
 *   1. Open the target Google Sheet.
 *   2. Extensions -> Apps Script.
 *   3. Replace the default Code.gs contents with this file, save.
 *   4. Deploy -> New deployment -> type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone   <-- IMPORTANT, see note below
 *   5. Copy the deployment URL and paste it into SHEET_WEBAPP_URL near
 *      the top of the dashboard's <script> block (in index.html).
 *
 * IMPORTANT — "Who has access" must be "Anyone", not "Anyone within
 * [your Google Workspace domain]". If your Google account belongs to a
 * Workspace org (e.g. a company Google account), the deploy dialog can
 * default to the domain-restricted option. A domain-restricted
 * deployment's URL looks like:
 *     https://script.google.com/a/macros/yourcompany.com/s/XXXX/exec
 * and only works for people currently signed into a yourcompany.com
 * Google account in that browser — everyone else silently gets an
 * HTML sign-in page back instead of JSON, which is why it can look like
 * it "works for me but not for my coworker". The correct public URL
 * (works for anyone, signed in or not) looks like:
 *     https://script.google.com/macros/s/XXXX/exec
 * If you already have a domain-restricted deployment, open
 * Deploy -> Manage deployments -> edit (pencil) -> change "Who has
 * access" to "Anyone" -> Deploy again, and use the URL it gives you.
 *
 * Data model: every question has its own column, titled exactly like the
 * question on the form (e.g. "Product Cost (Turnkey)"), so the Sheet
 * reads like a normal spreadsheet. The last column, "Full Record (JSON —
 * do not edit)", holds the complete JSON record so the dashboard
 * round-trips every field without loss even if a new question is added
 * on the app side before this script is updated to match — don't rename,
 * move, or hand-edit that column. If you change EVAL_HEADERS, delete the
 * existing "data" tab (or clear its header row) so it gets recreated
 * with the new columns — this script only writes headers the first time
 * a tab is created.
 */

var EVAL_SHEET_NAME = "data";
// These titles are typed by hand to match index.html's own field labels
// word-for-word (Supplier Details / Section A / Section B / QC_FIELDS
// around index.html:166-179, 564-593) — Apps Script can't import from
// index.html, so there's no single source of truth; if a question's
// wording changes in the form, update the matching entry here too, or
// the Sheet header will silently drift out of sync with what evaluators
// actually saw on screen. The last column always holds the full JSON
// record, whatever it's titled — doGet()/doPost() address it by
// position (headers.length - 1), never by matching this title text.
var EVAL_HEADERS = [
  "ID", "Ref #", "Supplier / Company Name", "Product / Spec Being Quoted", "Status", "Total Score", "Rating", "Last Updated",
  "Product Cost (Turnkey)", "Payment Terms — Net Terms", "Payment Terms — Deposit Required", "Payment Terms — Credit Limit",
  "Minimum Order Quantity (MOQ)", "Lead Time (PO issuance to ship-ready)",
  "Testing Capacity", "GMP Certification & Regulatory Compliance",
  "Responsiveness & Issue Resolution (queries, document requests — e.g. GMP cert, SDS — and non-quality issues)",
  "Product Quality History (12 mo)", "COA Turnaround", "Label Reviewer / Regulatory Label Review",
  "Notes", "Full Record (JSON — do not edit)",
];
var COMPARISON_HEADERS = ["ID", "Product", "Saved At", "Best Supplier", "Best Score", "Full Record (JSON — do not edit)"];

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    return sh;
  }
  // Self-heal an existing tab whose header row is missing, blank, or left
  // over from an older version of EVAL_HEADERS/COMPARISON_HEADERS, instead
  // of requiring the tab to be deleted by hand every time headers change.
  // Only touches row 1 (labels) — never the data rows below it.
  var firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var matches = headers.every(function (h, i) { return firstRow[i] === h; });
  if (!matches) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
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
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var type = (e.parameter && e.parameter.type) || "evaluations";
    var sh, headers;
    if (type === "comparisons") {
      sh = getSheet_("Comparisons", COMPARISON_HEADERS);
      headers = COMPARISON_HEADERS;
    } else {
      sh = getSheet_(EVAL_SHEET_NAME, EVAL_HEADERS);
      headers = EVAL_HEADERS;
    }
    var values = sh.getDataRange().getValues();
    values.shift(); // header row
    var dataIdx = headers.length - 1; // the full-JSON column is always last
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
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST body (JSON):
 *   {action:"save", type:"evaluation"|"comparison", record:{...}}
 *   {action:"delete", type:"evaluation"|"comparison", id:"..."}
 *   {action:"nextRef"} -> {next: N}, an auto-incrementing eval ref counter
 *
 * Wrapped in a script lock so two users saving at the same moment from
 * different locations can't race each other into a corrupted/duplicate
 * row or a skipped ref-number increment.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
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
      sh = getSheet_(EVAL_SHEET_NAME, EVAL_HEADERS);
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
      var a = record.answers || {};
      row = [
        record.id,
        record.refNumber || "",
        record.supplier || "",
        record.product || "",
        record.status || "",
        record.computed && record.computed.totalScore != null ? record.computed.totalScore : "",
        record.computed ? record.computed.rating || "" : "",
        record.updatedAt || "",
        a.productCost || "",
        a.netTerms || "",
        a.deposit || "",
        a.credit || "",
        a.moq || "",
        a.leadTime || "",
        a.testingCapacity || "",
        a.gmpMatch || "",
        a.responsivenessResolution || "",
        a.productQuality || "",
        a.coaTurnaround || "",
        a.labelReviewer || "",
        record.notes || "",
        JSON.stringify(record),
      ];
    }

    upsertRow_(sh, record.id, row);
    return jsonOut_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
