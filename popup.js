"use strict";

var browser = globalThis.browser || globalThis.chrome;

// Popup script for GST helper: wires UI to content script, fetches GSTN data, and downloads generated returns.

var port;
var currentUrl;
var targetTabId = null;
var urlCategory = null;
var urlReturnType = null;
var responseHandlers = {};
var msgId = 1;
var genProgress = {
  timer: null,
  startedAt: null,
  retryAfterSec: null,
};

var converterState = {
  files: [],
  open: false,
  returnType: "AUTO",
};

var schemaState = {
  open: false,
  returnType: "GSTR1",
  remoteLoaded: false,
  remoteLoading: false,
  remoteSaveTimer: null,
  remoteMeta: null,
};

var toolMode = "";

window.addEventListener("error", (event) => {
  const message = String((event && event.message) || "");
  const source = String((event && event.filename) || "");
  if (source.includes("bootstrap.bundle.min.js") && message.includes("can't access property \"fn\"")) {
    event.preventDefault();
  }
});

var session = {
  gstRegType: "?",
  businessName: "",
  gstin: "",
  portalGstin: "",
  selectedClientGstin: "",
  selectedClientName: "",
  portalOnline: false,
  registrationDate: "",
  dropdown: null,
  is2bHost: false,
  category: "returns",
  periods: [],
  return: null,
  finYear: "2017-18",
  useCustomPeriods: false,
  periodFrom: "",
  periodTo: "",
  ledgerFrom: "",
  ledgerTo: "",
  typeListLocked: false,
  portalFallbackMode: false,
};

function executeScriptCompat(tabId, file) {
  if (browser.scripting && browser.scripting.executeScript) {
    return browser.scripting.executeScript({
      target: { tabId: tabId },
      files: [file],
    });
  }
  return browser.tabs.executeScript(tabId, { file: file });
}

function isEmbeddedWorkspace() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

// Slim return config table; shared defaults merged in for brevity.
const returnConfig = [
  {
    key: "G3B",
    display: "GSTR-3B",
    apiCode: "GSTR3B",
    fileNameCode: "R3B",
    expFilingStatus: "FIL",
    needsFileGeneration: false,
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G1",
    display: "GSTR-1",
    apiCode: "GSTR1",
    fileNameCode: "R1",
    expFilingStatus: "FIL",
    needsFileGeneration: true,
    useEinvoice: true,
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G2A",
    display: "GSTR-2A",
    apiCode: "GSTR2A",
    fileNameCode: "R2A",
    expFilingStatus: "NF",
    needsFileGeneration: true,
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G2AEXL",
    display: "GSTR-2A",
    apiCode: "GSTR2A",
    fileNameCode: "R2A",
    fileType: "EX",
    fileTypeCode: "EXL",
    expFilingStatus: "NF",
    needsFileGeneration: true,
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G2B",
    display: "GSTR-2B",
    apiCode: "GSTR2B",
    fileNameCode: "R2B",
    expFilingStatus: "NF",
    needsFileGeneration: false,
    domain: "https://gstr2b.gst.gov.in/gstr2b/returns",
    generateBase: "https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson",
    downloadBase: "https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/url",
  },
  {
    key: "G2BEXL",
    display: "GSTR-2B",
    apiCode: "GSTR2B",
    fileNameCode: "R2B",
    fileType: "EX",
    fileTypeCode: "EXL",
    expFilingStatus: "NF",
    needsFileGeneration: false,
    domain: "https://gstr2b.gst.gov.in/gstr2b",
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G4",
    display: "GSTR-4",
    apiCode: "GSTR4",
    fileNameCode: "R4",
    expFilingStatus: "FIL",
    isQuarterly: true,
    needsFileGeneration: true,
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G4A",
    display: "GSTR-4A",
    apiCode: "GSTR4A",
    fileNameCode: "R4A",
    expFilingStatus: "NF",
    isQuarterly: true,
    needsFileGeneration: true,
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G9",
    display: "GSTR-9",
    apiCode: "GSTR9",
    fileNameCode: "R9",
    expFilingStatus: "FIL",
    isAnnual: true,
    needsFileGeneration: false,
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  },
  {
    key: "G9C",
    display: "GSTR-9C",
    apiCode: "GSTR9C",
    fileNameCode: "R9C",
    expFilingStatus: "FIL",
    isAnnual: true,
    needsFileGeneration: true,
    flag: "0",
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  }, // HAR: flag=0
  {
    key: "G9CEX",
    display: "GSTR-9C",
    apiCode: "GSTR9C",
    fileNameCode: "R9C",
    fileType: "EX",
    fileTypeCode: "EXL",
    expFilingStatus: "FIL",
    isAnnual: true,
    needsFileGeneration: true,
    flag: "1",
    generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
  }, // HAR: flag=1 with file_type=EX
].map((cfg) =>
  Object.assign(
    {
      fileType: "",
      fileTypeCode: "",
      isQuarterly: false,
      isAnnual: false,
    },
    cfg,
  ),
).reduce((acc, cfg) => ((acc[cfg.key] = cfg), acc), {});

// Ledger endpoints (HAR v2)
const ledgerConfig = [
  {
    key: "ITC_LED",
    display: "ITC ledger (Excel)",
    base: "https://return.gst.gov.in/returns/auth/api/itcdtls",
    generateBase: "https://return.gst.gov.in/returns/auth/api/itcdtls",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/url",
    fromParam: "fdate",
    toParam: "tdate",
    format: "DD/MM/YYYY",
    fileNameCode: "ITCLED",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    key: "REV_RCLM",
    display: "E-Credit reversal & reclaim",
    base: "https://return.gst.gov.in/returns/auth/internalapi/getRevRclmDetls",
    generateBase: "https://return.gst.gov.in/returns/auth/internalapi/getRevRclmDetls",
    downloadBase: "https://return.gst.gov.in/returns/auth/internalapi/url",
    fromParam: "fdate",
    toParam: "tdate",
    format: "DD/MM/YYYY",
    fileNameCode: "REVRCLM",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    key: "RCM_LED",
    display: "RCM Liability / ITC statement",
    base: "https://return.gst.gov.in/returns/auth/internalapi/getRcmDetls",
    generateBase: "https://return.gst.gov.in/returns/auth/internalapi/getRcmDetls",
    downloadBase: "https://return.gst.gov.in/returns/auth/internalapi/url",
    fromParam: "fdate",
    toParam: "tdate",
    format: "DD/MM/YYYY",
    fileNameCode: "RCMLED",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    key: "LIAB_RET",
    display: "Electronic liability register (returns)",
    base: "https://return.gst.gov.in/returns/auth/api/retdtl",
    generateBase: "https://return.gst.gov.in/returns/auth/api/retdtl",
    downloadBase: "https://return.gst.gov.in/returns/auth/api/url",
    fromParam: "fdate",
    toParam: "to_dt",
    format: "MMYYYY",
    fileNameCode: "LIABRET",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    needsGstinParam: true,
  },
  {
    key: "LIAB_PAY",
    display: "Electronic liability register (other payments)",
    base: "https://payment.gst.gov.in/payment/auth/api/liabdetails",
    generateBase: "https://payment.gst.gov.in/payment/auth/api/liabdetails",
    downloadBase: "https://payment.gst.gov.in/payment/auth/api/url",
    fromParam: "fdate",
    toParam: "tdate",
    format: "YYYY-MM-DD",
    fileNameCode: "LIABPAY",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    key: "CASH_LED",
    display: "Cash ledger (payments)",
    base: "https://payment.gst.gov.in/payment/auth/ledger/detailedledger",
    generateBase: "https://payment.gst.gov.in/payment/auth/api/cashdetls",
    downloadBase: "https://payment.gst.gov.in/payment/auth/api/url",
    fromParam: "fdate",
    toParam: "tdate",
    format: "DD/MM/YYYY",
    fileNameCode: "CASHLED",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
].reduce((acc, cfg) => ((acc[cfg.key] = cfg), acc), {});

// Other endpoints (HAR v3)
const otherConfig = [
  {
    key: "CHALLAN_LIST",
    display: "Challan list (payments)",
    base: "https://payment.gst.gov.in/payment/auth/challan/getlist",
    needsGstinParam: true,
    fileNameCode: "CHALLAN",
    contentType: "application/json",
  },
  {
    key: "IMS_IN",
    display: "IMS Inward supplies",
    base: "https://return.gst.gov.in/imsweb/auth/api/ims/generateDoc?flag=0",
    generateBase: "https://return.gst.gov.in/imsweb/auth/api/ims/generateDoc",
    downloadBase: "https://return.gst.gov.in/imsweb/auth/api/ims/url",
    needsFileUrl: true,
    fileNameCode: "IMSIN",
    contentType: "application/zip",
  },
  {
    key: "IMS_OUT",
    display: "IMS Outward supplies (R1)",
    base: "https://return.gst.gov.in/imsweb/auth/api/ims/generateOutwardsDoc?flag=0",
    generateBase: "https://return.gst.gov.in/imsweb/auth/api/ims/generateOutwardsDoc?flag=1",
    requiresPeriod: true,
    fileNameCode: "IMSOUT",
    contentType: "application/json",
  },
  {
    key: "G3B_VS_G1SUM",
    display: "GSTR-3B vs GSTR-1 (summ)",
    fileNameCode: "R3B_R1SUM",
    apiCode: "GSTR3B_GSTR1SUM",
    summaryType: "GSTR3B_VS_GSTR1",
    compare: "GSTR1",
  },
  {
    key: "G3B_VS_G2ASUM",
    display: "GSTR-3B vs GSTR-2A (summ)",
    fileNameCode: "R3B_R2ASUM",
    apiCode: "GSTR3B_GSTR2ASUM",
    summaryType: "GSTR3B_VS_GSTR2A",
    compare: "GSTR2A",
  },
].reduce((acc, cfg) => ((acc[cfg.key] = cfg), acc), {});

const summaryConfig = [
  {
    key: "G1SUM",
    display: "GSTR-1 (summ)",
    fileNameCode: "R1SUM",
    apiCode: "GSTR1SUM",
    summaryType: "GSTR1",
  },
  {
    key: "G2ASUM",
    display: "GSTR-2A (summ)",
    fileNameCode: "R2ASUM",
    apiCode: "GSTR2ASUM",
    summaryType: "GSTR2A",
    blank: true,
  },
  {
    key: "G2BSUM",
    display: "GSTR-2B (summ)",
    fileNameCode: "R2BSUM",
    apiCode: "GSTR2BSUM",
    summaryType: "GSTR2B",
    blank: true,
  },
  {
    key: "G2AOTHER",
    display: "GSTR-2A (Other)",
    fileNameCode: "R2AOTHER",
    apiCode: "GSTR2A_OTHER",
    summaryType: "GSTR2A_OTHER",
  },
  {
    key: "G3B_VS_G1SUM",
    display: "GSTR-3B vs GSTR-1 (summ)",
    fileNameCode: "R3B_R1SUM",
    apiCode: "GSTR3B_GSTR1SUM",
    summaryType: "GSTR3B_VS_GSTR1",
    compare: "GSTR1",
  },
  {
    key: "G3B_VS_G2ASUM",
    display: "GSTR-3B vs GSTR-2A (summ)",
    fileNameCode: "R3B_R2ASUM",
    apiCode: "GSTR3B_GSTR2ASUM",
    summaryType: "GSTR3B_VS_GSTR2A",
    compare: "GSTR2A",
  },
].reduce((acc, cfg) => ((acc[cfg.key] = cfg), acc), {});

const rc = (key) => returnConfig[key];

const parseUrlPrefs = () => {
  const params = new URLSearchParams(window.location.search || "");
  const cat = params.get("category");
  const type = params.get("returnType");
  urlCategory = cat ? cat.toLowerCase() : null;
  urlReturnType = type ? type.toUpperCase() : null;
  if (urlReturnType === "G2A_EXCEL") urlReturnType = "G2AEXL";
  if (urlReturnType === "G2B_EXCEL") urlReturnType = "G2BEXL";
};

const parseTargetTabId = () => {
  if (targetTabId !== null) return targetTabId;
  const params = new URLSearchParams(window.location.search || "");
  const raw = params.get("tabId");
  if (raw && /^\d+$/.test(raw)) {
    targetTabId = parseInt(raw, 10);
  }
  return targetTabId;
};

const resolveTargetTab = () =>
  new Promise((resolve) => {
    const id = parseTargetTabId();
    if (id !== null) {
      browser.tabs.get(id, (tab) => {
        if (browser.runtime && browser.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(tab || null);
      });
      return;
    }
    const resolveFromAnyGstTab = (fallbackTab) => {
      browser.tabs.query({}, (allTabs) => {
        const gstTab = (allTabs || []).find(
          (tab) =>
            tab &&
            tab.url &&
            /https:\/\/(services|return|payment|gstr2b)\.gst\.gov\.in\//i.test(tab.url),
        );
        resolve(gstTab || fallbackTab || null);
      });
    };
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0] ? tabs[0] : null;
      if (
        activeTab &&
        activeTab.url &&
        /https:\/\/(services|return|payment|gstr2b)\.gst\.gov\.in\//i.test(activeTab.url)
      ) {
        resolve(activeTab);
        return;
      }
      browser.runtime.sendMessage({ type: "get-active-gst-tab" }, (resp) => {
        if (
          browser.runtime &&
          browser.runtime.lastError
        ) {
          resolveFromAnyGstTab(activeTab);
          return;
        }
        if (!resp || !resp.status || !resp.tabId) {
          resolveFromAnyGstTab(activeTab);
          return;
        }
        browser.tabs.get(resp.tabId, (tab) => {
          if (browser.runtime && browser.runtime.lastError) {
            resolveFromAnyGstTab(activeTab);
            return;
          }
          resolve(tab || activeTab);
        });
      });
    });
  });

const findTabForHost = (preferredHost) =>
  new Promise((resolve) => {
    if (!preferredHost) {
      resolve(null);
      return;
    }
    browser.tabs.query({ currentWindow: true }, (tabs) => {
      const match = (tabs || []).find((tab) => {
        try {
          return tab && tab.url && new URL(tab.url).hostname.toLowerCase() === preferredHost.toLowerCase();
        } catch (e) {
          return false;
        }
      });
      resolve(match || null);
    });
  });

const connectToTab = (tab) =>
  new Promise((resolve) => {
    if (!tab || !tab.url) {
      resolve(false);
      return;
    }
    try {
      currentUrl = new URL(tab.url);
    } catch (e) {
      resolve(false);
      return;
    }
    targetTabId = typeof tab.id === "number" ? tab.id : targetTabId;
    if (currentUrl.hostname.toLowerCase().endsWith("gst.gov.in")) {
      executeScriptCompat(tab.id, "jszip.min.js");
      executeScriptCompat(tab.id, "contentscript.js");
    }
    try {
      if (port && typeof port.disconnect === "function") port.disconnect();
    } catch (e) {
      /* ignore */
    }
    port = browser.tabs.connect(tab.id, { name: "gc-returns-pro-assistant" });
    port.onMessage.addListener((msg) => {
      const handler = msg && typeof msg.Id !== "undefined" ? responseHandlers[msg.Id] : null;
      if (typeof handler === "function") {
        handler(msg);
        return;
      }
      console.warn("GC Returns Pro popup received an unexpected port message.", msg);
    });
    resolve(true);
  });

const ensureConnectedToHost = async (preferredHost) => {
  if (
    currentUrl &&
    currentUrl.hostname &&
    currentUrl.hostname.toLowerCase() === preferredHost.toLowerCase() &&
    port
  ) {
    return true;
  }
  const tab = (await findTabForHost(preferredHost)) || (await resolveTargetTab());
  return connectToTab(tab);
};

document.addEventListener(
  "DOMContentLoaded",
  function () {
    // ── Dark Mode ──────────────────────────────────────────────────
    (function initDarkMode() {
      const prefs = loadPrefs();
      const btn = document.getElementById("darkModeBtn");
      const label = document.getElementById("darkModeBtnLabel");
      function applyDark(on) {
        document.body.classList.toggle("dark", !!on);
        if (btn) btn.textContent = on ? "☀️ Light" : "🌙 Dark";
      }
      applyDark(!!prefs.darkMode);
      if (btn) {
        btn.addEventListener("click", () => {
          const nowDark = document.body.classList.toggle("dark");
          const p = loadPrefs();
          p.darkMode = nowDark;
          savePrefs(p);
          btn.textContent = nowDark ? "☀️ Light" : "🌙 Dark";
        });
      }
    })();

    // ── Client Folder Toggle ────────────────────────────────────────
    (function initFolderToggle() {
      const toggle = document.getElementById("clientFolderToggle");
      if (!toggle) return;
      const prefs = loadPrefs();
      toggle.checked = !!prefs.useClientFolder;
      toggle.addEventListener("change", () => {
        const p = loadPrefs();
        p.useClientFolder = toggle.checked;
        savePrefs(p);
      });
    })();

    setupStandaloneConverter();
    setupSchemaPanel();
    try {
      const params = new URLSearchParams(window.location.search || "");
      if (params.get("openSchema") === "1") {
        setSchemaOpen(true);
      }
      if (params.get("openConverter") === "1") {
        setConverterOpen(true);
      }
      applyFocusedToolMode(params.get("tool"));
    } catch (e) {}
    try {
      if (window.self !== window.top) {
        document.documentElement.classList.add("embedded");
        document.body.classList.add("embedded");
        window.scrollTo(0, 0);
      }
    } catch (e) {
      document.documentElement.classList.add("embedded");
      document.body.classList.add("embedded");
      window.scrollTo(0, 0);
    }
    if (toolMode === "schema" || toolMode === "converter") {
      showStatus(null);
      return;
    }
    parseUrlPrefs();
    resolveTargetTab().then((tab) => {
      if (!tab || !tab.url) {
        currentUrl = new URL(window.location.href);
        setTimeout(startupAsync, 100);
        return;
      }
      currentUrl = new URL(tab.url);
      if (currentUrl.hostname.toLowerCase().endsWith("gst.gov.in")) {
        executeScriptCompat(tab.id, "jszip.min.js");
        executeScriptCompat(tab.id, "contentscript.js");
      }
      setTimeout(startupAsync, 500);
    });
  },
  false,
);

const connect = () =>
  new Promise((resolve) => {
    resolveTargetTab().then((tab) => {
      if (!tab) {
        resolve();
        return;
      }
      connectToTab(tab).then(() => resolve());
    });
  });

const ensureStartupUrl = async () => {
  if (
    currentUrl &&
    currentUrl.hostname &&
    currentUrl.hostname.toLowerCase().endsWith("gst.gov.in")
  ) {
    return true;
  }
  const tab = await resolveTargetTab();
  if (!tab || !tab.url) return false;
  await connectToTab(tab);
  return !!(
    currentUrl &&
    currentUrl.hostname &&
    currentUrl.hostname.toLowerCase().endsWith("gst.gov.in")
  );
};

const processAsync = (msg) =>
  new Promise((resolve) => {
    const i = msgId++;
    responseHandlers[i] = resolve;
    msg.Id = i;
    if (msg && msg.url) {
      msg.url = routeUrlForHost(msg.url);
    }
    port.postMessage(msg);
  });

function routeUrlForHost(url) {
  if (!url || !currentUrl) return url;
  const host = currentUrl.hostname.toLowerCase();
  // Keep IMS endpoints on return.gst.gov.in to avoid host rewrite.
  if (url.includes("/imsweb/auth/api/ims/")) return url;
  if (url.includes("/returns/auth/api/gstr1/summary")) return url;
  if (host.endsWith("gst.gov.in") && host !== "return.gst.gov.in") {
    if (url.startsWith("https://return.gst.gov.in/")) {
      return url.replace("https://return.gst.gov.in", currentUrl.origin);
    }
  }
  return url;
}

const displayRegType = (t) =>
  ({ NT: "Regular", TP: "Regular", CA: "Casual", CO: "Composition" }[t] || t);
const displayFilingStatus = (s) =>
  ({ FIL: "Filed", NF: "Not filed", FRZ: "Submitted, but not filed" }[s] || s);

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsText(file);
  });
}

function setConverterOpen(open) {
  converterState.open = !!open;
  const panel = getElement("converterPanel");
  if (panel) panel.hidden = !converterState.open;
}

function getConverterDisplayName(payload, fallback) {
  const root = payload && payload.data ? payload.data : payload || {};
  const gstin = String(root.gstin || root.ctin || "").trim();
  const period = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "").trim();
  return [fallback || "file.json", gstin ? `GSTIN ${gstin}` : "", period ? `Period ${period}` : ""]
    .filter(Boolean)
    .join(" • ");
}

function getConverterReturnType() {
  const select = getElement("converterReturnType");
  const value = String((select && select.value) || converterState.returnType || "AUTO").trim().toUpperCase();
  converterState.returnType = value || "AUTO";
  return converterState.returnType;
}

function detectConverterReturnType(payload) {
  const root = payload && payload.data ? payload.data : payload || {};
  const textPayload = JSON.stringify(root).slice(0, 12000).toLowerCase();
  const explicit = String(
    root.returnType ||
      root.rtn_typ ||
      root.rtnType ||
      root.apiCode ||
      root.return_type ||
      root.form_typ ||
      "",
  ).toUpperCase();
  if (/GSTR\s*-?\s*3B/i.test(explicit) || root.sup_details || root.inter_sup || root.itc_elg || root.inward_sup) return "GSTR3B";
  if (/GSTR\s*-?\s*2B/i.test(explicit) || root.docdata || root.cpsumm || root.itcsumm || root.gstr2b) return "GSTR2B";
  if (/GSTR\s*-?\s*2A/i.test(explicit) || root.__portalResponse || root.b2ba || root.cdnra || root.impg || root.impgsez) return "GSTR2A";
  if (/GSTR\s*-?\s*1/i.test(explicit) || root.b2b || root.b2cl || root.b2cs || root.exp || root.hsn || root.doc_issue) return "GSTR1";
  if (/gstr3b|sup_details|itc_elg/.test(textPayload)) return "GSTR3B";
  if (/gstr2b|docdata|cpsumm|itcsumm/.test(textPayload)) return "GSTR2B";
  if (/gstr2a|impgsez|cdnra/.test(textPayload)) return "GSTR2A";
  if (/b2b|b2cl|b2cs|doc_issue|hsn/.test(textPayload)) return "GSTR1";
  return "GENERIC";
}

function resolveConverterReturnType(payload) {
  const selected = getConverterReturnType();
  return selected === "AUTO" ? detectConverterReturnType(payload) : selected;
}

function getConverterFileParts(payload, returnType, combined) {
  const root = payload && payload.data ? payload.data : payload || {};
  const gstin = root.gstin || root.ctin || "GSTIN";
  const period = root.rtnprd || root.ret_period || root.rtn_prd || root.fp || root.report_period || (combined ? "ALL" : "PERIOD");
  const codeMap = {
    GSTR1: "R1",
    GSTR2A: "R2A",
    GSTR2B: "R2B",
    GSTR3B: "R3B",
    GENERIC: "JSON",
  };
  return {
    gstin,
    period,
    code: codeMap[returnType] || "JSON",
  };
}

async function buildConverterSingleBlob(payload, returnType) {
  if (returnType === "GSTR1") {
    const workbookXml = buildGstr1WorkbookXml(payload);
    return { blob: new Blob([workbookXml], { type: "application/vnd.ms-excel" }), ext: "xls" };
  }
  if (returnType === "GSTR2A") {
    const blob = await buildGstr2aWorkbookXlsxBlob(payload);
    return { blob, ext: "xlsx" };
  }
  if (returnType === "GSTR2B") {
    const blob = await buildGstr2bWorkbookXlsxBlob(payload);
    return { blob, ext: "xlsx" };
  }
  if (returnType === "GSTR3B") {
    const workbookXml = buildGstr3bWorkbookXml(payload);
    const blob = await buildXlsxBlobFromWorkbookXml(workbookXml);
    return { blob, ext: "xlsx" };
  }
  const workbookXml = buildGenericWorkbookXml(payload);
  return { blob: new Blob([workbookXml], { type: "application/vnd.ms-excel" }), ext: "xls" };
}

async function buildConverterCombinedBlob(payloads, returnType) {
  if (returnType === "GSTR1") {
    const workbookXml = buildCombinedGstr1WorkbookXml(payloads);
    return { blob: new Blob([workbookXml], { type: "application/vnd.ms-excel" }), ext: "xls" };
  }
  if (returnType === "GSTR2A") {
    const blob = await buildCombinedGstr2aWorkbookXlsxBlob(payloads);
    return { blob, ext: "xlsx" };
  }
  if (returnType === "GSTR2B") {
    const blob = await buildCombinedGstr2bWorkbookXlsxBlob(payloads);
    return { blob, ext: "xlsx" };
  }
  if (returnType === "GSTR3B") {
    const workbookXml = buildCombinedGstr3bWorkbookXml(payloads);
    const blob = await buildXlsxBlobFromWorkbookXml(workbookXml);
    return { blob, ext: "xlsx" };
  }
  const workbookXml = buildCombinedGenericWorkbookXml(payloads);
  return { blob: new Blob([workbookXml], { type: "application/vnd.ms-excel" }), ext: "xls" };
}

function renderConverterFiles() {
  const list = getElement("converterFiles");
  const summary = getElement("converterSummary");
  const singleBtn = getElement("converterDownloadSingleBtn");
  const combinedBtn = getElement("converterDownloadCombinedBtn");
  if (!list) return;
  const items = converterState.files || [];
  if (!items.length) {
    list.innerHTML = '<li class="converter-file text-muted">No files loaded yet.</li>';
    if (summary) summary.textContent = "Load JSON files to generate Excel output.";
    if (singleBtn) singleBtn.disabled = true;
    if (combinedBtn) combinedBtn.disabled = true;
    return;
  }
  list.innerHTML = items.map((item) => (
    `<li class="converter-file"><strong>${escapeXml(item.name)}</strong>${escapeXml(getConverterDisplayName(item.payload, ""))}</li>`
  )).join("");
  if (summary) {
    const selectedType = getConverterReturnType();
    const typeLabel = selectedType === "AUTO" ? "Auto detect" : selectedType;
    summary.textContent = items.length === 1
      ? `1 file ready. Converter mode: ${typeLabel}.`
      : `${items.length} files ready. Converter mode: ${typeLabel}. You can export single files or a combined workbook.`;
  }
  if (singleBtn) singleBtn.disabled = false;
  if (combinedBtn) combinedBtn.disabled = items.length === 0;
}

async function loadConverterFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file && /\.(json|zip)$/i.test(file.name || ""));
  if (!files.length) {
    const note = getElement("converterStatusNote");
    if (note) note.textContent = "Please choose JSON or ZIP files for conversion.";
    return;
  }
  const parsed = await Promise.all(files.map(async (file) => {
    if (/\.zip$/i.test(file.name || "")) {
      const zip = await JSZip.loadAsync(file);
      const jsonEntry = Object.keys(zip.files)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .sort()[0];
      if (!jsonEntry) throw new Error(`JSON file not found inside ${file.name}`);
      const jsonText = await zip.files[jsonEntry].async("string");
      return { name: file.name, payload: JSON.parse(jsonText) };
    }
    const text = await readFileAsText(file);
    return { name: file.name, payload: JSON.parse(text) };
  }));
  converterState.files = parsed;
  renderConverterFiles();
  const note = getElement("converterStatusNote");
  if (note) note.textContent = "Files loaded. Choose Download Excel for one file or Download Combined Excel for multiple files.";
}

async function downloadConverterSingle() {
  const btn = getElement("converterDownloadSingleBtn");
  if (!converterState.files.length) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Preparing...";
  }
  try {
    for (const item of converterState.files) {
      const payload = item.payload;
      const returnType = resolveConverterReturnType(payload);
      const parts = getConverterFileParts(payload, returnType, false);
      const built = await buildConverterSingleBlob(payload, returnType);
      const fileName = `${makeJsonFileName(parts.code, parts.gstin, parts.period)}.${built.ext}`;
      await downloadBlobAs(built.blob, fileName);
    }
    const note = getElement("converterStatusNote");
    if (note) note.textContent = "Excel download complete.";
  } catch (err) {
    const note = getElement("converterStatusNote");
    if (note) note.textContent = err && err.message ? err.message : "Converter export failed.";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Download Excel";
    }
  }
}

async function downloadConverterCombined() {
  const btn = getElement("converterDownloadCombinedBtn");
  if (!converterState.files.length) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Preparing...";
  }
  try {
    const payloads = converterState.files.map((item) => item.payload);
    let returnType = resolveConverterReturnType(payloads[0]);
    if (getConverterReturnType() === "AUTO") {
      const detectedTypes = Array.from(new Set(payloads.map((payload) => detectConverterReturnType(payload))));
      if (detectedTypes.length > 1) returnType = "GENERIC";
    }
    const parts = getConverterFileParts(payloads[0], returnType, true);
    const periods = payloads
      .map((payload) => {
        const r = payload && payload.data ? payload.data : payload || {};
        return String(r.rtnprd || r.ret_period || r.rtn_prd || r.fp || "").trim();
      })
      .filter(Boolean);
    const periodTag = periods.length > 1 ? `${periods[0]}_to_${periods[periods.length - 1]}` : (periods[0] || "ALL");
    const built = await buildConverterCombinedBlob(payloads, returnType);
    const fileName = `${makeJsonFileName(parts.code, parts.gstin, periodTag)}_CONVERTER.${built.ext}`;
    await downloadBlobAs(built.blob, fileName);
    releaseLargeArray(payloads);
    const note = getElement("converterStatusNote");
    if (note) note.textContent = "Combined Excel download complete.";
  } catch (err) {
    const note = getElement("converterStatusNote");
    if (note) note.textContent = err && err.message ? err.message : "Combined converter export failed.";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Download Combined Excel";
    }
  }
}

function setupStandaloneConverter() {
  const openBtn = getElement("openConverterBtn");
  const closeBtn = getElement("closeConverterBtn");
  const pickBtn = getElement("pickConverterFilesBtn");
  const fileInput = getElement("converterFileInput");
  const clearBtn = getElement("clearConverterFilesBtn");
  const dropzone = getElement("converterDropzone");
  const singleBtn = getElement("converterDownloadSingleBtn");
  const combinedBtn = getElement("converterDownloadCombinedBtn");
  const returnTypeSelect = getElement("converterReturnType");

  if (openBtn) openBtn.onclick = () => setConverterOpen(true);
  if (closeBtn) closeBtn.onclick = () => setConverterOpen(false);
  if (pickBtn && fileInput) pickBtn.onclick = () => fileInput.click();
  if (fileInput) {
    fileInput.onchange = async (evt) => {
      try {
        await loadConverterFiles(evt.target.files);
      } catch (err) {
        const note = getElement("converterStatusNote");
        if (note) note.textContent = err && err.message ? err.message : "Unable to load files.";
      } finally {
        fileInput.value = "";
      }
    };
  }
  if (clearBtn) {
    clearBtn.onclick = () => {
      converterState.files = [];
      renderConverterFiles();
      const note = getElement("converterStatusNote");
      if (note) note.textContent = "Single-file mode exports one workbook. Multi-file mode can generate a consolidated workbook too.";
    };
  }
  if (dropzone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        dropzone.classList.add("dragover");
      });
    });
    ["dragleave", "dragend", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        dropzone.classList.remove("dragover");
      });
    });
    dropzone.addEventListener("drop", async (evt) => {
      try {
        await loadConverterFiles(evt.dataTransfer && evt.dataTransfer.files);
      } catch (err) {
        const note = getElement("converterStatusNote");
        if (note) note.textContent = err && err.message ? err.message : "Unable to load dropped files.";
      }
    });
  }
  if (singleBtn) singleBtn.onclick = () => downloadConverterSingle();
  if (combinedBtn) combinedBtn.onclick = () => downloadConverterCombined();
  if (returnTypeSelect) {
    returnTypeSelect.value = converterState.returnType || "AUTO";
    returnTypeSelect.onchange = () => {
      converterState.returnType = getConverterReturnType();
      renderConverterFiles();
    };
  }
  renderConverterFiles();
}

function setSchemaOpen(open) {
  schemaState.open = !!open;
  const panel = getElement("schemaPanel");
  if (panel) panel.hidden = !schemaState.open;
  if (schemaState.open) renderSchemaTable();
}

function getSchemaSelectedReturnType() {
  const select = getElement("schemaReturnType");
  if (select && select.value) schemaState.returnType = normalizeSchemaReturnType(select.value);
  return schemaState.returnType || "GSTR1";
}

function setSchemaStatus(message) {
  const note = getElement("schemaStatusNote");
  if (note) note.textContent = message || "New keys are added automatically whenever you convert JSON to Excel.";
}

function applyFocusedToolMode(mode) {
  toolMode = String(mode || "").trim().toLowerCase();
  if (!toolMode) return;
  document.body.classList.add("tool-mode");
  const appHeaderTitle = getElement("appHeaderTitle");
  const appHeaderSub = getElement("appHeaderSub");
  const converterBtn = getElement("openConverterBtn");
  const schemaBtn = getElement("openSchemaBtn");
  if (toolMode === "schema") {
    setSchemaOpen(true);
    setConverterOpen(false);
    if (appHeaderTitle) appHeaderTitle.textContent = "Schema Manager";
    if (appHeaderSub) appHeaderSub.textContent = "Maintain friendly labels and sync them directly with GitHub.";
  } else if (toolMode === "converter") {
    setConverterOpen(true);
    setSchemaOpen(false);
    if (appHeaderTitle) appHeaderTitle.textContent = "Converters";
    if (appHeaderSub) appHeaderSub.textContent = "Convert GST JSON files without opening the download workspace.";
  }
  if (converterBtn) converterBtn.hidden = toolMode === "converter";
  if (schemaBtn) schemaBtn.hidden = toolMode === "schema";
}

function renderSchemaReturnTypeOptions() {
  const select = getElement("schemaReturnType");
  if (!select) return;
  select.innerHTML = SCHEMA_RETURN_TYPES.map((item) => (
    `<option value="${escapeXml(item.code)}"${item.code === getSchemaSelectedReturnType() ? " selected" : ""}>${escapeXml(item.label)}</option>`
  )).join("");
}

function renderSchemaTable() {
  renderSchemaReturnTypeOptions();
  const returnType = getSchemaSelectedReturnType();
  const body = getElement("schemaTableBody");
  if (!body) return;
  const rows = buildSchemaRows(returnType);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="3" class="text-muted">No schema entries yet for this return type.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => (
    `<tr>
      <td>${row.row_no}</td>
      <td><code>${escapeXml(row.key)}</code></td>
      <td><input type="text" data-schema-key="${escapeXml(row.key)}" value="${escapeXml(row.abbreviation || row.label || "")}" placeholder="${escapeXml(row.label || "")}"></td>
    </tr>`
  )).join("");
}

function saveSchemaTableEdits() {
  const returnType = getSchemaSelectedReturnType();
  const body = getElement("schemaTableBody");
  if (!body) return;
  const store = loadSchemaStore();
  let changed = false;
  Array.from(body.querySelectorAll("input[data-schema-key]")).forEach((input) => {
    const key = input.getAttribute("data-schema-key") || "";
    const abbreviation = String(input.value || "").trim();
    const existingLabel = getSchemaLabel(returnType, key) || getDefaultSchemaLabel(key);
    changed = upsertSchemaEntry(store, returnType, key, existingLabel, abbreviation || existingLabel) || changed;
  });
  if (changed) {
    saveSchemaStore(store);
    setSchemaStatus("Schema changes saved.");
  } else {
    setSchemaStatus("No schema changes to save.");
  }
  renderSchemaTable();
}

function copySchemaTable() {
  const returnType = getSchemaSelectedReturnType();
  const rows = buildSchemaRows(returnType);
  const text = ["return\tkey\tabbreviation"]
    .concat(rows.map((row) => `${row.return_type}\t${row.key}\t${row.abbreviation || row.label || ""}`))
    .join("\n");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => setSchemaStatus("Schema table copied. You can paste it into Excel."),
      () => setSchemaStatus("Unable to copy automatically. Select and copy the table manually."),
    );
    return;
  }
  setSchemaStatus("Clipboard access is unavailable in this window.");
}

function downloadSchemaExcel() {
  const returnType = getSchemaSelectedReturnType();
  const rows = buildSchemaRows(returnType);
  const workbookXml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E8FB" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Schema", rows, ["return_type", "key", "abbreviation", "label", "updated_at"], { schemaReturnType: "GENERIC" })}
</Workbook>`;
  const blobUrl = URL.createObjectURL(new Blob([workbookXml], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  downloadAs(blobUrl, `gc-returns-pro-schema-${returnType}.xlsx`);
  setSchemaStatus("Schema Excel exported.");
}
async function buildCombinedGstr2aWorkbookXlsxBlob(payloads) {
  const fields = ["gstin", "rtnprd", "status", "message", "date", "time", "generated_on", "version", "checksum", "file_url"];
  const valuesByField = new Map(fields.map((field) => [field, { field }]));
  const periods = [];
  const sectionsByName = new Map();
  (payloads || []).forEach((payload) => {
    const meta = extractWorkbookMeta(payload);
    const period = meta.rtnprd || "";
    if (period && !periods.includes(period)) periods.push(period);
    if (period) {
      valuesByField.get("gstin")[period] = meta.gstin || "";
      valuesByField.get("rtnprd")[period] = meta.rtnprd || "";
      valuesByField.get("status")[period] = meta.status || "";
      valuesByField.get("message")[period] = meta.message || "";
      valuesByField.get("date")[period] = meta.file_date || "";
      valuesByField.get("time")[period] = meta.file_time || "";
      valuesByField.get("generated_on")[period] = meta.generated_on || "";
      valuesByField.get("version")[period] = meta.version || "";
      valuesByField.get("checksum")[period] = meta.checksum || "";
      valuesByField.get("file_url")[period] = meta.file_url || "";
    }
    const workbookData = buildGstr2aWorkbookData(payload, true);
    (workbookData.sectionSheets || []).forEach((section) => {
      if (!sectionsByName.has(section.name)) sectionsByName.set(section.name, []);
      (section.rows || []).forEach((row) => sectionsByName.get(section.name).push({ ...(row || {}) }));
    });
  });
  const sheets = [
    { name: "Summary", rows: fields.map((field) => valuesByField.get(field)), columns: ["field"].concat(periods), options: { schemaReturnType: "GSTR2A" } },
  ];
  Array.from(sectionsByName.entries()).forEach(([name, rows]) => {
    sheets.push({ name, rows, columns: getSpreadsheetColumns(rows, ["report_period", "row_no"]), options: { schemaReturnType: "GSTR2A" } });
  });
  return buildXlsxBlobFromSheets(sheets);
}


async function importSchemaFile(file) {
  if (!file) return;
  const text = await readFileAsText(file);
  const rows = file.name && /\.json$/i.test(file.name)
    ? (() => {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
        return [];
      })()
    : parseSchemaTextRows(text, getSchemaSelectedReturnType());
  if (!rows.length) {
    setSchemaStatus("No schema rows found in the selected file.");
    return;
  }
  importSchemaRows(rows);
  renderSchemaTable();
  setSchemaStatus(`Imported ${rows.length} schema row(s).`);
}

function importSchemaFromPaste() {
  const area = getElement("schemaPasteArea");
  const rows = parseSchemaTextRows(area && area.value, getSchemaSelectedReturnType());
  if (!rows.length) {
    setSchemaStatus("Paste rows in the format return, key, abbreviation or key, abbreviation.");
    return;
  }
  importSchemaRows(rows);
  if (area) area.value = "";
  renderSchemaTable();
  setSchemaStatus(`Imported ${rows.length} pasted schema row(s).`);
}

function setupSchemaPanel() {
  const openBtn = getElement("openSchemaBtn");
  const closeBtn = getElement("closeSchemaBtn");
  const saveBtn = getElement("schemaSaveBtn");
  const exportBtn = getElement("schemaExportBtn");
  const copyBtn = getElement("schemaCopyBtn");
  const importPasteBtn = getElement("schemaImportPasteBtn");
  const pickFileBtn = getElement("schemaPickFileBtn");
  const importFile = getElement("schemaImportFile");
  const returnTypeSelect = getElement("schemaReturnType");

  renderSchemaReturnTypeOptions();
  if (openBtn) openBtn.onclick = () => setSchemaOpen(true);
  if (closeBtn) closeBtn.onclick = () => setSchemaOpen(false);
  if (saveBtn) saveBtn.onclick = () => saveSchemaTableEdits();
  if (exportBtn) exportBtn.onclick = () => downloadSchemaExcel();
  if (copyBtn) copyBtn.onclick = () => copySchemaTable();
  if (importPasteBtn) importPasteBtn.onclick = () => importSchemaFromPaste();
  if (pickFileBtn && importFile) pickFileBtn.onclick = () => importFile.click();
  if (importFile) {
    importFile.onchange = async (evt) => {
      try {
        await importSchemaFile(evt.target.files && evt.target.files[0]);
      } catch (err) {
        setSchemaStatus(err && err.message ? err.message : "Unable to import schema file.");
      } finally {
        importFile.value = "";
      }
    };
  }
  if (returnTypeSelect) {
    returnTypeSelect.onchange = () => {
      schemaState.returnType = normalizeSchemaReturnType(returnTypeSelect.value);
      renderSchemaTable();
      setSchemaStatus(`Showing schema for ${schemaState.returnType}.`);
    };
  }
  renderSchemaTable();
  ensureSchemaStoreLoaded();
}

const formatLedgerDate = (val, fmt) => {
  if (!val) return "";
  const m = moment(val);
  if (!m.isValid()) return "";
  switch (fmt) {
    case "MMYYYY":
      return m.format("MMYYYY");
    case "YYYY-MM-DD":
      return m.format("YYYY-MM-DD");
    default:
      return m.format("DD/MM/YYYY");
  }
};

function extractRegistrationDate(info) {
  const candidateKeys = [
    "rgdt",
    "dateReg",
    "regDate",
    "registrationDate",
    "dtreg",
    "dtReg",
    "regDt",
    "effectiveDate",
    "dtOfReg",
    "dateOfRegistration",
  ];
  const queue = [info];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const key of candidateKeys) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        const parsed = moment(
          current[key],
          ["YYYY-MM-DD", "DD/MM/YYYY", "YYYY/MM/DD", "YYYYMMDD", moment.ISO_8601],
          true,
        );
        if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
      }
    }
    Object.keys(current).forEach((key) => {
      const value = current[key];
      if (value && typeof value === "object") queue.push(value);
    });
  }
  return "";
}

function fetchRegistrationDateFromClientData() {
  return new Promise((resolve) => {
    resolveTargetTab().then((tab) => {
      if (!tab || typeof tab.id !== "number") {
        resolve("");
        return;
      }
      browser.tabs.sendMessage(
        tab.id,
        { type: "portal-profile-detail" },
        (resp) => {
          if (browser.runtime && browser.runtime.lastError) {
            resolve("");
            return;
          }
          if (!resp || !resp.status || !resp.response) {
            resolve("");
            return;
          }
          try {
            const parsed = JSON.parse(resp.response);
            resolve(extractRegistrationDate(parsed));
          } catch (e) {
            resolve("");
          }
        },
      );
    });
  });
}

function collectCachedProfiles() {
  const profiles = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("gc-returns-pro-profile-")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const portalProfile = parsed && parsed.portalProfile ? parsed.portalProfile : null;
      const portalInfo = parsed && parsed.portalInfo ? parsed.portalInfo : null;
      const combined = Object.assign({}, parsed || {}, portalInfo || {}, portalProfile || {});
      const profileGstin = String(
        (combined && (combined.gstin || combined.gstinId || combined.ctin)) || "",
      )
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase();
      const profileName =
        (combined &&
          (combined.tradeName ||
            combined.trdnm ||
            combined.legalName ||
            combined.lgnm ||
            combined.bname ||
            combined.businessName ||
            combined.name)) ||
        "";
      profiles.push({
        gstin: profileGstin || "",
        businessName: String(profileName || "").trim(),
        registrationDate:
          extractRegistrationDate(combined) ||
          extractRegistrationDate(portalProfile) ||
          extractRegistrationDate(portalInfo) ||
          "",
      });
    }
  } catch (e) {
    return null;
  }
  return profiles;
}

function getRegistrationDateFromCachedProfile(gstin) {
  const targetGstin = String(gstin || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  if (!targetGstin) return "";
  const profiles = collectCachedProfiles();
  if (!profiles) return "";
  const match = profiles.find((profile) => profile.gstin && profile.gstin === targetGstin);
  if (match) return match.registrationDate || "";
  return "";
}

function getCachedCompanyProfile(gstin) {
  const targetGstin = String(gstin || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  const profiles = collectCachedProfiles();
  if (!profiles || !targetGstin) return null;
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    if (targetGstin && profile.gstin && profile.gstin === targetGstin) {
      return profile;
    }
  }
  return null;
}

function applyBusinessIdentity(options) {
  const opts = options || {};
  const rawGstin = opts.gstin || session.gstin || "";
  const cachedProfile = getCachedCompanyProfile(rawGstin);
  const finalGstin = (cachedProfile && cachedProfile.gstin) || rawGstin || "";
  const finalName =
    (cachedProfile && cachedProfile.businessName) ||
    opts.businessName ||
    session.businessName ||
    "GST Portal";
  const finalRegistrationDate =
    (cachedProfile && cachedProfile.registrationDate) ||
    opts.registrationDate ||
    session.registrationDate ||
    "";

  session.gstin = finalGstin || session.gstin;
  session.businessName = finalName || session.businessName;
  session.registrationDate = finalRegistrationDate || session.registrationDate;

  const businessNameEl = getElement("businessName");
  const businessSubEl = getElement("businessSub");
  const appHeaderTitleEl = getElement("appHeaderTitle");
  const appHeaderSubEl = getElement("appHeaderSub");
  const regType = opts.regType || session.gstRegType || "";
  const titleWithGstin = finalGstin ? `${finalName} - ${finalGstin}` : finalName;
  const subLine = finalGstin
    ? `GSTIN ${finalGstin}${regType ? ` | ${displayRegType(regType)}` : ""}`
    : (opts.subText || "GST Portal");

  if (businessNameEl) businessNameEl.textContent = finalName || "GST Portal";
  if (businessSubEl) businessSubEl.textContent = subLine;
  if (appHeaderTitleEl) appHeaderTitleEl.textContent = titleWithGstin || "GC Returns Pro";
  if (appHeaderSubEl) {
    appHeaderSubEl.textContent = subLine || "Download returns faster with a focused workspace.";
  }
}

function normalizeGstin(value) {
  return String(value || "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function readSelectedClientFromEmbeddedParent() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const queryGstin = normalizeGstin(params.get("selectedClientGstin"));
    const queryName = String(params.get("selectedClientName") || "").trim();
    if (queryGstin) {
      return { gstin: queryGstin, name: queryName };
    }
    if (window.self === window.top || !window.parent || !window.parent.document) return null;
    const bodyText = String(
      (window.parent.document.body && window.parent.document.body.textContent) || "",
    );
    const gstinMatch = bodyText.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i);
    const selectedGstin = normalizeGstin(gstinMatch ? gstinMatch[0] : "");
    if (!selectedGstin) return null;
    const rawClients =
      localStorage.getItem("gc-returns-pro-clients") || localStorage.getItem("gc-returns-pro-dataset-cache") || "";
    if (!rawClients) return { gstin: selectedGstin, name: "" };
    let parsed = JSON.parse(rawClients);
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.clients)) {
      parsed = parsed.clients;
    }
    const clients = Array.isArray(parsed) ? parsed : [];
    const match = clients.find((client) => normalizeGstin(client && client.gstin) === selectedGstin);
    return {
      gstin: selectedGstin,
      name: String((match && (match.name || match.clientName || match.tradeName)) || "").trim(),
    };
  } catch (e) {
    return null;
  }
}

function getDownloadValidationState() {
  const portalGstin = normalizeGstin(session.portalGstin || session.gstin);
  const selectedClientGstin = normalizeGstin(session.selectedClientGstin);
  const selectedClientName = String(session.selectedClientName || "").trim();
  const hasSelectedClient = !!selectedClientGstin;
  const requiresClientMatch = isEmbeddedWorkspace() && hasSelectedClient;
  const hasRequiredContext = !!portalGstin && (!requiresClientMatch || !!selectedClientGstin);
  const matches =
    hasRequiredContext && (!requiresClientMatch || portalGstin === selectedClientGstin);
  let message = "Please login to GST Portal first.";
  if (!portalGstin) {
    message = "Please login to GST Portal first.";
  } else if (requiresClientMatch && !selectedClientGstin) {
    message = "Select the client again, then reopen the download workspace.";
  } else if (requiresClientMatch && portalGstin !== selectedClientGstin) {
    message = `Logged in GSTIN ${portalGstin} does not match selected client ${selectedClientGstin}.`;
  }
  return {
    portalGstin,
    selectedClientGstin,
    selectedClientName,
    hasSelectedClient,
    hasRequiredContext,
    requiresClientMatch,
    matches,
    message,
  };
}

function updatePortalStatusPill() {
  const pillEl = getElement("gstStatusPill");
  if (!pillEl) return;
  const validation = getDownloadValidationState();
  if (!session.portalOnline || !validation.portalGstin) {
    pillEl.textContent = "Offline";
    pillEl.className = "pill danger";
    return;
  }
  pillEl.textContent = "Online";
  pillEl.className = "pill success";
}

function applySelectedClientContext() {
  const selected = readSelectedClientFromEmbeddedParent();
  session.selectedClientGstin = normalizeGstin(selected && selected.gstin);
  session.selectedClientName = String((selected && selected.name) || "").trim();
  if (!session.businessName && session.selectedClientName) {
    applyBusinessIdentity({
      businessName: session.selectedClientName,
      gstin: session.selectedClientGstin,
      subText: session.selectedClientGstin
        ? `GSTIN ${session.selectedClientGstin}`
        : "Selected client",
    });
  }
  updatePortalStatusPill();
}

function applyPortalSessionIdentity(info) {
  const normalizedGstin = normalizeGstin(
    info && (info.gstin || info.gstinId || info.ctin),
  );
  session.portalOnline = !!(
    info &&
    (
      info.regType ||
      info.rgst ||
      info.status ||
      info.sts ||
      normalizedGstin
    )
  );
  session.portalGstin = normalizedGstin;
  session.gstin = session.portalGstin || session.gstin;
  session.businessName = (info && info.bname) || session.businessName;
  updatePortalStatusPill();
}

function hasPortalIdentity(info) {
  const normalizedGstin = normalizeGstin(
    info && (info.gstin || info.gstinId || info.ctin),
  );
  return !!(
    info &&
    (
      info.regType ||
      info.rgst ||
      info.status ||
      info.sts ||
      normalizedGstin
    )
  );
}

function enforceDownloadValidation(period, options) {
  const opts = options || {};
  const validation = getDownloadValidationState();
  const divInfo = period ? getElement(`info-${period.value}`) : getElement("returnStatus");
  const buttons = (opts.buttons || []).filter(Boolean);
  if (!validation.matches) {
    buttons.forEach((button) => {
      button.hidden = false;
      button.disabled = true;
    });
    if (divInfo) {
      divInfo.innerHTML = pill(validation.message, "danger");
    }
    updatePortalStatusPill();
    return false;
  }
  updatePortalStatusPill();
  return true;
}

function renderDownloadValidationAlert(validation) {
  const container = getElement("returnStatus");
  if (!container) return;
  const existing = getElement("download-validation-alert");
  if (validation && !validation.matches) {
    const html = `<div class="alert alert-danger py-2" id="download-validation-alert">${validation.message}</div>`;
    if (existing) {
      existing.outerHTML = html;
    } else {
      container.insertAdjacentHTML("afterbegin", html);
    }
    return;
  }
  if (existing) existing.remove();
}

function showPortalOfflineFallback(message) {
  const fallbackName = session.selectedClientName || session.businessName || "Business Name";
  const fallbackGstin = session.selectedClientGstin || session.gstin || "";
  applyBusinessIdentity({
    businessName: fallbackName,
    gstin: fallbackGstin,
    subText: fallbackGstin ? `GSTIN ${fallbackGstin}` : "GSTIN & Reg Type",
  });
  showEmbeddedWorkspaceMessage(message || "Please login to GST Portal first.");
}

function getRegistrationBoundDate(cfg) {
  if (!session.registrationDate) return null;
  const registrationMoment = moment(session.registrationDate, "YYYY-MM-DD", true);
  if (!registrationMoment.isValid()) return null;
  return cfg && cfg.format === "MMYYYY"
    ? registrationMoment.startOf("month")
    : registrationMoment.startOf("day");
}

function getLedgerInputMaxValue(cfg) {
  return cfg && cfg.format === "MMYYYY"
    ? moment().format("YYYY-MM")
    : moment().format("YYYY-MM-DD");
}

function getLedgerInputMinValue(cfg) {
  if (!session.registrationDate) return "";
  return cfg && cfg.format === "MMYYYY"
    ? moment(session.registrationDate, "YYYY-MM-DD", true).format("YYYY-MM")
    : session.registrationDate;
}

function isLedgerRangeInFuture(cfg, from, to) {
  const parseFormats =
    cfg && cfg.format === "MMYYYY"
      ? ["YYYY-MM", "YYYY-MM-DD"]
      : ["YYYY-MM-DD", "YYYY-MM"];
  const fromMoment = moment(from, parseFormats, true);
  const toMoment = moment(to, parseFormats, true);
  if (!fromMoment.isValid() || !toMoment.isValid()) return false;
  const todayLimit =
    cfg && cfg.format === "MMYYYY" ? moment().endOf("month") : moment().endOf("day");
  return fromMoment.isAfter(todayLimit) || toMoment.isAfter(todayLimit);
}

function getEffectiveLedgerRange(cfg, from, to) {
  const parseFormats =
    cfg && cfg.format === "MMYYYY"
      ? ["YYYY-MM", "YYYY-MM-DD"]
      : ["YYYY-MM-DD", "YYYY-MM"];
  let fromMoment = moment(from, parseFormats, true);
  let toMoment = moment(to, parseFormats, true);
  if (!fromMoment.isValid() || !toMoment.isValid()) {
    return { from: from || "", to: to || "", isValid: false };
  }

  const registrationLimit = session.registrationDate
    ? moment(
        session.registrationDate,
        "YYYY-MM-DD",
        true,
      )[cfg && cfg.format === "MMYYYY" ? "startOf" : "startOf"](
        cfg && cfg.format === "MMYYYY" ? "month" : "day",
      )
    : null;
  const todayLimit =
    cfg && cfg.format === "MMYYYY" ? moment().endOf("month") : moment().endOf("day");

  if (registrationLimit && fromMoment.isBefore(registrationLimit)) fromMoment = registrationLimit.clone();
  if (registrationLimit && toMoment.isBefore(registrationLimit)) toMoment = registrationLimit.clone();
  if (fromMoment.isAfter(todayLimit)) fromMoment = todayLimit.clone();
  if (toMoment.isAfter(todayLimit)) toMoment = todayLimit.clone();
  if (fromMoment.isAfter(toMoment)) toMoment = fromMoment.clone();

  return {
    from: cfg && cfg.format === "MMYYYY" ? fromMoment.format("YYYY-MM") : fromMoment.format("YYYY-MM-DD"),
    to: cfg && cfg.format === "MMYYYY" ? toMoment.format("YYYY-MM") : toMoment.format("YYYY-MM-DD"),
    isValid: true,
  };
}

function updateGenerationBanner() {
  const banner = getElement("banner-generating");
  if (!banner || !genProgress.startedAt) return;

  const elapsedSec = Math.round((Date.now() - genProgress.startedAt) / 1000);
  let eta = "soon";
  if (genProgress.retryAfterSec && genProgress.retryAfterSec > 0) {
    const remainder =
      genProgress.retryAfterSec - (elapsedSec % genProgress.retryAfterSec);
    eta = `${remainder}s`;
  }

  banner.textContent = `GST Portal is generating your files. Elapsed ${elapsedSec}s - retry ETA ${eta}. Files keep generating even if you close this window.`;
}

function startGenerationBanner(retryAfterSec) {
  const banner = getElement("banner-generating");
  if (!banner) return;

  genProgress.startedAt = Date.now();
  genProgress.retryAfterSec = retryAfterSec || null;
  banner.hidden = false;

  updateGenerationBanner();

  if (genProgress.timer) clearInterval(genProgress.timer);
  genProgress.timer = setInterval(updateGenerationBanner, 1000);
}

function stopGenerationBanner() {
  const banner = getElement("banner-generating");
  if (genProgress.timer) {
    clearInterval(genProgress.timer);
    genProgress.timer = null;
  }
  genProgress.startedAt = null;
  genProgress.retryAfterSec = null;
  if (banner) banner.hidden = true;
}

function showGenTime(e, d, t) {
  //"date":"29/05/2019","time":"11:59:54"
  const gt = moment(`${d} ${t}`, "DD/MM/YYYY HH:mm:ss");
  var a = document.createElement("a");
  a.setAttribute("data-toggle", "tooltip");
  a.setAttribute("title", `Generated on ${d} ${t}`);
  a.textContent = `Generated ${gt.fromNow()}`;

  e.textContent = "";
  e.appendChild(a);
}

function showEmbeddedWorkspaceMessage(message) {
  if (!isEmbeddedWorkspace()) return;
  const businessInfo = getElement("businessInfo");
  const workspace = getElement("workspace");
  const returnStatus = getElement("returnStatus");
  if (businessInfo) businessInfo.hidden = false;
  if (workspace) workspace.hidden = false;
  if (returnStatus) {
    returnStatus.innerHTML = `<div class="alert alert-warning py-2 mb-0" id="embedded-status-alert">${message}</div>`;
  }
}

function setBulkActionMessage(message, type) {
  const el = getElement("bulk-action-status");
  if (!el) return;
  if (!message) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = pill(message, type || "warning");
}

function describeUiError(error, fallbackText) {
  if (!error) return fallbackText || "Failed";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return fallbackText || "Failed";
}

function decodeBase64Utf8Text(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, "");
  if (!normalized || normalized.length < 8 || normalized.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  } catch (err) {
    return null;
  }
}

function isReadableDecodedMessage(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length < 4 || /^[\[{]/.test(text)) return false;
  const printable = text.replace(/[\r\n\t]/g, "");
  if (!printable) return false;
  const readableChars = printable.match(/[A-Za-z0-9 .,:;'"()\-_/&]/g);
  return !!readableChars && readableChars.length / printable.length > 0.85;
}

function createStructuredSkipPayload(period, message) {
  const reportPeriod = period && period.value ? period.value : "";
  const gstin = session && session.gstin ? session.gstin : "";
  return {
    status: message,
    msg: message,
    message,
    rtnprd: reportPeriod,
    gstin,
    __skipRecord: true,
    __skipMessage: message,
    data: {
      gstin,
      rtnprd: reportPeriod,
      status: message,
      msg: message,
      message,
    },
  };
}

function createStructuredSkipError(period, message) {
  const err = new Error(message || "Skipped");
  err.skipRecord = true;
  err.skipMessage = message || "Skipped";
  err.summaryPayload = createStructuredSkipPayload(period, err.skipMessage);
  return err;
}

function parseJsonOrBase64Message(text) {
  const rawText = typeof text === "string" ? text.trim() : "";
  try {
    return {
      payload: rawText ? JSON.parse(rawText) : null,
      decodedMessage: null,
    };
  } catch (jsonErr) {
    const decoded = decodeBase64Utf8Text(rawText);
    if (decoded && isReadableDecodedMessage(decoded)) {
      return {
        payload: null,
        decodedMessage: decoded.trim(),
      };
    }
    throw jsonErr;
  }
}

const showStatus = (msg) => {
  const divStatus = getElement("status");
  const divStatusText = getElement("statusText");
  const visible = !!msg;
  divStatus.hidden = !visible;
  divStatusText.textContent = msg || "";
  const embeddedAlertId = "embedded-status-alert";
  const embeddedExisting = getElement(embeddedAlertId);
  if (isEmbeddedWorkspace()) {
    const businessInfo = getElement("businessInfo");
    const workspace = getElement("workspace");
    const returnStatus = getElement("returnStatus");
    if (visible) {
      if (businessInfo) businessInfo.hidden = false;
      if (workspace) workspace.hidden = true;
      if (returnStatus) {
        const html = `<div class="alert alert-warning py-2 mb-0" id="${embeddedAlertId}">${msg}</div>`;
        if (embeddedExisting) {
          embeddedExisting.outerHTML = html;
        } else {
          returnStatus.innerHTML = html;
        }
      }
    } else if (embeddedExisting) {
      embeddedExisting.remove();
    }
  } else if (embeddedExisting) {
    embeddedExisting.remove();
  }
};

const getElement = (id) => document.getElementById(id);

const addActivity = (text, cls) => {
  const list = getElement("activityLog");
  if (!list) return;
  // remove placeholder
  if (list.children.length === 1 && list.children[0].classList.contains("text-muted")) {
    list.innerHTML = "";
  }
  const li = document.createElement("li");
  li.className = `activity-item ${cls || ""}`.trim();
  li.textContent = text;
  list.prepend(li);
};

const PREF_KEY = "gc-returns-pro-prefs";

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY)) || {};
  } catch (e) {
    return {};
  }
};

const savePrefs = (data) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(data));
  } catch (e) {
    /* ignore storage errors */
  }
};

const prefKeyForReturn = (cat) => `returnKey_${cat || "returns"}`;

function periodKey(val) {
  if (!val || val.length < 6) return null;
  const mm = parseInt(val.substring(0, 2));
  const yy = parseInt(val.substring(2));
  if (isNaN(mm) || isNaN(yy)) return null;
  return yy * 100 + mm; // YYYYMM for correct ordering
}

function financialYearFromPeriodValue(val) {
  if (!val || val.length < 6) return "";
  const mm = parseInt(val.substring(0, 2), 10);
  const yy = parseInt(val.substring(2, 6), 10);
  if (!Number.isFinite(mm) || !Number.isFinite(yy) || mm < 1 || mm > 12) return "";
  const startYear = mm >= 4 ? yy : yy - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function currentFinancialYearStart() {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

function makeFinancialYearLabel(fyStart) {
  return `${fyStart}-${String(fyStart + 1).slice(-2)}`;
}

function syntheticFyMonths(fyLabel) {
  const match = String(fyLabel || "").match(/^(\d{4})/);
  const fyStart = match ? parseInt(match[1], 10) : currentFinancialYearStart();
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const date = new Date(fyStart, 3 + offset, 1);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yy = String(date.getFullYear());
    months.push({ month: names[date.getMonth()], value: `${mm}${yy}` });
  }
  return months;
}

function buildFinancialYearDropdownFrom2016() {
  const years = [];
  for (let fy = currentFinancialYearStart(); fy >= 2016; fy -= 1) {
    const year = makeFinancialYearLabel(fy);
    years.push({ year, months: syntheticFyMonths(year) });
  }
  return { Years: years };
}

function pill(text, type) {
  const cls = type || "muted";
  return `<span class="pill ${cls}">${text}</span>`;
}

function getOtherResponseMessage(parsed, fallbackText) {
  if (!parsed) return fallbackText;
  const pickMessage = (value) => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const nested =
        value.message ||
        value.errMsg ||
        value.detailMessage ||
        value.error_message ||
        value.statusDesc ||
        value.statusdesc ||
        value.msg ||
        value.error;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
    return "";
  };
  const direct =
    parsed.error_message ||
    parsed.errMsg ||
    parsed.message ||
    parsed.msg ||
    parsed.error;
  const directMessage = pickMessage(direct);
  if (directMessage) return directMessage;
  if (parsed.data && typeof parsed.data === "object") {
    const nested =
      parsed.data.error_message ||
      parsed.data.errMsg ||
      parsed.data.message ||
      parsed.data.msg ||
      parsed.data.error ||
      parsed.data.statusDesc ||
      parsed.data.statusdesc;
    const nestedMessage = pickMessage(nested);
    if (nestedMessage) return nestedMessage;
  }
  return fallbackText;
}

function getImsOutDownloadUrl(parsed) {
  return (
    (parsed && parsed.data && Array.isArray(parsed.data.url) && parsed.data.url[0]) ||
    (parsed && parsed.data && typeof parsed.data.url === "string" && parsed.data.url) ||
    (parsed && Array.isArray(parsed.url) && parsed.url[0]) ||
    (parsed && typeof parsed.url === "string" && parsed.url) ||
    null
  );
}

async function saveRemoteFileWithName(url, filename, contentType) {
  const msg = await processAsync({ request: "getBlob", url });
  if (!msg || !msg.status || !msg.response) {
    throw new Error(msg && msg.statusCode ? `HTTP ${msg.statusCode}` : "Download failed");
  }
  downloadAs(msg.response, filename);
  return true;
}

const withParams = (base, entries) => {
  const url = new URL(base);
  entries.forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    url.searchParams.set(k, v);
  });
  return url.toString();
};

const gstn = {
  ustatus: "https://return.gst.gov.in/services/api/ustatus",
  dropdown: "https://return.gst.gov.in/returns/auth/api/dropdown",
  rolestatus: (p) =>
    withParams("https://return.gst.gov.in/returns/auth/api/rolestatus", [
      ["rtn_prd", p.value],
      ["userType", p.rt],
    ]),
  generateFile: (cfg, p, force) =>
    withParams(cfg.generateBase, [
      ["rtn_typ", cfg.apiCode],
      ["rtn_prd", p.value],
      ["flag", cfg.flag !== undefined ? cfg.flag : force ? "1" : "0"],
      // Only send file_type when present; matches HAR captures.
      ["file_type", cfg.fileType || null],
    ]),
  downloadFile: (cfg, p, fileNo) =>
    withParams(cfg.downloadBase, [
      ["rtn_typ", cfg.apiCode],
      ["rtn_prd", p.value],
      ["file_num", fileNo],
      ["file_type", cfg.fileType],
    ]),
  gstr3bSummary: (p) =>
    withParams(
      "https://return.gst.gov.in/returns/auth/api/gstr3b/summary",
      [["rtn_prd", p.value]],
    ),
  gstr3bPayable: (p) =>
    withParams(
      "https://return.gst.gov.in/returns/auth/api/gstr3b/taxpayble",
      [["rtn_prd", p.value]],
    ),
  annualrolestatus: (fy) =>
    withParams(
      "https://return.gst.gov.in/returns2/auth/api/annualrolestatus",
      [["return_prd", `03${fy + 1}`]],
    ),
  annualDropdown: () =>
    withParams("https://return.gst.gov.in/returns/auth/api/dropdown", [
      ["annualRtnFlg", "true"],
    ]),
};

const reportButtonClicked = () => {}; // noop placeholder

// ── Sanitize a string to be safe as a folder/file name component ──
function sanitizeFolderName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")  // replace Windows-unsafe chars
    .replace(/\s+/g, "_")           // spaces → underscores
    .replace(/_+/g, "_")            // collapse consecutive underscores
    .replace(/^_|_$/g, "")         // trim leading/trailing underscores
    .slice(0, 60) || "Client";     // max 60 chars, never empty
}

// ── Core download function: prepends client folder when enabled ──
const downloadAs = (url, filename) => {
  const prefs = loadPrefs();
  let finalName = filename;
  if (prefs.useClientFolder) {
    const clientName = sanitizeFolderName(
      session.selectedClientName || session.businessName || ""
    );
    if (clientName) {
      finalName = `NEO-GST/${clientName}/${filename}`;
    }
  }
  const dlPromise = browser.downloads.download({ url, filename: finalName });
  // Notify background to show a notification when this download completes
  dlPromise && dlPromise.then && dlPromise.then((downloadId) => {
    if (typeof downloadId === "number") {
      browser.runtime.sendMessage({
        type: "gc-returns-pro-download-started",
        downloadId,
        filename: finalName.split("/").pop(),
      }).catch(() => {});
    }
  }).catch(() => {});
  return dlPromise;
};
async function downloadBlobAs(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await downloadAs(blobUrl, filename);
  } finally {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        // ignore revoke issues
      }
    }, 2000);
  }
}

function releaseLargeArray(items) {
  if (!Array.isArray(items)) return;
  for (let i = 0; i < items.length; i++) items[i] = null;
  items.length = 0;
}
const saveBlobUrl = (fileName, url) => downloadAs(url, fileName);
const isGstr1Return = (cfg) => cfg && cfg.apiCode === "GSTR1";
const isGstr2aReturn = (cfg) => cfg && cfg.apiCode === "GSTR2A";
const isGstr2bReturn = (cfg) => cfg && cfg.apiCode === "GSTR2B";
const isGstr3bReturn = (cfg) => cfg && cfg.apiCode === "GSTR3B";
const isStructuredJsonExcelReturn = (cfg) => isGstr1Return(cfg) || isGstr2aReturn(cfg) || isGstr2bReturn(cfg);
const supportsExcelDownloadReturn = (cfg) => isStructuredJsonExcelReturn(cfg) || isGstr3bReturn(cfg);
const isGeneratedStructuredReturn = (cfg) => isGstr1Return(cfg) || isGstr2aReturn(cfg);

function saveJsonAsZipAsync(jsonfilename, zipfilename, jsonData) {
  return processAsync({
    request: "save-json-as-zip",
    jsonfilename: jsonfilename,
    zipfilename: zipfilename,
    jsonData: jsonData,
  });
}

const formatNumber = (num, length) => String(num).padStart(length, "0");

const makeJsonFileName = (type, gstin, period) => {
  const d = new Date();
  return `returns_${formatNumber(d.getDate(), 2)}${formatNumber(
    d.getMonth() + 1,
    2,
  )}${d.getFullYear()}_${type}_${gstin}_${period}`;
};

const makeZipFileName = (type, gstin, period, tag) => {
  const d = new Date();
  return `${gstin}_${type}${tag ? `_${tag}` : ""}_${period}_${d.getFullYear()}${formatNumber(
    d.getMonth() + 1,
    2,
  )}${formatNumber(d.getDate(), 2)}`;
};

function extractFailureText(msg, fallbackText) {
  if (msg && msg.error) return msg.error;
  if (msg && msg.response) {
    try {
      const parsed = JSON.parse(msg.response);
      if (parsed && parsed.error) {
        if (typeof parsed.error === "string") return parsed.error;
        if (parsed.error.message) return parsed.error.message;
        if (parsed.error.detailMessage) return parsed.error.detailMessage;
      }
      if (parsed && parsed.message) return parsed.message;
    } catch (e) {
      // ignore parse issues
    }
  }
  if (msg && msg.statusCode) return `${fallbackText} (HTTP ${msg.statusCode})`;
  return fallbackText;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripInvalidXmlChars(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/g, "");
}

function escapeXml(value) {
  return stripInvalidXmlChars(String(value == null ? "" : value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeWorksheetName(name) {
  return String(name || "Sheet")
    .replace(/[\\/*?:[\]]/g, " ")
    .trim()
    .substring(0, 31) || "Sheet";
}

const MAX_WORKSHEET_ROWS = 60000;
const XLSX_MAX_WORKSHEET_DATA_ROWS = 1048575; // Excel row limit (1,048,576) minus header row.
const XLSX_BATCH_WRITE_ROWS = 2000;
const GSTR1_DEFAULT_LIGHTWEIGHT_MODE = true;
const GSTR1_BULK_CONCURRENCY = 4;
const GSTR1_SHEET_CHUNK_THRESHOLD = 10000;
const GSTR1_SHEET_CHUNK_THRESHOLD_MIN = 3000;
const GSTR1_SHEET_CHUNK_THRESHOLD_MAX = 15000;
const GSTR1_SECTION_FILTER_STORAGE_KEY = "gc-returns-pro-gstr1-section-filter";

function buildWorksheetChunkName(baseName, chunkIndex) {
  const suffix = chunkIndex > 0 ? `(${chunkIndex})` : "";
  const safeBase = sanitizeWorksheetName(baseName || "Sheet");
  if (!suffix) return safeBase;
  const trimmedBase = safeBase.substring(0, Math.max(1, 31 - suffix.length));
  return sanitizeWorksheetName(`${trimmedBase}${suffix}`);
}

function sanitizeExportFileSegment(value) {
  return String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "") || "export";
}

function makeNamedRangeExportFileName(cfg, fromStr, toStr, ext) {
  const name = sanitizeExportFileSegment(
    (cfg && (cfg.display || cfg.label || cfg.key)) || "export",
  );
  const gstin = sanitizeExportFileSegment(session.gstin || "GSTIN");
  const fromPart = sanitizeExportFileSegment(fromStr || "from");
  const toPart = sanitizeExportFileSegment(toStr || "to");
  return `${name}_${gstin}_${fromPart}_${toPart}.${ext}`;
}

function flattenObjectToRows(obj, prefix, rows) {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => flattenObjectToRows(item, `${prefix}[${index}]`, rows));
    return;
  }
  if (typeof obj === "object") {
    Object.keys(obj).forEach((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenObjectToRows(obj[key], nextPrefix, rows);
    });
    return;
  }
  rows.push({ field: prefix, value: obj });
}

function buildPivotedItcSummaryRows(itcSummary, includePeriod, reportPeriod) {
  const flattenedRows = [];
  const grouped = new Map();
  const supportedTaxes = new Set(["txval", "igst", "cgst", "sgst", "cess"]);

  flattenObjectToRows(itcSummary || {}, "", flattenedRows);

  flattenedRows.forEach((row) => {
    const parts = String(row.field || "").split(".").filter(Boolean);
    if (!parts.length) return;

    const taxType = parts[parts.length - 1];
    if (!supportedTaxes.has(taxType)) return;

    const numericValue = Number(row.value || 0);
    if (!Number.isFinite(numericValue)) return;

    let groupingKey = "";
    let type = "total";

    if (parts.length >= 4) {
      groupingKey = parts.slice(0, 2).join(".");
      type = parts[2];
    } else if (parts.length === 3) {
      groupingKey = parts.slice(0, 2).join(".");
      type = "total";
    } else if (parts.length === 2) {
      groupingKey = parts[0];
      type = "total";
    } else {
      groupingKey = parts[0];
    }

    const mapKey = `${includePeriod ? `${reportPeriod}||` : ""}${groupingKey}||${type}`;
    if (!grouped.has(mapKey)) {
      grouped.set(mapKey, {
        ...(includePeriod ? { report_period: reportPeriod } : {}),
        itc_group: groupingKey,
        type,
        txval: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0,
      });
    }
    grouped.get(mapKey)[taxType] += numericValue;
  });

  return Array.from(grouped.values());
}

function buildRawFlattenedRows(payload, includePeriod, reportPeriod) {
  const rows = [];
  flattenObjectToRows(payload || {}, "", rows);
  return rows.map((row) => ({
    ...(includePeriod ? { report_period: reportPeriod } : {}),
    field: row.field,
    value: row.value,
  }));
}

function buildRawJsonRows(payload, includePeriod, reportPeriod) {
  const jsonText = JSON.stringify(payload || {});
  const chunkSize = 30000;
  const rows = [];
  for (let i = 0; i < jsonText.length; i += chunkSize) {
    rows.push({
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      chunk_no: Math.floor(i / chunkSize) + 1,
      json_chunk: jsonText.substring(i, i + chunkSize),
    });
  }
  if (!rows.length) {
    rows.push({
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      chunk_no: 1,
      json_chunk: "",
    });
  }
  return rows;
}

function inferSpreadsheetType(value) {
  return typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
}

const GSTR1_COLUMN_LABELS = {
  report_period: "Report Period",
  hsn_number: "HSN Number",
  row_no: "Row Number",
  ctin: "Counterparty GSTIN",
  cfs: "Counterparty Filing Status",
  inv_val: "Invoice Value",
  inv_itms_num: "Invoice Items Count",
  inv_itms_itm_det_csamt: "Invoice Item Cess Amount",
  inv_itms_itm_det_samt: "Invoice Item State/UT Tax Amount",
  inv_itms_itm_det_rt: "Invoice Item Tax Rate",
  inv_itms_itm_det_txval: "Invoice Item Taxable Value",
  inv_itms_itm_det_camt: "Invoice Item Central Tax Amount",
  inv_itms_itm_det_iamt: "Invoice Item Integrated Tax Amount",
  inv_flag: "Invoice Flag",
  inv_irn: "Invoice Reference Number",
  inv_updby: "Invoice Updated By",
  inv_irngendate: "Invoice IRN Generation Date",
  inv_inum: "Invoice Number",
  inv_cflag: "Invoice Counterparty Flag",
  inv_inv_typ: "Invoice Type",
  inv_pos: "Invoice Place of Supply",
  inv_srctyp: "Invoice Source Type",
  inv_idt: "Invoice Date",
  inv_rchrg: "Invoice Reverse Charge",
  inv_chksum: "Invoice Checksum",
  nt_val: "Note Value",
  nt_itms_num: "Note Items Count",
  nt_itms_itm_det_csamt: "Note Item Cess Amount",
  nt_itms_itm_det_samt: "Note Item State/UT Tax Amount",
  nt_itms_itm_det_rt: "Note Item Tax Rate",
  nt_itms_itm_det_txval: "Note Item Taxable Value",
  nt_itms_itm_det_camt: "Note Item Central Tax Amount",
  nt_itms_itm_det_iamt: "Note Item Integrated Tax Amount",
  nt_flag: "Note Flag",
  nt_irn: "Note IRN",
  nt_updby: "Note Updated By",
  nt_d_flag: "Note Deletion Flag",
  nt_nt_num: "Note Number",
  nt_irngendate: "Note IRN Generation Date",
  nt_cflag: "Note Counterparty Flag",
  nt_nt_dt: "Note Date",
  nt_inv_typ: "Note Invoice Type",
  nt_pos: "Note Place of Supply",
  nt_srctyp: "Note Source Type",
  nt_ntty: "Note Type",
  nt_rchrg: "Note Reverse Charge",
  nt_chksum: "Note Checksum",
  flag: "Flag",
  data_csamt: "Data Cess Amount",
  data_samt: "Data State/UT Tax Amount",
  data_rt: "Data Tax Rate",
  data_uqc: "Data Unit Quantity Code",
  data_txval: "Data Taxable Value",
  data_qty: "Data Quantity",
  data_num: "Data Serial Number",
  data_camt: "Data Central Tax Amount",
  data_hsn_sc: "Data HSN/SAC Code",
  data_iamt: "Data Integrated Tax Amount",
  data_desc: "Data Description",
  chksum: "Checksum",
  hsn_b2b_csamt: "HSN B2B Cess Amount",
  hsn_b2b_samt: "HSN B2B State/UT Tax Amount",
  hsn_b2b_rt: "HSN B2B Tax Rate",
  hsn_b2b_uqc: "HSN B2B Unit Quantity Code",
  hsn_b2b_num: "HSN B2B Serial Number",
  hsn_b2b_qty: "HSN B2B Quantity",
  hsn_b2b_txval: "HSN B2B Taxable Value",
  hsn_b2b_camt: "HSN B2B Central Tax Amount",
  hsn_b2b_hsn_sc: "HSN B2B HSN/SAC Code",
  hsn_b2b_iamt: "HSN B2B Integrated Tax Amount",
  hsn_b2b_desc: "HSN B2B Description",
  hsn_b2c_csamt: "HSN B2C Cess Amount",
  hsn_b2c_samt: "HSN B2C State/UT Tax Amount",
  hsn_b2c_rt: "HSN B2C Tax Rate",
  hsn_b2c_uqc: "HSN B2C Unit Quantity Code",
  hsn_b2c_num: "HSN B2C Serial Number",
  hsn_b2c_qty: "HSN B2C Quantity",
  hsn_b2c_txval: "HSN B2C Taxable Value",
  hsn_b2c_camt: "HSN B2C Central Tax Amount",
  hsn_b2c_hsn_sc: "HSN B2C HSN/SAC Code",
  hsn_b2c_iamt: "HSN B2C Integrated Tax Amount",
  hsn_b2c_desc: "HSN B2C Description",
  hsn_b2c: "HSN B2C",
  doc_d: "Doc D",
  doc_det_docs_num: "Doc Det Docs Num",
  docs_num: "Docs Num",
  doc_det_docs_totnum: "Doc Det Docs Totnum",
  docs_totnum: "Docs Totnum",
  doc_det_docs_from: "Doc Det Docs From",
  docs_from: "Docs From",
  doc_det_docs_to: "Doc Det Docs To",
  docs_to: "Docs To",
  doc_det_docs_net_issue: "Doc Det Docs Net Issue",
  docs_net_issue: "Docs Net Issue",
  doc_det_doc_num: "Doc Det Doc Num",
  doc_num: "Doc Num",
};

const SCHEMA_STORAGE_KEY = "gc-returns-pro-schema-store-v1";
const SCHEMA_GITHUB_CONFIG_SRC = "ui/github-config.json";
const SCHEMA_GITHUB_CONFIG_FALLBACK_SRC = "ui/github-config.example.json";
const SCHEMA_DATASET_FORMAT = "gc-returns-pro-client-store";
const SCHEMA_DATASET_FORMAT_VERSION = 2;
const SCHEMA_RETURN_TYPES = [
  { code: "GSTR1", label: "GSTR-1" },
  { code: "GSTR2A", label: "GSTR-2A" },
  { code: "GSTR2B", label: "GSTR-2B" },
  { code: "GSTR3B", label: "GSTR-3B" },
  { code: "GENERIC", label: "Generic" },
];

function getDefaultSchemaLabel(column) {
  return String(column || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeSchemaReturnType(returnType) {
  const value = String(returnType || "GENERIC").trim().toUpperCase();
  return SCHEMA_RETURN_TYPES.some((item) => item.code === value) ? value : "GENERIC";
}

function normalizeSchemaStore(raw) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const store = { returns: {} };
  const returns = parsed.returns && typeof parsed.returns === "object" ? parsed.returns : {};
  Object.keys(returns).forEach((returnType) => {
    const normalizedReturnType = normalizeSchemaReturnType(returnType);
    const bucket = returns[returnType] && typeof returns[returnType] === "object" ? returns[returnType] : {};
    store.returns[normalizedReturnType] = {};
    Object.keys(bucket).forEach((key) => {
      const normalizedKey = normalizeSpreadsheetColumnKey(key);
      if (!normalizedKey) return;
      const entry = bucket[key] && typeof bucket[key] === "object" ? bucket[key] : {};
      const label = String(entry.label || getDefaultSchemaLabel(normalizedKey)).trim();
      const abbreviation = String(entry.abbreviation || label).trim() || label;
      store.returns[normalizedReturnType][normalizedKey] = {
        key: normalizedKey,
        label,
        abbreviation,
        updatedAt: String(entry.updatedAt || ""),
      };
    });
  });
  return store;
}

function getSchemaDatasetBody(dataset) {
  if (!dataset || typeof dataset !== "object") return {};
  if (dataset.format === SCHEMA_DATASET_FORMAT && dataset.data && typeof dataset.data === "object") {
    return dataset.data;
  }
  if (dataset.data && typeof dataset.data === "object" && Array.isArray(dataset.data.clients)) {
    return dataset.data;
  }
  return dataset;
}

function buildSchemaDatasetEnvelope(dataset) {
  const source = getSchemaDatasetBody(dataset);
  const body = {
    version: 1,
    updatedAt: String(source.updatedAt || "").trim(),
    clients: Array.isArray(source.clients) ? source.clients : [],
    returnStatuses: Array.isArray(source.returnStatuses) ? source.returnStatuses : [],
    schemaStore: source.schemaStore && typeof source.schemaStore === "object" ? source.schemaStore : { returns: {} },
  };
  body.returnStatuses = Array.isArray(body.returnStatuses)
    ? body.returnStatuses
        .map((entry, index) => ({
          id: String(entry && entry.id || `status-${index + 1}`).trim(),
          gstin: String(entry && entry.gstin || "").trim().toUpperCase(),
        }))
        .filter((entry) => entry.id && entry.gstin)
    : [];
  body.updatedAt = new Date().toISOString();
  return {
    format: SCHEMA_DATASET_FORMAT,
    version: SCHEMA_DATASET_FORMAT_VERSION,
    updatedAt: body.updatedAt,
    source: "github",
    data: body,
  };
}

function loadSchemaStore() {
  try {
    const raw = localStorage.getItem(SCHEMA_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && parsed.returns && typeof parsed.returns === "object") {
      return normalizeSchemaStore(parsed);
    }
  } catch (e) {}
  return normalizeSchemaStore(null);
}

function saveSchemaStore(store) {
  const normalized = normalizeSchemaStore(store);
  localStorage.setItem(SCHEMA_STORAGE_KEY, JSON.stringify(normalized));
  scheduleSchemaStoreRemoteSave(normalized);
}

function ensureSchemaBucket(store, returnType) {
  const nextStore = store && typeof store === "object" ? store : { returns: {} };
  if (!nextStore.returns || typeof nextStore.returns !== "object") nextStore.returns = {};
  const normalizedReturnType = normalizeSchemaReturnType(returnType);
  if (!nextStore.returns[normalizedReturnType] || typeof nextStore.returns[normalizedReturnType] !== "object") {
    nextStore.returns[normalizedReturnType] = {};
  }
  return nextStore.returns[normalizedReturnType];
}

function getSchemaLabel(returnType, column) {
  const normalizedColumn = normalizeSpreadsheetColumnKey(column);
  if (!normalizedColumn) return "";
  const store = loadSchemaStore();
  const primaryReturnType = normalizeSchemaReturnType(returnType);
  const primaryBucket = ensureSchemaBucket(store, primaryReturnType);
  const primaryEntry = primaryBucket[normalizedColumn];
  if (primaryEntry && primaryEntry.abbreviation) return String(primaryEntry.abbreviation).trim();
  if (primaryEntry && primaryEntry.label) return String(primaryEntry.label).trim();
  const fallbackReturnTypes = Object.keys(store.returns || {}).filter((key) => key !== primaryReturnType);
  for (let index = 0; index < fallbackReturnTypes.length; index += 1) {
    const bucket = ensureSchemaBucket(store, fallbackReturnTypes[index]);
    const entry = bucket[normalizedColumn];
    if (entry && entry.abbreviation) return String(entry.abbreviation).trim();
    if (entry && entry.label) return String(entry.label).trim();
  }
  return "";
}

function upsertSchemaEntry(store, returnType, column, label, abbreviation) {
  const normalizedColumn = normalizeSpreadsheetColumnKey(column);
  if (!normalizedColumn) return false;
  const bucket = ensureSchemaBucket(store, returnType);
  const nextLabel = String(label || "").trim() || getDefaultSchemaLabel(normalizedColumn);
  const nextAbbreviation = String(abbreviation || "").trim() || nextLabel;
  const existing = bucket[normalizedColumn] || {};
  const changed =
    existing.label !== nextLabel ||
    existing.abbreviation !== nextAbbreviation ||
    existing.key !== normalizedColumn;
  bucket[normalizedColumn] = {
    key: normalizedColumn,
    label: nextLabel,
    abbreviation: nextAbbreviation,
    updatedAt: new Date().toISOString(),
  };
  return changed;
}

function ensureSchemaColumns(returnType, columns, labelMap) {
  const normalizedReturnType = normalizeSchemaReturnType(returnType);
  const uniqueColumns = Array.from(
    new Set((columns || []).map((column) => normalizeSpreadsheetColumnKey(column)).filter(Boolean)),
  );
  if (!uniqueColumns.length) return;
  const store = loadSchemaStore();
  let changed = false;
  uniqueColumns.forEach((column) => {
    const fallbackLabel =
      labelMap && Object.prototype.hasOwnProperty.call(labelMap, column)
        ? labelMap[column]
        : getDefaultSchemaLabel(column);
    changed = upsertSchemaEntry(store, normalizedReturnType, column, fallbackLabel, fallbackLabel) || changed;
  });
  if (changed) saveSchemaStore(store);
}

function ensureSchemaForSections(returnType, sections, labelMap) {
  const columns = [];
  (sections || []).forEach((section) => {
    (section && section.rows ? section.rows : []).forEach((row) => {
      Object.keys(row || {}).forEach((key) => columns.push(key));
    });
  });
  ensureSchemaColumns(returnType, columns, labelMap);
}

function buildSchemaRows(returnType) {
  const normalizedReturnType = normalizeSchemaReturnType(returnType);
  const store = loadSchemaStore();
  const bucket = ensureSchemaBucket(store, normalizedReturnType);
  return Object.keys(bucket)
    .sort((a, b) => a.localeCompare(b))
    .map((key, index) => ({
      row_no: index + 1,
      return_type: normalizedReturnType,
      key,
      label: bucket[key] && bucket[key].label ? bucket[key].label : getDefaultSchemaLabel(key),
      abbreviation:
        bucket[key] && bucket[key].abbreviation
          ? bucket[key].abbreviation
          : (bucket[key] && bucket[key].label ? bucket[key].label : getDefaultSchemaLabel(key)),
      updated_at: bucket[key] && bucket[key].updatedAt ? bucket[key].updatedAt : "",
    }));
}

function parseSchemaTextRows(text, selectedReturnType) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines.some((line) => line.includes("\t"))
    ? "\t"
    : lines.some((line) => line.includes("|"))
      ? "|"
      : ",";
  const rawRows = lines.map((line) => line.split(delimiter).map((cell) => String(cell || "").trim()));
  const header = rawRows[0].map((cell) => {
    const normalized = normalizeSpreadsheetColumnKey(cell);
    if (normalized === "abbrevation" || normalized === "abbrev" || normalized === "abbr") {
      return "abbreviation";
    }
    return normalized;
  });
  const hasHeader =
    header.includes("key") ||
    header.includes("label") ||
    header.includes("abbreviation") ||
    header.includes("return_type") ||
    header.includes("return");
  const rows = hasHeader ? rawRows.slice(1) : rawRows;
  return rows
    .map((cells) => {
      if (hasHeader) {
        const payload = {};
        header.forEach((name, index) => {
          payload[name] = cells[index] || "";
        });
        return {
          returnType: payload.return_type || payload.return || selectedReturnType,
          key: payload.key || payload.field || "",
          label: payload.label || payload.abbreviation || payload.value || "",
          abbreviation: payload.abbreviation || payload.label || payload.value || "",
        };
      }
      return {
        returnType: selectedReturnType,
        key: cells[0] || "",
        label: cells[1] || "",
        abbreviation: cells[1] || "",
      };
    })
    .filter((row) => row.key);
}

function importSchemaRows(rows) {
  const store = loadSchemaStore();
  let changed = false;
  (rows || []).forEach((row) => {
    changed = upsertSchemaEntry(store, row.returnType, row.key, row.label, row.abbreviation) || changed;
  });
  if (changed) saveSchemaStore(store);
  return changed;
}

function encodeBase64Utf8(value) {
  return btoa(unescape(encodeURIComponent(String(value == null ? "" : value))));
}

function decodeBase64Utf8(value) {
  return decodeURIComponent(escape(atob(String(value || ""))));
}

async function fetchSchemaGithubConfig() {
  let config = null;
  let source = SCHEMA_GITHUB_CONFIG_SRC;
  let primaryStatus = 0;
  const primary = await fetch(SCHEMA_GITHUB_CONFIG_SRC, { cache: "no-store" });
  if (primary.ok) {
    config = await primary.json();
  } else {
    primaryStatus = primary.status;
    const fallback = await fetch(SCHEMA_GITHUB_CONFIG_FALLBACK_SRC, { cache: "no-store" });
    if (!fallback.ok) {
      throw new Error(
        `Unable to load GitHub config (${primaryStatus || "n/a"}). Also failed fallback config (${fallback.status}).`,
      );
    }
    config = await fallback.json();
    source = SCHEMA_GITHUB_CONFIG_FALLBACK_SRC;
  }
  const normalized = {
    token: String(config && config.token || "").trim(),
    owner: String(config && config.owner || "").trim(),
    repo: String(config && config.repo || "").trim(),
    path: String(config && config.path || "").trim(),
    branch: String(config && config.branch || "main").trim() || "main",
  };
  if (!normalized.token || !normalized.owner || !normalized.repo || !normalized.path) {
    throw new Error(`GitHub config in ${source} must include token, owner, repo, and path.`);
  }
  return normalized;
}

async function schemaGithubRequest(config, path, options) {
  const request = options || {};
  const response = await fetch(`https://api.github.com${path}`, {
    method: request.method || "GET",
    headers: Object.assign(
      {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      request.headers || {},
    ),
    body: request.body || undefined,
  });
  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch (err) {
    parsed = null;
  }
  if (!response.ok) {
    const error = new Error((parsed && (parsed.message || parsed.error)) || bodyText || `GitHub API failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

function isSchemaGithubNotFoundError(error) {
  return !!(error && (error.status === 404 || /\bnot found\b/i.test(error.message || "")));
}

async function ensureSchemaGithubBranch(config) {
  const branch = String(config && config.branch || "main").trim() || "main";
  try {
    await schemaGithubRequest(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return false;
  } catch (error) {
    if (!isSchemaGithubNotFoundError(error)) throw error;
  }
  const repo = await schemaGithubRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
  );
  const defaultBranch = String(repo && repo.default_branch || "main").trim() || "main";
  const defaultRef = await schemaGithubRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
  );
  const sha = String(defaultRef && defaultRef.object && defaultRef.object.sha || "").trim();
  if (!sha) throw new Error(`Unable to find base SHA for ${defaultBranch}.`);
  await schemaGithubRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/refs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha,
      }),
    },
  );
  return true;
}

async function fetchSchemaRemoteFileState(config) {
  await ensureSchemaGithubBranch(config);
  const encodedPath = config.path.split("/").map((part) => encodeURIComponent(part)).join("/");
  let json = null;
  try {
    json = await schemaGithubRequest(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`,
    );
  } catch (error) {
    if (isSchemaGithubNotFoundError(error)) {
      return { sha: "", content: "", missing: true };
    }
    throw error;
  }
  return {
    sha: String(json && json.sha || "").trim(),
    content: decodeBase64Utf8(String(json && json.content || "").replace(/\s+/g, "")),
  };
}

async function loadSchemaStoreFromGithub() {
  const config = await fetchSchemaGithubConfig();
  const remote = await fetchSchemaRemoteFileState(config);
  let dataset = null;
  try {
    dataset = remote.content ? JSON.parse(remote.content) : null;
  } catch (err) {
    dataset = null;
  }
  const store = normalizeSchemaStore(getSchemaDatasetBody(dataset).schemaStore);
  schemaState.remoteMeta = {
    config,
    sha: remote.sha,
  };
  return remote.missing ? normalizeSchemaStore(null) : store;
}

async function writeSchemaStoreToGithub(store) {
  const meta = schemaState.remoteMeta || { config: await fetchSchemaGithubConfig(), sha: "" };
  const config = meta.config;
  const current = await fetchSchemaRemoteFileState(config);
  let dataset = null;
  try {
    dataset = current.content ? JSON.parse(current.content) : null;
  } catch (err) {
    dataset = null;
  }
  const nextDataset = buildSchemaDatasetEnvelope(dataset);
  nextDataset.data.schemaStore = normalizeSchemaStore(store);
  nextDataset.data.updatedAt = new Date().toISOString();
  nextDataset.updatedAt = nextDataset.data.updatedAt;
  const encodedPath = config.path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const body = {
    message: `${current.missing ? "Create" : "Update"} schema store in ${config.path} from GC Returns Pro`,
    content: encodeBase64Utf8(JSON.stringify(nextDataset, null, 2)),
    branch: config.branch,
  };
  const sha = current.sha || meta.sha || "";
  if (sha) body.sha = sha;
  const response = await schemaGithubRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  schemaState.remoteMeta = {
    config,
    sha: String(response && response.content && response.content.sha || current.sha || meta.sha || "").trim(),
  };
}

function scheduleSchemaStoreRemoteSave(store) {
  if (schemaState.remoteSaveTimer) {
    clearTimeout(schemaState.remoteSaveTimer);
  }
  schemaState.remoteSaveTimer = setTimeout(async () => {
    try {
      await writeSchemaStoreToGithub(store);
      setSchemaStatus("Schema changes saved and synced to GitHub.");
    } catch (err) {
      setSchemaStatus(err && err.message ? err.message : "Schema saved locally, but GitHub sync failed.");
    }
  }, 700);
}

async function ensureSchemaStoreLoaded() {
  if (schemaState.remoteLoaded || schemaState.remoteLoading) return;
  schemaState.remoteLoading = true;
  try {
    const remoteStore = await loadSchemaStoreFromGithub();
    localStorage.setItem(SCHEMA_STORAGE_KEY, JSON.stringify(remoteStore));
    schemaState.remoteLoaded = true;
    renderSchemaTable();
    setSchemaStatus("Schema loaded from GitHub.");
  } catch (err) {
    schemaState.remoteLoaded = true;
    setSchemaStatus(err && err.message ? `${err.message} Using local schema.` : "Using local schema.");
  } finally {
    schemaState.remoteLoading = false;
  }
}

function normalizeSpreadsheetColumnKey(column) {
  return String(column || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toSpreadsheetHeaderLabel(column, options) {
  const normalized = normalizeSpreadsheetColumnKey(column);
  const schemaLabel =
    options && options.schemaReturnType ? getSchemaLabel(options.schemaReturnType, normalized) : "";
  if (schemaLabel) {
    return schemaLabel;
  }
  const labelMap = (options && options.headerLabelMap) || null;
  if (labelMap && Object.prototype.hasOwnProperty.call(labelMap, normalized)) {
    return labelMap[normalized];
  }
  return getDefaultSchemaLabel(column);
}

function inferSpreadsheetStyle(value, column, rowIndex, options) {
  if (options && typeof options.styleResolver === "function") {
    return options.styleResolver(value, column, rowIndex, options);
  }
  const isNumeric = typeof value === "number" && Number.isFinite(value);
  if (options && options.stripedRows) {
    if (isNumeric) return rowIndex % 2 === 0 ? "NumberCell" : "NumberCellAlt";
    return rowIndex % 2 === 0 ? "Cell" : "CellAlt";
  }
  return isNumeric ? "NumberCell" : "Cell";
}

function inferGstr2aSpreadsheetStyle(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? "Integer" : "Decimal";
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return "DateText";
    }
  }
  return "Cell";
}

function inferSpreadsheetColumnWidth(column, rows, options) {
  const base = toSpreadsheetHeaderLabel(column, options);
  let maxLength = base.length;
  (rows || []).slice(0, 50).forEach((row) => {
    const value = row && Object.prototype.hasOwnProperty.call(row, column) ? row[column] : "";
    const text = value == null ? "" : String(value);
    if (text.length > maxLength) maxLength = text.length;
  });
  return Math.max(70, Math.min(220, maxLength * 7));
}

function buildSingleSpreadsheetWorksheet(name, rows, preferredColumns, options) {
  const safeName = buildWorksheetChunkName(name, 0);
  const hasRows = Array.isArray(rows) && rows.length > 0;
  const hidden = !!(options && options.hidden);
  const freezeHeader = !hidden && !(options && options.freezeHeader === false);
  const autoFilter = !hidden && !!(options && options.autoFilter);
  const inferredColumns = hasRows
    ? Array.from(
        rows.reduce((set, row) => {
          Object.keys(row || {}).forEach((key) => set.add(key));
          return set;
        }, new Set()),
      )
    : ["Info"];
  const columns =
    preferredColumns && preferredColumns.length
      ? preferredColumns.concat(
          inferredColumns.filter((column) => !preferredColumns.includes(column)),
        )
      : inferredColumns;
  const columnXml = columns
    .map((column) => `<Column ss:AutoFitWidth="0" ss:Width="${inferSpreadsheetColumnWidth(column, rows, options)}"/>`)
    .join("");
  const headerXml = columns
    .map(
      (column) =>
        `<Cell ss:StyleID="${(options && options.headerStyleId) || "Header"}"><Data ss:Type="String">${escapeXml(toSpreadsheetHeaderLabel(column, options))}</Data></Cell>`,
    )
    .join("");
  const bodyXml = (hasRows ? rows : [{ Info: "No data" }])
    .map((row, rowIndex) => {
      const cells = columns
        .map((column) => {
          const value = row && Object.prototype.hasOwnProperty.call(row, column) ? row[column] : "";
          const styleId = inferSpreadsheetStyle(value, column, rowIndex, options);
          const styleAttr = styleId ? ` ss:StyleID="${styleId}"` : "";
          return `<Cell${styleAttr}><Data ss:Type="${inferSpreadsheetType(value)}">${escapeXml(
            value == null ? "" : value,
          )}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");
  const autoFilterXml = autoFilter
    ? `<AutoFilter x:Range="R1C1:R${Math.max((rows || []).length + 1, 2)}C${Math.max(columns.length, 1)}" xmlns="urn:schemas-microsoft-com:office:excel"/>`
    : "";
  const worksheetOptionsXml = hidden
    ? '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Visible>SheetHidden</Visible></WorksheetOptions>'
    : freezeHeader
      ? '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>'
      : "";
  return `<Worksheet ss:Name="${escapeXml(safeName)}"><Table>${columnXml}<Row>${headerXml}</Row>${bodyXml}</Table>${autoFilterXml}${worksheetOptionsXml}</Worksheet>`;
}

function buildSpreadsheetWorksheet(name, rows, preferredColumns, options) {
  const allRows = Array.isArray(rows) ? rows : [];
  const shouldChunk = !((options && options.hidden) || false) && allRows.length > MAX_WORKSHEET_ROWS;
  if (!shouldChunk) {
    return buildSingleSpreadsheetWorksheet(name, rows, preferredColumns, options);
  }

  const parts = [];
  for (let index = 0; index < allRows.length; index += MAX_WORKSHEET_ROWS) {
    const chunkRows = allRows.slice(index, index + MAX_WORKSHEET_ROWS);
    const chunkName = buildWorksheetChunkName(name, Math.floor(index / MAX_WORKSHEET_ROWS));
    parts.push(buildSingleSpreadsheetWorksheet(chunkName, chunkRows, preferredColumns, options));
  }
  return parts.join("");
}

function getSpreadsheetColumns(rows, preferredColumns) {
  const inferredColumns = Array.isArray(rows) && rows.length
    ? Array.from(
        rows.reduce((set, row) => {
          Object.keys(row || {}).forEach((key) => set.add(key));
          return set;
        }, new Set()),
      )
    : ["Info"];
  return preferredColumns && preferredColumns.length
    ? preferredColumns.concat(inferredColumns.filter((column) => !preferredColumns.includes(column)))
    : inferredColumns;
}

function excelColumnName(index) {
  let value = Number(index) + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function buildXlsxWorksheetXml(rows, columns, options) {
  const allRows = [];
  const customHeaderRows = Array.isArray(options && options.customHeaderRows)
    ? options.customHeaderRows
    : [];
  const skipDefaultHeader = !!(options && options.skipDefaultHeader);
  if (customHeaderRows.length) {
    customHeaderRows.forEach((row) => {
      const rowValues = Array.isArray(row) ? row.slice() : [];
      allRows.push(rowValues);
    });
  }
  if (!skipDefaultHeader) {
    const header = columns.map((column) => toSpreadsheetHeaderLabel(column, options));
    allRows.push(header);
  }
  const body = Array.isArray(rows) && rows.length ? rows : [{ Info: "No data" }];
  body.forEach((row) => {
    allRows.push(columns.map((column) => (row && Object.prototype.hasOwnProperty.call(row, column) ? row[column] : "")));
  });

  const headerRowCount = customHeaderRows.length + (skipDefaultHeader ? 0 : 1);
  const rowXml = allRows.map((values, rowIndex) => {
    const cells = values.map((rawValue, colIndex) => {
      const cellRef = `${excelColumnName(colIndex)}${rowIndex + 1}`;
      const value = rawValue == null ? "" : rawValue;
      const isHeaderCell = rowIndex < headerRowCount;
      if (!isHeaderCell && options && options.omitEmptyCells && value === "") return "";
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${cellRef}"${isHeaderCell ? ' s="1"' : ""}><v>${value}</v></c>`;
      }
      return `<c r="${cellRef}" t="inlineStr"${isHeaderCell ? ' s="1"' : ""}><is><t>${escapeXml(String(value))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const mergeRefs = Array.isArray(options && options.merges) ? options.merges.filter(Boolean) : [];
  const mergeXml = mergeRefs.length
    ? `<mergeCells count="${mergeRefs.length}">${mergeRefs.map((ref) => `<mergeCell ref="${escapeXml(String(ref))}"/>`).join("")}</mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
  ${mergeXml}
</worksheet>`;
}

async function buildXlsxBlobFromSheets(sheetSpecs, writeOptions) {
  const sheets = (sheetSpecs || []).filter((sheet) => sheet && sheet.name && Array.isArray(sheet.columns));
  if (!sheets.length) throw new Error("No worksheets to export");
  if (!(typeof XLSX !== "undefined" && XLSX && XLSX.utils && typeof XLSX.write === "function")) {
    throw new Error("SheetJS (XLSX) is required for Excel export.");
  }

  const wb = XLSX.utils.book_new();
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Sheets = wb.Workbook.Sheets || [];

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    const cols = sheet.columns || [];
    const options = sheet.options || {};
    const customHeaderRows = Array.isArray(options.customHeaderRows) ? options.customHeaderRows : [];
    const skipDefaultHeader = !!options.skipDefaultHeader;
    const bodyRows = Array.isArray(sheet.rows) && sheet.rows.length ? sheet.rows : [{ Info: "No data" }];

    const initialRows = [];
    customHeaderRows.forEach((row) => initialRows.push(Array.isArray(row) ? row.slice() : []));
    if (!skipDefaultHeader) {
      initialRows.push(cols.map((column) => toSpreadsheetHeaderLabel(column, options)));
    }
    const ws = XLSX.utils.aoa_to_sheet(initialRows.length ? initialRows : [[]]);
    for (let start = 0; start < bodyRows.length; start += XLSX_BATCH_WRITE_ROWS) {
      const rowsChunk = [];
      const end = Math.min(start + XLSX_BATCH_WRITE_ROWS, bodyRows.length);
      for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
        const row = bodyRows[rowIndex];
        rowsChunk.push(cols.map((column) => (
          row && Object.prototype.hasOwnProperty.call(row, column) ? row[column] : ""
        )));
      }
      if (rowsChunk.length) {
        XLSX.utils.sheet_add_aoa(ws, rowsChunk, { origin: -1 });
      }
      // Yield to keep popup responsive and reduce long GC pauses on huge exports.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (Array.isArray(options.merges) && options.merges.length) {
      ws["!merges"] = options.merges
        .filter(Boolean)
        .map((ref) => (XLSX.utils.decode_range ? XLSX.utils.decode_range(String(ref)) : null))
        .filter(Boolean);
    }

    const safeName = buildWorksheetChunkName(sheet.name, 0);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
    wb.Workbook.Sheets[index] = wb.Workbook.Sheets[index] || { name: safeName };
    wb.Workbook.Sheets[index].Hidden = options.hidden ? 1 : 0;
    if (index > 0 && index % 2 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const opts = writeOptions && typeof writeOptions === "object" ? writeOptions : {};
  const compression = opts.compression === undefined ? false : !!opts.compression;
  let out = null;
  if (opts.useWorker && typeof Worker !== "undefined") {
    try {
      const xlsxUrl = (typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL)
        ? browser.runtime.getURL("xlsx.full.min.js")
        : (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL)
          ? chrome.runtime.getURL("xlsx.full.min.js")
          : "xlsx.full.min.js";
      out = await new Promise((resolve, reject) => {
        const workerSource = `
          self.onmessage = function(event) {
            var payload = event.data || {};
            try {
              importScripts(payload.xlsxUrl);
              var out = XLSX.write(payload.workbook, {
                bookType: "xlsx",
                type: "array",
                compression: !!payload.compression
              });
              self.postMessage({ ok: true, out: out }, [out.buffer]);
            } catch (err) {
              self.postMessage({ ok: false, error: (err && err.message) ? err.message : String(err) });
            }
          };
        `;
        const workerBlob = new Blob([workerSource], { type: "application/javascript" });
        const workerUrl = URL.createObjectURL(workerBlob);
        const worker = new Worker(workerUrl);
        worker.onmessage = (msg) => {
          const data = msg && msg.data ? msg.data : {};
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          if (data.ok) resolve(data.out);
          else reject(new Error(data.error || "Worker XLSX write failed"));
        };
        worker.onerror = (err) => {
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error((err && err.message) || "Worker error"));
        };
        worker.postMessage({ workbook: wb, compression, xlsxUrl });
      });
    } catch (workerErr) {
      out = null;
    }
  }
  if (!out) {
    out = XLSX.write(wb, {
      bookType: "xlsx",
      type: "array",
      compression,
    });
  }
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function buildXlsxBlobFromWorkbookXml(workbookXml, writeOptions) {
  if (!(typeof JSZip !== "undefined" && JSZip)) {
    throw new Error("JSZip is required for styled Excel export.");
  }
  const opts = writeOptions && typeof writeOptions === "object" ? writeOptions : {};
  const parsed = parseSpreadsheetMlWorkbook(workbookXml);
  if (!parsed.sheets.length) throw new Error("No worksheets to export");

  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${parsed.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  const xl = zip.folder("xl");
  xl.folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${parsed.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n  ")}
  <Relationship Id="rId${parsed.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  xl.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${parsed.sheets.map((sheet, i) => `<sheet name="${escapeXmlText(buildWorksheetChunkName(sheet.name || `Sheet${i + 1}`, 0))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`);
  xl.file("styles.xml", buildSpreadsheetMlXlsxStylesXml(parsed.styleList));

  const wsFolder = xl.folder("worksheets");
  for (let i = 0; i < parsed.sheets.length; i += 1) {
    wsFolder.file(`sheet${i + 1}.xml`, buildSpreadsheetMlXlsxWorksheetXml(parsed.sheets[i], parsed.styleIndexById));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const uint8 = await zip.generateAsync({
    type: "uint8array",
    compression: opts.compression ? "DEFLATE" : "STORE",
    compressionOptions: { level: 1 },
  });
  return new Blob([uint8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function decodeXmlText(value) {
  return String(value == null ? "" : value)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function getXmlAttr(attrs, name) {
  const pattern = new RegExp(`(?:^|\\s)(?:ss:)?${name}="([^"]*)"`, "i");
  const match = String(attrs || "").match(pattern);
  return match ? decodeXmlText(match[1]) : "";
}

function parseSpreadsheetMlStyles(workbookXml) {
  const styles = new Map();
  const styleRe = /<Style\b([^>]*)>([\s\S]*?)<\/Style>/gi;
  let match;
  while ((match = styleRe.exec(workbookXml))) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const id = getXmlAttr(attrs, "ID");
    if (!id) continue;
    const fontMatch = body.match(/<Font\b([^>]*)\/?>/i);
    const alignMatch = body.match(/<Alignment\b([^>]*)\/?>/i);
    const interiorMatch = body.match(/<Interior\b([^>]*)\/?>/i);
    const numberMatch = body.match(/<NumberFormat\b([^>]*)\/?>/i);
    styles.set(id, {
      id,
      bold: !!(fontMatch && getXmlAttr(fontMatch[1], "Bold") === "1"),
      italic: !!(fontMatch && getXmlAttr(fontMatch[1], "Italic") === "1"),
      size: fontMatch && getXmlAttr(fontMatch[1], "Size") ? Number(getXmlAttr(fontMatch[1], "Size")) : 11,
      fill: interiorMatch ? String(getXmlAttr(interiorMatch[1], "Color") || "").replace(/^#/, "").toUpperCase() : "",
      horizontal: alignMatch ? String(getXmlAttr(alignMatch[1], "Horizontal") || "").toLowerCase() : "",
      wrap: !!(alignMatch && getXmlAttr(alignMatch[1], "WrapText") === "1"),
      indent: alignMatch && getXmlAttr(alignMatch[1], "Indent") ? Number(getXmlAttr(alignMatch[1], "Indent")) : 0,
      numberFormat: numberMatch ? getXmlAttr(numberMatch[1], "Format") : "",
      border: /<Borders\b[\s\S]*?<Border\b/i.test(body),
    });
  }
  return styles;
}

function parseSpreadsheetMlWorkbook(workbookXml) {
  const styles = parseSpreadsheetMlStyles(workbookXml);
  const usedStyleIds = new Set();
  const sheets = [];
  const worksheetRe = /<Worksheet\b([^>]*)>([\s\S]*?)<\/Worksheet>/gi;
  let worksheetMatch;
  while ((worksheetMatch = worksheetRe.exec(workbookXml))) {
    const sheetAttrs = worksheetMatch[1] || "";
    const sheetBody = worksheetMatch[2] || "";
    const tableMatch = sheetBody.match(/<Table\b[^>]*>([\s\S]*?)<\/Table>/i);
    if (!tableMatch) continue;
    const tableBody = tableMatch[1] || "";
    const columns = [];
    const colRe = /<Column\b([^>]*)\/?>/gi;
    let colMatch;
    while ((colMatch = colRe.exec(tableBody))) {
      const width = Number(getXmlAttr(colMatch[1], "Width"));
      columns.push(Number.isFinite(width) && width > 0 ? width : 80);
    }

    const rows = [];
    const merges = [];
    const rowRe = /<Row\b([^>]*)>([\s\S]*?)<\/Row>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableBody))) {
      const rowNumber = rows.length + 1;
      const rowAttrs = rowMatch[1] || "";
      const rowCells = [];
      let colNumber = 1;
      const cellRe = /<Cell\b([^>]*?)>([\s\S]*?)<\/Cell>|<Cell\b([^>]*?)\/>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[2] || ""))) {
        const attrs = cellMatch[1] || cellMatch[3] || "";
        const indexedCol = Number(getXmlAttr(attrs, "Index"));
        if (Number.isFinite(indexedCol) && indexedCol > 0) colNumber = indexedCol;
        const styleId = getXmlAttr(attrs, "StyleID");
        if (styleId) usedStyleIds.add(styleId);
        const dataBody = cellMatch[2] || "";
        const dataMatch = dataBody.match(/<Data\b([^>]*)>([\s\S]*?)<\/Data>/i);
        const type = dataMatch ? getXmlAttr(dataMatch[1], "Type") || "String" : "String";
        const value = dataMatch ? decodeXmlText(String(dataMatch[2] || "").replace(/<[^>]+>/g, "")) : "";
        const mergeAcross = Number(getXmlAttr(attrs, "MergeAcross"));
        rowCells.push({ col: colNumber, styleId, type, value, mergeAcross: Number.isFinite(mergeAcross) && mergeAcross > 0 ? mergeAcross : 0 });
        if (Number.isFinite(mergeAcross) && mergeAcross > 0) {
          merges.push(`${excelColumnName(colNumber - 1)}${rowNumber}:${excelColumnName(colNumber + mergeAcross - 1)}${rowNumber}`);
          colNumber += mergeAcross + 1;
        } else {
          colNumber += 1;
        }
      }
      rows.push({ height: Number(getXmlAttr(rowAttrs, "Height")) || 0, cells: rowCells });
    }
    sheets.push({
      name: getXmlAttr(sheetAttrs, "Name") || `Sheet${sheets.length + 1}`,
      columns,
      rows,
      merges,
    });
  }

  const styleList = Array.from(usedStyleIds)
    .map((id) => styles.get(id) || { id })
    .filter((style) => style && style.id);
  const styleIndexById = new Map();
  styleList.forEach((style, index) => styleIndexById.set(style.id, index + 1));
  return { sheets, styleList, styleIndexById };
}

function buildSpreadsheetMlXlsxStylesXml(styleList) {
  const safeStyles = styleList && styleList.length ? styleList : [];
  const fonts = [{ size: 11, bold: false, italic: false }].concat(safeStyles.map((style) => ({
    size: style.size || 11,
    bold: !!style.bold,
    italic: !!style.italic,
  })));
  const fillKeys = ["", "gray125"];
  safeStyles.forEach((style) => {
    const fill = style.fill || "";
    if (fill && !fillKeys.includes(fill)) fillKeys.push(fill);
  });
  const borderKeys = ["none"];
  safeStyles.forEach((style) => {
    const key = style.border ? "thin" : "none";
    if (!borderKeys.includes(key)) borderKeys.push(key);
  });
  const numFmtStyles = safeStyles.filter((style) => style.numberFormat && style.numberFormat !== "0.00");
  const numFmtXml = numFmtStyles.length
    ? `<numFmts count="${numFmtStyles.length}">${numFmtStyles.map((style, index) => `<numFmt numFmtId="${164 + index}" formatCode="${escapeXmlText(style.numberFormat)}"/>`).join("")}</numFmts>`
    : "";
  const fontXml = fonts.map((font) => `<font><sz val="${font.size || 11}"/><name val="Calibri"/>${font.bold ? "<b/>" : ""}${font.italic ? "<i/>" : ""}</font>`).join("");
  const fillXml = fillKeys.map((fill) => {
    if (!fill) return '<fill><patternFill patternType="none"/></fill>';
    if (fill === "gray125") return '<fill><patternFill patternType="gray125"/></fill>';
    return `<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor indexed="64"/></patternFill></fill>`;
  }).join("");
  const thinBorder = '<border><left style="thin"><color rgb="FF1F1F1F"/></left><right style="thin"><color rgb="FF1F1F1F"/></right><top style="thin"><color rgb="FF1F1F1F"/></top><bottom style="thin"><color rgb="FF1F1F1F"/></bottom><diagonal/></border>';
  const borderXml = borderKeys.map((key) => (key === "thin" ? thinBorder : "<border><left/><right/><top/><bottom/><diagonal/></border>")).join("");
  const xfXml = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'].concat(safeStyles.map((style, index) => {
    const customNumFmtIndex = numFmtStyles.indexOf(style);
    const numFmtId = style.numberFormat === "0.00" ? 2 : (customNumFmtIndex >= 0 ? 164 + customNumFmtIndex : 0);
    const fontId = index + 1;
    const fillId = fillKeys.indexOf(style.fill || "");
    const borderId = borderKeys.indexOf(style.border ? "thin" : "none");
    const alignment = (style.horizontal || style.wrap || style.indent)
      ? `<alignment${style.horizontal ? ` horizontal="${style.horizontal}"` : ""}${style.wrap ? ' wrapText="1"' : ""}${style.indent ? ` indent="${style.indent}"` : ""} vertical="center"/>`
      : "";
    return `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${Math.max(fillId, 0)}" borderId="${Math.max(borderId, 0)}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${numFmtId ? ' applyNumberFormat="1"' : ""}${alignment ? ' applyAlignment="1"' : ""}>${alignment}</xf>`;
  })).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${numFmtXml}
  <fonts count="${fonts.length}">${fontXml}</fonts>
  <fills count="${fillKeys.length}">${fillXml}</fills>
  <borders count="${borderKeys.length}">${borderXml}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${safeStyles.length + 1}">${xfXml}</cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function buildSpreadsheetMlXlsxWorksheetXml(sheet, styleIndexById) {
  const colXml = (sheet.columns || []).length
    ? `<cols>${sheet.columns.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Number(width || 80) / 7)}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rowXml = (sheet.rows || []).map((row, rowIndex) => {
    const expandedCells = [];
    (row.cells || []).forEach((cell) => {
      expandedCells.push(cell);
      const mergeAcross = Number(cell.mergeAcross || 0);
      for (let offset = 1; offset <= mergeAcross; offset += 1) {
        expandedCells.push({
          col: cell.col + offset,
          styleId: cell.styleId,
          type: "String",
          value: "",
          mergedPlaceholder: true,
        });
      }
    });
    const cellsByCol = new Map();
    expandedCells.forEach((cell) => {
      if (!cellsByCol.has(cell.col) || !cell.mergedPlaceholder) cellsByCol.set(cell.col, cell);
    });
    const cells = Array.from(cellsByCol.values()).sort((a, b) => a.col - b.col).map((cell) => {
      const ref = `${excelColumnName(cell.col - 1)}${rowIndex + 1}`;
      const styleIndex = styleIndexById && styleIndexById.get(cell.styleId) ? styleIndexById.get(cell.styleId) : 0;
      const styleAttr = styleIndex ? ` s="${styleIndex}"` : "";
      const numericValue = Number(cell.value);
      if (String(cell.type || "").toLowerCase() === "number" && cell.value !== "" && Number.isFinite(numericValue)) {
        return `<c r="${ref}"${styleAttr}><v>${numericValue}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${escapeXmlText(cell.value)}</t></is></c>`;
    }).join("");
    const heightAttr = row.height ? ` ht="${row.height}" customHeight="1"` : "";
    return `<row r="${rowIndex + 1}"${heightAttr}>${cells}</row>`;
  }).join("");
  const mergeXml = (sheet.merges || []).length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${escapeXmlText(ref)}"/>`).join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${colXml}
  <sheetData>${rowXml}</sheetData>
  ${mergeXml}
</worksheet>`;
}

function escapeXmlText(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildStreamingWorksheetXml(sheet) {
  const cols = sheet.columns || [];
  const options = sheet.options || {};
  const customHeaderRows = Array.isArray(options.customHeaderRows) ? options.customHeaderRows : [];
  const skipDefaultHeader = !!options.skipDefaultHeader;
  const bodyRows = Array.isArray(sheet.rows) && sheet.rows.length ? sheet.rows : [{ Info: "No data" }];

  let rowIndex = 1;
  const rowParts = [];
  const pushRow = (values, header) => {
    const cells = [];
    for (let colIndex = 0; colIndex < values.length; colIndex += 1) {
      const cellRef = `${excelColumnName(colIndex)}${rowIndex}`;
      const value = values[colIndex];
      if (typeof value === "number" && Number.isFinite(value)) {
        cells.push(`<c r="${cellRef}"${header ? ' s="1"' : ""}><v>${value}</v></c>`);
      } else {
        cells.push(`<c r="${cellRef}" t="inlineStr"${header ? ' s="1"' : ""}><is><t>${escapeXmlText(value)}</t></is></c>`);
      }
    }
    rowParts.push(`<row r="${rowIndex}">${cells.join("")}</row>`);
    rowIndex += 1;
  };

  for (let i = 0; i < customHeaderRows.length; i += 1) {
    const row = Array.isArray(customHeaderRows[i]) ? customHeaderRows[i] : [];
    pushRow(row, true);
  }
  if (!skipDefaultHeader) {
    pushRow(cols.map((column) => toSpreadsheetHeaderLabel(column, options)), true);
  }
  for (let i = 0; i < bodyRows.length; i += 1) {
    const row = bodyRows[i];
    pushRow(cols.map((column) => (row && Object.prototype.hasOwnProperty.call(row, column) ? row[column] : "")), false);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowParts.join("")}</sheetData>
</worksheet>`;
}

async function buildXlsxBlobStreamingFromSheets(sheetSpecs, writeOptions) {
  const sheets = (sheetSpecs || []).filter((sheet) => sheet && sheet.name && Array.isArray(sheet.columns));
  if (!sheets.length) throw new Error("No worksheets to export");
  if (!(typeof JSZip !== "undefined" && JSZip)) {
    // Fallback if JSZip is unavailable in runtime.
    return buildXlsxBlobFromSheets(sheets, writeOptions);
  }

  const opts = writeOptions && typeof writeOptions === "object" ? writeOptions : {};
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  const xl = zip.folder("xl");
  xl.folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n  ")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  xl.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets.map((sheet, i) => `<sheet name="${escapeXmlText(buildWorksheetChunkName(sheet.name, 0))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`);
  xl.file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="2"><xf/><xf applyFont="1"><font><b/></font></xf></cellXfs>
</styleSheet>`);

  const wsFolder = xl.folder("worksheets");
  for (let i = 0; i < sheets.length; i += 1) {
    const xml = buildStreamingWorksheetXml(sheets[i]);
    wsFolder.file(`sheet${i + 1}.xml`, xml);
    if (opts.releaseRows && Array.isArray(sheets[i].rows)) {
      sheets[i].rows.length = 0;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const uint8 = await zip.generateAsync({
    type: "uint8array",
    compression: opts.compression ? "DEFLATE" : "STORE",
    compressionOptions: { level: 1 },
  });
  return new Blob([uint8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function buildCombinedSummaryRows(payloads) {
  const periods = [];
  const fields = ["gstin", "rtnprd", "status", "message", "generated_on", "version"];
  const valuesByField = new Map(fields.map((field) => [field, { field }]));

  (payloads || []).forEach((payload) => {
    const meta = extractWorkbookMeta(payload);
    const period = meta.rtnprd || "";
    if (!period) return;
    if (!periods.includes(period)) periods.push(period);
    valuesByField.get("gstin")[period] = meta.gstin || "";
    valuesByField.get("rtnprd")[period] = period;
    valuesByField.get("status")[period] = meta.status || "";
    valuesByField.get("message")[period] = meta.message || "";
    valuesByField.get("generated_on")[period] = meta.generated_on || "";
    valuesByField.get("version")[period] = meta.version || "";
  });

  return {
    rows: fields.map((field) => valuesByField.get(field)),
    columns: ["field"].concat(periods),
  };
}

function extractWorkbookMeta(payload) {
  const data = payload && payload.data ? payload.data : payload || {};
  const pick = (...values) =>
    values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
  const collectUrlList = (...values) => {
    const list = [];
    const seen = new Set();
    const push = (value) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      list.push(trimmed);
    };
    values.forEach((value) => {
      if (Array.isArray(value)) value.forEach(push);
      else push(value);
    });
    return list;
  };
  const linkedUrls = collectUrlList(
    payload && payload.__sourceFileUrls,
    payload && payload.__linkedFileUrls,
    payload && payload.url,
    data && data.url,
    payload && payload.file_url,
    data && data.file_url,
    payload && payload.fileUrl,
    data && data.fileUrl,
  );
  const dedupedStatuses = dedupeLinkStatusesByUrl(
    ((payload && payload.__linkFetchStatuses) || (data && data.__linkFetchStatuses) || []).filter(Boolean),
  );
  const statusByUrl = new Map(
    dedupedStatuses.map((item) => [String((item && item.url) || "").trim(), item]),
  );
  const linkStatusDetail = linkedUrls.length
    ? linkedUrls.map((url) => {
      const item = statusByUrl.get(url);
      if (!item) return "unknown";
      const status = String(item.status || "").toLowerCase();
      if (status === "success") return "success";
      const msg = String(item.message || "").trim();
      return msg ? `failed: ${msg}` : "failed";
    }).join(",")
    : (payload && payload.__linkStatusText) || (data && data.__linkStatusText) || "";

  return {
    gstin: pick(data.gstin, data.gstinId, payload && payload.gstin, payload && payload.gstinId),
    rtnprd: pick(
      data.rtnprd,
      data.rtn_prd,
      data.ret_period,
      data.retPrd,
      data.fp,
      payload && payload.rtnprd,
      payload && payload.rtn_prd,
      payload && payload.ret_period,
      payload && payload.retPrd,
      payload && payload.fp,
    ),
    generated_on: pick(
      data.gendt,
      data.gen_dt,
      data.generated_on,
      data.generatedOn,
      data.gendate,
      payload && payload.gendt,
      payload && payload.gen_dt,
      payload && payload.generated_on,
      payload && payload.generatedOn,
      payload && payload.gendate,
    ),
    version: pick(
      data.version,
      data.ver,
      payload && payload.version,
      payload && payload.ver,
    ),
    checksum: pick(
      payload && payload.chksum,
      data.chksum,
      payload && payload.checksum,
      data.checksum,
      payload && payload.chksm,
      data.chksm,
    ),
    status: pick(
      payload && payload.status,
      payload && payload.status_cd,
      data.status,
      data.status_cd,
    ),
    message: pick(
      payload && payload.msg,
      payload && payload.message,
      data.msg,
      data.message,
    ),
    file_date: pick(
      payload && payload.date,
      data.date,
    ),
    file_time: pick(
      payload && payload.time,
      data.time,
    ),
    file_url: pick(
      linkedUrls.join(","),
      payload && payload.url,
      data.url,
      payload && payload.file_url,
      data && data.file_url,
      payload && payload.fileUrl,
      data.fileUrl,
    ),
    link_status: pick(
      linkStatusDetail,
      payload && payload.__linkStatusText,
      data && data.__linkStatusText,
    ),
  };
}

function buildGstr2bWorkbookData(payload, includePeriod) {
  const data = getGstr2bSectionSourceData(payload);
  const reportPeriod = data.rtnprd || "";
  const metaRows = [];
  [
    ["gstin", data.gstin || ""],
    ["rtnprd", data.rtnprd || ""],
    ["status", data.status || payload && payload.status || ""],
    ["message", data.message || data.msg || payload && payload.message || payload && payload.msg || ""],
    ["generated_on", data.gendt || ""],
    ["version", data.version || ""],
    ["checksum", payload && payload.chksum ? payload.chksum : ""],
    ["link_status", (payload && payload.__linkStatusText) || "N/A"],
  ].forEach(([field, value]) => metaRows.push({ ...(includePeriod ? { report_period: reportPeriod } : {}), field, value }));

  const summSectionSheets = buildGstr2bSummSectionSheets(data, includePeriod, reportPeriod);
  const summaryRows = metaRows.concat(buildGstr2bNonSummSummaryRows(data, includePeriod, reportPeriod));

  return {
    metaRows: summaryRows,
    summSectionSheets,
  };
}

function normalizeGstr2bKey(key) {
  return String(key || "").toLowerCase().replace(/[\s_\-]/g, "");
}

function isGstr2bChecksumLikeSummKey(key) {
  const normalized = normalizeGstr2bKey(key);
  if (!/summ$/.test(normalized)) return false;
  return normalized.startsWith("chk") || normalized.startsWith("check");
}

function isGstr2bSummSectionKey(key) {
  const normalized = normalizeGstr2bKey(key);
  if (!/summ$/.test(normalized)) return false;
  if (isGstr2bChecksumLikeSummKey(normalized)) return false;
  return true;
}

function buildGstr2bSummSectionSheets(data, includePeriod, reportPeriod) {
  const sectionKeys = Object.keys(data || {}).filter((key) => isGstr2bSummSectionKey(key));
  const sections = [];
  sectionKeys.forEach((parentKey) => {
    const parentValue = data[parentKey];
    if (!parentValue || typeof parentValue !== "object") return;
    const childKeys = Object.keys(parentValue || {});
    if (!childKeys.length) return;
    childKeys.forEach((childKey) => {
      const childValue = parentValue[childKey];
      if (childValue == null) return;
      if (!Array.isArray(childValue) && typeof childValue !== "object") return;
      let rows = expandObjectRows(childValue, [{}], "");
      rows = rows
        .filter((row) => row && Object.keys(row).length > 0)
        .map((row, index) => ({
          ...(includePeriod ? { report_period: reportPeriod } : {}),
          row_no: index + 1,
          ...(row || {}),
        }));
      if (!rows.length) return;
      sections.push({
        name: `${String(parentKey || "").toUpperCase()}_${String(childKey || "").toUpperCase()}`,
        rows,
      });
    });
  });
  return sections;
}

function buildGstr2bNonSummSummaryRows(data, includePeriod, reportPeriod) {
  const rows = [];
  const pushPrimitive = (field, value) => {
    if (value === undefined || value === null || typeof value === "object") return;
    rows.push({
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      field,
      value: String(value),
    });
  };
  const visit = (value, path) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      if (value.every((item) => item === null || item === undefined || typeof item !== "object")) {
        pushPrimitive(path, value.join(", "));
        return;
      }
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      Object.keys(value).forEach((key) => {
        const nextPath = path ? `${path}.${key}` : key;
        visit(value[key], nextPath);
      });
      return;
    }
    pushPrimitive(path, value);
  };
  Object.keys(data || {}).forEach((key) => {
    if (isGstr2bSummSectionKey(key)) return;
    visit(data[key], key);
  });
  return rows;
}

function getGstr2bSectionSourceData(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const candidates = [
    root.data,
    root,
    root.__portalResponse && root.__portalResponse.data,
    root.__portalResponse,
  ].filter((item) => item && typeof item === "object");
  const score = (obj) => {
    let value = 0;
    if (obj.itcsumm && typeof obj.itcsumm === "object") value += 3;
    if (obj.cpsumm && typeof obj.cpsumm === "object") value += 3;
    if (obj.docdata && typeof obj.docdata === "object") value += 4;
    return value;
  };
  let best = candidates[0] || {};
  let bestScore = -1;
  candidates.forEach((candidate) => {
    const candidateScore = score(candidate);
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      best = candidate;
    }
  });
  return best || {};
}

function buildGstr2bWorkbookXml(payload) {
  const workbookData = buildGstr2bWorkbookData(payload, false);
  ensureSchemaColumns("GSTR2B", ["field", "value"], null);
  ensureSchemaForSections("GSTR2B", [
    { name: "ITC Summary", rows: workbookData.itcRows },
    { name: "Supplier Summary", rows: workbookData.supplierSummaryRows },
    { name: "B2B Invoices", rows: workbookData.invoiceRows },
    { name: "Imports", rows: workbookData.importRows },
    { name: "Raw Flattened", rows: workbookData.rawFlattenedRows },
    { name: "Raw JSON", rows: workbookData.rawJsonRows },
  ], null);

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E8FB" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", workbookData.metaRows, ["field", "value"], { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("ITC Summary", workbookData.itcRows, ["itc_group", "type", "txval", "igst", "cgst", "sgst", "cess"], { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("Supplier Summary", workbookData.supplierSummaryRows, null, { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("B2B Invoices", workbookData.invoiceRows, null, { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("Imports", workbookData.importRows, null, { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("Raw Flattened", workbookData.rawFlattenedRows, null, { hidden: true, schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("Raw JSON", workbookData.rawJsonRows, null, { hidden: true, schemaReturnType: "GSTR2B" })}
</Workbook>`;
}

function buildGenericWorkbookData(payload, includePeriod) {
  const data = payload && payload.data ? payload.data : payload || {};
  const meta = extractWorkbookMeta(payload);
  const reportPeriod = meta.rtnprd || "";
  const metaRows = [];
  [
    ["gstin", meta.gstin || ""],
    ["rtnprd", reportPeriod],
    ["generated_on", meta.generated_on || ""],
    ["version", meta.version || ""],
    ["checksum", meta.checksum || ""],
  ].forEach(([field, value]) => metaRows.push({ field, value }));

  const rawFlattenedRows = buildRawFlattenedRows(payload, includePeriod, reportPeriod);
  const rawJsonRows = buildRawJsonRows(payload, includePeriod, reportPeriod);

  return {
    metaRows,
    rawFlattenedRows,
    rawJsonRows,
  };
}

function expandObjectRows(value, seedRows, prefix) {
  if (value === null || value === undefined) {
    return seedRows;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      if (prefix) {
        return seedRows.map((row) => ({ ...row, [prefix]: "" }));
      }
      return seedRows;
    }
    const allPrimitive = value.every(
      (item) => item === null || item === undefined || typeof item !== "object",
    );
    if (allPrimitive) {
      return seedRows.map((row) => ({
        ...row,
        [prefix]: value.map((item) => (item == null ? "" : item)).join(", "),
      }));
    }
    let expanded = [];
    value.forEach((item) => {
      const nextSeed = seedRows.map((row) => ({ ...row }));
      const nested = expandObjectRows(item, nextSeed, prefix);
      expanded = expanded.concat(nested);
    });
    return expanded;
  }
  if (typeof value === "object") {
    let rows = seedRows;
    Object.keys(value).forEach((key) => {
      const nextPrefix = prefix ? `${prefix}_${key}` : key;
      rows = expandObjectRows(value[key], rows, nextPrefix);
    });
    return rows;
  }
  if (!prefix) return seedRows;
  return seedRows.map((row) => ({ ...row, [prefix]: value }));
}

function buildSectionWorkbookData(payload) {
  const data = payload && payload.data ? payload.data : payload || {};
  const excludedKeys = new Set(["gstin", "rtnprd", "gendt", "gen_dt", "version", "chksum"]);
  const sections = [];

  Object.keys(data || {}).forEach((key) => {
    if (excludedKeys.has(key)) return;
    const sectionValue = data[key];
    if (sectionValue == null) return;
    let rows = [];
    if (Array.isArray(sectionValue)) {
      rows = expandObjectRows(sectionValue, [{}], "");
    } else if (typeof sectionValue === "object") {
      rows = expandObjectRows(sectionValue, [{}], "");
    }
    rows = rows.filter((row) => row && Object.keys(row).length > 0);
    if (!rows.length) return;
    sections.push({
      name: key.toUpperCase(),
      rows,
    });
  });

  return sections;
}

function mergeWorkbookSectionsByName(sections) {
  const merged = new Map();
  (sections || []).forEach((section) => {
    if (!section) return;
    const name = String(section.name || "").trim();
    if (!name) return;
    if (!merged.has(name)) {
      merged.set(name, {
        name,
        rows: [],
      });
    }
    const target = merged.get(name);
    (section.rows || []).forEach((row) => {
      target.rows.push({ ...(row || {}) });
    });
  });
  return Array.from(merged.values());
}

function normalizeWorkbookValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => normalizeWorkbookValue(item)).join(",");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function pickRowChecksum(row) {
  if (!row || typeof row !== "object") return "";
  const directKeys = ["checksum", "chksum", "chksm", "inv_chksum", "nt_chksum"];
  for (const key of directKeys) {
    const value = normalizeWorkbookValue(row[key]);
    if (value) return value;
  }
  const matchingKey = Object.keys(row).find((key) => /(check.?sum|chksum|chksm)$/i.test(String(key || "")));
  return matchingKey ? normalizeWorkbookValue(row[matchingKey]) : "";
}

function buildWorkbookRowFallbackKey(row) {
  if (!row || typeof row !== "object") return "";
  const ignored = new Set(["row_no"]);
  const keys = Object.keys(row).filter((key) => !ignored.has(key)).sort();
  return keys.map((key) => `${key}:${normalizeWorkbookValue(row[key])}`).join("|");
}

function dedupeWorkbookRows(rows) {
  const seenChecksums = new Set();
  const seenFallbackKeys = new Set();
  const deduped = [];

  (rows || []).forEach((row) => {
    if (!row || typeof row !== "object") return;
    const reportPeriod = normalizeWorkbookValue(row.report_period || "");
    const checksum = pickRowChecksum(row);
    if (checksum) {
      const checksumKey = `${reportPeriod}|${checksum}`;
      if (seenChecksums.has(checksumKey)) return;
      seenChecksums.add(checksumKey);
      deduped.push({ ...row });
      return;
    }

    const fallbackKey = `${reportPeriod}|${buildWorkbookRowFallbackKey(row)}`;
    if (seenFallbackKeys.has(fallbackKey)) return;
    seenFallbackKeys.add(fallbackKey);
    deduped.push({ ...row });
  });

  return deduped.map((row, index) => (Object.prototype.hasOwnProperty.call(row, "row_no")
    ? { ...row, row_no: index + 1 }
    : row));
}

function getGstr1SectionSourceData(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const knownSectionKeys = GSTR1_STANDARD_SECTION_KEYS;
  const isPlainObject = (obj) =>
    !!obj && typeof obj === "object" && !Array.isArray(obj);
  const getKnownSectionCount = (obj) =>
    !isPlainObject(obj)
      ? 0
      : knownSectionKeys.filter((key) => Object.prototype.hasOwnProperty.call(obj, key)).length;
  const getCandidateScore = (obj) => {
    if (!isPlainObject(obj)) return -1;
    const keys = Object.keys(obj);
    const knownCount = getKnownSectionCount(obj);
    if (knownCount) return knownCount * 100 + keys.length;
    const sectionLikeCount = keys.filter((key) => {
      const value = obj[key];
      return Array.isArray(value) || isPlainObject(value);
    }).length;
    return sectionLikeCount ? sectionLikeCount : -1;
  };

  let bestCandidate = null;
  let bestScore = -1;
  const visited = new Set();

  function visit(node, depth) {
    if (!isPlainObject(node) || visited.has(node) || depth > 6) return;
    visited.add(node);

    const score = getCandidateScore(node);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = node;
    }

    Object.keys(node).forEach((key) => {
      if (key === "__portalResponse") return;
      const value = node[key];
      if (isPlainObject(value)) {
        visit(value, depth + 1);
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          if (isPlainObject(item)) visit(item, depth + 1);
        });
      }
    });
  }

  visit(root, 0);
  return bestCandidate || root || {};
}

function getGstr1SectionCandidates(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const candidates = [
    root.data,
    root,
    root.__portalResponse && root.__portalResponse.data,
    root.__portalResponse,
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
  return candidates.length ? candidates : [root];
}

const GSTR1_STANDARD_SECTION_KEYS = [
  "b2b",
  "b2ba",
  "b2cl",
  "b2cla",
  "b2cs",
  "b2csa",
  "cdnr",
  "cdnra",
  "cdnur",
  "cdnura",
  "exp",
  "expa",
  "at",
  "ata",
  "atadj",
  "atadja",
  "txpd",
  "txpda",
  "nil",
  "hsn",
  "docs",
  "doc_issue",
  "supecom",
  "supecoma",
  "eco_dtls",
  "eco_dtlsa",
];

function expandGstr1SectionRows(value, seedRows, prefix) {
  if (value === null || value === undefined) {
    return seedRows;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return prefix
        ? seedRows.map((row) => ({ ...row, [prefix]: "" }))
        : seedRows;
    }
    const allPrimitive = value.every(
      (item) => item === null || item === undefined || typeof item !== "object",
    );
    if (allPrimitive) {
      return seedRows.map((row) => ({
        ...row,
        [prefix]: value.map((item) => (item == null ? "" : item)).join(", "),
      }));
    }
    let rows = [];
    value.forEach((item) => {
      const nextSeed = seedRows.map((row) => ({ ...row }));
      rows = rows.concat(expandGstr1SectionRows(item, nextSeed, prefix));
    });
    return rows;
  }
  if (typeof value === "object") {
    let rows = seedRows;
    Object.keys(value).forEach((key) => {
      const nextPrefix = prefix ? `${prefix}_${key}` : key;
      rows = expandGstr1SectionRows(value[key], rows, nextPrefix);
    });
    return rows;
  }
  if (!prefix) return seedRows;
  return seedRows.map((row) => ({ ...row, [prefix]: value }));
}

function buildGstr1SectionWorkbookData(payload, includePeriod) {
  const normalizedPayload =
    payload && payload.__gstr1SectionsConsolidated
      ? payload
      : consolidateGstr1PayloadSections(payload);
  const dataCandidates = getGstr1SectionCandidates(normalizedPayload);
  const meta = extractWorkbookMeta(normalizedPayload);
  const reportPeriod = meta.rtnprd || "";
  const excludedKeys = new Set([
    "gstin",
    "gstinId",
    "rtnprd",
    "rtn_prd",
    "ret_period",
    "retPrd",
    "fp",
    "gendt",
    "gen_dt",
    "generated_on",
    "generatedOn",
    "gendate",
    "version",
    "ver",
    "chksum",
    "checksum",
    "status",
    "status_cd",
    "msg",
    "message",
    "date",
    "time",
    "timeStamp",
    "timestamp",
    "url",
    "file_url",
    "fileurl",
    "fileUrl",
    "rc",
    "__portalResponse",
    "__linkedPayloads",
    "__linkedFileUrls",
    "__sourceFileUrls",
    "__linkFetchStatuses",
    "__linkStatusText",
    "__gstr1SectionsConsolidated",
  ]);
  const sections = [];
  const availableKeys = Array.from(new Set(
    dataCandidates.flatMap((candidate) => Object.keys(candidate || {})).filter((key) => !excludedKeys.has(key)),
  ));
  const orderedKeys = Array.from(new Set(GSTR1_STANDARD_SECTION_KEYS.concat(availableKeys)));
  const isSectionEmpty = (value) => {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
  };
  const buildColumnAlignedRows = (flatRows) => {
    const sourceRows = Array.isArray(flatRows) ? flatRows : [];
    if (!sourceRows.length) {
      return [
        {
          ...(includePeriod ? { report_period: reportPeriod } : {}),
          value: "",
        },
      ];
    }

    const keys = [];
    const valuesByKey = {};
    sourceRows.forEach((row, rowIndex) => {
      const normalizedRow = Object.keys(row || {}).reduce((acc, field) => {
        if (/(check.?sum|chksum|chksm)$/i.test(String(field || ""))) return acc;
        acc[field] = row[field];
        return acc;
      }, {});

      Object.keys(normalizedRow).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(valuesByKey, key)) {
          valuesByKey[key] = Array(rowIndex).fill("");
          keys.push(key);
        }
      });

      keys.forEach((key) => {
        valuesByKey[key].push(
          Object.prototype.hasOwnProperty.call(normalizedRow, key) ? normalizedRow[key] : "",
        );
      });
    });

    const rowCount = sourceRows.length;
    const out = [];
    for (let i = 0; i < rowCount; i += 1) {
      const row = {
        ...(includePeriod ? { report_period: reportPeriod } : {}),
      };
      keys.forEach((key) => {
        row[key] = Object.prototype.hasOwnProperty.call(valuesByKey, key) ? valuesByKey[key][i] : "";
      });
      out.push(row);
    }
    return out;
  };

  orderedKeys.forEach((key) => {
    if (excludedKeys.has(key)) return;
    let sectionValue = null;
    dataCandidates.forEach((candidate) => {
      const value = candidate && candidate[key];
      if (value == null) return;
      if (!Array.isArray(value) && typeof value !== "object") return;
      sectionValue = sectionValue == null ? value : mergeGstr1SectionValues(sectionValue, value);
    });
    if (sectionValue == null) return;

    let rows = [];
    if (isSectionEmpty(sectionValue)) {
      rows = buildColumnAlignedRows([]);
    } else {
      const expanded = expandGstr1SectionRows(sectionValue, [{}], "")
        .filter((row) => row && Object.keys(row).length > 0);
      rows = buildColumnAlignedRows(expanded);
    }

    sections.push({
      name: key.toUpperCase(),
      rows,
    });
  });

  return sections;
}

function expandGstr2aSectionRows(value, seedRows, prefix) {
  if (value === null || value === undefined) {
    return seedRows;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return prefix
        ? seedRows.map((row) => ({ ...row, [prefix]: "" }))
        : seedRows;
    }
    const allPrimitive = value.every(
      (item) => item === null || item === undefined || typeof item !== "object",
    );
    if (allPrimitive) {
      return seedRows.map((row) => ({
        ...row,
        [prefix]: value.map((item) => (item == null ? "" : item)).join(", "),
      }));
    }
    let rows = [];
    value.forEach((item) => {
      const nextSeed = seedRows.map((row) => ({ ...row }));
      rows = rows.concat(expandGstr2aSectionRows(item, nextSeed, prefix));
    });
    return rows;
  }
  if (typeof value === "object") {
    let rows = seedRows;
    Object.keys(value).forEach((key) => {
      const nextPrefix = prefix ? `${prefix}_${key}` : key;
      rows = expandGstr2aSectionRows(value[key], rows, nextPrefix);
    });
    return rows;
  }
  if (!prefix) return seedRows;
  return seedRows.map((row) => ({ ...row, [prefix]: value }));
}

function buildGstr2aSectionWorkbookRows(payload, includePeriod) {
  const data = getGstr2aSectionSourceData(payload);
  const meta = extractWorkbookMeta(payload);
  const reportPeriod = meta.rtnprd || "";
  const excludedKeys = new Set([
    "gstin",
    "gstinid",
    "rtnprd",
    "rtn_prd",
    "ret_period",
    "retprd",
    "fp",
    "gendt",
    "gen_dt",
    "generated_on",
    "generatedon",
    "gendate",
    "version",
    "ver",
    "chksum",
    "checksum",
    "status",
    "status_cd",
    "msg",
    "message",
    "date",
    "time",
    "timestamp",
    "url",
    "file_url",
    "fileurl",
    "fileUrl",
    "rc",
    "__portalResponse",
    "__linkedPayloads",
    "__linkedFileUrls",
    "__sourceFileUrls",
  ]);
  const sections = [];

  Object.keys(data || {}).forEach((key) => {
    if (excludedKeys.has(String(key))) return;
    const sectionValue = data[key];
    if (sectionValue == null) return;
    if (!Array.isArray(sectionValue) && typeof sectionValue !== "object") return;

    let rows = expandGstr2aSectionRows(sectionValue, [{}], "");
    rows = rows
      .filter((row) => row && Object.keys(row).length > 0)
      .map((row, index) => ({
        ...(includePeriod ? { report_period: reportPeriod } : {}),
        row_no: index + 1,
        ...Object.keys(row || {}).reduce((acc, field) => {
          if (/(check.?sum|chksum|chksm)$/i.test(String(field || ""))) return acc;
          acc[field] = row[field];
          return acc;
        }, {}),
      }));
    if (!rows.length) return;

    sections.push({
      name: String(key || "").toUpperCase(),
      rows,
    });
  });

  return sections;
}

function getGstr2aSectionSourceData(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const knownSectionKeys = [
    "b2b",
    "b2ba",
    "cdnr",
    "cdnra",
    "isd",
    "isda",
    "impg",
    "impgsez",
    "imps",
    "itcava",
    "itcavl",
    "hsn",
    "txi",
    "txpd",
    "nil",
  ];
  const isPlainObject = (obj) =>
    !!obj && typeof obj === "object" && !Array.isArray(obj);
  const getKnownSectionCount = (obj) =>
    !isPlainObject(obj)
      ? 0
      : knownSectionKeys.filter((key) => Object.prototype.hasOwnProperty.call(obj, key)).length;
  const getCandidateScore = (obj) => {
    if (!isPlainObject(obj)) return -1;
    const keys = Object.keys(obj);
    const knownCount = getKnownSectionCount(obj);
    if (knownCount) return knownCount * 100 + keys.length;
    const sectionLikeCount = keys.filter((key) => {
      const value = obj[key];
      return Array.isArray(value) || isPlainObject(value);
    }).length;
    return sectionLikeCount ? sectionLikeCount : -1;
  };

  let bestCandidate = null;
  let bestScore = -1;
  const visited = new Set();

  function visit(node, depth) {
    if (!isPlainObject(node) || visited.has(node) || depth > 6) return;
    visited.add(node);

    const score = getCandidateScore(node);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = node;
    }

    Object.keys(node).forEach((key) => {
      if (key === "__portalResponse" || key === "__linkedPayloads") return;
      const value = node[key];
      if (isPlainObject(value)) {
        visit(value, depth + 1);
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          if (isPlainObject(item)) visit(item, depth + 1);
        });
      }
    });
  }

  visit(root, 0);
  return bestCandidate || root || {};
}

function buildGstr1WorkbookData(payload) {
  const normalizedPayload =
    payload && payload.__gstr1SectionsConsolidated
      ? payload
      : consolidateGstr1PayloadSections(payload);
  const meta = extractWorkbookMeta(normalizedPayload);
  const metaRows = [
    ["gstin", meta.gstin || ""],
    ["rtnprd", meta.rtnprd || ""],
    ["status", meta.status || ""],
    ["message", meta.message || ""],
    ["date", meta.file_date || ""],
    ["time", meta.file_time || ""],
    ["generated_on", meta.generated_on || ""],
    ["version", meta.version || ""],
    ["checksum", meta.checksum || ""],
    ["file_url", meta.file_url || ""],
    ["link_status", meta.link_status || "N/A"],
  ].map(([field, value]) => ({ field, value }));
  const primarySections = buildGstr1SectionWorkbookData(normalizedPayload, false);
  const fallbackSections = buildSectionWorkbookData(getGstr1SectionSourceData(normalizedPayload));

  return {
    metaRows,
    sectionSheets: mergeWorkbookSectionsByName(primarySections.length ? primarySections : fallbackSections),
    rawFlattenedRows: buildRawFlattenedRows(normalizedPayload, false, meta.rtnprd || ""),
    rawJsonRows: buildRawJsonRows(normalizedPayload, false, meta.rtnprd || ""),
  };
}

function buildGstr1WorkbookXml(payload) {
  const workbookData = buildGstr1WorkbookData(payload);
  ensureSchemaColumns("GSTR1", ["field", "value"], null);
  ensureSchemaForSections("GSTR1", workbookData.sectionSheets, GSTR1_COLUMN_LABELS);
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Cell">
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2EC"/>
   </Borders>
 </Style>
 <Style ss:ID="CellAlt">
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#F8FBFF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2EC"/>
   </Borders>
 </Style>
 <Style ss:ID="NumberCell">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="Standard"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2EC"/>
   </Borders>
 </Style>
 <Style ss:ID="NumberCellAlt">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Interior ss:Color="#F8FBFF" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="Standard"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2EC"/>
   </Borders>
 </Style>
 <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#1F4E78" ss:Pattern="Solid"/>
   <Font ss:Color="#FFFFFF" ss:Bold="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#163A5A"/>
   </Borders>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", workbookData.metaRows, ["field", "value"], {
    stripedRows: true,
    autoFilter: true,
    schemaReturnType: "GSTR1",
  })}
 ${workbookData.sectionSheets.map((section) => buildSpreadsheetWorksheet(section.name, section.rows, null, {
    stripedRows: true,
    autoFilter: true,
    headerLabelMap: GSTR1_COLUMN_LABELS,
    schemaReturnType: "GSTR1",
  })).join("\n ")}
</Workbook>`;
}

function buildGstr2aWorkbookData(payload, includePeriod) {
  const meta = extractWorkbookMeta(payload);
  const reportPeriod = meta.rtnprd || "";
  const excludedSectionNames = new Set([
    "URL", "FILE_URL", "FILEURL", "DATE", "TIME", "TIMESTAMP", "RC", "STATUS", "MSG", "MESSAGE",
    "__PORTALRESPONSE", "__LINKEDPAYLOADS", "__LINKEDFILEURLS", "__SOURCEFILEURLS",
    "DATA",
  ]);
  const generatedOn = String(meta.generated_on || "");
  const generatedParts = generatedOn ? generatedOn.split(/\s+/) : [];
  const downloadDate = meta.file_date || generatedParts[0] || "";
  const downloadTime = meta.file_time || generatedParts.slice(1).join(" ") || "";
  const metaRows = [
    ["GSTIN", meta.gstin || ""],
    ["Return Period", reportPeriod],
    ["Status", meta.status || ""],
    ["Download Date", downloadDate],
    ["Download Time", downloadTime],
    ["Generated On", meta.generated_on || ""],
    ["Version", meta.version || ""],
    ["File URL", meta.file_url || ""],
    ["Link Status", meta.link_status || "N/A"],
  ].map(([field, value]) => ({
    ...(includePeriod ? { report_period: reportPeriod } : {}),
    field,
    value,
  }));

  const withPeriodAndRowNo = (rows) =>
    (rows || []).map((row, index) => ({
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      row_no: index + 1,
      ...(row || {}),
    }));

  const mainSections = buildGstr2aSectionWorkbookRows(payload, false).map((section) => ({
    name: section.name,
    rows: withPeriodAndRowNo((section.rows || []).map((row) => {
      const next = { ...(row || {}) };
      delete next.row_no;
      delete next.report_period;
      return next;
    })),
  })).filter((section) => !excludedSectionNames.has(String(section.name || "").toUpperCase()));
  const portalSections = payload && payload.__portalResponse
    ? buildGstr2aSectionWorkbookRows(payload.__portalResponse, false)
        .filter((section) => !excludedSectionNames.has(String(section.name || "").toUpperCase()))
        .filter((section) => String(section.name || "").toUpperCase() !== "DATA")
        .map((section) => ({
          name: `GSTN_${section.name}`,
          rows: withPeriodAndRowNo((section.rows || []).map((row) => {
            const next = { ...(row || {}) };
            delete next.row_no;
            delete next.report_period;
            return next;
          })),
        }))
    : [];
  const linkedSectionGroups = dedupeStructuredPayloadChunks((payload && payload.__linkedPayloads) || [], "GSTR2A").map((linkedPayload) =>
    buildGstr2aSectionWorkbookRows(linkedPayload, false)
      .filter((section) => !excludedSectionNames.has(String(section.name || "").toUpperCase()))
      .map((section) => ({
        name: section.name,
        rows: withPeriodAndRowNo((section.rows || []).map((row) => {
          const next = { ...(row || {}) };
          delete next.row_no;
          delete next.report_period;
          return next;
        })),
      })),
  ).filter((sections) => sections.length);
  const primarySections = linkedSectionGroups.length ? linkedSectionGroups[0] : mainSections;
  const additionalLinkedSections = linkedSectionGroups.slice(1).flatMap((sections, payloadIndex) =>
    sections.map((section) => ({
      name: `LINKED_${payloadIndex + 2}_${section.name}`,
      rows: section.rows || [],
    })),
  );

  return {
    metaRows,
    sectionSheets: mergeWorkbookSectionsByName(
      primarySections.concat(portalSections, additionalLinkedSections),
    ),
    rawFlattenedRows: buildRawFlattenedRows(payload, includePeriod, reportPeriod),
    rawJsonRows: buildRawJsonRows(payload, includePeriod, reportPeriod),
  };
}

function buildGstr2aWorkbookXml(payload) {
  const workbookData = buildGstr2aWorkbookData(payload, false);
  ensureSchemaColumns("GSTR2A", ["field", "value"], null);
  ensureSchemaForSections("GSTR2A", workbookData.sectionSheets, null);
  ensureSchemaForSections("GSTR2A", [
    { rows: workbookData.rawFlattenedRows || [] },
    { rows: workbookData.rawJsonRows || [] },
  ], null);
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1F4E78" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="HeaderRow">
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Cell">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="Integer">
   <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
   <NumberFormat ss:Format="0"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="Decimal">
   <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
   <NumberFormat ss:Format="0.00"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="DateText">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
 </Styles>
${buildSpreadsheetWorksheet("Summary", workbookData.metaRows, ["field", "value"], {
  autoFilter: false,
  styleResolver: inferGstr2aSpreadsheetStyle,
  schemaReturnType: "GSTR2A",
})}
${workbookData.sectionSheets.map((section) => buildSpreadsheetWorksheet(section.name, section.rows, ["row_no"], {
  autoFilter: true,
  styleResolver: inferGstr2aSpreadsheetStyle,
  schemaReturnType: "GSTR2A",
})).join("\n ")}
${buildSpreadsheetWorksheet("Raw Flattened", workbookData.rawFlattenedRows, null, {
  hidden: true,
  freezeHeader: false,
  styleResolver: inferGstr2aSpreadsheetStyle,
  schemaReturnType: "GSTR2A",
})}
${buildSpreadsheetWorksheet("Raw JSON", workbookData.rawJsonRows, null, {
  hidden: true,
  freezeHeader: false,
  styleResolver: inferGstr2aSpreadsheetStyle,
  schemaReturnType: "GSTR2A",
})}
</Workbook>`;
}

function buildGenericWorkbookXml(payload) {
  const workbookData = buildGenericWorkbookData(payload, false);
  const sectionSheets = buildSectionWorkbookData(payload);
  ensureSchemaColumns("GENERIC", ["field", "value"], null);
  ensureSchemaForSections("GENERIC", sectionSheets, null);
  ensureSchemaForSections("GENERIC", [
    { rows: workbookData.rawFlattenedRows || [] },
    { rows: workbookData.rawJsonRows || [] },
  ], null);
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E8FB" ss:Pattern="Solid"/>
 </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", workbookData.metaRows, ["field", "value"], { schemaReturnType: "GENERIC" })}
 ${sectionSheets.map((section) => buildSpreadsheetWorksheet(section.name, section.rows, null, { schemaReturnType: "GENERIC" })).join("\n ")}
 ${buildSpreadsheetWorksheet("Raw Flattened", workbookData.rawFlattenedRows, null, { hidden: true, schemaReturnType: "GENERIC" })}
 ${buildSpreadsheetWorksheet("Raw JSON", workbookData.rawJsonRows, null, { hidden: true, schemaReturnType: "GENERIC" })}
</Workbook>`;
}

function buildCombinedGstr2bWorkbookXml(payloads) {
  const combinedSummary = buildCombinedSummaryRows(payloads);
  const combined = {
    itcRows: [],
    supplierSummaryRows: [],
    invoiceRows: [],
    importRows: [],
  };

  (payloads || []).forEach((payload) => {
    const data = buildGstr2bWorkbookData(payload, true);
    (data.itcRows || []).forEach((row) => {
      combined.itcRows.push({
        report_period: payload && payload.data ? payload.data.rtnprd || "" : "",
        itc_group: row.itc_group,
        type: row.type,
        txval: row.txval,
        igst: row.igst,
        cgst: row.cgst,
        sgst: row.sgst,
        cess: row.cess,
      });
    });
    (data.supplierSummaryRows || []).forEach((row) => combined.supplierSummaryRows.push(row));
    (data.invoiceRows || []).forEach((row) => combined.invoiceRows.push(row));
    (data.importRows || []).forEach((row) => combined.importRows.push(row));
  });

  ensureSchemaColumns("GSTR2B", combinedSummary.columns, null);
  ensureSchemaForSections("GSTR2B", [
    { name: "ITC Summary", rows: combined.itcRows },
    { name: "Supplier Summary", rows: combined.supplierSummaryRows },
    { name: "B2B Invoices", rows: combined.invoiceRows },
    { name: "Imports", rows: combined.importRows },
  ], null);
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E8FB" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", combinedSummary.rows, combinedSummary.columns, { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("ITC Summary", combined.itcRows, ["report_period", "itc_group", "type", "txval", "igst", "cgst", "sgst", "cess"], { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("Supplier Summary", combined.supplierSummaryRows, null, { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("B2B Invoices", combined.invoiceRows, null, { schemaReturnType: "GSTR2B" })}
 ${buildSpreadsheetWorksheet("Imports", combined.importRows, null, { schemaReturnType: "GSTR2B" })}
</Workbook>`;
}

function buildCombinedGenericWorkbookXml(payloads) {
  const combinedSummary = buildCombinedSummaryRows(payloads);
  const combined = {
    rawFlattenedRows: [],
  };

  (payloads || []).forEach((payload) => {
    const data = buildGenericWorkbookData(payload, true);
    (data.rawFlattenedRows || []).forEach((row) => combined.rawFlattenedRows.push(row));
  });

  ensureSchemaColumns("GENERIC", combinedSummary.columns, null);
  ensureSchemaForSections("GENERIC", [{ name: "Raw Flattened", rows: combined.rawFlattenedRows }], null);
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E8FB" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", combinedSummary.rows, combinedSummary.columns, { schemaReturnType: "GENERIC" })}
 ${buildSpreadsheetWorksheet("Raw Flattened", combined.rawFlattenedRows, ["report_period", "field", "value"], { hidden: true, schemaReturnType: "GENERIC" })}
</Workbook>`;
}

function buildCombinedGstr1WorkbookXml(payloads) {
  const workbookState = createGstr1WorkbookState();
  (payloads || []).forEach((payload) => appendGstr1PayloadToWorkbookState(workbookState, payload));
  return finalizeGstr1WorkbookXml(workbookState);
}

function createGstr1WorkbookState(options) {
  const fields = ["gstin", "rtnprd", "portal_status", "message", "date", "time", "generated_on", "version", "file_url", "status"];
  const configuredMaxRows = Number(options && options.maxWorksheetRows);
  const maxWorksheetRows = Number.isFinite(configuredMaxRows) && configuredMaxRows > 0
    ? Math.floor(configuredMaxRows)
    : XLSX_MAX_WORKSHEET_DATA_ROWS;
  return {
    fields,
    maxWorksheetRows,
    lightweightMode: options && Object.prototype.hasOwnProperty.call(options, "lightweightMode")
      ? !!options.lightweightMode
      : GSTR1_DEFAULT_LIGHTWEIGHT_MODE,
    periods: [],
    valuesByField: new Map(fields.map((field) => [field, { field }])),
    sectionSheetsByBaseName: new Map(),
    sectionBaseOrder: [],
  };
}

function sanitizeGstr1RowForConversion(row) {
  if (!row || typeof row !== "object") return row;
  const next = {};
  Object.keys(row).forEach((key) => {
    if (/(check.?sum|chksum|chksm)$/i.test(String(key || ""))) return;
    if (String(key || "").toLowerCase() === "row_no") return;
    next[key] = row[key];
  });
  return next;
}

function getEnabledGstr1SectionFilterSet() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(GSTR1_SECTION_FILTER_STORAGE_KEY);
    if (!raw || !String(raw).trim()) return null;
    const parts = String(raw)
      .split(",")
      .map((v) => String(v || "").trim().toLowerCase().replace(/[\s_\-]/g, ""))
      .filter(Boolean);
    if (!parts.length) return null;
    return new Set(parts);
  } catch (err) {
    return null;
  }
}

function shouldIncludeGstr1Section(sectionName) {
  const filterSet = getEnabledGstr1SectionFilterSet();
  if (!filterSet || !filterSet.size) return true;
  const normalized = String(sectionName || "").toLowerCase().replace(/[\s_\-]/g, "");
  return filterSet.has(normalized);
}

function dedupeGstr1SectionRows(sectionName, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const preferredKeys = [
    "ctin",
    "gstin",
    "inv_inum",
    "inv_idt",
    "nt_nt_num",
    "nt_nt_dt",
    "inum",
    "idt",
    "docs_num",
    "doc_det_docs_num",
    "data_hsn_sc",
    "hsn_sc",
    "txval",
    "rt",
  ];
  const signature = (row) => {
    const r = row || {};
    const picked = preferredKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(r, key))
      .map((key) => `${key}:${JSON.stringify(r[key])}`);
    if (picked.length) return picked.join("|");
    const keys = Object.keys(r).filter((k) => k !== "row_no" && k !== "report_period").sort();
    return keys.map((key) => `${key}:${JSON.stringify(r[key])}`).join("|");
  };
  return list.filter((row) => {
    const key = signature(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildGstr1CombinedSections(payload, period) {
  const normalizedPayload =
    payload && payload.__gstr1SectionsConsolidated
      ? payload
      : consolidateGstr1PayloadSections(payload);
  const sections = buildGstr1SectionWorkbookData(normalizedPayload, true);
  const fallbackSections = buildSectionWorkbookData(getGstr1SectionSourceData(normalizedPayload)).map((section) => ({
    name: section.name,
    rows: (section.rows || []).map((row) => ({
      ...(period ? { report_period: period } : {}),
      ...(row || {}),
    })),
  }));
  const computed = (sections.length ? sections : fallbackSections).map((section) => ({
    name: section.name,
    // Keep all rows to avoid accidental data loss from aggressive dedupe.
    rows: (section.rows || []).map(sanitizeGstr1RowForConversion),
  }));
  return computed;
}

function appendRowsToGstr1WorkbookState(state, baseName, rows) {
  if (!state || !baseName || !Array.isArray(rows) || !rows.length) return;
  if (!state.sectionSheetsByBaseName.has(baseName)) {
    state.sectionSheetsByBaseName.set(baseName, [{ name: baseName, rows: [] }]);
    state.sectionBaseOrder.push(baseName);
  }

  const perSheetLimit = Number(state.maxWorksheetRows) > 0 ? Number(state.maxWorksheetRows) : MAX_WORKSHEET_ROWS;
  const sheets = state.sectionSheetsByBaseName.get(baseName);
  let sheet = sheets[sheets.length - 1];
  rows.forEach((row) => {
    if ((sheet.rows || []).length >= perSheetLimit) {
      sheet = { name: buildWorksheetChunkName(baseName, sheets.length), rows: [] };
      sheets.push(sheet);
    }
    sheet.rows.push(row || {});
  });
}

function appendGstr1MetaToWorkbookState(state, payload) {
  if (!state || !payload) return;
  const meta = extractWorkbookMeta(payload);
  const period = meta.rtnprd || "";
  if (period && !state.periods.includes(period)) {
    state.periods.push(period);
  }
  if (period) {
    state.valuesByField.get("gstin")[period] = meta.gstin || "";
    state.valuesByField.get("rtnprd")[period] = meta.rtnprd || "";
    state.valuesByField.get("portal_status")[period] = meta.status || "";
    state.valuesByField.get("message")[period] = meta.message || "";
    state.valuesByField.get("date")[period] = meta.file_date || "";
    state.valuesByField.get("time")[period] = meta.file_time || "";
    state.valuesByField.get("generated_on")[period] = meta.generated_on || "";
    state.valuesByField.get("version")[period] = meta.version || "";
    state.valuesByField.get("file_url")[period] = meta.file_url || "";
    state.valuesByField.get("status")[period] = meta.link_status || "";
  }
}

function isGstr1HsnSectionName(sectionName) {
  const normalized = String(sectionName || "").toLowerCase().replace(/[\s_\-]/g, "");
  return normalized === "hsn";
}

function createGstr1HsnBulkAccumulator() {
  return {
    byHsn: new Map(),
    byPeriod: new Map(),
    manager: null,
    threshold: 45000,
    spilled: false,
    spillKey: `gc-returns-pro-gstr1-hsnspill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

function mergeNumericAndSparseTextRow(target, source, skipKeysSet) {
  const out = target || {};
  const src = source || {};
  Object.keys(src).forEach((key) => {
    if (skipKeysSet && skipKeysSet.has(String(key || "").toLowerCase())) return;
    const value = src[key];
    const n = Number(value);
    if (Number.isFinite(n)) {
      out[key] = (Number(out[key]) || 0) + n;
    } else if ((out[key] === "" || out[key] == null) && value != null && String(value).trim() !== "") {
      out[key] = value;
    }
  });
  return out;
}

function upsertHsnAggregates(acc, row) {
  const source = row || {};
  const hsnCode = String(source.hsn_number || source.data_hsn_sc || source.hsn_sc || source.hsn_data_hsn_sc || "").trim();
  const period = String(source.report_period || "").trim();
  const hsnSkip = new Set(["report_period", "row_no", "hsn_number", "data_hsn_sc", "hsn_sc", "hsn_data_hsn_sc"]);
  const periodSkip = new Set(["report_period", "row_no", "hsn_number", "data_hsn_sc", "hsn_sc", "hsn_data_hsn_sc", "desc", "description", "uqc", "unit"]);

  if (hsnCode) {
    const current = acc.byHsn.get(hsnCode) || { hsn_number: hsnCode };
    acc.byHsn.set(hsnCode, mergeNumericAndSparseTextRow(current, source, hsnSkip));
  }
  if (period) {
    const currentP = acc.byPeriod.get(period) || { report_period: period };
    acc.byPeriod.set(period, mergeNumericAndSparseTextRow(currentP, source, periodSkip));
  }
}

async function spillHsnAccumulatorIfNeeded(acc, force) {
  if (!acc) return;
  const size = acc.byHsn.size + acc.byPeriod.size;
  if (!force && size < acc.threshold) return;
  if (!acc.manager) {
    acc.manager = new SectionBufferManager({
      cache: null,
      useIndexedDb: true,
      dbName: acc.spillKey,
      basePrefix: "https://gc-returns-pro.local/gstr1/hsnspill",
      bufferSize: 1000,
    });
  }
  const hRows = Array.from(acc.byHsn.values());
  const pRows = Array.from(acc.byPeriod.values());
  for (let i = 0; i < hRows.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await acc.manager.append("byhsn", hRows[i]);
  }
  for (let i = 0; i < pRows.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await acc.manager.append("byperiod", pRows[i]);
  }
  await acc.manager.flushAll();
  acc.byHsn.clear();
  acc.byPeriod.clear();
  acc.spilled = true;
}

async function finalizeGstr1HsnAccumulator(acc) {
  if (!acc) return { hsnRows: [], periodRows: [] };
  await spillHsnAccumulatorIfNeeded(acc, true);
  const finalByHsn = new Map();
  const finalByPeriod = new Map();
  const mergeRowMap = (targetMap, keyField, row) => {
    const key = String((row && row[keyField]) || "").trim();
    if (!key) return;
    const current = targetMap.get(key) || { [keyField]: key };
    const skip = new Set(keyField === "hsn_number"
      ? ["report_period", "row_no", "hsn_number", "data_hsn_sc", "hsn_sc", "hsn_data_hsn_sc"]
      : ["report_period", "row_no", "hsn_number", "data_hsn_sc", "hsn_sc", "hsn_data_hsn_sc", "desc", "description", "uqc", "unit"]);
    targetMap.set(key, mergeNumericAndSparseTextRow(current, row, skip));
  };

  if (acc.manager) {
    const hMeta = acc.manager.getSectionMeta("byhsn");
    for (let i = 0; i < hMeta.chunks; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await acc.manager.readSectionChunkRows("byhsn", i);
      rows.forEach((row) => mergeRowMap(finalByHsn, "hsn_number", row));
    }
    const pMeta = acc.manager.getSectionMeta("byperiod");
    for (let i = 0; i < pMeta.chunks; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await acc.manager.readSectionChunkRows("byperiod", i);
      rows.forEach((row) => mergeRowMap(finalByPeriod, "report_period", row));
    }
    await acc.manager.clearAll();
  }

  const hsnRows = Array.from(finalByHsn.values()).sort((a, b) => String(a.hsn_number || "").localeCompare(String(b.hsn_number || "")));
  const periodRows = Array.from(finalByPeriod.values()).sort((a, b) => periodKey(a.report_period) - periodKey(b.report_period));
  return { hsnRows, periodRows };
}

function appendGstr1PayloadToWorkbookState(state, payload) {
  if (!state || !payload) return;
  payload =
    payload && payload.__gstr1SectionsConsolidated
      ? payload
      : consolidateGstr1PayloadSections(payload);
  appendGstr1MetaToWorkbookState(state, payload);

  const meta = extractWorkbookMeta(payload);
  const period = meta.rtnprd || "";
  buildGstr1CombinedSections(payload, period).forEach((section) => {
    appendRowsToGstr1WorkbookState(state, section.name, section.rows || []);
  });
}

function finalizeGstr1WorkbookXml(state) {
  const periods = state && Array.isArray(state.periods) ? state.periods : [];
  const summaryRows = state && state.valuesByField
    ? state.fields.map((field) => state.valuesByField.get(field))
    : [];
  const sectionSheets = [];

  (state && Array.isArray(state.sectionBaseOrder) ? state.sectionBaseOrder : []).forEach((baseName) => {
    const sheets = state.sectionSheetsByBaseName.get(baseName) || [];
    sheets.forEach((sheet) => {
      sectionSheets.push(sheet);
    });
  });

  ensureSchemaColumns("GSTR1", ["field"].concat(periods), null);
  ensureSchemaForSections(
    "GSTR1",
    sectionSheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows || [] })),
    GSTR1_COLUMN_LABELS,
  );
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Cell">
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
 </Style>
 <Style ss:ID="CellAlt">
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
 </Style>
 <Style ss:ID="NumberCell">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="Standard"/>
 </Style>
 <Style ss:ID="NumberCellAlt">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="Standard"/>
 </Style>
 <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Font ss:Bold="1"/>
 </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", summaryRows, ["field"].concat(periods), {
    stripedRows: true,
    autoFilter: true,
    schemaReturnType: "GSTR1",
  })}
 ${sectionSheets.map((sheet) => buildSpreadsheetWorksheet(sheet.name, sheet.rows, ["report_period"], {
    stripedRows: true,
    autoFilter: true,
    headerLabelMap: GSTR1_COLUMN_LABELS,
    schemaReturnType: "GSTR1",
  })).join("\n ")}
</Workbook>`;
}

function collectGstr1WorkbookSheets(state) {
  const periods = state && Array.isArray(state.periods) ? state.periods : [];
  const summaryRows = state && state.valuesByField ? state.fields.map((field) => state.valuesByField.get(field)) : [];
  const sectionSheets = [];
  const DOC_ISSUE_NUM_LABELS = {
    1: "Invoices for outward supply",
    2: "Invoices for inward supply from unregistered person",
    3: "Revised Invoice",
    4: "Debit Note",
    5: "Credit Note",
    6: "Receipt voucher",
    7: "Payment Voucher",
    8: "Refund voucher",
    9: "Delivery Challan for job work",
    10: "Delivery Challan for supply on approval",
    11: "Delivery Challan in case of liquid gas",
    12: "Delivery Challan in cases other than by way of supply (excluding at S no. 9 to 11)",
  };
  const DOC_NUM_KEYS = ["doc_det_docs_num", "docs_num"];
  const HSN_CODE_KEYS = ["data_hsn_sc", "hsn_sc", "hsn_data_hsn_sc"];
  const isHsnSheetName = (name) => {
    const normalized = String(name || "").toLowerCase().replace(/[\s_\-]/g, "");
    return normalized === "hsn";
  };

  const mapDocIssueRow = (row) => {
    const out = { ...(row || {}) };
    DOC_NUM_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(out, key)) return;
      const n = Number(out[key]);
      if (!Number.isFinite(n)) return;
      if (DOC_ISSUE_NUM_LABELS[n]) out[key] = DOC_ISSUE_NUM_LABELS[n];
    });
    return out;
  };

  const getOrderedGstr1Columns = (rows, sheetName) => {
    const cols = getSpreadsheetColumns(rows || [], []);
    const normalized = cols.map((col) => normalizeSpreadsheetColumnKey(col));
    const upperSheet = String(sheetName || "").toUpperCase();
    if (upperSheet === "DOC_ISSUE") {
      const preferred = [
        "report_period",
        "flag",
        "doc_d",
        "doc_det_docs_num",
        "docs_num",
        "doc_det_docs_totnum",
        "docs_totnum",
        "doc_det_docs_from",
        "docs_from",
        "doc_det_docs_to",
        "docs_to",
        "doc_det_docs_net_issue",
        "docs_net_issue",
        // Keep actual document number as the last business column.
        "doc_det_doc_num",
        "doc_num",
      ];
      const rank = new Map(preferred.map((key, idx) => [key, idx]));
      const withMeta = cols.map((col, idx) => ({
        col,
        idx,
        norm: normalized[idx],
        rank: rank.has(normalized[idx]) ? rank.get(normalized[idx]) : 9999,
      }));
      withMeta.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.idx - b.idx;
      });
      return withMeta.map((item) => item.col);
    }
    if (upperSheet === "HSN") {
      const preferred = ["hsn_number"].concat(cols.map((col, idx) => normalized[idx]).filter((n) => n !== "hsn_number"));
      const rank = new Map(preferred.map((key, idx) => [key, idx]));
      const withMeta = cols.map((col, idx) => ({
        col,
        idx,
        norm: normalized[idx],
        rank: rank.has(normalized[idx]) ? rank.get(normalized[idx]) : 9999,
      }));
      withMeta.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.idx - b.idx;
      });
      return withMeta.map((item) => item.col);
    }
    const priority = [
      // Always first
      "report_period",
      // GSTIN / party context first
      "gstin",
      "ctin",
      "gstin_of_supplier",
      "gstin_of_recipient",
      "pos",
      // Invoice / note identity
      "inv_inum",
      "inum",
      "nt_nt_num",
      "nt_num",
      "inv_idt",
      "idt",
      "nt_nt_dt",
      "nt_dt",
      // Invoice value + reverse charge
      "inv_val",
      "val",
      "nt_val",
      "inv_rchrg",
      "rchrg",
      "reverse_charge",
      // Rate and taxable
      "inv_itms_itm_det_rt",
      "nt_itms_itm_det_rt",
      "itms_itm_det_rt",
      "data_rt",
      "rt",
      "inv_itms_itm_det_txval",
      "nt_itms_itm_det_txval",
      "itms_itm_det_txval",
      "data_txval",
      "txval",
      "taxable_value",
      // Tax amounts
      "inv_itms_itm_det_iamt",
      "nt_itms_itm_det_iamt",
      "itms_itm_det_iamt",
      "data_iamt",
      "iamt",
      "inv_itms_itm_det_camt",
      "nt_itms_itm_det_camt",
      "itms_itm_det_camt",
      "data_camt",
      "camt",
      "inv_itms_itm_det_samt",
      "nt_itms_itm_det_samt",
      "itms_itm_det_samt",
      "data_samt",
      "samt",
      "inv_itms_itm_det_csamt",
      "nt_itms_itm_det_csamt",
      "itms_itm_det_csamt",
      "data_csamt",
      "csamt",
    ];
    const rank = new Map(priority.map((key, idx) => [key, idx]));
    const withMeta = cols.map((col, idx) => ({
      col,
      idx,
      norm: normalized[idx],
      rank: rank.has(normalized[idx]) ? rank.get(normalized[idx]) : 9999,
    }));
    withMeta.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.idx - b.idx;
    });
    return withMeta.map((item) => item.col);
  };

  const aggregateHsnRows = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    const grouped = new Map();
    const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
    const toNum = (v) => {
      if (isNumber(v)) return v;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    list.forEach((row) => {
      const source = row || {};
      const hsnKey = HSN_CODE_KEYS.find((key) => Object.prototype.hasOwnProperty.call(source, key));
      const code = hsnKey
        ? String(source[hsnKey] || "").trim()
        : String(source.hsn_number || "").trim();
      if (!code) return;
      if (!grouped.has(code)) {
        grouped.set(code, { ...source });
      } else {
        const target = grouped.get(code);
        Object.keys(source).forEach((key) => {
          if (key === "report_period" || key === "row_no") return;
          const left = toNum(target[key]);
          const right = toNum(source[key]);
          if (left !== null && right !== null) {
            target[key] = left + right;
          } else if ((target[key] === "" || target[key] == null) && source[key] != null) {
            target[key] = source[key];
          }
        });
      }
    });
    return Array.from(grouped.entries()).map(([hsnNumber, row]) => {
      const next = { ...(row || {}) };
      delete next.report_period;
      delete next.row_no;
      HSN_CODE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
      });
      return {
        hsn_number: hsnNumber,
        ...next,
      };
    });
  };

  const transformGstr1SheetRows = (name, rows) => {
    const upper = String(name || "").toUpperCase();
    if (upper === "DOC_ISSUE" && !(state && state.lightweightMode)) return (rows || []).map(mapDocIssueRow);
    // Keep HSN consolidated to control workbook size and match expected compact layout.
    if (upper === "HSN") return aggregateHsnRows(rows || []);
    return rows || [];
  };

  (state && Array.isArray(state.sectionBaseOrder) ? state.sectionBaseOrder : []).forEach((baseName) => {
    if (String(baseName || "").toUpperCase() === "DATA") return;
    const sheets = state.sectionSheetsByBaseName.get(baseName) || [];
    sheets.forEach((sheet) => {
      sectionSheets.push(sheet);
    });
  });

  const toSampleSheetName = (name) => {
    const upper = String(name || "").toUpperCase();
    const map = {
      B2B: "b2b",
      B2BA: "b2b_amend",
      B2CS: "b2c_small",
      B2CSA: "b2c_small_amend",
      B2CL: "b2c_large",
      B2CLA: "b2c_large_amend",
      CDNR: "cn_dn_regd",
      CDNRA: "cn_dn_regd_amend",
      CDNUR: "cn_dn_unregd",
      CDNURA: "cn_dn_unregd_amend",
      EXP: "export",
      EXPA: "export_amend",
      AT: "adv_recd",
      ATA: "adv_recd_amend",
      ATADJ: "adv_adj",
      ATADJA: "adv_adj_amend",
      NIL: "nil_exempt_nongst",
      HSN: "hsn_sac_summary",
      DOCS: "doc_issue",
      DOC_ISSUE: "doc_issue",
      SUMMARY: "summary",
    };
    return map[upper] || String(name || "").toLowerCase();
  };

  return [
    {
      name: "summary",
      rows: summaryRows,
      columns: getSpreadsheetColumns(summaryRows, ["field"].concat(periods)),
      options: { schemaReturnType: "GSTR1" },
    },
  ].concat(sectionSheets.map((sheet) => {
    const transformedRows = transformGstr1SheetRows(sheet.name, sheet.rows).map((row) => {
      const next = { ...(row || {}) };
      if (Object.prototype.hasOwnProperty.call(next, "row_no")) delete next.row_no;
      if (isHsnSheetName(sheet.name) && Object.prototype.hasOwnProperty.call(next, "report_period")) delete next.report_period;
      return next;
    });
    return {
      name: toSampleSheetName(sheet.name),
      rows: transformedRows,
      columns: getOrderedGstr1Columns(transformedRows, sheet.name),
      options: {
        schemaReturnType: "GSTR1",
        headerLabelMap: state && state.lightweightMode ? null : GSTR1_COLUMN_LABELS,
      },
    };
  })).concat((() => {
    const hasExplicitPeriodSheet = sectionSheets.some((sheet) => String(sheet && sheet.name || "").toUpperCase() === "HSN0PERIODWISE");
    if (hasExplicitPeriodSheet) return [];
    const hsnPeriodTotals = new Map();
    const addToPeriodTotals = (period, key, value) => {
      if (!period) return;
      if (!Number.isFinite(value)) return;
      if (!hsnPeriodTotals.has(period)) hsnPeriodTotals.set(period, { report_period: period });
      const row = hsnPeriodTotals.get(period);
      row[key] = (Number(row[key]) || 0) + value;
    };
    const skipKeys = new Set([
      "report_period",
      "row_no",
      "hsn_number",
      "data_hsn_sc",
      "hsn_sc",
      "hsn_data_hsn_sc",
      "desc",
      "description",
      "uqc",
      "unit",
    ]);
    sectionSheets.forEach((sheet) => {
      if (!isHsnSheetName(sheet && sheet.name)) return;
      const rows = sheet && Array.isArray(sheet.rows) ? sheet.rows : [];
      rows.forEach((r) => {
        const row = r || {};
        const period = String(row.report_period || "").trim();
        if (!period) return;
        Object.keys(row).forEach((key) => {
          if (skipKeys.has(String(key || "").toLowerCase())) return;
          const n = Number(row[key]);
          if (!Number.isFinite(n)) return;
          addToPeriodTotals(period, key, n);
        });
      });
    });
    const periodRows = Array.from(hsnPeriodTotals.values()).sort((a, b) => periodKey(a.report_period) - periodKey(b.report_period));
    const extra = [];
    if (periodRows.length) {
      extra.push({
        name: "hsn0periodwise",
        rows: periodRows,
        columns: getSpreadsheetColumns(periodRows, ["report_period"]),
        options: { schemaReturnType: "GSTR1" },
      });
    }
    return extra;
  })()).concat([
    {
      name: "nil_returns",
      rows: [{ status: "" }],
      columns: ["status"],
      options: { schemaReturnType: "GSTR1" },
    },
  ]);
}

async function buildGstr1WorkbookXlsxBlob(state, options) {
  const sheets = collectGstr1WorkbookSheets(state);
  const opts = options && typeof options === "object" ? options : {};
  return buildXlsxBlobStreamingFromSheets(sheets, {
    compression: opts.compression === undefined ? false : !!opts.compression,
    releaseRows: true,
  });
}

function collectGstr2bWorkbookSheets(payload, includePeriod) {
  const shouldIncludePeriod = !!includePeriod;
  const source = getGstr2bSectionSourceData(payload);
  const docdata = source && source.docdata && typeof source.docdata === "object" ? source.docdata : {};
  const cpsumm = source && source.cpsumm && typeof source.cpsumm === "object" ? source.cpsumm : {};
  const doc = docdata;
  const metaRows = [
    { ...(shouldIncludePeriod ? { report_period: source.rtnprd || "" } : {}), field: "gstin", value: source.gstin || "" },
    { ...(shouldIncludePeriod ? { report_period: source.rtnprd || "" } : {}), field: "rtnprd", value: source.rtnprd || "" },
    { ...(shouldIncludePeriod ? { report_period: source.rtnprd || "" } : {}), field: "generated_on", value: source.gendt || "" },
    { ...(shouldIncludePeriod ? { report_period: source.rtnprd || "" } : {}), field: "version", value: source.version || "" },
    { ...(shouldIncludePeriod ? { report_period: source.rtnprd || "" } : {}), field: "checksum", value: payload && payload.chksum ? payload.chksum : "" },
  ];

  const toDate = (value) => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;
    const iso = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const dmy = text.match(/^(\d{2})[-.](\d{2})[-.](\d{4})$/);
    if (dmy) return `${dmy[1]}/${dmy[2]}/${dmy[3]}`;
    return text;
  };
  const toMonthPeriod = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{2})(\d{4})$/);
    if (!match) return text;
    const monthIndex = Number(match[1]) - 1;
    const year = match[2];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (monthIndex < 0 || monthIndex > 11) return text;
    return `${months[monthIndex]}'${year.slice(-2)}`;
  };
  const stateCodeMap = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "28": "Andhra Pradesh",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman and Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
    "97": "Other Territory",
    "99": "Centre Jurisdiction",
  };
  const toPos = (value) => {
    const text = String(value == null ? "" : value).trim();
    if (!text) return "";
    const code = text.padStart(2, "0");
    return stateCodeMap[code] || text;
  };
  const toYesNo = (value) => {
    const text = String(value == null ? "" : value).trim().toUpperCase();
    if (!text) return "";
    if (["Y", "YES", "TRUE", "1"].includes(text)) return "Yes";
    if (["N", "NO", "FALSE", "0"].includes(text)) return "No";
    return String(value);
  };
  const toSource = (value) => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^E[\s-]?INV/i.test(text) || /^EINVOICE$/i.test(text)) return "E-Invoice";
    return text;
  };
  const toReason = (value) => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.toUpperCase() === "P") return "POS and supplier state are same but recipient state is different";
    return text;
  };
  const toInvoiceType = (value) => {
    const text = String(value || "").trim().toUpperCase();
    if (text === "R") return "Regular";
    return String(value || "");
  };
  const toNoteType = (value) => {
    const text = String(value || "").trim().toUpperCase();
    if (text === "C") return "Credit Note";
    if (text === "D") return "Debit Note";
    return String(value || "");
  };
  const toSupplyType = (value) => {
    const text = String(value || "").trim().toUpperCase();
    if (text === "R") return "Regular";
    return String(value || "");
  };
  const b2bRows = [];
  (Array.isArray(doc.b2b) ? doc.b2b : []).forEach((supplier) => {
    (Array.isArray(supplier && supplier.inv) ? supplier.inv : []).forEach((inv) => {
      b2bRows.push({
        gstin_of_supplier: supplier && supplier.ctin || "",
        trade_legal_name: supplier && supplier.trdnm || "",
        invoice_number: inv && inv.inum || "",
        invoice_type: toInvoiceType(inv && inv.typ),
        invoice_date: toDate(inv && inv.dt),
        invoice_value: inv && inv.val != null ? Number(inv.val) : "",
        place_of_supply: toPos(inv && inv.pos),
        reverse_charge: toYesNo(inv && inv.rev),
        taxable_value: inv && inv.txval != null ? Number(inv.txval) : "",
        igst: inv && inv.igst != null ? Number(inv.igst) : "",
        cgst: inv && inv.cgst != null ? Number(inv.cgst) : "",
        sgst: inv && inv.sgst != null ? Number(inv.sgst) : "",
        cess: inv && inv.cess != null ? Number(inv.cess) : "",
        gstr_period: toMonthPeriod(supplier && supplier.supprd),
        gstr_filing_date: toDate(supplier && supplier.supfildt),
        itc_availability: toYesNo(inv && inv.itcavl),
        reason: toReason(inv && inv.rsn),
        applicable_percent: "100%",
        source: toSource(inv && inv.srctyp),
        irn: inv && inv.irn || "",
        irn_date: toDate(inv && inv.irngendate),
      });
    });
  });

  const cdnrRows = [];
  (Array.isArray(doc.cdnr) ? doc.cdnr : []).forEach((supplier) => {
    (Array.isArray(supplier && supplier.nt) ? supplier.nt : []).forEach((nt) => {
      cdnrRows.push({
        gstin_of_supplier: supplier && supplier.ctin || "",
        trade_legal_name: supplier && supplier.trdnm || "",
        note_number: nt && nt.ntnum || "",
        note_type: toNoteType(nt && nt.typ),
        note_supply_type: toSupplyType(nt && nt.suptyp) || "Regular",
        note_date: toDate(nt && nt.dt),
        note_value: nt && nt.val != null ? Number(nt.val) : "",
        place_of_supply: toPos(nt && nt.pos),
        reverse_charge: toYesNo(nt && nt.rev),
        taxable_value: nt && nt.txval != null ? Number(nt.txval) : "",
        igst: nt && nt.igst != null ? Number(nt.igst) : "",
        cgst: nt && nt.cgst != null ? Number(nt.cgst) : "",
        sgst: nt && nt.sgst != null ? Number(nt.sgst) : "",
        cess: nt && nt.cess != null ? Number(nt.cess) : "",
        itc_reduce_flag: "NA",
        itc_reduce_igst: "NA",
        itc_reduce_cgst: "NA",
        itc_reduce_sgst: "NA",
        itc_reduce_cess: "NA",
        remarks: "No remarks available",
        gstr_period: toMonthPeriod(supplier && supplier.supprd),
        gstr_filing_date: toDate(supplier && supplier.supfildt),
        itc_availability: toYesNo(nt && nt.itcavl),
        reason: toReason(nt && nt.rsn),
        applicable_percent: "100%",
        source: toSource(nt && nt.srctyp),
        irn: nt && nt.irn || "",
        irn_date: toDate(nt && nt.irngendate),
      });
    });
  });

  const impgRows = (Array.isArray(doc.impg) ? doc.impg : []).map((item) => ({
    icegate_reference_date: toDate(item && item.refdt),
    port_code: item && item.portcode || "",
    boe_number: item && item.boenum || "",
    boe_date: toDate(item && item.boedt),
    taxable_value: item && item.txval != null ? Number(item.txval) : "",
    igst: item && item.igst != null ? Number(item.igst) : "",
    cess: item && item.cess != null ? Number(item.cess) : "",
  }));
  const sumNumber = (values) =>
    (values || []).reduce((acc, value) => acc + (value == null || value === "" ? 0 : Number(value) || 0), 0);
  const docTotalsB2b = {
    rows: b2bRows.length,
    txval: sumNumber(b2bRows.map((row) => row.taxable_value)),
    igst: sumNumber(b2bRows.map((row) => row.igst)),
    cgst: sumNumber(b2bRows.map((row) => row.cgst)),
    sgst: sumNumber(b2bRows.map((row) => row.sgst)),
    cess: sumNumber(b2bRows.map((row) => row.cess)),
  };
  const docTotalsCdnr = {
    rows: cdnrRows.length,
    txval: sumNumber(cdnrRows.map((row) => row.taxable_value)),
    igst: sumNumber(cdnrRows.map((row) => row.igst)),
    cgst: sumNumber(cdnrRows.map((row) => row.cgst)),
    sgst: sumNumber(cdnrRows.map((row) => row.sgst)),
    cess: sumNumber(cdnrRows.map((row) => row.cess)),
  };
  const cpB2b = Array.isArray(cpsumm.b2b) ? cpsumm.b2b : [];
  const cpCdnr = Array.isArray(cpsumm.cdnr) ? cpsumm.cdnr : [];
  const cpTotalsB2b = {
    rows: sumNumber(cpB2b.map((row) => row && row.ttldocs)),
    txval: sumNumber(cpB2b.map((row) => row && row.txval)),
    igst: sumNumber(cpB2b.map((row) => row && row.igst)),
    cgst: sumNumber(cpB2b.map((row) => row && row.cgst)),
    sgst: sumNumber(cpB2b.map((row) => row && row.sgst)),
    cess: sumNumber(cpB2b.map((row) => row && row.cess)),
  };
  const cpTotalsCdnr = {
    rows: sumNumber(cpCdnr.map((row) => row && row.ttldocs)),
    txval: sumNumber(cpCdnr.map((row) => row && row.txval)),
    igst: sumNumber(cpCdnr.map((row) => row && row.igst)),
    cgst: sumNumber(cpCdnr.map((row) => row && row.cgst)),
    sgst: sumNumber(cpCdnr.map((row) => row && row.sgst)),
    cess: sumNumber(cpCdnr.map((row) => row && row.cess)),
  };
  const nearlyEqual = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;
  const buildCpSummaryRow = (section, docTotals, cpTotals) => {
    const rowsMatch = docTotals.rows === cpTotals.rows ? "Yes" : "No";
    const txvalMatch = nearlyEqual(docTotals.txval, cpTotals.txval) ? "Yes" : "No";
    const igstMatch = nearlyEqual(docTotals.igst, cpTotals.igst) ? "Yes" : "No";
    const cgstMatch = nearlyEqual(docTotals.cgst, cpTotals.cgst) ? "Yes" : "No";
    const sgstMatch = nearlyEqual(docTotals.sgst, cpTotals.sgst) ? "Yes" : "No";
    const cessMatch = nearlyEqual(docTotals.cess, cpTotals.cess) ? "Yes" : "No";
    const overall = [rowsMatch, txvalMatch, igstMatch, cgstMatch, sgstMatch, cessMatch].every((value) => value === "Yes")
      ? "Yes"
      : "No";
    return {
      match: overall,
      period: source.rtnprd || "",
      section,
      doc_rows: docTotals.rows,
      cpsumm_rows: cpTotals.rows,
      rows_match: rowsMatch,
      doc_txval: docTotals.txval,
      cpsumm_txval: cpTotals.txval,
      txval_match: txvalMatch,
      doc_igst: docTotals.igst,
      cpsumm_igst: cpTotals.igst,
      igst_match: igstMatch,
      doc_cgst: docTotals.cgst,
      cpsumm_cgst: cpTotals.cgst,
      cgst_match: cgstMatch,
      doc_sgst: docTotals.sgst,
      cpsumm_sgst: cpTotals.sgst,
      sgst_match: sgstMatch,
      doc_cess: docTotals.cess,
      cpsumm_cess: cpTotals.cess,
      cess_match: cessMatch,
    };
  };
  const cpsummRows = [
    buildCpSummaryRow("B2B", docTotalsB2b, cpTotalsB2b),
    buildCpSummaryRow("B2B-CDNR", docTotalsCdnr, cpTotalsCdnr),
  ];

  const titleOnly = (name, title) => ({
    name,
    rows: [],
    columns: ["_title"],
    options: {
      skipDefaultHeader: true,
      customHeaderRows: [[title]],
    },
  });
  const headerOnly = (name, rows, merges) => ({
    name,
    rows: [],
    columns: Array.from({ length: 28 }, (_, i) => `c${i + 1}`),
    options: {
      skipDefaultHeader: true,
      omitEmptyCells: true,
      customHeaderRows: rows,
      merges: merges || [],
    },
  });
  const makeRows = (rows) => (rows || []).map((row) => {
    const out = {};
    for (let i = 0; i < 8; i += 1) {
      if (row && Object.prototype.hasOwnProperty.call(row, i)) out[`c${i + 1}`] = row[i];
    }
    return out;
  });
  const num = (v) => (v == null || v === "" ? 0 : Number(v));
  const nz = (v) => (v == null || v === "" ? "" : Number(v));
  const itc = source && source.itcsumm && typeof source.itcsumm === "object" ? source.itcsumm : {};
  const itcavl = itc && itc.itcavl && typeof itc.itcavl === "object" ? itc.itcavl : {};
  const itcunavl = itc && itc.itcunavl && typeof itc.itcunavl === "object" ? itc.itcunavl : {};
  const nonrev = itcavl.nonrevsup || {};
  const rev = itcavl.revsup || {};
  const imp = itcavl.imports || {};
  const oth = itcavl.othersup || {};
  const nonrevUn = itcunavl.nonrevsup || {};
  const itcAvailableSheet = {
    name: "ITC Available",
    columns: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    rows: makeRows([
      ["Credit which may be availed under FORM GSTR-3B"],
      ["Part A", "ITC Available - Credit may be claimed in relevant headings in GSTR-3B"],
      ["I", "All other ITC - Supplies from registered persons other than reverse charge (IMS)", "4(A)(5)", nz(nonrev.igst), nz(nonrev.cgst), nz(nonrev.sgst), nz(nonrev.cess), "Net input tax credit may be availed under Table 4(A)(5) of FORM GSTR-3B."],
      ["Details", "B2B - Invoices (IMS)", "", nz(nonrev.b2b && nonrev.b2b.igst), nz(nonrev.b2b && nonrev.b2b.cgst), nz(nonrev.b2b && nonrev.b2b.sgst), nz(nonrev.b2b && nonrev.b2b.cess), ""],
      [null, "B2B - Debit notes (IMS)", null, 0, 0, 0, 0],
      [null, "ECO - Documents (IMS)", null, 0, 0, 0, 0],
      [null, "B2B - Invoices (Amendment) (IMS)", null, 0, 0, 0, 0],
      [null, "B2B - Debit notes (Amendment) (IMS)", null, 0, 0, 0, 0],
      [null, "ECO - Documents (Amendment) (IMS)", null, 0, 0, 0, 0],
      ["II", "Inward Supplies from ISD", "4(A)(4)", 0, 0, 0, 0, "Net input tax credit may be availed under Table 4(A)(4) of FORM GSTR-3B."],
      ["Details", "ISD - Invoices", "", 0, 0, 0, 0, ""],
      [null, "ISD - Invoices (Amendment)", null, 0, 0, 0, 0],
      ["III", "Inward Supplies liable for reverse charge", "3.1(d) \n 4(A)(3)", nz(rev.igst), nz(rev.cgst), nz(rev.sgst), nz(rev.cess), "These supplies shall be declared in Table 3.1(d) of FORM GSTR-3B for payment of tax. \nNet input tax credit may be availed under Table 4(A)(3) of FORM GSTR-3B on payment of tax."],
      ["Details", "B2B - Invoices", "", nz(rev.b2b && rev.b2b.igst), nz(rev.b2b && rev.b2b.cgst), nz(rev.b2b && rev.b2b.sgst), nz(rev.b2b && rev.b2b.cess), ""],
      [null, "B2B - Debit notes", null, 0, 0, 0, 0],
      [null, "B2B - Invoices (Amendment)", null, 0, 0, 0, 0],
      [null, "B2B - Debit notes (Amendment)", null, 0, 0, 0, 0],
      ["IV", "Import of Goods", "4(A)(1)", nz(imp.igst), 0, 0, nz(imp.cess), "Net input tax credit may be availed under Table 4(A)(1) of FORM GSTR-3B."],
      ["Details", "IMPG - Import of goods from overseas", "", nz(imp.impg && imp.impg.igst), 0, 0, nz(imp.impg && imp.impg.cess), ""],
      [null, "IMPG (Amendment)", null, 0, 0, 0, 0],
      [null, "IMPGSEZ - Import of goods from SEZ ", null, 0, 0, 0, 0],
      [null, "IMPGSEZ (Amendment)", null, 0, 0, 0, 0],
      ["Part B", "ITC Available - Credit notes should be net off against relevant ITC available headings in GSTR-3B"],
      ["I", "Others", "4(A)", nz(oth.igst), nz(oth.cgst), nz(oth.sgst), nz(oth.cess), "Credit Notes shall be net-off against relevant ITC available tables [Table 4A(3,4,5)]. Liability against Credit Notes (Reverse Charge) shall be net-off in Table 3.1(d)."],
      ["Details", "B2B - Credit notes (IMS)", "4(A)(5)", nz(oth.cdnr && oth.cdnr.igst), nz(oth.cdnr && oth.cdnr.cgst), nz(oth.cdnr && oth.cdnr.sgst), nz(oth.cdnr && oth.cdnr.cess), ""],
      [null, "B2B - Credit notes (Amendment) (IMS)", "4(A)(5)", 0, 0, 0, 0],
      [null, "B2B - Credit notes (Reverse charge)", "3.1(d) \n 4(A)(3)", 0, 0, 0, 0],
      [null, "B2B - Credit notes (Reverse charge)(Amendment)", "3.1(d) \n 4(A)(3)", 0, 0, 0, 0],
      [null, "ISD - Credit notes", "4(A)(4)", 0, 0, 0, 0],
      [null, "ISD - Credit notes (Amendment) ", "4(A)(4)", 0, 0, 0, 0],
    ]),
    options: {
      skipDefaultHeader: true,
      omitEmptyCells: true,
      customHeaderRows: [
        ["FORM SUMMARY - ITC Available"],
        ["S.no.", "Heading", "GSTR-3B table", "Integrated Tax  (₹)", "Central Tax (₹)", "State/UT Tax (₹)", "Cess  (₹)", "Advisory"],
      ],
    },
  };
  const itcNotAvailableSheet = {
    name: "ITC not available",
    columns: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    rows: makeRows([
      ["Credit which may not be availed under FORM GSTR-3B"],
      ["Part A", "ITC Not Available"],
      ["I", "All other ITC - Supplies from registered persons other than reverse charge", "4(D)(2)", nz(nonrevUn.igst), nz(nonrevUn.cgst), nz(nonrevUn.sgst), nz(nonrevUn.cess), " Such credit shall not be taken and has to be reported in table 4(D)(2) of FORM GSTR-3B."],
      ["Details", "B2B - Invoices", "", nz(nonrevUn.b2b && nonrevUn.b2b.igst), nz(nonrevUn.b2b && nonrevUn.b2b.cgst), nz(nonrevUn.b2b && nonrevUn.b2b.sgst), nz(nonrevUn.b2b && nonrevUn.b2b.cess), ""],
      [null, "B2B - Debit notes", null, 0, 0, 0, 0],
      [null, "ECO - Documents", null, 0, 0, 0, 0],
      [null, "B2B - Invoices (Amendment)", null, 0, 0, 0, 0],
      [null, "B2B - Debit notes (Amendment)", null, 0, 0, 0, 0],
      [null, "ECO - Documents (Amendment)", null, 0, 0, 0, 0],
      ["II", "Inward Supplies from ISD", "4(D)(2)", 0, 0, 0, 0, " Such credit shall not be taken and has to be reported in table 4(D)(2) of FORM GSTR-3B."],
      ["Details", "ISD - Invoices", "", 0, 0, 0, 0, ""],
      [null, "ISD - Invoices (Amendment)", null, 0, 0, 0, 0],
      ["III", "Inward Supplies liable for reverse charge", "3.1(d) \n 4(D)(2)", 0, 0, 0, 0, "These supplies shall be declared in Table 3.1(d) of FORM GSTR-3B for payment of tax. \n However, credit will not be available on the same and has to be reported in table 4(D)(2) of FORM GSTR-3B."],
      ["Details", "B2B - Invoices", "", 0, 0, 0, 0, ""],
      [null, "B2B - Debit notes", null, 0, 0, 0, 0],
      [null, "B2B - Invoices (Amendment)", null, 0, 0, 0, 0],
      [null, "B2B - Debit notes (Amendment)", null, 0, 0, 0, 0],
      ["Part B", "ITC Not Available - Credit notes should be net off against relevant ITC available headings in GSTR-3B"],
      ["I", "Others", "4(A)", 0, 0, 0, 0, "Credit Notes should be net-off against relevant ITC available tables [Table 4A(3,4,5)]."],
      ["Details", "B2B - Credit notes", "4(A)(5)", 0, 0, 0, 0, ""],
      [null, "B2B - Credit notes (Amendment)", "4(A)(5)", 0, 0, 0, 0],
      [null, "B2B - Credit notes (Reverse charge)", "4(A)(3)", 0, 0, 0, 0],
      [null, "B2B - Credit notes (Reverse charge)(Amendment)", "4(A)(3)", 0, 0, 0, 0],
      [null, "ISD - Credit notes", "4(A)(4)", 0, 0, 0, 0],
      [null, "ISD - Credit notes (Amendment)", "4(A)(4)", 0, 0, 0, 0],
    ]),
    options: {
      skipDefaultHeader: true,
      omitEmptyCells: true,
      customHeaderRows: [
        ["FORM SUMMARY - ITC Not Available"],
        ["S.no.", "Heading", "GSTR-3B table", "Integrated Tax  (₹)", "Central Tax (₹)", "State/UT Tax (₹)", "Cess  (₹)", "Advisory"],
      ],
    },
  };
  const itcReversalSheet = {
    name: "ITC Reversal",
    columns: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    rows: makeRows([
      ["Credit which may not be availed under FORM GSTR-3B"],
      ["Part A", "ITC Reversed - Others"],
      ["I", "ITC Reversal on account of Rule 37A ", "4(B)(2)", 0, 0, 0, 0, "Such credit shall be reversed and has to be reported in table 4(B)(2) of FORM GSTR-3B."],
      ["Details", "B2B - Invoices", "", 0, 0, 0, 0, ""],
      [null, "B2B - Debit notes", null, 0, 0, 0, 0],
      [null, "B2B - Invoices (Amendment)", null, 0, 0, 0, 0],
      [null, "B2B - Debit notes (Amendment)", null, 0, 0, 0, 0],
    ]),
    options: {
      skipDefaultHeader: true,
      omitEmptyCells: true,
      customHeaderRows: [
        ["FORM SUMMARY - ITC Reversal"],
        ["S.no.", "Heading", "GSTR-3B table", "Integrated Tax  (₹)", "Central Tax (₹)", "State/UT Tax (₹)", "Cess  (₹)", "Advisory"],
      ],
    },
  };
  const itcRejectedSheet = {
    name: "ITC Rejected",
    columns: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    rows: makeRows([
      ["Credit which is rejected on IMS Dashboard"],
      ["Part A", "ITC Rejected - Others"],
      ["I", "All other ITC - Supplies from registered persons other than reverse charge (IMS)", "NA", 0, 0, 0, 0, "Input tax credit cannot be availed in FORM GSTR-3B."],
      ["Details", "B2B - Invoices (IMS)", "", 0, 0, 0, 0, ""],
      [null, "B2B - Debit notes (IMS)", null, 0, 0, 0, 0],
      [null, "ECO - Documents (IMS)", null, 0, 0, 0, 0],
      [null, "B2B - Invoices (Amendment) (IMS)", null, 0, 0, 0, 0],
      [null, "B2B - Debit notes (Amendment) (IMS)", null, 0, 0, 0, 0],
      [null, "ECO - Documents (Amendment) (IMS)", null, 0, 0, 0, 0],
      ["II", "Inward Supplies from ISD", "NA", 0, 0, 0, 0, "Input tax credit cannot be availed in FORM GSTR-3B."],
      ["Details", "ISD - Invoices", "", 0, 0, 0, 0, ""],
      [null, "ISD - Invoices (Amendment)", null, 0, 0, 0, 0],
      ["Part B", "Rejected Records - Credit notes rejected on IMS Dashboard"],
      ["I", "Others", "NA", 0, 0, 0, 0, "These Credit Notes are not eligible to net-off against relevant ITC available tables [Table 4A(4,5)]."],
      ["Details", "B2B - Credit notes (IMS)", "NA", 0, 0, 0, 0, ""],
      [null, "B2B - Credit notes (Amendment) (IMS)", "NA", 0, 0, 0, 0],
      [null, "ISD - Credit notes", "NA", 0, 0, 0, 0],
      [null, "ISD - Credit notes (Amendment)", "NA", 0, 0, 0, 0],
    ]),
    options: {
      skipDefaultHeader: true,
      omitEmptyCells: true,
      customHeaderRows: [
        ["FORM SUMMARY - ITC Rejected"],
        ["S.no.", "Heading", "GSTR-3B table", "Integrated Tax  (₹)", "Central Tax (₹)", "State/UT Tax (₹)", "Cess  (₹)", "Advisory"],
      ],
    },
  };

  const sheetSpecs = [
    {
      name: "Summary",
      rows: metaRows,
      columns: getSpreadsheetColumns(metaRows || [], shouldIncludePeriod ? ["report_period", "field", "value"] : ["field", "value"]),
      options: { schemaReturnType: "GSTR2B" },
    },
    {
      name: "cpsumm",
      rows: cpsummRows,
      columns: [
        "match",
        "period",
        "section",
        "doc_rows",
        "cpsumm_rows",
        "rows_match",
        "doc_txval",
        "cpsumm_txval",
        "txval_match",
        "doc_igst",
        "cpsumm_igst",
        "igst_match",
        "doc_cgst",
        "cpsumm_cgst",
        "cgst_match",
        "doc_sgst",
        "cpsumm_sgst",
        "sgst_match",
        "doc_cess",
        "cpsumm_cess",
        "cess_match",
      ],
      options: { schemaReturnType: "GSTR2B" },
    },
    itcAvailableSheet,
    itcNotAvailableSheet,
    itcReversalSheet,
    itcRejectedSheet,
    {
      name: "B2B",
      rows: b2bRows,
      columns: [
        "gstin_of_supplier", "trade_legal_name", "invoice_number", "invoice_type", "invoice_date", "invoice_value",
        "place_of_supply", "reverse_charge", "taxable_value", "igst", "cgst", "sgst", "cess", "gstr_period",
        "gstr_filing_date", "itc_availability", "reason", "applicable_percent", "source", "irn", "irn_date",
      ],
      options: {
        skipDefaultHeader: true,
        customHeaderRows: [
          ["Taxable inward supplies received from registered persons"],
          ["GSTIN of supplier", "Trade/Legal name", "Invoice Details", "", "", "", "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Tax Amount", "", "", "", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate", "Source", "IRN", "IRN Date"],
          ["", "", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "", "", "", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "", "", "", "", "", "", "", ""],
        ],
        merges: ["A2:A3", "B2:B3", "C2:F2", "G2:G3", "H2:H3", "I2:I3", "J2:M2", "N2:N3", "O2:O3", "P2:P3", "Q2:Q3", "R2:R3", "S2:S3", "T2:T3", "U2:U3"],
      },
    },
    headerOnly("B2BA", [
      ["Amendments to previously filed invoices by supplier"],
      ["Original Details", null, "Revised Details"],
      ["Invoice number", "Invoice Date", "GSTIN of supplier", "Trade/Legal name", "Invoice Details", null, null, null, "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Tax Amount", null, null, null, "Whether ITC to be reduced (Taxpayer's Input)", "Amount declared by taxpayer for ITC reduction", null, null, null, "Remarks", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate"],
      [null, null, null, null, "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["B3:B4", "X3:X4", "Z3:Z4", "E3:H3", "A3:A4", "C2:Z2", "I3:I4", "Q3:T3", "D3:D4", "U3:U4", "W3:W4", "A2:B2", "L3:O3", "P3:P4", "J3:J4", "K3:K4", "C3:C4", "V3:V4", "Y3:Y4"]),
    {
      name: "B2B-CDNR",
      rows: cdnrRows,
      columns: [
        "gstin_of_supplier", "trade_legal_name", "note_number", "note_type", "note_supply_type", "note_date", "note_value",
        "place_of_supply", "reverse_charge", "taxable_value", "igst", "cgst", "sgst", "cess", "itc_reduce_flag",
        "itc_reduce_igst", "itc_reduce_cgst", "itc_reduce_sgst", "itc_reduce_cess", "remarks", "gstr_period",
        "gstr_filing_date", "itc_availability", "reason", "applicable_percent", "source", "irn", "irn_date",
      ],
      options: {
        skipDefaultHeader: true,
        customHeaderRows: [
          ["Debit/Credit notes (Original)"],
          ["GSTIN of supplier", "Trade/Legal name", "Credit note/Debit note details", "", "", "", "", "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Tax Amount", "", "", "", "Whether ITC to be reduced (Taxpayer's Input)", "Amount declared by taxpayer for ITC reduction", "", "", "", "Rmarks", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate", "Source", "IRN", "IRN Date"],
          ["", "", "Note number", "Note type", "Note Supply type", "Note date", "Note Value (₹)", "", "", "", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "", "", "", "", "", "", "", "", ""],
        ],
        merges: ["A2:A3", "B2:B3", "C2:G2", "H2:H3", "I2:I3", "J2:J3", "K2:N2", "O2:O3", "P2:S2", "T2:T3", "U2:U3", "V2:V3", "W2:W3", "X2:X3", "Y2:Y3", "Z2:Z3", "AA2:AA3", "AB2:AB3"],
      },
    },
    headerOnly("B2B-CDNRA", [
      ["Amendments to previously filed Credit/Debit notes by supplier"],
      ["Original Details", null, null, "Revised Details"],
      ["Note type", "Note number", "Note date", "GSTIN of supplier", "Trade/Legal name", "Credit note/Debit note details", null, null, null, null, "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Tax Amount", null, null, null, "Whether ITC to be reduced (Taxpayer's Input)", "Amount declared by taxpayer for ITC reduction", null, null, null, "Remarks", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate"],
      [null, null, null, null, null, "Note number", "Note type", "Note Supply type", "Note date", "Note Value (₹)", null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["L3:L4", "B3:B4", "X3:X4", "Z3:Z4", "A2:C2", "F3:J3", "A3:A4", "M3:M4", "D3:D4", "W3:W4", "S3:V3", "AA3:AA4", "N3:Q3", "R3:R4", "AB3:AB4", "D2:AB2", "K3:K4", "C3:C4", "E3:E4", "Y3:Y4"]),
    headerOnly("ECO", [
      ["Documents reported by ECO on which ECO is liable to pay tax u/s 9(5)"],
      ["GSTIN of ECO", "Trade/Legal name", "Document details", null, null, null, "Place of supply", "Taxable value (₹)", "Tax amount", null, null, null, "GSTR-1/1A/IFF period", "GSTR-1/1A/IFF filing date", "ITC availability", "Reason", "Source", "IRN", "IRN Date"],
      [null, null, "Document number", "Document type", "Document date", "Document value(₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["P2:P3", "H2:H3", "O2:O3", "M2:M3", "B2:B3", "A2:A3", "N2:N3", "Q2:Q3", "C2:F2", "G2:G3", "R2:R3", "S2:S3", "I2:L2"]),
    headerOnly("ECOA", [
      ["Amendments to documents reported by ECO on which ECO is liable to pay tax u/s 9(5)"],
      ["Original Details", null, "Revised Details"],
      ["Document number", "Document date", "GSTIN of ECO", "Trade/Legal name", "Document details", null, null, null, "Place of supply", "Taxable value (₹)", "Tax amount", null, null, null, "Whether ITC to be reduced (Taxpayer's Input)", "Amount declared by taxpayer for ITC reduction", null, null, null, "Remarks", "GSTR-1/1A/IFF period", "GSTR-1/1A/IFF filing date", "ITC availability", "Reason"],
      [null, null, null, null, "Document number", "Document type", "Document date", "Document value(₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["C2:X2", "A2:B2", "E3:H3", "K3:N3", "C3:C4", "A3:A4", "B3:B4", "V3:V4", "P3:S3", "I3:I4", "O3:O4", "D3:D4", "J3:J4", "X3:X4", "W3:W4", "T3:T4", "U3:U4"]),
    headerOnly("ISD", [
      ["ISD Credits"],
      ["GSTIN of ISD", "Trade/Legal name", "ISD Document type", "ISD Document number", "ISD Document date", "Original Invoice Number", "Original invoice date", "Input tax distribution by ISD", null, null, null, "ISD GSTR-6 Period", "ISD GSTR-6 Filing Date", "Eligibility of ITC"],
      [null, null, null, null, null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["H2:K2", "D2:D3", "M2:M3", "A2:A3", "B2:B3", "N2:N3", "C2:C3", "F2:F3", "E2:E3", "G2:G3", "L2:L3"]),
    headerOnly("ISDA", [
      ["Amendments ISD Credits received"],
      ["Original Details", null, null, "Revised Details"],
      ["ISD Document type", "Document Number", "Document date", "GSTIN of ISD", "Trade/Legal name", "ISD Document type", "ISD Document number", "ISD Document date", "Original Invoice Number", "Original invoice date", "Input tax distribution by ISD", null, null, null, "ISD GSTR-6 Period", "ISD GSTR-6 Filing Date", "Eligibility of ITC"],
      [null, null, null, null, null, null, null, null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["K3:N3", "C3:C4", "A3:A4", "P3:P4", "B3:B4", "E3:E4", "Q3:Q4", "D2:Q2", "D3:D4", "F3:F4", "G3:G4", "H3:H4", "I3:I4", "J3:J4", "O3:O4", "A2:C2"]),
    {
      name: "IMPG",
      rows: impgRows,
      columns: ["icegate_reference_date", "port_code", "boe_number", "boe_date", "taxable_value", "igst", "cess"],
      options: {
        skipDefaultHeader: true,
        customHeaderRows: [
          ["Import of goods from overseas on bill of entry"],
          ["Icegate Reference Date", "Port Code", "Bill of Entry Details", "", "", "Amount of tax (₹)", ""],
          ["", "", "Number", "Date", "Taxable Value", "Integrated Tax(₹)", "Cess(₹)"],
        ],
        merges: ["A2:A3", "B2:B3", "C2:E2", "F2:G2"],
      },
    },
    headerOnly("IMPGA", [
      ["Import of goods from overseas on bill of entry (Amendments)"],
      ["Icegate Reference Date", "Port Code", "Bill of Entry Details", null, null, "Amount of tax (₹)", null, "Type of Amendment"],
      [null, null, "Number", "Date", "Taxable Value", "Integrated Tax(₹)", "Cess(₹)"],
    ], ["C2:E2", "F2:G2", "H2:H3", "J2:K2", "B2:B3", "A2:A3", "I2:I3"]),
    headerOnly("IMPGSEZ", [
      ["Import of goods from SEZ units/developers on bill of entry"],
      ["GSTIN of supplier", "Trade/Legal name", "Icegate Reference Date", "Port Code", "Bill of Entry Details", null, null, "Amount of tax (₹)"],
      [null, null, null, null, "Number", "Date", "Taxable Value", "Integrated Tax(₹)", "Cess(₹)"],
    ], ["E2:G2", "H2:I2", "C2:C3", "B2:B3", "A2:A3", "D2:D3"]),
    headerOnly("IMPGSEZA", [
      ["Import of goods from SEZ units/developers on bill of entry (Amendments)"],
      ["GSTIN of supplier", "Trade/Legal name", "Icegate Reference Date", "Port Code", "Bill of Entry Details", null, null, "Amount of tax (₹)", null, "Type of Amendment"],
      [null, null, null, null, "Number", "Date", "Taxable Value", "Integrated Tax(₹)", "Cess(₹)"],
    ], ["L2:M2", "E2:G2", "H2:I2", "C2:C3", "J2:J3", "B2:B3", "A2:A3", "D2:D3", "K2:K3"]),
    headerOnly("B2B (ITC Reversal)", [
      ["ITC Reversed - Others"],
      ["GSTIN of supplier", "Trade/Legal name", "Invoice Details", null, null, null, "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Tax Amount", null, null, null, "GSTR-1/IFF Period", "GSTR-1/IFF Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate", "Source", "IRN", "IRN Date"],
      [null, null, "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["P2:P3", "H2:H3", "U2:U3", "C2:F2", "O2:O3", "B2:B3", "A2:A3", "N2:N3", "T2:T3", "J2:M2", "G2:G3", "Q2:Q3", "S2:S3", "I2:I3", "R2:R3"]),
    headerOnly("B2BA (ITC Reversal)", [
      ["Amendments to previously filed invoices by supplier (ITC reversal)"],
      ["Original Details", null, "Revised Details"],
      ["Invoice number", "Invoice Date", "GSTIN of supplier", "Trade/Legal name", "Invoice Details", null, null, null, "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Tax Amount", null, null, null, "GSTR-1/IFF Period", "GSTR-1/IFF Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate"],
      [null, null, null, null, "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["A2:B2", "E3:H3", "K3:K4", "C3:C4", "L3:O3", "C2:T2", "A3:A4", "B3:B4", "I3:I4", "P3:P4", "T3:T4", "S3:S4", "D3:D4", "J3:J4", "Q3:Q4", "R3:R4"]),
    headerOnly("B2B-DNR", [
      ["Debit notes (Original)"],
      ["GSTIN of supplier", "Trade/Legal name", "Debit note details", null, null, null, null, "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Tax Amount", null, null, null, "GSTR-1/IFF Period", "GSTR-1/IFF Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate", "Source", "IRN", "IRN Date"],
      [null, null, "Note number", "Note type", "Note Supply type", "Note date", "Note Value (₹)", null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["P2:P3", "H2:H3", "U2:U3", "C2:G2", "J2:J3", "O2:O3", "B2:B3", "A2:A3", "V2:V3", "T2:T3", "K2:N2", "Q2:Q3", "R2:R3", "S2:S3", "I2:I3"]),
    headerOnly("B2B-DNRA", [
      ["Amendments to previously filed Debit notes by supplier"],
      ["Original Details", null, null, "Revised Details"],
      ["Note type", "Note number", "Note date", "GSTIN of supplier", "Trade/Legal name", "Debit note details", null, null, null, null, "Place of supply", "Supply Attract Reverse Charge", "Rate(%)", "Taxable Value (₹)", null, null, null, "Tax Amount", "GSTR-1/IFF Period", "GSTR-1/IFF Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate"],
      [null, null, null, null, null, "Note number", "Note type", "Note Supply type", "Note date", "Note Value (₹)", null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["F3:J3", "K3:K4", "C3:C4", "B3:B4", "A3:A4", "V3:V4", "N3:Q3", "E3:E4", "L3:L4", "U3:U4", "T3:T4", "D3:D4", "W3:W4", "M3:M4", "R3:R4", "S3:S4", "A2:C2", "D2:V2"]),
    headerOnly("B2B(Rejected)", [
      ["ITC Rejected for taxable inward supplies received from registered persons"],
      ["GSTIN of supplier", "Trade/Legal name", "Invoice Details", null, null, null, "Place of supply", "Taxable Value (₹)", "Tax Amount", null, null, null, "Remarks", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "Applicable % of Tax Rate", "Source", "IRN", "IRN Date"],
      [null, null, "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["P2:P3", "H2:H3", "O2:O3", "M2:M3", "B2:B3", "A2:A3", "N2:N3", "Q2:Q3", "C2:F2", "G2:G3", "R2:R3", "S2:S3", "I2:L2"]),
    headerOnly("B2BA(Rejected)", [
      ["ITC Rejected for amendments to previously filed invoices by supplier"],
      ["Original Details", null, "Revised Details"],
      ["Invoice number", "Invoice Date", "GSTIN of supplier", "Trade/Legal name", "Invoice Details", null, null, null, "Place of supply", "Taxable Value (₹)", "Tax Amount", null, null, null, "Remarks", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "Applicable % of Tax Rate"],
      [null, null, null, null, "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["C2:R2", "A2:B2", "E3:H3", "K3:N3", "C3:C4", "A3:A4", "B3:B4", "O3:O4", "P3:P4", "I3:I4", "Q3:Q4", "D3:D4", "J3:J4", "R3:R4"]),
    headerOnly("B2B-CDNR(Rejected)", [
      ["ITC Rejected for Debit/Credit notes (Original)"],
      ["GSTIN of supplier", "Trade/Legal name", "Credit note/Debit note details", null, null, null, null, "Place of supply", "Taxable Value (₹)", "Tax Amount", null, null, null, "Remarks", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "Applicable % of Tax Rate", "Source", "IRN", "IRN Date"],
      [null, null, "Note number", "Note type", "Note Supply type", "Note date", "Note Value (₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["P2:P3", "S2:S3", "H2:H3", "C2:G2", "O2:O3", "B2:B3", "A2:A3", "N2:N3", "T2:T3", "J2:M2", "Q2:Q3", "R2:R3", "I2:I3"]),
    headerOnly("B2B-CDNRA(Rejected)", [
      ["ITC Rejected for amendments to previously filed Credit/Debit notes by supplier"],
      ["Original Details", null, null, "Revised Details"],
      ["Note type", "Note number", "Note date", "GSTIN of supplier", "Trade/Legal name", "Credit note/Debit note details", null, null, null, null, "Place of supply", "Taxable Value (₹)", "Tax Amount", null, null, null, "Remarks", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "Applicable % of Tax Rate"],
      [null, null, null, null, null, "Note number", "Note type", "Note Supply type", "Note date", "Note Value (₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["F3:J3", "M3:P3", "K3:K4", "C3:C4", "A3:A4", "B3:B4", "E3:E4", "L3:L4", "Q3:Q4", "R3:R4", "T3:T4", "D3:D4", "D2:T2", "S3:S4", "A2:C2"]),
    headerOnly("ECO(Rejected)", [
      ["ITC Rejected for documents reported by ECO on which ECO is liable to pay tax us 9(5)"],
      ["GSTIN of ECO", "Trade/Legal name", "Document details", null, null, null, "Place of supply", "Taxable value (₹)", "Tax amount", null, null, null, "Remarks", "GSTR-1/1A/IFF period", "GSTR-1/1A/IFF filing date", "Source", "IRN", "IRN Date"],
      [null, null, "Document number", "Document type", "Document date", "Document value(₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["P2:P3", "H2:H3", "O2:O3", "M2:M3", "A2:A3", "B2:B3", "N2:N3", "Q2:Q3", "C2:F2", "G2:G3", "R2:R3", "I2:L2"]),
    headerOnly("ECOA(Rejected)", [
      ["  ITC Rejected for amendments to documents reported by ECO on which ECO is liable to pay tax u/s 9(5)"],
      ["Original Details", null, "Revised Details"],
      ["Document number", "Document date", "GSTIN of ECO", "Trade/Legal name", "Document details", null, null, null, "Place of supply", "Taxable value (₹)", "Tax amount", null, null, null, "Remarks", "GSTR-1/1A/IFF period", "GSTR-1/1A/IFF filing date"],
      [null, null, null, null, "Document number", "Document type", "Document date", "Document value(₹)", null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["A2:B2", "E3:H3", "C2:Q2", "K3:N3", "C3:C4", "A3:A4", "B3:B4", "O3:O4", "P3:P4", "I3:I4", "Q3:Q4", "D3:D4", "J3:J4"]),
    headerOnly("ISD(Rejected)", [
      ["ITC Rejected for ISD Credits"],
      ["GSTIN of ISD", "Trade/Legal name", "ISD Document type", "ISD Document number", "ISD Document date", "Original Invoice Number", "Original invoice date", "Input tax distribution by ISD", null, null, null, "ISD GSTR-6 Period", "ISD GSTR-6 Filing Date"],
      [null, null, null, null, null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["H2:K2", "D2:D3", "M2:M3", "A2:A3", "B2:B3", "C2:C3", "F2:F3", "E2:E3", "G2:G3", "L2:L3"]),
    headerOnly("ISDA(Rejected)", [
      ["ITC Rejected for amendments of ISD Credits received"],
      ["Original Details", null, null, "Revised Details"],
      ["ISD Document type", "Document Number", "Document date", "GSTIN of ISD", "Trade/Legal name", "ISD Document type", "ISD Document number", "ISD Document date", "Original Invoice Number", "Original invoice date", "Input tax distribution by ISD", null, null, null, "ISD GSTR-6 Period", "ISD GSTR-6 Filing Date"],
      [null, null, null, null, null, null, null, null, null, null, "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
    ], ["K3:N3", "C3:C4", "A3:A4", "P3:P4", "B3:B4", "E3:E4", "G3:G4", "F3:F4", "D3:D4", "H3:H4", "I3:I4", "J3:J4", "O3:O4", "A2:C2", "D2:P2"]),
  ];
  const collectedSheets = {};
  const sheetMeta = {};
  sheetSpecs.forEach((sheet) => {
    collectedSheets[sheet.name] = Array.isArray(sheet.rows)
      ? sheet.rows.map((row) => ({ ...(row || {}) }))
      : [];
    sheetMeta[sheet.name] = {
      columns: Array.isArray(sheet.columns) ? sheet.columns.slice() : [],
      options: cloneGstr2bSheetOptions(sheet.options),
    };
  });
  Object.defineProperty(collectedSheets, "__meta", {
    value: sheetMeta,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return collectedSheets;
}

function cloneGstr2bSheetOptions(options) {
  if (!options || typeof options !== "object") return {};
  return {
    ...options,
    customHeaderRows: Array.isArray(options.customHeaderRows)
      ? options.customHeaderRows.map((row) => (Array.isArray(row) ? row.slice() : row))
      : options.customHeaderRows,
    merges: Array.isArray(options.merges) ? options.merges.slice() : options.merges,
  };
}

function buildGstr2bWorkbookSheetSpecs(collectedSheets, leadingColumns) {
  const sheets = [];
  const sheetMeta = collectedSheets && collectedSheets.__meta && typeof collectedSheets.__meta === "object"
    ? collectedSheets.__meta
    : {};
  Object.keys(collectedSheets || {}).forEach((sheetName) => {
    const rows = Array.isArray(collectedSheets[sheetName]) ? collectedSheets[sheetName] : [];
    const meta = sheetMeta[sheetName] || {};
    const baseColumns = Array.isArray(meta.columns) ? meta.columns.slice() : [];
    const preferredColumns = Array.isArray(leadingColumns) && leadingColumns.length
      ? leadingColumns.concat(baseColumns.filter((column) => !leadingColumns.includes(column)))
      : baseColumns;
    sheets.push({
      name: sheetName,
      rows,
      columns: getSpreadsheetColumns(rows, preferredColumns),
      options: cloneGstr2bSheetOptions(meta.options),
    });
  });
  return sheets;
}

const GSTR2B_COMBINED_GROUPED_SUMMARY_SHEETS = new Set([
  "ITC Available",
  "ITC not available",
  "ITC Reversal",
  "ITC Rejected",
]);

function setGstr2bCombinedSheetMeta(combinedSheetMeta, sheetName, sheetMeta) {
  if (Object.prototype.hasOwnProperty.call(combinedSheetMeta, sheetName)) return;
  combinedSheetMeta[sheetName] = {
    columns: Array.isArray(sheetMeta && sheetMeta.columns) ? sheetMeta.columns.slice() : [],
    options: cloneGstr2bSheetOptions(sheetMeta && sheetMeta.options),
  };
}

function buildCombinedGstr2bSummaryPivotRows(payloads) {
  const rowConfig = [
    { key: "rtnprd", label: "Period" },
    { key: "gstin", label: "GSTIN" },
    { key: "generated_on", label: "DATA OF Filing" },
    { key: "version", label: "STATUS" },
    { key: "checksum", label: "CHECKSUM" },
  ];
  const rowsByKey = new Map(rowConfig.map((item) => [item.key, { field: item.label }]));
  const periods = [];

  (payloads || []).forEach((payload, index) => {
    const source = getGstr2bSectionSourceData(payload);
    const period = source.rtnprd || `PERIOD_${index + 1}`;
    if (!periods.includes(period)) periods.push(period);
    const collectedSheets = collectGstr2bWorkbookSheets(payload, false);
    const valuesByField = {};
    (collectedSheets.Summary || []).forEach((row) => {
      if (row && row.field) valuesByField[row.field] = row.value == null ? "" : row.value;
    });
    rowConfig.forEach((item) => {
      rowsByKey.get(item.key)[period] = valuesByField[item.key] == null ? "" : valuesByField[item.key];
    });
  });

  return {
    rows: rowConfig.map((item) => rowsByKey.get(item.key)),
    columns: ["field"].concat(periods),
  };
}

function isGstr2bNumericSummaryColumn(column) {
  return ["c4", "c5", "c6", "c7"].includes(column);
}

function groupCombinedGstr2bItcSummaryRows(rows, columns) {
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const key = (columns || [])
      .filter((column) => !isGstr2bNumericSummaryColumn(column))
      .map((column) => `${column}:${row && row[column] == null ? "" : row[column]}`)
      .join("||");
    if (!grouped.has(key)) {
      grouped.set(key, { ...(row || {}) });
      return;
    }
    const target = grouped.get(key);
    (columns || []).forEach((column) => {
      if (!isGstr2bNumericSummaryColumn(column)) return;
      const current = target[column] == null || target[column] === "" ? 0 : Number(target[column]) || 0;
      const next = row && row[column] != null && row[column] !== "" ? Number(row[column]) || 0 : 0;
      target[column] = current + next;
    });
  });
  return Array.from(grouped.values());
}

async function buildGstr2bWorkbookXlsxBlob(payload) {
  const collectedSheets = collectGstr2bWorkbookSheets(payload, false);
  return buildXlsxBlobFromSheets(buildGstr2bWorkbookSheetSpecs(collectedSheets));
}

function collectGstr2aWorkbookSheets(payload, includePeriod) {
  const data = buildGstr2aWorkbookData(payload, !!includePeriod);
  const sectionSheets = (data.sectionSheets || []).map((section) => ({
    name: section.name,
    rows: section.rows || [],
    columns: getSpreadsheetColumns(section.rows || [], includePeriod ? ["report_period", "row_no"] : ["row_no"]),
    options: { schemaReturnType: "GSTR2A" },
  }));
  return [
    { name: "Summary", rows: data.metaRows || [], columns: getSpreadsheetColumns(data.metaRows || [], includePeriod ? ["report_period", "field", "value"] : ["field", "value"]), options: { schemaReturnType: "GSTR2A" } },
  ].concat(sectionSheets);
}

async function buildGstr2aWorkbookXlsxBlob(payload) {
  return buildXlsxBlobFromSheets(collectGstr2aWorkbookSheets(payload, false));
}

async function buildCombinedGstr2bWorkbookXlsxBlob(payloads) {
  const combinedSheets = {};
  const combinedSheetMeta = {};
  const summaryPivot = buildCombinedGstr2bSummaryPivotRows(payloads);
  combinedSheets.Summary = summaryPivot.rows;
  combinedSheetMeta.Summary = {
    columns: summaryPivot.columns,
    options: { schemaReturnType: "GSTR2B" },
  };

  (payloads || []).forEach((payload) => {
    const source = getGstr2bSectionSourceData(payload);
    const returnPeriod = source.rtnprd || "";
    const fy = getFyFromPeriod(returnPeriod);
    const gstin = source.gstin || "";
    const collectedSheets = collectGstr2bWorkbookSheets(payload, false);
    const sheetMeta = collectedSheets && collectedSheets.__meta && typeof collectedSheets.__meta === "object"
      ? collectedSheets.__meta
      : {};

    Object.keys(collectedSheets || {}).forEach((sheetName) => {
      if (sheetName === "Summary") return;
      if (!Object.prototype.hasOwnProperty.call(combinedSheets, sheetName)) {
        combinedSheets[sheetName] = [];
        setGstr2bCombinedSheetMeta(combinedSheetMeta, sheetName, sheetMeta[sheetName]);
      }
      (collectedSheets[sheetName] || []).forEach((row) => {
        if (GSTR2B_COMBINED_GROUPED_SUMMARY_SHEETS.has(sheetName)) {
          combinedSheets[sheetName].push({ ...(row || {}) });
        } else {
          combinedSheets[sheetName].push({
            RETURN_PERIOD: returnPeriod,
            FY: fy,
            GSTIN: gstin,
            ...(row || {}),
          });
        }
      });
    });
  });

  GSTR2B_COMBINED_GROUPED_SUMMARY_SHEETS.forEach((sheetName) => {
    if (!Array.isArray(combinedSheets[sheetName])) return;
    const columns = combinedSheetMeta[sheetName] && Array.isArray(combinedSheetMeta[sheetName].columns)
      ? combinedSheetMeta[sheetName].columns
      : [];
    combinedSheets[sheetName] = groupCombinedGstr2bItcSummaryRows(combinedSheets[sheetName], columns);
  });

  Object.defineProperty(combinedSheets, "__meta", {
    value: combinedSheetMeta,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  const sheetSpecs = buildGstr2bWorkbookSheetSpecs(combinedSheets, ["RETURN_PERIOD", "FY", "GSTIN"])
    .map((sheet) => {
      if (sheet.name === "Summary" || GSTR2B_COMBINED_GROUPED_SUMMARY_SHEETS.has(sheet.name)) {
        return {
          ...sheet,
          columns: getSpreadsheetColumns(sheet.rows || [], combinedSheetMeta[sheet.name] && combinedSheetMeta[sheet.name].columns),
        };
      }
      return sheet;
    });

  return buildXlsxBlobFromSheets(sheetSpecs);
}

function getFyFromPeriod(period) {

    if (!period || period.length !== 6) return "";

    const mm = parseInt(period.substring(0, 2), 10);
    const yyyy = parseInt(period.substring(2), 10);

    if (mm >= 4) {
        return `${yyyy}-${String(yyyy + 1).slice(-2)}`;
    }

    return `${yyyy - 1}-${String(yyyy).slice(-2)}`;
}

function buildCombinedGstr2aWorkbookXml(payloads) {
  const fields = ["gstin", "rtnprd", "status", "message", "date", "time", "generated_on", "version", "checksum", "file_url"];
  const valuesByField = new Map(fields.map((field) => [field, { field }]));
  const periods = [];
  const sectionsByName = new Map();
  const rawFlattenedRows = [];

  (payloads || []).forEach((payload) => {
    const meta = extractWorkbookMeta(payload);
    const period = meta.rtnprd || "";
    if (period && !periods.includes(period)) periods.push(period);
    if (period) {
      valuesByField.get("gstin")[period] = meta.gstin || "";
      valuesByField.get("rtnprd")[period] = meta.rtnprd || "";
      valuesByField.get("status")[period] = meta.status || "";
      valuesByField.get("message")[period] = meta.message || "";
      valuesByField.get("date")[period] = meta.file_date || "";
      valuesByField.get("time")[period] = meta.file_time || "";
      valuesByField.get("generated_on")[period] = meta.generated_on || "";
      valuesByField.get("version")[period] = meta.version || "";
      valuesByField.get("checksum")[period] = meta.checksum || "";
      valuesByField.get("file_url")[period] = meta.file_url || "";
    }

    const workbookData = buildGstr2aWorkbookData(payload, true);
    (workbookData.rawFlattenedRows || []).forEach((row) => {
      rawFlattenedRows.push(row);
    });
    (workbookData.sectionSheets || []).forEach((section) => {
      if (!sectionsByName.has(section.name)) sectionsByName.set(section.name, []);
      (section.rows || []).forEach((row) => {
        sectionsByName.get(section.name).push({ ...(row || {}) });
      });
    });
  });

  ensureSchemaColumns("GSTR2A", ["field"].concat(periods), null);
  ensureSchemaForSections("GSTR2A", Array.from(sectionsByName.entries()).map(([name, rows]) => ({ name, rows })), null);
  ensureSchemaForSections("GSTR2A", [{ name: "Raw Flattened", rows: rawFlattenedRows }], null);
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1F4E78" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="HeaderRow">
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Cell">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="Integer">
   <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
   <NumberFormat ss:Format="0"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="Decimal">
   <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
   <NumberFormat ss:Format="0.00"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="DateText">
   <Alignment ss:Horizontal="Center" ss:Vertical="Top"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
 </Styles>
${buildSpreadsheetWorksheet("Summary", fields.map((field) => valuesByField.get(field)), ["field"].concat(periods), {
  autoFilter: false,
  styleResolver: inferGstr2aSpreadsheetStyle,
  schemaReturnType: "GSTR2A",
})}
${Array.from(sectionsByName.entries()).map(([name, rows]) => buildSpreadsheetWorksheet(name, rows, ["report_period", "row_no"], {
  autoFilter: true,
  styleResolver: inferGstr2aSpreadsheetStyle,
  schemaReturnType: "GSTR2A",
})).join("\n ")}
${buildSpreadsheetWorksheet("Raw Flattened", rawFlattenedRows, ["report_period", "field", "value"], {
  hidden: true,
  freezeHeader: false,
  styleResolver: inferGstr2aSpreadsheetStyle,
  schemaReturnType: "GSTR2A",
})}
</Workbook>`;
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sumNumbers(values) {
  return (values || []).reduce((total, value) => total + asNumber(value), 0);
}

function getGstr3bSectionAmounts(section) {
  return {
    taxable: asNumber(section && (section.txval ?? section.taxable_value ?? section.taxableValue)),
    igst: asNumber(section && (section.iamt ?? section.igst ?? section.igst_amt ?? section.iamt_paid)),
    cgst: asNumber(section && (section.camt ?? section.cgst ?? section.cgst_amt ?? section.camt_paid)),
    sgst: asNumber(section && (section.samt ?? section.sgst ?? section.sgst_amt ?? section.samt_paid)),
    cess: asNumber(section && (section.csamt ?? section.cess ?? section.cess_amt ?? section.csamt_paid)),
  };
}

function sumGstr3bAmountBuckets(items) {
  return (items || []).reduce(
    (totals, item) => {
      const amounts = getGstr3bSectionAmounts(item);
      totals.taxable += amounts.taxable;
      totals.igst += amounts.igst;
      totals.cgst += amounts.cgst;
      totals.sgst += amounts.sgst;
      totals.cess += amounts.cess;
      return totals;
    },
    { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
  );
}

function findGstr3bTypedRow(items, type) {
  return ((items || []).find((item) => String(item && item.ty || "").toUpperCase() === type) || null);
}

function sumPaymentRows(rows, field) {
  return (rows || []).reduce(
    (totals, row) => {
      totals.igst += asNumber((row && row.igst && row.igst[field]) ?? (row && row.igst && row.igst.tx));
      totals.cgst += asNumber((row && row.cgst && row.cgst[field]) ?? (row && row.cgst && row.cgst.tx));
      totals.sgst += asNumber((row && row.sgst && row.sgst[field]) ?? (row && row.sgst && row.sgst.tx));
      totals.cess += asNumber((row && row.cess && row.cess[field]) ?? (row && row.cess && row.cess.tx));
      return totals;
    },
    { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  );
}

function sumGstr3bCashRows(rows, fields) {
  const cashFields = fields || {};
  return (rows || []).reduce(
    (totals, row) => {
      totals.igst += asNumber(
        (row && row[cashFields.igst]) ??
        (cashFields.igstNested && row && row.igst && row.igst[cashFields.igstNested]),
      );
      totals.cgst += asNumber(
        (row && row[cashFields.cgst]) ??
        (cashFields.cgstNested && row && row.cgst && row.cgst[cashFields.cgstNested]),
      );
      totals.sgst += asNumber(
        (row && row[cashFields.sgst]) ??
        (cashFields.sgstNested && row && row.sgst && row.sgst[cashFields.sgstNested]),
      );
      totals.cess += asNumber(
        (row && row[cashFields.cess]) ??
        (cashFields.cessNested && row && row.cess && row.cess[cashFields.cessNested]),
      );
      return totals;
    },
    { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  );
}

function hasGstr3bObjectValues(value) {
  return value && typeof value === "object" && Object.keys(value).length > 0;
}

function normalizeGstr3bTaxPayment(rawTaxPayment) {
  const source = rawTaxPayment || {};
  const returnsDbCdredList = source.returnsDbCdredList || {};
  const firstItcRow = Array.isArray(source.tax_paiditc)
    ? (source.tax_paiditc.find((item) => hasGstr3bObjectValues(item)) || {})
    : {};
  const returnsItcRow = ((returnsDbCdredList.tax_paid && returnsDbCdredList.tax_paid.pd_by_itc) || [])
    .find((item) => hasGstr3bObjectValues(item)) || {};
  return {
    net_tax_pay: source.net_tax_pay || returnsDbCdredList.net_tax_pay || source.tax_pay || returnsDbCdredList.tax_pay || source.tx_py || [],
    pdcash: source.pdcash || source.tax_paidcash || (returnsDbCdredList.tax_paid && returnsDbCdredList.tax_paid.pd_by_cash) || [],
    pditc: hasGstr3bObjectValues(source.pditc)
      ? source.pditc
      : hasGstr3bObjectValues(firstItcRow)
        ? firstItcRow
        : returnsItcRow,
    tx_py: source.tx_py || returnsDbCdredList.tax_pay || source.tax_pay || [],
  };
}

function pickGstr3bTaxPaymentSource(root) {
  const candidates = [
    root && root.tx_pmt,
    root && root.txpd,
    root && root.taxpayble && root.taxpayble.tx_pmt,
    root && root.taxpayble && root.taxpayble.txpd,
    root && root.taxpayble,
    root && root.taxpayable && root.taxpayable.tx_pmt,
    root && root.taxpayable && root.taxpayable.txpd,
    root && root.taxpayable,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && Object.keys(candidate).length > 0) {
      return candidate;
    }
  }
  return {};
}

function normalizeGstr3bExcelAmount(value) {
  const numericValue = asNumber(value);
  return numericValue === 0 ? "" : numericValue;
}

function asGstr3bDisplayValue(value, fallback) {
  if (value === "" || value == null) return fallback || "";
  return value;
}

function getGstr3bItcPaidThroughCredit(itcRow, liabilityTaxKey, creditTaxKey) {
  const row = itcRow || {};
  const shortLiability = { igst: "i", cgst: "c", sgst: "s", cess: "cs" }[liabilityTaxKey] || liabilityTaxKey;
  const shortCredit = { igst: "i", cgst: "c", sgst: "s", cess: "cs" }[creditTaxKey] || creditTaxKey;
  const candidates = [
    `${shortLiability}_pd${shortCredit}`,
    `${liabilityTaxKey}_${creditTaxKey}_amt`,
    `${shortLiability}_${shortCredit}_amt`,
  ];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return "";
}

function buildGstr3bPdfStyleRows(payload) {
  const root = payload && payload.data ? payload.data : payload || {};
  const reportPeriod = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
  const gstin = String(root.gstin || "");
  const supDetails = root.sup_details || {};
  const interSup = root.inter_sup || {};
  const itcEligible = root.itc_elg || {};
  const interestLateFee = root.intr_ltfee || {};
  const taxPayment = normalizeGstr3bTaxPayment(pickGstr3bTaxPaymentSource(root));
  const totalTaxPaid = sumPaymentRows(taxPayment.net_tax_pay, "tx");
  const paidUsingIgstItc = {
    igst: asNumber((taxPayment.pditc && taxPayment.pditc.i_pdi) ?? (taxPayment.pditc && taxPayment.pditc.igst_igst_amt)),
    cgst: asNumber((taxPayment.pditc && taxPayment.pditc.c_pdi) ?? (taxPayment.pditc && taxPayment.pditc.cgst_igst_amt)),
    sgst: asNumber((taxPayment.pditc && taxPayment.pditc.s_pdi) ?? (taxPayment.pditc && taxPayment.pditc.sgst_igst_amt)),
    cess: asNumber((taxPayment.pditc && taxPayment.pditc.cs_pdi) ?? 0),
  };
  const paidUsingCgstItc = {
    igst: asNumber((taxPayment.pditc && taxPayment.pditc.i_pdc) ?? (taxPayment.pditc && taxPayment.pditc.igst_cgst_amt)),
    cgst: asNumber((taxPayment.pditc && taxPayment.pditc.c_pdc) ?? (taxPayment.pditc && taxPayment.pditc.cgst_cgst_amt)),
    sgst: asNumber(taxPayment.pditc && taxPayment.pditc.s_pdc),
    cess: asNumber((taxPayment.pditc && taxPayment.pditc.cs_pdc) ?? 0),
  };
  const paidUsingSgstItc = {
    igst: asNumber((taxPayment.pditc && taxPayment.pditc.i_pds) ?? (taxPayment.pditc && taxPayment.pditc.igst_sgst_amt)),
    cgst: asNumber(taxPayment.pditc && taxPayment.pditc.c_pds),
    sgst: asNumber((taxPayment.pditc && taxPayment.pditc.s_pds) ?? (taxPayment.pditc && taxPayment.pditc.sgst_sgst_amt)),
    cess: asNumber((taxPayment.pditc && taxPayment.pditc.cs_pds) ?? 0),
  };
  const paidUsingCessItc = {
    igst: 0,
    cgst: 0,
    sgst: 0,
    cess: asNumber((taxPayment.pditc && taxPayment.pditc.cs_pdcs) ?? (taxPayment.pditc && taxPayment.pditc.cess_cess_amt)),
  };
  const paidInCash = sumGstr3bCashRows(taxPayment.pdcash, { igst: "ipd", cgst: "cpd", sgst: "spd", cess: "cspd", igstNested: "tx", cgstNested: "tx", sgstNested: "tx", cessNested: "tx" });
  const tdsRows = (taxPayment.tx_py || []).filter((row) => /TDS/i.test(String(row && row.tran_desc || "")));
  const tcsRows = (taxPayment.tx_py || []).filter((row) => /TCS/i.test(String(row && row.tran_desc || "")));

  const rows = [];
  const pushBlankRow = () => rows.push({ Section: "", Particulars: "", "Taxable Value": "", IGST: "", CGST: "", SGST: "", CESS: "" });
  const pushInfoRow = (section, particulars, values) => {
    const safeValues = values || {};
    rows.push({
      Section: section || "",
      Particulars: particulars || "",
      "Taxable Value": normalizeGstr3bExcelAmount(safeValues.taxable),
      IGST: normalizeGstr3bExcelAmount(safeValues.igst),
      CGST: normalizeGstr3bExcelAmount(safeValues.cgst),
      SGST: normalizeGstr3bExcelAmount(safeValues.sgst),
      CESS: normalizeGstr3bExcelAmount(safeValues.cess),
    });
  };

  pushInfoRow("GSTIN", gstin, {});
  pushInfoRow("Return Period", reportPeriod, {});
  pushBlankRow();

  pushInfoRow("3.1 (a)", "Outward taxable supplies (other than zero rated, nil rated and exempted)", getGstr3bSectionAmounts(supDetails.osup_det));
  pushInfoRow("3.1 (b)", "Outward taxable supplies (zero rated)", getGstr3bSectionAmounts(supDetails.osup_zero));
  pushInfoRow("3.1 (c)", "Other outward supplies (Nil rated, exempted)", getGstr3bSectionAmounts(supDetails.osup_nil_exmp));
  pushInfoRow("3.1 (d)", "Inward supplies (liable to reverse charge)", getGstr3bSectionAmounts(supDetails.isup_rev));
  pushInfoRow("3.1 (e)", "Non-GST outward supplies", getGstr3bSectionAmounts(supDetails.osup_nongst));
  pushBlankRow();

  const interStateRows = []
    .concat(Array.isArray(interSup.unreg_details) ? interSup.unreg_details.map((row) => ({ section: "3.2", particulars: `Supplies made to unregistered persons${row && row.pos ? ` - POS ${row.pos}` : ""}`, row })) : [])
    .concat(Array.isArray(interSup.comp_details) ? interSup.comp_details.map((row) => ({ section: "3.2", particulars: `Supplies made to composition taxable persons${row && row.pos ? ` - POS ${row.pos}` : ""}`, row })) : [])
    .concat(Array.isArray(interSup.uin_details) ? interSup.uin_details.map((row) => ({ section: "3.2", particulars: `Supplies made to UIN holders${row && row.pos ? ` - POS ${row.pos}` : ""}`, row })) : []);
  if (interStateRows.length > 0) {
    interStateRows.forEach((entry) => {
      const src = entry.row || {};
      pushInfoRow(entry.section, entry.particulars, {
        taxable: src.txval,
        igst: src.iamt,
      });
    });
    pushBlankRow();
  }

  pushInfoRow("4(A)(1)", "Import of goods", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_avl, "IMPG")));
  pushInfoRow("4(A)(2)", "Import of services", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_avl, "IMPS")));
  pushInfoRow("4(A)(3)", "Inward supplies liable to reverse charge (other than 1 and 2 above)", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_avl, "ISRC")));
  pushInfoRow("4(A)(4)", "Inward supplies from ISD", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_avl, "ISD")));
  pushInfoRow("4(A)(5)", "All other ITC", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_avl, "OTH")));
  pushInfoRow("4(B)(1)", "ITC reversed as per rules 42 and 43 of CGST Rules and section 17(5)", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_rev, "RUL")));
  pushInfoRow("4(B)(2)", "Others", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_rev, "OTH")));
  pushInfoRow("4(C)", "Net ITC available (A) - (B)", getGstr3bSectionAmounts(itcEligible.itc_net));
  pushInfoRow("4(D)(1)", "Ineligible ITC under section 16(4) and ITC restricted due to PoS rules", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_inelg, "RUL")));
  pushInfoRow("4(D)(2)", "Others", getGstr3bSectionAmounts(findGstr3bTypedRow(itcEligible.itc_inelg, "OTH")));
  pushBlankRow();

  pushInfoRow("5.1", "Interest", getGstr3bSectionAmounts(interestLateFee.intr_details));
  pushInfoRow("5.1", "Late fee", getGstr3bSectionAmounts(interestLateFee.ltfee_details));
  pushBlankRow();

  pushInfoRow("6.1", "Total tax payable", totalTaxPaid);
  pushInfoRow("6.1", "Paid through IGST ITC", paidUsingIgstItc);
  pushInfoRow("6.1", "Paid through CGST ITC", paidUsingCgstItc);
  pushInfoRow("6.1", "Paid through SGST ITC", paidUsingSgstItc);
  pushInfoRow("6.1", "Paid through CESS ITC", paidUsingCessItc);
  pushInfoRow("6.1", "Paid in cash", paidInCash);
  pushInfoRow("6.2", "TDS credit", sumPaymentRows(tdsRows, "tx"));
  pushInfoRow("6.2", "TCS credit", sumPaymentRows(tcsRows, "tx"));

  return {
    reportPeriod,
    rows,
    columns: ["Section", "Particulars", "Taxable Value", "IGST", "CGST", "SGST", "CESS"],
  };
}

function buildGstr3bSection61Rows(root, taxPayment) {
  const returnsDbCdredList = (root.taxpayble && root.taxpayble.returnsDbCdredList) || {};
  const liabilities = returnsDbCdredList.tax_pay || taxPayment.net_tax_pay || [];
  const paidByCashRows = (returnsDbCdredList.tax_paid && returnsDbCdredList.tax_paid.pd_by_cash) || taxPayment.pdcash || [];
  const interestPaidRows = paidByCashRows;
  const lateFeePaidRows = paidByCashRows;
  const otherLiability = liabilities.find((row) => asNumber(row && row.trancd) === 30002) || liabilities[0] || {};
  const reverseChargeLiability = liabilities.find((row) => asNumber(row && row.trancd) === 30003) || {};
  const reverseChargeCash = paidByCashRows.find((row) => asNumber(row && row.trancd) === 30003) || paidByCashRows[0] || {};
  const returnsItcRow = ((returnsDbCdredList.tax_paid && returnsDbCdredList.tax_paid.pd_by_itc) || [])
    .find((row) => hasGstr3bObjectValues(row)) || {};
  const itcRow = hasGstr3bObjectValues(returnsItcRow) ? returnsItcRow : (taxPayment.pditc || {});
  const buildTaxRow = (label, taxKey, liabilityRow, cashRow, options) => {
    const cfg = options || {};
    return {
      kind: cfg.kind || "tax",
      label,
      taxPayable: normalizeGstr3bExcelAmount(liabilityRow && liabilityRow[taxKey] && liabilityRow[taxKey].tx),
      adjustment: 0,
      netTaxPayable: normalizeGstr3bExcelAmount(liabilityRow && liabilityRow[taxKey] && liabilityRow[taxKey].tx),
      itcIntegrated: cfg.zeroItc ? "" : normalizeGstr3bExcelAmount(getGstr3bItcPaidThroughCredit(itcRow, taxKey, "igst")),
      itcCentral: cfg.zeroItc ? "" : normalizeGstr3bExcelAmount(getGstr3bItcPaidThroughCredit(itcRow, taxKey, "cgst")),
      itcState: cfg.zeroItc ? "" : normalizeGstr3bExcelAmount(getGstr3bItcPaidThroughCredit(itcRow, taxKey, "sgst")),
      itcCess: cfg.zeroItc ? "" : normalizeGstr3bExcelAmount(getGstr3bItcPaidThroughCredit(itcRow, taxKey, "cess")),
      paidInCash: normalizeGstr3bExcelAmount(cashRow && cashRow[taxKey] && cashRow[taxKey].tx),
      interestPaid: normalizeGstr3bExcelAmount(cashRow && cashRow[taxKey] && cashRow[taxKey].intr),
      lateFeePaid: normalizeGstr3bExcelAmount(cashRow && cashRow[taxKey] && cashRow[taxKey].fee),
    };
  };

  return [
    { kind: "group", label: "(A) Other than reverse charge" },
    buildTaxRow("Integrated tax", "igst", otherLiability, {}, { kind: "tax" }),
    buildTaxRow("Central tax", "cgst", otherLiability, {}, { kind: "tax" }),
    buildTaxRow("State/UT tax", "sgst", otherLiability, {}, { kind: "tax" }),
    buildTaxRow("Cess", "cess", otherLiability, {}, { kind: "tax" }),
    { kind: "group", label: "(B) Reverse charge and supplies made u/s 9(5)" },
    buildTaxRow("Integrated tax", "igst", reverseChargeLiability, reverseChargeCash, { kind: "tax", zeroItc: true }),
    buildTaxRow("Central tax", "cgst", reverseChargeLiability, reverseChargeCash, { kind: "tax", zeroItc: true }),
    buildTaxRow("State/UT tax", "sgst", reverseChargeLiability, reverseChargeCash, { kind: "tax", zeroItc: true }),
    buildTaxRow("Cess", "cess", reverseChargeLiability, reverseChargeCash, { kind: "tax", zeroItc: true }),
  ];
}

function buildGstr3bStyledCell(value, styleId, options) {
  const cfg = options || {};
  const attrs = [];
  if (styleId) attrs.push(` ss:StyleID="${styleId}"`);
  if (cfg.index) attrs.push(` ss:Index="${cfg.index}"`);
  if (cfg.mergeAcross) attrs.push(` ss:MergeAcross="${cfg.mergeAcross}"`);
  const cellValue = value == null ? "" : value;
  const type = cfg.type || (typeof cellValue === "number" && Number.isFinite(cellValue) ? "Number" : "String");
  return `<Cell${attrs.join("")}><Data ss:Type="${type}">${escapeXml(cellValue)}</Data></Cell>`;
}

function buildGstr3bStyledRow(cells, options) {
  const cfg = options || {};
  const attrs = [];
  if (cfg.height) attrs.push(` ss:Height="${cfg.height}"`);
  return `<Row${attrs.join("")}>${cells.join("")}</Row>`;
}

function buildGstr3bVerticalMetricRows(title, metrics, styles) {
  const rows = [];
  rows.push(buildGstr3bStyledRow([
    buildGstr3bStyledCell(title, styles.titleStyle || "G3BCellBold"),
    buildGstr3bStyledCell("", styles.valueStyle || "G3BNumber"),
  ]));
  (metrics || []).forEach((metric) => {
    rows.push(buildGstr3bStyledRow([
      buildGstr3bStyledCell(`    ${metric.label}`, styles.labelStyle || "G3BCell"),
      buildGstr3bStyledCell(metric.value, styles.valueStyle || "G3BNumber"),
    ]));
  });
  return rows;
}

function buildGstr3bSummaryWorksheet(payload, sheetName) {
  const root = payload && payload.data ? payload.data : payload || {};
  const reportPeriod = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
  const yearLabel = reportPeriod && reportPeriod.length === 6
    ? `${reportPeriod.slice(2, 6)}-${String(Number(reportPeriod.slice(2, 6)) + 1).slice(-2)}`
    : "";
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const periodLabel = reportPeriod && reportPeriod.length === 6 ? (monthNames[Math.max(0, Math.min(11, Number(reportPeriod.slice(0, 2)) - 1))] || reportPeriod) : reportPeriod;
  const workbookData = buildGstr3bPdfStyleRows(payload);
  const infoRows = [
    ["GSTIN of the supplier", root.gstin || ""],
    ["2(a). Legal name of the registered person", "Medchoice Health Care Private Limited"],
    ["2(b). Trade name, if any", "Medchoice Health Care Private Limited"],
    ["2(c). ARN", root.taxpayble && root.taxpayble.status ? `Status ${root.taxpayble.status}` : ""],
    ["2(d). Date of ARN", ((root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.tax_pay && root.taxpayble.returnsDbCdredList.tax_pay[0] && root.taxpayble.returnsDbCdredList.tax_pay[0].trandate) || "")],
  ];
  const rows = [];
  rows.push(buildGstr3bStyledRow([
    buildGstr3bStyledCell("Form GSTR-3B", "G3BTitle", { mergeAcross: 5 }),
    buildGstr3bStyledCell("Year", "G3BLabel"),
    buildGstr3bStyledCell(yearLabel, "G3BValue"),
  ], { height: 24 }));
  rows.push(buildGstr3bStyledRow([
    buildGstr3bStyledCell("[See rule 61(5)]", "G3BSubtitle", { mergeAcross: 5 }),
    buildGstr3bStyledCell("Period", "G3BLabel"),
    buildGstr3bStyledCell(periodLabel, "G3BValue"),
  ]));
  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank", { mergeAcross: 9 })]));
  infoRows.forEach(([label, value]) => {
    rows.push(buildGstr3bStyledRow([
      buildGstr3bStyledCell(label, "G3BLabel"),
      buildGstr3bStyledCell(value, "G3BValue"),
    ]));
  });

  const tableXml = `
<Table>
 <Column ss:AutoFitWidth="0" ss:Width="340"/>
 <Column ss:AutoFitWidth="0" ss:Width="220"/>
 ${rows.join("\n ")}
</Table>`;
  const safeName = sanitizeWorksheetName(sheetName || "Summary");
  return `<Worksheet ss:Name="${escapeXml(safeName)}">${tableXml}<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/></WorksheetOptions></Worksheet>`;
}

function buildCombinedGstr3bSummaryWorksheet(payloads) {
  const periodOrder = [];
  const fieldDefs = [
    {
      label: "GSTIN of the supplier",
      getValue: (root) => root.gstin || "",
    },
    {
      label: "2(a). Legal name of the registered person",
      getValue: () => "Medicube Health Care Private Limited",
    },
    {
      label: "2(b). Trade name, if any",
      getValue: () => "Medicube Health Care Private Limited",
    },
    {
      label: "2(c). ARN",
      getValue: (root) => ((root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.net_tax_pay && root.taxpayble.returnsDbCdredList.net_tax_pay[0] && root.taxpayble.returnsDbCdredList.net_tax_pay[0].debit_id) || (root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.tax_pay && root.taxpayble.returnsDbCdredList.tax_pay[0] && root.taxpayble.returnsDbCdredList.tax_pay[0].debit_id) || ""),
    },
    {
      label: "2(d). Date of ARN",
      getValue: (root) => ((root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.tax_pay && root.taxpayble.returnsDbCdredList.tax_pay[0] && root.taxpayble.returnsDbCdredList.tax_pay[0].trandate) || ""),
    },
  ];

  const summaryRows = fieldDefs.map((fieldDef) => {
    const row = { Field: fieldDef.label };
    (payloads || []).forEach((payload) => {
      const root = payload && payload.data ? payload.data : payload || {};
      const period = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
      if (period && !periodOrder.includes(period)) periodOrder.push(period);
      row[period] = fieldDef.getValue(root);
    });
    return row;
  });
  const columns = ["Field"].concat(periodOrder);
  const headerXml = columns
    .map((column) => `<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">${escapeXml(column)}</Data></Cell>`)
    .join("");
  const bodyXml = summaryRows.map((row) => {
    const cells = columns.map((column, index) => {
      const value = row[column] == null ? "" : row[column];
      const styleId = index === 0 ? "G3BLabel" : "G3BValue";
      const type = "String";
      return `<Cell ss:StyleID="${styleId}"><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
    }).join("");
    return `<Row>${cells}</Row>`;
  }).join("");
  const columnXml = ['<Column ss:AutoFitWidth="0" ss:Width="360"/>']
    .concat(periodOrder.map(() => '<Column ss:AutoFitWidth="0" ss:Width="190"/>'))
    .join("");
  return `<Worksheet ss:Name="Summary"><Table>${columnXml}<Row>${headerXml}</Row>${bodyXml}</Table></Worksheet>`;
}

function buildCombinedGstr3bSection61Worksheet(payloads) {
  const periods = [];
  const linesByPeriod = new Map();
  (payloads || []).forEach((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const period = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
    if (!period) return;
    periods.push(period);
    linesByPeriod.set(period, buildGstr3bSection61LineItems(payload));
  });

  const baseLines = periods.length ? linesByPeriod.get(periods[0]) || [] : [];
  const columnXml = ['<Column ss:AutoFitWidth="0" ss:Width="360"/>']
    .concat(periods.map(() => '<Column ss:AutoFitWidth="0" ss:Width="110"/>'))
    .concat(['<Column ss:AutoFitWidth="0" ss:Width="110"/>'])
    .join("");
  const titleMergeAcross = Math.max(periods.length + 1, 1);
  const titleXml = `<Row><Cell ss:StyleID="G3BSectionBar" ss:MergeAcross="${titleMergeAcross}"><Data ss:Type="String">6.1 Payment of tax</Data></Cell></Row>`;
  const headerXml = `<Row><Cell ss:StyleID="G3BHeader"><Data ss:Type="String">Description</Data></Cell>${periods
    .map((period) => `<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">${escapeXml(period)}</Data></Cell>`)
    .join("")}<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">Total</Data></Cell></Row>`;
  const bodyXml = baseLines.map((line, index) => {
    const style = line.header ? "G3BSectionBar" : (line.style || "G3BCell");
    const descCell = `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(line.desc)}</Data></Cell>`;
    let total = 0;
    let hasNumericValue = false;
    const valueCells = periods
      .map((period) => {
        const periodLines = linesByPeriod.get(period) || [];
        const periodLine = periodLines[index] || {};
        const value = periodLine.amount == null ? "" : periodLine.amount;
        const numericValue = asNumber(value);
        if (value !== "" && value !== "-" && Number.isFinite(numericValue)) {
          total += numericValue;
          hasNumericValue = true;
        }
        const cellStyle = periodLine.header ? "G3BSectionBar" : (value !== "" ? "G3BNumber" : "G3BValue");
        return `<Cell ss:StyleID="${cellStyle}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
      })
      .join("");
    const totalValue = hasNumericValue ? total.toFixed(2) : "";
    const totalCellStyle = hasNumericValue ? "G3BNumber" : "G3BValue";
    return `<Row>${descCell}${valueCells}<Cell ss:StyleID="${totalCellStyle}"><Data ss:Type="String">${escapeXml(totalValue)}</Data></Cell></Row>`;
  }).join("");
  return `<Worksheet ss:Name="GSTR-3B"><Table>${columnXml}${titleXml}${headerXml}${bodyXml}</Table></Worksheet>`;
}

function buildCombinedGstr3bBreakupWorksheet(payloads) {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const rows = (payloads || []).map((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const reportPeriod = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
    const periodLabel = reportPeriod && reportPeriod.length === 6
      ? `${monthNames[Math.max(0, Math.min(11, Number(reportPeriod.slice(0, 2)) - 1))] || reportPeriod} ${reportPeriod.slice(2, 6)}`
      : reportPeriod;
    const taxPayment = normalizeGstr3bTaxPayment(pickGstr3bTaxPaymentSource(root));
    const totals = sumPaymentRows(taxPayment.net_tax_pay, "tx");
    return {
      period: periodLabel,
      igst: asNumber(totals.igst).toFixed(2),
      cgst: asNumber(totals.cgst).toFixed(2),
      sgst: asNumber(totals.sgst).toFixed(2),
      cess: asNumber(totals.cess).toFixed(2),
    };
  });

  const columnXml = [
    '<Column ss:AutoFitWidth="0" ss:Width="170"/>',
    '<Column ss:AutoFitWidth="0" ss:Width="160"/>',
    '<Column ss:AutoFitWidth="0" ss:Width="160"/>',
    '<Column ss:AutoFitWidth="0" ss:Width="160"/>',
    '<Column ss:AutoFitWidth="0" ss:Width="120"/>',
  ].join("");
  const titleXml = '<Row><Cell ss:StyleID="G3BSectionBar" ss:MergeAcross="4"><Data ss:Type="String">Breakup of tax liability declared (for interest computation)</Data></Cell></Row>';
  const headerXml = '<Row>' +
    '<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">Period</Data></Cell>' +
    '<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">Integrated tax</Data></Cell>' +
    '<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">Central tax</Data></Cell>' +
    '<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">State/UT tax</Data></Cell>' +
    '<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">Cess</Data></Cell>' +
    '</Row>';
  const bodyXml = rows.map((row) => (
    '<Row>' +
    `<Cell ss:StyleID="G3BCell"><Data ss:Type="String">${escapeXml(row.period)}</Data></Cell>` +
    `<Cell ss:StyleID="G3BNumber"><Data ss:Type="String">${escapeXml(row.igst)}</Data></Cell>` +
    `<Cell ss:StyleID="G3BNumber"><Data ss:Type="String">${escapeXml(row.cgst)}</Data></Cell>` +
    `<Cell ss:StyleID="G3BNumber"><Data ss:Type="String">${escapeXml(row.sgst)}</Data></Cell>` +
    `<Cell ss:StyleID="G3BNumber"><Data ss:Type="String">${escapeXml(row.cess)}</Data></Cell>` +
    '</Row>'
  )).join("");
  return `<Worksheet ss:Name="Tax Liability Breakup"><Table>${columnXml}${titleXml}${headerXml}${bodyXml}</Table></Worksheet>`;
}

function buildCombinedGstr3bSection61TableXml(payloads) {
  const worksheetXml = buildCombinedGstr3bSection61Worksheet(payloads);
  const match = worksheetXml.match(/<Table>([\s\S]*)<\/Table>/);
  return match ? match[1] : "";
}

function buildGstr3bSection61LineItems(payload) {
  const root = payload && payload.data ? payload.data : payload || {};
  const period = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
  const taxPayment = normalizeGstr3bTaxPayment(pickGstr3bTaxPaymentSource(root));
  const rows = buildGstr3bSection61Rows(root, taxPayment);
  const asAmount = (value, opts) => {
    const cfg = opts || {};
    if (value === "-" || cfg.dash) return "-";
    const numeric = asNumber(value);
    if (cfg.blankZero && numeric === 0) return "";
    return numeric.toFixed(2);
  };
  const findTaxRow = (groupLabel, taxLabel) => {
    let currentGroup = "";
    for (const row of rows) {
      if (row.kind === "group") currentGroup = row.label;
      if (row.kind === "tax" && currentGroup === groupLabel && row.label === taxLabel) return row;
    }
    return null;
  };
  const groupA = "(A) Other than reverse charge";
  const groupB = "(B) Reverse charge and supplies made u/s 9(5)";
  const aIgst = findTaxRow(groupA, "Integrated tax") || {};
  const aCgst = findTaxRow(groupA, "Central tax") || {};
  const aSgst = findTaxRow(groupA, "State/UT tax") || {};
  const aCess = findTaxRow(groupA, "Cess") || {};
  const bIgst = findTaxRow(groupB, "Integrated tax") || {};
  const bCgst = findTaxRow(groupB, "Central tax") || {};
  const bSgst = findTaxRow(groupB, "State/UT tax") || {};
  const bCess = findTaxRow(groupB, "Cess") || {};
  return [
    { desc: "(A) Other than reverse charge", style: "G3BCellBold", amount: "" },
    { desc: "Tax payable", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.taxPayable) },
    { desc: "b) Central tax", amount: asAmount(aCgst.taxPayable) },
    { desc: "c) State/UT tax", amount: asAmount(aSgst.taxPayable) },
    { desc: "d) Cess", amount: asAmount(aCess.taxPayable) },
    { desc: "Adjustment of negative liability", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.adjustment) },
    { desc: "b) Central tax", amount: asAmount(aCgst.adjustment) },
    { desc: "c) State/UT tax", amount: asAmount(aSgst.adjustment) },
    { desc: "d) Cess", amount: asAmount(aCess.adjustment) },
    { desc: "Net tax payable", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.netTaxPayable) },
    { desc: "b) Central tax", amount: asAmount(aCgst.netTaxPayable) },
    { desc: "c) State/UT tax", amount: asAmount(aSgst.netTaxPayable) },
    { desc: "d) Cess", amount: asAmount(aCess.netTaxPayable) },
    { desc: "Tax paid through ITC - Integrated tax", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.itcIntegrated, { blankZero: true }) },
    { desc: "b) Central tax", amount: "" },
    { desc: "c) State/UT tax", amount: "" },
    { desc: "d) Cess", amount: "" },
    { desc: "Tax paid through ITC - Central tax", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.itcCentral, { blankZero: true }) },
    { desc: "b) Central tax", amount: asAmount(aCgst.itcCentral, { blankZero: true }) },
    { desc: "c) State/UT tax", amount: "" },
    { desc: "d) Cess", amount: "" },
    { desc: "Tax paid through ITC - State/UT tax", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.itcState, { blankZero: true }) },
    { desc: "b) Central tax", amount: "" },
    { desc: "c) State/UT tax", amount: asAmount(aSgst.itcState, { blankZero: true }) },
    { desc: "d) Cess", amount: "" },
    { desc: "Tax paid through ITC - Cess", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: "" },
    { desc: "b) Central tax", amount: "" },
    { desc: "c) State/UT tax", amount: "" },
    { desc: "d) Cess", amount: asAmount(aCess.itcCess, { blankZero: true }) },
    { desc: "Tax paid in cash", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.paidInCash) },
    { desc: "b) Central tax", amount: asAmount(aCgst.paidInCash) },
    { desc: "c) State/UT tax", amount: asAmount(aSgst.paidInCash) },
    { desc: "d) Cess", amount: asAmount(aCess.paidInCash) },
    { desc: "Interest paid in cash", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(aIgst.interestPaid) },
    { desc: "b) Central tax", amount: asAmount(aCgst.interestPaid) },
    { desc: "c) State/UT tax", amount: asAmount(aSgst.interestPaid) },
    { desc: "d) Cess", amount: asAmount(aCess.interestPaid) },
    { desc: "Late fee paid in cash", style: "G3BCellBold", amount: "" },
    { desc: "a) Central tax", amount: asAmount(aCgst.lateFeePaid) },
    { desc: "b) State/UT tax", amount: asAmount(aSgst.lateFeePaid) },
    { desc: "(B) Reverse charge and supplies u/s 9(5)", style: "G3BCellBold", amount: "" },
    { desc: "Tax payable", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(bIgst.taxPayable) },
    { desc: "b) Central tax", amount: asAmount(bCgst.taxPayable) },
    { desc: "c) State/UT tax", amount: asAmount(bSgst.taxPayable) },
    { desc: "d) Cess", amount: asAmount(bCess.taxPayable) },
    { desc: "Adjustment of negative liability", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(bIgst.adjustment) },
    { desc: "b) Central tax", amount: asAmount(bCgst.adjustment) },
    { desc: "c) State/UT tax", amount: asAmount(bSgst.adjustment) },
    { desc: "d) Cess", amount: asAmount(bCess.adjustment) },
    { desc: "Net tax payable", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(bIgst.netTaxPayable) },
    { desc: "b) Central tax", amount: asAmount(bCgst.netTaxPayable) },
    { desc: "c) State/UT tax", amount: asAmount(bSgst.netTaxPayable) },
    { desc: "d) Cess", amount: asAmount(bCess.netTaxPayable) },
    { desc: "Tax paid through ITC", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: "-" },
    { desc: "b) Central tax", amount: "-" },
    { desc: "c) State/UT tax", amount: "-" },
    { desc: "d) Cess", amount: "-" },
    { desc: "Tax paid in cash", style: "G3BCellBold", amount: "" },
    { desc: "a) Integrated tax", amount: asAmount(bIgst.paidInCash) },
    { desc: "b) Central tax", amount: asAmount(bCgst.paidInCash) },
    { desc: "c) State/UT tax", amount: asAmount(bSgst.paidInCash) },
    { desc: "d) Cess", amount: asAmount(bCess.paidInCash) },
  ];
}

function buildCombinedGstr3bAllTablesWorksheet(payloads) {
  const periodOrder = [];
  const payloadMap = new Map();
  (payloads || []).forEach((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const period = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
    if (period && !periodOrder.includes(period)) periodOrder.push(period);
    payloadMap.set(period, {
      pdf: buildGstr3bPdfStyleRows(payload),
      root,
      taxPayment: normalizeGstr3bTaxPayment(
        root.tx_pmt ||
        root.txpd ||
        root.taxpayble && (root.taxpayble.tx_pmt || root.taxpayble.txpd || root.taxpayble) ||
        root.taxpayable && (root.taxpayable.tx_pmt || root.taxpayable.txpd || root.taxpayable),
      ),
    });
  });

  const rows = [];
  const addHeading = (text, level) => rows.push({ Description: text, __kind: level || "group" });
  const addMetricRow = (description, getter) => {
    const row = { Description: description, __kind: "item" };
    let total = 0;
    periodOrder.forEach((period) => {
      const value = asNumber(getter(payloadMap.get(period), period));
      row[period] = value === 0 ? "" : value;
      total += value;
    });
    row.Total = total === 0 ? "" : total;
    rows.push(row);
  };

  addHeading("3.1 Details of Outward supplies and inward supplies liable to reverse charge");
  [
    { label: "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", key: "sup_details.osup_det" },
    { label: "(b) Outward taxable supplies (zero rated)", key: "sup_details.osup_zero" },
    { label: "(c) Other outward supplies (nil rated, exempted)", key: "sup_details.osup_nil_exmp" },
    { label: "(d) Inward supplies (liable to reverse charge)", key: "sup_details.isup_rev" },
    { label: "(e) Non-GST outward supplies", key: "sup_details.osup_nongst" },
  ].forEach((item) => {
    addHeading(item.label, "subgroup");
    addMetricRow("  Total taxable value", (ctx) => {
      const path = item.key.split(".");
      let cur = ctx.root;
      path.forEach((p) => { cur = cur && cur[p]; });
      return cur && cur.txval;
    });
    addMetricRow("  Integrated tax", (ctx) => {
      const path = item.key.split(".");
      let cur = ctx.root;
      path.forEach((p) => { cur = cur && cur[p]; });
      return cur && cur.iamt;
    });
    addMetricRow("  Central tax", (ctx) => {
      const path = item.key.split(".");
      let cur = ctx.root;
      path.forEach((p) => { cur = cur && cur[p]; });
      return cur && cur.camt;
    });
    addMetricRow("  State/UT tax", (ctx) => {
      const path = item.key.split(".");
      let cur = ctx.root;
      path.forEach((p) => { cur = cur && cur[p]; });
      return cur && cur.samt;
    });
    addMetricRow("  Cess", (ctx) => {
      const path = item.key.split(".");
      let cur = ctx.root;
      path.forEach((p) => { cur = cur && cur[p]; });
      return cur && cur.csamt;
    });
  });

  addHeading("3.2 Out of supplies made in 3.1(a) above, details of inter-state supplies made");
  [
    { label: "Supplies made to Unregistered Persons", key: "unreg_details" },
    { label: "Supplies made to Composition Taxable Persons", key: "comp_details" },
    { label: "Supplies made to UIN holders", key: "uin_details" },
  ].forEach((item) => {
    addHeading(item.label, "subgroup");
    addMetricRow("  Total taxable value", (ctx) => (((ctx.root.inter_sup || {})[item.key] || [])[0] || {}).txval);
    addMetricRow("  Integrated tax", (ctx) => (((ctx.root.inter_sup || {})[item.key] || [])[0] || {}).iamt);
  });

  addHeading("4. Eligible ITC");
  [
    { heading: "A. ITC Available (whether in full or part)", rows: [
      ["(1) Import of goods", "itc_avl", "IMPG"],
      ["(2) Import of services", "itc_avl", "IMPS"],
      ["(3) Inward supplies liable to reverse charge (other than 1 & 2 above)", "itc_avl", "ISRC"],
      ["(4) Inward supplies from ISD", "itc_avl", "ISD"],
      ["(5) All other ITC", "itc_avl", "OTH"],
    ]},
    { heading: "B. ITC Reversed", rows: [
      ["(1) As per rules 38,42 & 43 of CGST Rules and section 17(5)", "itc_rev", "RUL"],
      ["(2) Others", "itc_rev", "OTH"],
    ]},
    { heading: "C. Net ITC available (A-B)", rows: [["", "itc_net", ""]]},
    { heading: "(D) Other Details", rows: [
      ["(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period", "itc_inelg", "RUL"],
      ["(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", "itc_inelg", "OTH"],
    ]},
  ].forEach((section) => {
    addHeading(section.heading, "subgroup");
    section.rows.forEach(([label, bucket, ty]) => {
      addHeading(`  ${label || section.heading}`, "subgroup");
      ["iamt|Integrated tax", "camt|Central tax", "samt|State/UT tax", "csamt|Cess"].forEach((pair) => {
        const [field, title] = pair.split("|");
        addMetricRow(`    ${title}`, (ctx) => {
          const itc = ctx.root.itc_elg || {};
          if (bucket === "itc_net") return (itc.itc_net || {})[field];
          const found = ((itc[bucket] || []).find((r) => r && r.ty === ty) || {});
          return found[field];
        });
      });
    });
  });

  addHeading("5 Values of exempt, nil-rated and non-GST inward supplies");
  ["From a supplier under composition scheme, Exempt, Nil rated supply", "Non GST supply"].forEach((label) => {
    addHeading(label, "subgroup");
    addMetricRow("  Inter-State supplies", () => 0);
    addMetricRow("  Intra-State supplies", () => 0);
  });

  addHeading("5.1 Interest and Late fee for previous tax period");
  [
    { label: "System computed Interest", fixed: true },
    { label: "Interest Paid", source: "intr_details" },
    { label: "Late fee", source: "ltfee_details" },
  ].forEach((item) => {
    addHeading(item.label, "subgroup");
    ["iamt|Integrated tax", "camt|Central tax", "samt|State/UT tax", "csamt|Cess"].forEach((pair) => {
      const [field, title] = pair.split("|");
      addMetricRow(`  ${title}`, (ctx) => item.fixed ? 0 : (((ctx.root.intr_ltfee || {})[item.source] || {})[field]));
    });
  });

  addHeading("6.1 Payment of tax");
  const columns = ["Description"].concat(periodOrder, ["Total"]);
  const headerXml = columns.map((column) => `<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">${escapeXml(column)}</Data></Cell>`).join("");
  const bodyXml = rows.map((row) => {
    let styleId = "G3BItem";
    if (row.__kind === "group") styleId = "G3BCellBold";
    else if (row.__kind === "subgroup") styleId = String(row.Description || "").startsWith("  ") ? "G3BSubgroup" : "G3BLabel";
    else if (row.__kind === "item") styleId = String(row.Description || "").startsWith("    ") ? "G3BItemDeep" : "G3BItem";
    return `<Row>${columns.map((column, index) => {
      const value = row[column] == null ? "" : row[column];
      const cellStyle = index === 0 ? styleId : (row.__kind === "item" ? "G3BNumber" : "G3BValue");
      const cellType = typeof value === "number" ? "Number" : "String";
      return `<Cell ss:StyleID="${cellStyle}"><Data ss:Type="${cellType}">${escapeXml(value)}</Data></Cell>`;
    }).join("")}</Row>`;
  }).join("");
  const columnXml = ['<Column ss:AutoFitWidth="0" ss:Width="420"/>']
    .concat(periodOrder.map(() => '<Column ss:AutoFitWidth="0" ss:Width="110"/>'))
    .concat(['<Column ss:AutoFitWidth="0" ss:Width="110"/>'])
    .join("");
  const section61Table = buildCombinedGstr3bSection61TableXml(payloads);
  const section61RowsOnly = section61Table
    .replace(/<Column[^>]*\/>/g, "")
    .replace(/^.*?<Row>/s, "<Row>");
  return `<Worksheet ss:Name="GSTR-3B Details"><Table>${columnXml}<Row>${headerXml}</Row>${bodyXml}${section61RowsOnly}</Table></Worksheet>`;
}

function buildGstr3bPdfExactWorksheet(payload, sheetName) {
  const root = payload && payload.data ? payload.data : payload || {};
  const reportPeriod = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const periodLabel = reportPeriod && reportPeriod.length === 6 ? (monthNames[Math.max(0, Math.min(11, Number(reportPeriod.slice(0, 2)) - 1))] || reportPeriod) : reportPeriod;
  const yearLabel = reportPeriod && reportPeriod.length === 6
    ? `${reportPeriod.slice(2, 6)}-${String(Number(reportPeriod.slice(2, 6)) + 1).slice(-2)}`
    : "";
  const workbookData = buildGstr3bPdfStyleRows(payload);
  const taxPayment = normalizeGstr3bTaxPayment(
    root.tx_pmt ||
    root.txpd ||
    root.taxpayble && (root.taxpayble.tx_pmt || root.taxpayble.txpd || root.taxpayble) ||
    root.taxpayable && (root.taxpayable.tx_pmt || root.taxpayable.txpd || root.taxpayable),
  );
  const section61Rows = buildGstr3bSection61Rows(root, taxPayment);
  const infoRows = [
    ["GSTIN of the supplier", root.gstin || ""],
    ["2(a). Legal name of the registered person", "Medicube Health Care Private Limited"],
    ["2(b). Trade name, if any", "Medicube Health Care Private Limited"],
    ["2(c). ARN", ((root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.net_tax_pay && root.taxpayble.returnsDbCdredList.net_tax_pay[0] && root.taxpayble.returnsDbCdredList.net_tax_pay[0].debit_id) || (root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.tax_pay && root.taxpayble.returnsDbCdredList.tax_pay[0] && root.taxpayble.returnsDbCdredList.tax_pay[0].debit_id) || "")],
    ["2(d). Date of ARN", ((root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.tax_pay && root.taxpayble.returnsDbCdredList.tax_pay[0] && root.taxpayble.returnsDbCdredList.tax_pay[0].trandate) || "")],
  ];
  const rows = [];
  const addBlank = () => rows.push('<Row><Cell/><Cell/></Row>');
  const addRow = (cells) => rows.push(`<Row>${cells.join("")}</Row>`);
  const numCell = (value, style) => `<Cell ss:StyleID="${style || "G3BNumber"}"><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${escapeXml(value == null ? "" : value)}</Data></Cell>`;
  const textCell = (value, style, extra) => `<Cell ss:StyleID="${style || "G3BCell"}"${extra || ""}><Data ss:Type="String">${escapeXml(value == null ? "" : value)}</Data></Cell>`;

  addRow([
    textCell("Form GSTR-3B", "G3BTitle", ' ss:MergeAcross="5"'),
    textCell("Year", "G3BLabel"),
    textCell(yearLabel, "G3BValue"),
  ]);
  addRow([
    textCell("[See rule 61(5)]", "G3BSubtitle", ' ss:MergeAcross="5"'),
    textCell("Period", "G3BLabel"),
    textCell(periodLabel, "G3BValue"),
  ]);
  addBlank();
  infoRows.forEach(([label, value]) => {
    addRow([
      textCell(label, "G3BLabel"),
      textCell(value, "G3BValue", ' ss:MergeAcross="5"'),
    ]);
  });
  addRow([
    textCell("", "G3BBlank", ' ss:MergeAcross="5"'),
    textCell("(Amount in Rs for all tables)", "G3BNote", ' ss:MergeAcross="1"'),
  ]);
  addBlank();

  addRow([textCell("3.1 Details of Outward supplies and inward supplies liable to reverse charge", "G3BSectionBar", ' ss:MergeAcross="5"')]);
  addRow([
    textCell("Nature of Supplies", "G3BHeaderWide"),
    textCell("Total taxable value", "G3BHeader"),
    textCell("Integrated tax", "G3BHeader"),
    textCell("Central tax", "G3BHeader"),
    textCell("State/UT tax", "G3BHeader"),
    textCell("Cess", "G3BHeader"),
  ]);
  workbookData.rows.slice(3, 8).forEach((row) => {
    addRow([
      textCell(String(`${row.Section} ${row.Particulars}`.trim()).replace("3.1 ", ""), "G3BCell"),
      numCell(asGstr3bDisplayValue(row["Taxable Value"], "0.00")),
      numCell(asGstr3bDisplayValue(row.IGST, "-")),
      numCell(asGstr3bDisplayValue(row.CGST, "-")),
      numCell(asGstr3bDisplayValue(row.SGST, "-")),
      numCell(asGstr3bDisplayValue(row.CESS, "-")),
    ]);
  });
  addBlank();

  addRow([textCell("3.2 Out of supplies made in 3.1 (a) above, details of inter-state supplies made", "G3BSectionBar", ' ss:MergeAcross="2"')]);
  addRow([
    textCell("Nature of Supplies", "G3BHeaderWide"),
    textCell("Total taxable value", "G3BHeader"),
    textCell("Integrated tax", "G3BHeader"),
  ]);
  const interSup = root.inter_sup || {};
  [
    ["Supplies made to Unregistered Persons", (interSup.unreg_details || [])[0] || {}],
    ["Supplies made to Composition Taxable Persons", (interSup.comp_details || [])[0] || {}],
    ["Supplies made to UIN holders", (interSup.uin_details || [])[0] || {}],
  ].forEach(([label, src]) => {
    addRow([
      textCell(label, "G3BCell"),
      numCell(asGstr3bDisplayValue(normalizeGstr3bExcelAmount(src.txval), "0.00")),
      numCell(asGstr3bDisplayValue(normalizeGstr3bExcelAmount(src.iamt), "0.00")),
    ]);
  });
  addBlank();

  addRow([textCell("4. Eligible ITC", "G3BSectionBar", ' ss:MergeAcross="4"')]);
  addRow([
    textCell("Details", "G3BHeaderWide"),
    textCell("Integrated tax", "G3BHeader"),
    textCell("Central tax", "G3BHeader"),
    textCell("State/UT tax", "G3BHeader"),
    textCell("Cess", "G3BHeader"),
  ]);
  const itcRows = [
    ["A. ITC Available (whether in full or part)", null],
    ["(1) Import of goods", workbookData.rows[9]],
    ["(2) Import of services", workbookData.rows[10]],
    ["(3) Inward supplies liable to reverse charge (other than 1 & 2 above)", workbookData.rows[11]],
    ["(4) Inward supplies from ISD", workbookData.rows[12]],
    ["(5) All other ITC", workbookData.rows[13]],
    ["B. ITC Reversed", null],
    ["(1) As per rules 38,42 & 43 of CGST Rules and section 17(5)", workbookData.rows[14]],
    ["(2) Others", workbookData.rows[15]],
    ["C. Net ITC available (A-B)", workbookData.rows[16]],
    ["(D) Other Details", null],
    ["(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period", workbookData.rows[17]],
    ["(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", { IGST: "", CGST: "", SGST: "", CESS: "" }],
  ];
  itcRows.forEach(([label, row]) => {
    addRow([
      textCell(label, row ? "G3BCell" : "G3BCellBold"),
      numCell(asGstr3bDisplayValue(row && row.IGST, row ? "0.00" : "")),
      numCell(asGstr3bDisplayValue(row && row.CGST, row ? "0.00" : "")),
      numCell(asGstr3bDisplayValue(row && row.SGST, row ? "0.00" : "")),
      numCell(asGstr3bDisplayValue(row && row.CESS, row ? "0.00" : "")),
    ]);
  });
  addBlank();

  addRow([textCell("5 Values of exempt, nil-rated and non-GST inward supplies", "G3BSectionBar", ' ss:MergeAcross="2"')]);
  addRow([
    textCell("Nature of Supplies", "G3BHeaderWide"),
    textCell("Inter- State supplies", "G3BHeader"),
    textCell("Intra- State supplies", "G3BHeader"),
  ]);
  addRow([textCell("From a supplier under composition scheme, Exempt, Nil rated supply", "G3BCell"), numCell("0.00"), numCell("0.00")]);
  addRow([textCell("Non GST supply", "G3BCell"), numCell("0.00"), numCell("0.00")]);
  addBlank();

  addRow([textCell("5.1 Interest and Late fee for previous tax period", "G3BSectionBar", ' ss:MergeAcross="4"')]);
  addRow([
    textCell("Details", "G3BHeaderWide"),
    textCell("Integrated tax", "G3BHeader"),
    textCell("Central tax", "G3BHeader"),
    textCell("State/UT tax", "G3BHeader"),
    textCell("Cess", "G3BHeader"),
  ]);
  addRow([textCell("System computed Interest", "G3BCell"), numCell("-"), numCell("-"), numCell("-"), numCell("-")]);
  addRow([textCell("Interest Paid", "G3BCell"), numCell("0.00"), numCell("0.00"), numCell("0.00"), numCell("0.00")]);
  addRow([textCell("Late fee", "G3BCell"), numCell("-"), numCell("0.00"), numCell("0.00"), numCell("-")]);
  addBlank();

  addRow([textCell("6.1 Payment of tax", "G3BSectionBar", ' ss:MergeAcross="10"')]);
  addRow([
    textCell("Description", "G3BHeader"),
    textCell("Tax payable", "G3BHeader"),
    textCell("Adjustment of negative liability of previous tax period", "G3BHeader"),
    textCell("Net Tax Payable", "G3BHeader"),
    textCell("Tax paid through ITC", "G3BHeader", ' ss:MergeAcross="3"'),
    textCell("Tax paid in cash", "G3BHeader"),
    textCell("Interest paid in cash", "G3BHeader"),
    textCell("Late fee paid in cash", "G3BHeader"),
  ]);
  addRow([
    textCell("", "G3BHeader"),
    textCell("", "G3BHeader"),
    textCell("", "G3BHeader"),
    textCell("", "G3BHeader"),
    textCell("Integrated tax", "G3BHeader"),
    textCell("Central tax", "G3BHeader"),
    textCell("State/UT tax", "G3BHeader"),
    textCell("Cess", "G3BHeader"),
    textCell("", "G3BHeader"),
    textCell("", "G3BHeader"),
    textCell("", "G3BHeader"),
  ]);
  section61Rows.forEach((row) => {
    if (row.kind === "group") {
      addRow([textCell(row.label, "G3BCellBold", ' ss:MergeAcross="10"')]);
      return;
    }
    addRow([
      textCell(row.label, "G3BCell"),
      numCell(asGstr3bDisplayValue(row.taxPayable, "0.00")),
      numCell(asGstr3bDisplayValue(row.adjustment, "0.00")),
      numCell(asGstr3bDisplayValue(row.netTaxPayable, "0.00")),
      numCell(asGstr3bDisplayValue(row.itcIntegrated, "-")),
      numCell(asGstr3bDisplayValue(row.itcCentral, "-")),
      numCell(asGstr3bDisplayValue(row.itcState, "-")),
      numCell(asGstr3bDisplayValue(row.itcCess, "-")),
      numCell(asGstr3bDisplayValue(row.paidInCash, "0.00")),
      numCell(asGstr3bDisplayValue(row.interestPaid, "0.00")),
      numCell(asGstr3bDisplayValue(row.lateFeePaid, "-")),
    ]);
  });

  const tableXml = `
<Table>
 <Column ss:AutoFitWidth="0" ss:Width="280"/>
 <Column ss:AutoFitWidth="0" ss:Width="80"/>
 <Column ss:AutoFitWidth="0" ss:Width="80"/>
 <Column ss:AutoFitWidth="0" ss:Width="80"/>
 <Column ss:AutoFitWidth="0" ss:Width="74"/>
 <Column ss:AutoFitWidth="0" ss:Width="74"/>
 <Column ss:AutoFitWidth="0" ss:Width="74"/>
 <Column ss:AutoFitWidth="0" ss:Width="60"/>
 <Column ss:AutoFitWidth="0" ss:Width="80"/>
 <Column ss:AutoFitWidth="0" ss:Width="90"/>
 <Column ss:AutoFitWidth="0" ss:Width="90"/>
 ${rows.join("\n ")}
</Table>`;
  const safeName = sanitizeWorksheetName(sheetName || "GSTR-3B");
  return `<Worksheet ss:Name="${escapeXml(safeName)}">${tableXml}<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/></WorksheetOptions></Worksheet>`;
}

function buildGstr3bStyledWorksheet(payload, sheetName, options) {
  const cfg = options || {};
  const root = payload && payload.data ? payload.data : payload || {};
  const reportPeriod = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
  const workbookData = buildGstr3bPdfStyleRows(payload);
  const taxPayment = normalizeGstr3bTaxPayment(
    root.tx_pmt ||
    root.txpd ||
    root.taxpayble && (root.taxpayble.tx_pmt || root.taxpayble.txpd || root.taxpayble) ||
    root.taxpayable && (root.taxpayable.tx_pmt || root.taxpayable.txpd || root.taxpayable),
  );
  const section61Rows = buildGstr3bSection61Rows(root, taxPayment);
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const periodLabel = reportPeriod && reportPeriod.length === 6 ? (monthNames[Math.max(0, Math.min(11, Number(reportPeriod.slice(0, 2)) - 1))] || reportPeriod) : reportPeriod;
  const yearLabel = reportPeriod && reportPeriod.length === 6
    ? `${reportPeriod.slice(2, 6)}-${String(Number(reportPeriod.slice(2, 6)) + 1).slice(-2)}`
    : "";
  const infoRows = [
    ["GSTIN of the supplier", root.gstin || ""],
    ["2(a). Legal name of the registered person", "Medchoice Health Care Private Limited"],
    ["2(b). Trade name, if any", "Medchoice Health Care Private Limited"],
    ["2(c). ARN", root.taxpayble && root.taxpayble.status ? `Status ${root.taxpayble.status}` : ""],
    ["2(d). Date of ARN", ((root.taxpayble && root.taxpayble.returnsDbCdredList && root.taxpayble.returnsDbCdredList.tax_pay && root.taxpayble.returnsDbCdredList.tax_pay[0] && root.taxpayble.returnsDbCdredList.tax_pay[0].trandate) || "")],
  ];
  const breakup = [{
    period: periodLabel ? `${periodLabel} ${reportPeriod.slice(2, 6)}` : reportPeriod,
    igst: normalizeGstr3bExcelAmount(sumPaymentRows(taxPayment.net_tax_pay, "tx").igst),
    cgst: normalizeGstr3bExcelAmount(sumPaymentRows(taxPayment.net_tax_pay, "tx").cgst),
    sgst: normalizeGstr3bExcelAmount(sumPaymentRows(taxPayment.net_tax_pay, "tx").sgst),
    cess: normalizeGstr3bExcelAmount(sumPaymentRows(taxPayment.net_tax_pay, "tx").cess),
  }];
  const pushBlockHeader = (text) => rows.push(buildGstr3bStyledRow([
    buildGstr3bStyledCell(text, "G3BSectionBar"),
    buildGstr3bStyledCell("", "G3BSectionBar"),
  ]));
  const pushTwoColHeader = (left, right) => rows.push(buildGstr3bStyledRow([
    buildGstr3bStyledCell(left, "G3BHeader"),
    buildGstr3bStyledCell(right || "Amount", "G3BHeader"),
  ]));
  const pushMetricBlock = (title, metrics) => {
    buildGstr3bVerticalMetricRows(title, metrics, {
      titleStyle: "G3BCell",
      labelStyle: "G3BCell",
      valueStyle: "G3BNumber",
    }).forEach((row) => rows.push(row));
  };

  const rows = [];
  if (cfg.includeSummary) {
    rows.push(buildGstr3bStyledRow([
      buildGstr3bStyledCell("Form GSTR-3B", "G3BTitle", { mergeAcross: 5 }),
      buildGstr3bStyledCell("Year", "G3BLabel"),
      buildGstr3bStyledCell(yearLabel, "G3BValue"),
    ], { height: 24 }));
    rows.push(buildGstr3bStyledRow([
      buildGstr3bStyledCell("[See rule 61(5)]", "G3BSubtitle", { mergeAcross: 5 }),
      buildGstr3bStyledCell("Period", "G3BLabel"),
      buildGstr3bStyledCell(periodLabel, "G3BValue"),
    ]));
    rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank", { mergeAcross: 10 })]));
    infoRows.forEach(([label, value]) => {
      rows.push(buildGstr3bStyledRow([
        buildGstr3bStyledCell(label, "G3BLabel", { mergeAcross: 1 }),
        buildGstr3bStyledCell(value, "G3BValue", { mergeAcross: 9 }),
      ]));
    });
  }
  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
  pushBlockHeader("3.1 Details of Outward supplies and inward supplies liable to reverse charge");
  pushTwoColHeader("Nature of Supplies", "");
  workbookData.rows.slice(3, 8).forEach((row) => {
    pushMetricBlock(`${row.Section} ${row.Particulars}`.trim(), [
      { label: "Total taxable value", value: asGstr3bDisplayValue(row["Taxable Value"], "") },
      { label: "Integrated tax", value: asGstr3bDisplayValue(row.IGST, "") },
      { label: "Central tax", value: asGstr3bDisplayValue(row.CGST, "") },
      { label: "State/UT tax", value: asGstr3bDisplayValue(row.SGST, "") },
      { label: "Cess", value: asGstr3bDisplayValue(row.CESS, "") },
    ]);
  });

  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
  pushBlockHeader("3.2 Of the supplies made in 3.1 (a) above, details of inter-state supplies made");
  pushTwoColHeader("Nature of Supplies", "");
  const interSup = root.inter_sup || {};
  [
    ["Supplies made to Unregistered Persons", (interSup.unreg_details || [])[0] || {}],
    ["Supplies made to Composition Taxable Persons", (interSup.comp_details || [])[0] || {}],
    ["Supplies made to UIN holders", (interSup.uin_details || [])[0] || {}],
  ].forEach(([label, src]) => {
    pushMetricBlock(label, [
      { label: "Total taxable value", value: asGstr3bDisplayValue(normalizeGstr3bExcelAmount(src.txval), "") },
      { label: "Integrated tax", value: asGstr3bDisplayValue(normalizeGstr3bExcelAmount(src.iamt), "") },
    ]);
  });

  const itcRows = [
    { kind: "group", label: "A. ITC Available (whether in full or part)" },
    { kind: "item", label: "(1) Import of goods", row: workbookData.rows[9] },
    { kind: "item", label: "(2) Import of services", row: workbookData.rows[10] },
    { kind: "item", label: "(3) Inward supplies liable to reverse charge (other than 1 & 2 above)", row: workbookData.rows[11] },
    { kind: "item", label: "(4) Inward supplies from ISD", row: workbookData.rows[12] },
    { kind: "item", label: "(5) All other ITC", row: workbookData.rows[13] },
    { kind: "group", label: "B. ITC Reversed" },
    { kind: "item", label: "(1) As per rules 38,42 & 43 of CGST Rules and section 17(5)", row: workbookData.rows[14] },
    { kind: "item", label: "(2) Others", row: workbookData.rows[15] },
    { kind: "group", label: "C. Net ITC available (A-B)" },
    { kind: "item", label: "", row: workbookData.rows[16] },
    { kind: "group", label: "(D) Other Details" },
    { kind: "item", label: "(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period", row: { IGST: workbookData.rows[17] && workbookData.rows[17].IGST, CGST: workbookData.rows[17] && workbookData.rows[17].CGST, SGST: workbookData.rows[17] && workbookData.rows[17].SGST, CESS: workbookData.rows[17] && workbookData.rows[17].CESS } },
    { kind: "item", label: "(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", row: { IGST: "", CGST: "", SGST: "", CESS: "" } },
  ];
  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
  pushBlockHeader("4. Eligible ITC");
  pushTwoColHeader("Details", "");
  itcRows.forEach((entry) => {
    if (entry.kind === "group") {
      rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell(entry.label, "G3BCellBold"), buildGstr3bStyledCell("", "G3BNumber")]));
      return;
    }
    const row = entry.row || {};
    pushMetricBlock(entry.label || `${row.Section || ""} ${row.Particulars || ""}`.trim(), [
      { label: "Integrated tax", value: asGstr3bDisplayValue(row.IGST, "0.00") },
      { label: "Central tax", value: asGstr3bDisplayValue(row.CGST, "0.00") },
      { label: "State/UT tax", value: asGstr3bDisplayValue(row.SGST, "0.00") },
      { label: "Cess", value: asGstr3bDisplayValue(row.CESS, "0.00") },
    ]);
  });

  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
  pushBlockHeader("5 Values of exempt, nil-rated and non-GST inward supplies");
  pushTwoColHeader("Nature of supplies", "");
  [
    "From a supplier under composition scheme, Exempt, Nil rated supply",
    "Non GST supply",
  ].forEach((label) => {
    pushMetricBlock(label, [
      { label: "Inter-State supplies", value: "" },
      { label: "Intra-State supplies", value: "" },
    ]);
  });

  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
  pushBlockHeader("5.1 Interest and Late fee for previous tax period");
  pushTwoColHeader("Details", "");
  [
    { label: "System computed Interest", values: { IGST: "-", CGST: "-", SGST: "-", CESS: "-" } },
    { label: "Interest Paid", values: workbookData.rows[19] || {} },
    { label: "Late fee", values: workbookData.rows[20] || {} },
  ].forEach((entry) => {
    const row = entry.values || {};
    pushMetricBlock(entry.label, [
      { label: "Integrated tax", value: asGstr3bDisplayValue(row.IGST, entry.label === "System computed Interest" ? "-" : "0.00") },
      { label: "Central tax", value: asGstr3bDisplayValue(row.CGST, entry.label === "System computed Interest" ? "-" : "0.00") },
      { label: "State/UT tax", value: asGstr3bDisplayValue(row.SGST, entry.label === "System computed Interest" ? "-" : "0.00") },
      { label: "Cess", value: asGstr3bDisplayValue(row.CESS, entry.label === "System computed Interest" ? "-" : "0.00") },
    ]);
  });

  if (!cfg.excludeSection61) {
    rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
    rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("6.1 Payment of tax", "G3BSectionBar", { mergeAcross: 10 })]));
    rows.push(buildGstr3bStyledRow([
      buildGstr3bStyledCell("Description", "G3BHeader"),
      buildGstr3bStyledCell("Tax payable", "G3BHeader"),
      buildGstr3bStyledCell("Adjustment of negative liability of previous tax period", "G3BHeader"),
      buildGstr3bStyledCell("Net Tax Payable", "G3BHeader"),
      buildGstr3bStyledCell("Tax paid through ITC", "G3BHeader", { mergeAcross: 3 }),
      buildGstr3bStyledCell("Tax paid in cash", "G3BHeader"),
      buildGstr3bStyledCell("Interest paid in cash", "G3BHeader"),
      buildGstr3bStyledCell("Late fee paid in cash", "G3BHeader"),
    ]));
    rows.push(buildGstr3bStyledRow([
      buildGstr3bStyledCell("", "G3BHeader"),
      buildGstr3bStyledCell("", "G3BHeader"),
      buildGstr3bStyledCell("", "G3BHeader"),
      buildGstr3bStyledCell("", "G3BHeader"),
      buildGstr3bStyledCell("Integrated tax", "G3BHeader"),
      buildGstr3bStyledCell("Central tax", "G3BHeader"),
      buildGstr3bStyledCell("State/UT tax", "G3BHeader"),
      buildGstr3bStyledCell("Cess", "G3BHeader"),
      buildGstr3bStyledCell("", "G3BHeader"),
      buildGstr3bStyledCell("", "G3BHeader"),
      buildGstr3bStyledCell("", "G3BHeader"),
    ]));
    section61Rows.forEach((row) => {
      if (row.kind === "group") {
        rows.push(buildGstr3bStyledRow([
          buildGstr3bStyledCell(row.label, "G3BCellBold", { mergeAcross: 10 }),
        ]));
        return;
      }
      rows.push(buildGstr3bStyledRow([
        buildGstr3bStyledCell(row.label, "G3BCell"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.taxPayable, "0.00"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.adjustment, "0.00"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.netTaxPayable, "0.00"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.itcIntegrated, "-"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.itcCentral, "-"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.itcState, "-"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.itcCess, "-"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.paidInCash, "0.00"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.interestPaid, row.paidInCash === "" ? "-" : "0.00"), "G3BNumber"),
        buildGstr3bStyledCell(asGstr3bDisplayValue(row.lateFeePaid, "-"), "G3BNumber"),
      ]));
    });
  }

  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
  pushBlockHeader("Breakup of tax liability declared (for interest computation)");
  pushTwoColHeader("Period", "");
  breakup.forEach((row) => {
    pushMetricBlock(row.period, [
      { label: "Integrated tax", value: asGstr3bDisplayValue(row.igst, "0.00") },
      { label: "Central tax", value: asGstr3bDisplayValue(row.cgst, "0.00") },
      { label: "State/UT tax", value: asGstr3bDisplayValue(row.sgst, "0.00") },
      { label: "Cess", value: asGstr3bDisplayValue(row.cess, "0.00") },
    ]);
  });

  rows.push(buildGstr3bStyledRow([buildGstr3bStyledCell("", "G3BBlank"), buildGstr3bStyledCell("", "G3BBlank")]));
  pushBlockHeader("Verification");
  rows.push(buildGstr3bStyledRow([
    buildGstr3bStyledCell("I hereby solemnly affirm and declare that the information given herein above is true and correct to the best of my knowledge and belief and nothing has been concealed there from.", "G3BCell", { mergeAcross: 10 }),
  ]));

  const tableXml = `
<Table>
 <Column ss:AutoFitWidth="0" ss:Width="220"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 ${rows.join("\n ")}
</Table>`;
  const safeName = sanitizeWorksheetName(sheetName || reportPeriod || "GSTR-3B");
  return `<Worksheet ss:Name="${escapeXml(safeName)}">${tableXml}<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/></WorksheetOptions></Worksheet>`;
}

function buildCombinedGstr3bMergedWorksheet(payloads) {
  const extractBodyRows = (worksheetXml) => {
    const match = worksheetXml.match(/<Table>[\s\S]*?<\/Column>([\s\S]*)<\/Table>/);
    return match ? match[1] : "";
  };
  const periodBlocks = (payloads || []).map((payload, index) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const reportPeriod = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "") || `Period ${index + 1}`;
    return [
      `<Row><Cell ss:StyleID="G3BSectionBar" ss:MergeAcross="10"><Data ss:Type="String">${escapeXml(reportPeriod)}</Data></Cell></Row>`,
      extractBodyRows(buildGstr3bStyledWorksheet(payload, reportPeriod, { includeSummary: false, excludeSection61: true })),
    ].join("\n");
  }).join("\n");

  const summaryRows = buildCombinedGstr3bSection61TableXml(payloads)
    .replace(/<Column[^>]*\/>/g, "")
    .replace(/^.*?<Row>/s, "<Row>");

  return `<Worksheet ss:Name="GSTR-3B"><Table>
 <Column ss:AutoFitWidth="0" ss:Width="220"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 <Column ss:AutoFitWidth="0" ss:Width="95"/>
 ${periodBlocks}
 <Row><Cell/><Cell/></Row>
 <Row><Cell ss:StyleID="G3BSectionBar" ss:MergeAcross="10"><Data ss:Type="String">6.1 Payment of tax</Data></Cell></Row>
 ${summaryRows}
</Table></Worksheet>`;
}

function buildGstr3bWorkbookXml(payload) {
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="G3BTitle">
   <Font ss:Bold="1" ss:Size="14"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="G3BSubtitle">
   <Font ss:Italic="1" ss:Size="10"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="G3BLabel">
   <Font ss:Bold="1" ss:Size="9"/>
   <Interior ss:Color="#F5D9C6" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 <Style ss:ID="G3BValue">
   <Font ss:Size="9"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 <Style ss:ID="G3BSectionBar">
   <Font ss:Bold="1" ss:Size="9"/>
   <Interior ss:Color="#FBE5D6" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 <Style ss:ID="G3BHeader">
   <Font ss:Bold="1" ss:Size="8"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#FDF2EA" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 <Style ss:ID="G3BCell">
   <Font ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 <Style ss:ID="G3BCellBold">
   <Font ss:Bold="1" ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 <Style ss:ID="G3BNumber">
   <Font ss:Size="8"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="0.00"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 <Style ss:ID="G3BBlank">
   <Alignment ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="G3BNote">
   <Font ss:Italic="1" ss:Size="8"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="G3BHeaderWide">
   <Font ss:Bold="1" ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#FDF2EA" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
 </Style>
 </Styles>
${buildGstr3bPdfExactWorksheet(payload, "GSTR-3B")}
</Workbook>`;
}

function addGstr3bTaxAmount(target, source) {
  const src = source || {};
  target.txval = asNumber(target.txval) + asNumber(src.txval);
  target.iamt = asNumber(target.iamt) + asNumber(src.iamt);
  target.camt = asNumber(target.camt) + asNumber(src.camt);
  target.samt = asNumber(target.samt) + asNumber(src.samt);
  target.csamt = asNumber(target.csamt) + asNumber(src.csamt);
}

function aggregateGstr3bTypedRows(payloads, bucket, typeList) {
  return (typeList || []).map((type) => {
    const row = { ty: type, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
    (payloads || []).forEach((payload) => {
      const root = payload && payload.data ? payload.data : payload || {};
      const found = findGstr3bTypedRow(root.itc_elg && root.itc_elg[bucket], type) || {};
      addGstr3bTaxAmount(row, found);
    });
    return row;
  });
}

function aggregateGstr3bPaymentRows(payloads, transactionCode) {
  const row = {
    trancd: transactionCode,
    igst: { tx: 0, intr: 0, fee: 0 },
    cgst: { tx: 0, intr: 0, fee: 0 },
    sgst: { tx: 0, intr: 0, fee: 0 },
    cess: { tx: 0, intr: 0, fee: 0 },
  };
  (payloads || []).forEach((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const taxPayment = normalizeGstr3bTaxPayment(pickGstr3bTaxPaymentSource(root));
    const liability = (taxPayment.net_tax_pay || []).find((item) => asNumber(item && item.trancd) === transactionCode) || {};
    const cash = (taxPayment.pdcash || []).find((item) => asNumber(item && item.trancd) === transactionCode) || {};
    ["igst", "cgst", "sgst", "cess"].forEach((taxKey) => {
      row[taxKey].tx += asNumber(liability[taxKey] && liability[taxKey].tx);
      row[taxKey].intr += asNumber(cash[taxKey] && cash[taxKey].intr);
      row[taxKey].fee += asNumber(cash[taxKey] && cash[taxKey].fee);
    });
  });
  return row;
}

function aggregateGstr3bCashPaymentRows(payloads, transactionCode) {
  const row = {
    trancd: transactionCode,
    igst: { tx: 0, intr: 0, fee: 0 },
    cgst: { tx: 0, intr: 0, fee: 0 },
    sgst: { tx: 0, intr: 0, fee: 0 },
    cess: { tx: 0, intr: 0, fee: 0 },
  };
  (payloads || []).forEach((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const taxPayment = normalizeGstr3bTaxPayment(pickGstr3bTaxPaymentSource(root));
    const cash = (taxPayment.pdcash || []).find((item) => asNumber(item && item.trancd) === transactionCode) || {};
    ["igst", "cgst", "sgst", "cess"].forEach((taxKey) => {
      row[taxKey].tx += asNumber(cash[taxKey] && cash[taxKey].tx);
      row[taxKey].intr += asNumber(cash[taxKey] && cash[taxKey].intr);
      row[taxKey].fee += asNumber(cash[taxKey] && cash[taxKey].fee);
    });
  });
  return row;
}

function buildAggregatedGstr3bPayload(payloads) {
  const firstRoot = payloads && payloads[0] && payloads[0].data ? payloads[0].data : (payloads && payloads[0]) || {};
  const aggregate = {
    gstin: firstRoot.gstin || "",
    rtnprd: "Combined",
    sup_details: {
      osup_det: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_zero: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nil_exmp: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
    },
    inter_sup: {
      unreg_details: [{ txval: 0, iamt: 0 }],
      comp_details: [{ txval: 0, iamt: 0 }],
      uin_details: [{ txval: 0, iamt: 0 }],
    },
    itc_elg: {
      itc_avl: [],
      itc_rev: [],
      itc_net: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
      itc_inelg: [],
    },
    intr_ltfee: {
      intr_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ltfee_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
    },
    taxpayble: {
      returnsDbCdredList: {
        tax_pay: [],
        net_tax_pay: [],
        tax_paid: {
          pd_by_cash: [],
          pd_by_itc: [{}],
        },
      },
    },
  };

  (payloads || []).forEach((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    ["osup_det", "osup_zero", "osup_nil_exmp", "isup_rev", "osup_nongst"].forEach((key) => {
      addGstr3bTaxAmount(aggregate.sup_details[key], root.sup_details && root.sup_details[key]);
    });
    [["unreg_details", 0], ["comp_details", 0], ["uin_details", 0]].forEach(([key, index]) => {
      const sourceRow = ((root.inter_sup || {})[key] || [])[0] || {};
      aggregate.inter_sup[key][index].txval += asNumber(sourceRow.txval);
      aggregate.inter_sup[key][index].iamt += asNumber(sourceRow.iamt);
    });
    addGstr3bTaxAmount(aggregate.itc_elg.itc_net, root.itc_elg && root.itc_elg.itc_net);
    addGstr3bTaxAmount(aggregate.intr_ltfee.intr_details, root.intr_ltfee && root.intr_ltfee.intr_details);
    addGstr3bTaxAmount(aggregate.intr_ltfee.ltfee_details, root.intr_ltfee && root.intr_ltfee.ltfee_details);
    const taxPayment = normalizeGstr3bTaxPayment(pickGstr3bTaxPaymentSource(root));
    const targetItc = aggregate.taxpayble.returnsDbCdredList.tax_paid.pd_by_itc[0];
    Object.keys(taxPayment.pditc || {}).forEach((key) => {
      targetItc[key] = asNumber(targetItc[key]) + asNumber(taxPayment.pditc[key]);
    });
  });

  aggregate.itc_elg.itc_avl = aggregateGstr3bTypedRows(payloads, "itc_avl", ["IMPG", "IMPS", "ISRC", "ISD", "OTH"]);
  aggregate.itc_elg.itc_rev = aggregateGstr3bTypedRows(payloads, "itc_rev", ["RUL", "OTH"]);
  aggregate.itc_elg.itc_inelg = aggregateGstr3bTypedRows(payloads, "itc_inelg", ["RUL", "OTH"]);
  aggregate.taxpayble.returnsDbCdredList.tax_pay = [
    aggregateGstr3bPaymentRows(payloads, 30002),
    aggregateGstr3bPaymentRows(payloads, 30003),
  ];
  aggregate.taxpayble.returnsDbCdredList.net_tax_pay = aggregate.taxpayble.returnsDbCdredList.tax_pay;
  aggregate.taxpayble.returnsDbCdredList.tax_paid.pd_by_cash = [
    aggregateGstr3bCashPaymentRows(payloads, 30002),
    aggregateGstr3bCashPaymentRows(payloads, 30003),
  ];

  return { data: aggregate };
}

function extractGstr3bWorksheetRowsOnly(worksheetXml) {
  const tableMatch = String(worksheetXml || "").match(/<Table>([\s\S]*)<\/Table>/);
  if (!tableMatch) return "";
  return tableMatch[1].replace(/<Column[^>]*\/>/g, "");
}

function buildCombinedGstr3bBreakupTransposedRows(payloads) {
  const periods = [];
  const totalsByPeriod = new Map();
  (payloads || []).forEach((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const period = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
    if (!period) return;
    periods.push(period);
    const taxPayment = normalizeGstr3bTaxPayment(pickGstr3bTaxPaymentSource(root));
    totalsByPeriod.set(period, sumPaymentRows(taxPayment.net_tax_pay, "tx"));
  });
  const taxRows = [
    ["Integrated tax", "igst"],
    ["Central tax", "cgst"],
    ["State/UT tax", "sgst"],
    ["Cess", "cess"],
  ];
  const columns = ["Description"].concat(periods, ["Total"]);
  const headerXml = columns.map((column) => `<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">${escapeXml(column)}</Data></Cell>`).join("");
  const rowsXml = taxRows.map(([label, key]) => {
    let total = 0;
    const cells = periods.map((period) => {
      const value = asNumber((totalsByPeriod.get(period) || {})[key]);
      total += value;
      return `<Cell ss:StyleID="G3BNumber"><Data ss:Type="Number">${value}</Data></Cell>`;
    }).join("");
    return `<Row><Cell ss:StyleID="G3BItem"><Data ss:Type="String">${escapeXml(label)}</Data></Cell>${cells}<Cell ss:StyleID="G3BNumber"><Data ss:Type="Number">${total}</Data></Cell></Row>`;
  }).join("");
  const titleMergeAcross = Math.max(columns.length - 1, 1);
  return `<Row><Cell ss:StyleID="G3BSectionBar" ss:MergeAcross="${titleMergeAcross}"><Data ss:Type="String">Breakup of tax liability declared (for interest computation)</Data></Cell></Row><Row>${headerXml}</Row>${rowsXml}`;
}

function buildCombinedGstr3bDetailsWorksheet(payloads) {
  const periods = [];
  (payloads || []).forEach((payload) => {
    const root = payload && payload.data ? payload.data : payload || {};
    const period = String(root.rtnprd || root.ret_period || root.rtn_prd || root.fp || "");
    if (period && !periods.includes(period)) periods.push(period);
  });
  const summaryRows = extractGstr3bWorksheetRowsOnly(buildCombinedGstr3bSummaryWorksheet(payloads));
  const detailRows = extractGstr3bWorksheetRowsOnly(buildCombinedGstr3bAllTablesWorksheet(payloads));
  const breakupRows = buildCombinedGstr3bBreakupTransposedRows(payloads);
  const columnXml = ['<Column ss:AutoFitWidth="0" ss:Width="420"/>']
    .concat(periods.map(() => '<Column ss:AutoFitWidth="0" ss:Width="110"/>'))
    .concat(['<Column ss:AutoFitWidth="0" ss:Width="110"/>'])
    .join("");
  return `<Worksheet ss:Name="Details"><Table>${columnXml}${summaryRows}<Row><Cell/></Row>${detailRows}<Row><Cell/></Row>${breakupRows}</Table></Worksheet>`;
}

function buildCombinedGstr3bWorkbookXml(payloads) {
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="G3BTitle">
   <Font ss:Bold="1" ss:Size="14"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="G3BSubtitle">
   <Font ss:Italic="1" ss:Size="10"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="G3BLabel">
   <Font ss:Bold="1" ss:Size="9"/>
   <Interior ss:Color="#F3E3D5" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BValue">
   <Font ss:Size="9"/>
   <Interior ss:Color="#FFFDFB" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BSectionBar">
   <Font ss:Bold="1" ss:Size="9"/>
   <Interior ss:Color="#F7E5D8" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BHeader">
   <Font ss:Bold="1" ss:Size="8"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#FCF1E8" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BCell">
   <Font ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BCellBold">
   <Font ss:Bold="1" ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#FAF4EF" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BSubgroup">
   <Font ss:Bold="1" ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1" ss:Indent="1"/>
   <Interior ss:Color="#F8EFE8" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BItem">
   <Font ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1" ss:Indent="1"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BItemDeep">
   <Font ss:Size="8"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1" ss:Indent="2"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BNumber">
   <Font ss:Size="8"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="0.00"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F1F1F"/></Borders>
 </Style>
 <Style ss:ID="G3BBlank">
   <Alignment ss:Vertical="Center"/>
 </Style>
 </Styles>
 ${buildGstr3bPdfExactWorksheet(buildAggregatedGstr3bPayload(payloads), "Summary")}
 ${buildCombinedGstr3bDetailsWorksheet(payloads)}
</Workbook>`;
}

const GSTR1_SUMMARY_COLUMNS = ["Description", "No. of records", "Document Type", "Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"];
const GSTR1_SUMMARY_SECTION_DEFS = [
  { title: "4A - Taxable outward supplies made to registered persons (other than reverse charge supplies) including supplies made through e-commerce operator attracting TCS - B2B Regular", rows: [{ label: "Total", aliases: ["B2B_4A", "b2b_regular", "b2breg"], docType: "Invoice" }] },
  { title: "4B - Taxable outward supplies made to registered persons attracting tax on reverse charge - B2B Reverse charge", rows: [{ label: "Total", aliases: ["B2B_4B", "b2brcm", "b2b_reverse", "b2b_reverse_charge"], docType: "Invoice" }] },
  { title: "5 - Taxable outward inter-state supplies made to unregistered persons (where invoice value is more than Rs. 1 lakh) including supplies made through e-commerce operator, rate wise - B2CL (Large)", rows: [{ label: "Total", aliases: ["B2CL", "b2cl_large"], docType: "Invoice" }] },
  { title: "6A - Exports (with/without payment)", rows: [
    { label: "Total", aliases: ["EXP", "exports"], docType: "Invoice" },
    { label: "- EXPWP", aliases: ["EXP_EXPWP", "expwp", "export_wp", "exports_wp"], docType: "Invoice" },
    { label: "- EXPWOP", aliases: ["EXP_EXPWOP", "expwop", "export_wop", "exports_wop"], docType: "Invoice" },
  ] },
  { title: "6B - Supplies made to SEZ unit or SEZ developer - SEZWP/SEZWOP", rows: [
    { label: "Total", aliases: ["B2B_SEZWP", "B2B_SEZWOP"], docType: "Invoice", combine: true },
    { label: "- SEZWP", aliases: ["B2B_SEZWP", "sezwp"], docType: "Invoice" },
    { label: "- SEZWOP", aliases: ["B2B_SEZWOP", "sezwop"], docType: "Invoice" },
  ] },
  { title: "6C - Deemed Exports - DE", rows: [{ label: "Total", aliases: ["B2B_6C", "de", "deemed", "deemed_exports"], docType: "Invoice" }] },
  { title: "7 - Taxable supplies (Net of debit and credit notes) to unregistered persons (other than the supplies covered in Table 5) including supplies made through e-commerce operator attracting TCS - B2CS (Others)", rows: [{ label: "Total", aliases: ["B2CS", "b2c_others"], docType: "Net Value" }] },
  { title: "8 - Nil rated, exempted and non GST outward supplies", rows: [
    { label: "Total", aliases: ["NIL"], valueOnly: true, nilField: "total" },
    { label: "- Nil", aliases: ["NIL"], valueOnly: true, nilField: "ttl_nilsup_amt" },
    { label: "- Exempted", aliases: ["NIL"], valueOnly: true, nilField: "ttl_expt_amt" },
    { label: "- Non-GST", aliases: ["NIL"], valueOnly: true, nilField: "ttl_ngsup_amt" },
  ] },
  { title: "9A - Amendment to taxable outward supplies made to registered person in returns of earlier tax periods in table 4 - B2B Regular", rows: [
    { label: "Amended amount - Total", aliases: ["B2BA_4A", "b2b_amend"], docType: "Invoice", useActual: true },
    { label: "Net differential amount (Amended - Original)", aliases: ["B2BA_4A", "b2b_amend_diff"] },
  ] },
  { title: "9A - Amendment to taxable outward supplies made to registered person in returns of earlier tax periods in table 4 - B2B Reverse charge", rows: [
    { label: "Amended amount - Total", aliases: ["B2BA_4B", "b2b_reverse_amend"], docType: "Invoice", useActual: true },
    { label: "Net differential amount (Amended - Original)", aliases: ["B2BA_4B", "b2b_reverse_amend_diff"] },
  ] },
  { title: "9A - Amendment to Inter-State supplies made to unregistered person (where invoice value is more than Rs. 1 lakh) in returns of earlier tax periods in table 5 - B2CL (Large)", rows: [
    { label: "Amended amount - Total", aliases: ["B2CLA", "b2cl_amend"], docType: "Invoice", useActual: true },
    { label: "Net differential amount (Amended - Original)", aliases: ["B2CLA", "b2cl_amend_diff"] },
  ] },
  { title: "9A - Amendment to Export supplies in returns of earlier tax periods in table 6A (EXPWP/EXPWOP)", rows: [
    { label: "Amended amount - Total", aliases: ["EXPA", "exp_amend"], docType: "Invoice", useActual: true },
    { label: "Net differential amount (Amended - Original) - Total", aliases: ["EXPA", "exp_amend_diff"] },
    { label: "- EXPWP", aliases: ["EXPA_EXPWP", "expwp_amend"], docType: "Invoice", useActual: true },
    { label: "- EXPWOP", aliases: ["EXPA_EXPWOP", "expwop_amend"], docType: "Invoice", useActual: true },
  ] },
  { title: "9A - Amendment to supplies made to SEZ units or SEZ developers in returns of earlier tax periods in table 6B (SEZWP/SEZWOP)", rows: [
    { label: "Amended amount - Total", aliases: ["B2BA_SEZWP", "B2BA_SEZWOP"], docType: "Invoice", combine: true, useActual: true },
    { label: "Net differential amount (Amended - Original) - Total", aliases: ["B2BA_SEZWP", "B2BA_SEZWOP"], combine: true },
    { label: "- SEZWP", aliases: ["B2BA_SEZWP", "sezwp_amend"], docType: "Invoice", useActual: true },
    { label: "- SEZWOP", aliases: ["B2BA_SEZWOP", "sezwop_amend"], docType: "Invoice", useActual: true },
  ] },
  { title: "9A - Amendment to Deemed Exports in returns of earlier tax periods in table 6C (DE)", rows: [
    { label: "Amended amount - Total", aliases: ["B2BA_6C", "de_amend"], docType: "Invoice", useActual: true },
    { label: "Net differential amount (Amended - Original)", aliases: ["B2BA_6C", "de_amend_diff"] },
  ] },
  { title: "9B - Credit/Debit Notes (Registered) - CDNR", rows: [
    { label: "Total - Net off debit/credit notes (Debit notes - Credit notes)", aliases: ["CDNR"], docType: "Note" },
    { label: "Credit / Debit notes issued to registered person for taxable outward supplies in table 4 other than table 6 - B2B Regular", aliases: ["CDNR_4A"], docType: "Note" },
    { label: "Credit / Debit notes issued to registered person for taxable outward supplies in table 4 other than table 6 - B2B Reverse charge", aliases: ["CDNR_4B"], docType: "Note" },
    { label: "Credit / Debit notes issued to registered person for taxable outward supplies in table 6B - SEZWP/SEZWOP", aliases: ["CDNR_SEZWP", "CDNR_SEZWOP"], docType: "Note", combine: true },
    { label: "Credit / Debit notes issued to registered person for taxable outward supplies in table 6C - DE", aliases: ["CDNR_6C"], docType: "Note" },
  ] },
  { title: "9B - Credit/Debit Notes (Unregistered) - CDNUR", rows: [
    { label: "Total - Net off debit/credit notes (Debit notes - Credit notes)", aliases: ["CDNUR"], docType: "Note" },
    { label: "- B2CL", aliases: ["CDNUR_B2CL"], docType: "Note" },
    { label: "- EXPWP", aliases: ["CDNUR_EXPWP"], docType: "Note" },
    { label: "- EXPWOP", aliases: ["CDNUR_EXPWOP"], docType: "Note" },
  ] },
  { title: "9C - Amended Credit/Debit Notes (Registered) - CDNRA", rows: [
    { label: "Amended amount - Total", aliases: ["CDNRA"], docType: "Note", useActual: true },
    { label: "Net Differential amount (Net Amended Debit notes - Net Amended Credit notes) - Total", aliases: ["CDNRA"] },
    { label: "Amended Credit / Debit notes issued to registered person for taxable outward supplies in table 4 other than table 6 - B2B Regular", aliases: ["CDNRA_4A"], docType: "Note" },
    { label: "Amended Credit / Debit notes issued to registered person for taxable outward supplies in table 4 other than table 6 - B2B Reverse charge", aliases: ["CDNRA_4B"], docType: "Note" },
    { label: "Amended Credit / Debit notes issued to registered person for taxable outward supplies in table 6B - SEZWP/SEZWOP", aliases: ["CDNRA_SEZWP", "CDNRA_SEZWOP"], docType: "Note", combine: true },
    { label: "Amended Credit / Debit notes issued to registered person for taxable outward supplies in table 6C - DE", aliases: ["CDNRA_6C"], docType: "Note" },
  ] },
  { title: "9C - Amended Credit/Debit Notes (Unregistered) - CDNURA", rows: [
    { label: "Amended amount - Total", aliases: ["CDNURA"], docType: "Note", useActual: true },
    { label: "Net Differential amount (Net Amended Debit notes - Net Amended Credit notes) - Total", aliases: ["CDNURA"] },
    { label: "- B2CL", aliases: ["CDNURA_B2CL"], docType: "Note" },
    { label: "- EXPWP", aliases: ["CDNURA_EXPWP"], docType: "Note" },
    { label: "- EXPWOP", aliases: ["CDNURA_EXPWOP"], docType: "Note" },
  ] },
  { title: "10 - Amendment to taxable outward supplies made to unregistered person in returns for earlier tax periods in table 7 including supplies made through e-commerce operator attracting TCS - B2C (Others)", rows: [
    { label: "Amended amount - Total", aliases: ["B2CSA", "b2cs_amend"], docType: "Net Value", useActual: true },
    { label: "Net differential amount (Amended - Original)", aliases: ["B2CSA", "b2cs_amend_diff"] },
  ] },
  { title: "11A(1), 11A(2) - Advances received for which invoice has not been issued (tax amount to be added to the output tax liability) (Net of refund vouchers, if any)", rows: [{ label: "Total", aliases: ["AT", "advance_tax"], docType: "Net Value" }] },
  { title: "11B(1), 11B(2) - Advance amount received in earlier tax period and adjusted against the supplies being shown in this tax period in Table Nos. 4, 5, 6 and 7 (Net of refund vouchers, if any)", rows: [{ label: "Total", aliases: ["TXPD", "ATADJ", "advance_adjusted"], docType: "Net Value" }] },
  { title: "11A - Amendment to advances received in returns for earlier tax periods in table 11A(1), 11A(2) (Net of refund vouchers, if any)", rows: [
    { label: "Amended amount - Total", aliases: ["ATA", "at_amend"], docType: "Net Value", useActual: true },
    { label: "Total", aliases: ["ATA", "at_amend_diff"] },
  ] },
  { title: "11B - Amendment to advances adjusted in returns for earlier tax periods in table 11B(1), 11B(2) (Net of refund vouchers, if any)", rows: [
    { label: "Amended amount - Total", aliases: ["TXPDA", "ATADJA", "atadj_amend"], docType: "Net Value", useActual: true },
    { label: "Total", aliases: ["TXPDA", "ATADJA", "atadj_amend_diff"] },
  ] },
  { title: "12 - HSN-wise summary of outward supplies", rows: [
    { label: "Total", aliases: ["hsn", "hsn_total", "hsn_sac_summary"], docType: "NA" },
    { label: "B2B Total", aliases: ["hsn_b2b"], docType: "NA" },
    { label: "B2C Total", aliases: ["hsn_b2c"], docType: "NA" },
  ] },
  { title: "13 - Documents issued", rows: [{ label: "Net issued documents", aliases: ["DOC_ISSUE", "docs", "documents"], docType: "All Documents", countField: "net_doc_issued", countOnly: true }] },
  { title: "14 - Supplies made through E-Commerce Operators", rows: [
    { label: "Total", aliases: ["SUPECOM", "ECOM"], docType: "Net Value" },
    { label: "(a) Liable to collect tax u/s 52", aliases: ["SUPECOM_14A", "eco_tcs"], docType: "Net Value" },
    { label: "(b) Liable to pay tax u/s 9(5)", aliases: ["SUPECOM_14B", "eco_95"], docType: "Net Value" },
  ] },
  { title: "14A - Amended Supplies made through E-Commerce Operators", rows: [
    { label: "Amended amount - Total", aliases: ["SUPECOMA", "ECOMA"], docType: "Net Value", useActual: true },
    { label: "Net differential amount (Amended - Original)", aliases: ["SUPECOMA", "ECOMA"], docType: "Net Value" },
  ] },
  { title: "15 - Supplies U/s 9(5)", rows: [
    { label: "Total", aliases: ["sec95", "sup95", "sup_95"], docType: "Document/Net Value" },
    { label: "- For Registered Recipients", aliases: ["sec95_reg", "sup95_reg"], docType: "Document" },
    { label: "- Regular", aliases: ["sec95_regular", "sup95_regular"], docType: "Document" },
    { label: "- DE", aliases: ["sec95_de", "sup95_de"], docType: "Document" },
    { label: "- SEZWP", aliases: ["sec95_sezwp", "sup95_sezwp"], docType: "Document" },
    { label: "- SEZWOP", aliases: ["sec95_sezwop", "sup95_sezwop"], docType: "Document" },
    { label: "- For Unregistered Recipient", aliases: ["sec95_unreg", "sup95_unreg"], docType: "Net Value" },
  ] },
  { title: "15A (I) - Amended Supplies U/s 9(5) - For Registered Recipients", rows: [
    { label: "Amended amount - Total", aliases: ["sec95a_reg", "sup95a_reg"], docType: "Document" },
    { label: "Net differential amount (Amended - Original)", aliases: ["sec95a_reg_diff", "sup95a_reg_diff"], docType: "Document" },
    { label: "- Regular", aliases: ["sec95a_regular", "sup95a_regular"], docType: "Document" },
    { label: "- DE", aliases: ["sec95a_de", "sup95a_de"], docType: "Document" },
    { label: "- SEZWP", aliases: ["sec95a_sezwp", "sup95a_sezwp"], docType: "Document" },
    { label: "- SEZWOP", aliases: ["sec95a_sezwop", "sup95a_sezwop"], docType: "Document" },
  ] },
  { title: "15A (II) - Amended Supplies U/s 9(5) - For Unregistered Recipients", rows: [
    { label: "Amended amount - Total", aliases: ["sec95a_unreg", "sup95a_unreg"], docType: "Net Value" },
    { label: "Net differential amount (Amended - Original)", aliases: ["sec95a_unreg_diff", "sup95a_unreg_diff"], docType: "Net Value" },
  ] },
];

function normalizeSummaryToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getGstr1SummaryRoot(payload) {
  const root = payload && payload.data && typeof payload.data === "object" ? payload.data : payload || {};
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) return root.data;
  return root;
}

function buildGstr1SummarySectionIndex(payload) {
  const root = getGstr1SummaryRoot(payload);
  const index = new Map();
  const add = (key, node) => {
    const normalized = normalizeSummaryToken(key);
    if (!normalized || !node || typeof node !== "object") return;
    if (!index.has(normalized)) index.set(normalized, []);
    index.get(normalized).push(node);
  };
  const sections = Array.isArray(root.sec_sum) ? root.sec_sum : [];
  sections.forEach((section) => {
    const secName = String(section && section.sec_nm || "").trim();
    add(secName, section);
    (Array.isArray(section && section.sub_sections) ? section.sub_sections : []).forEach((sub) => {
      const subName = String((sub && sub.sec_nm) || "").trim();
      const subType = String((sub && sub.typ) || "").trim();
      if (subName) add(subName, sub);
      if (subType) {
        add(subType, sub);
        if (secName) add(`${secName}_${subType}`, sub);
      }
    });
  });
  return index;
}

function getNestedSummaryValue(obj, keys) {
  const candidates = Array.isArray(keys) ? keys : [keys];
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  const normalizedMap = new Map(Object.keys(obj).map((key) => [normalizeSummaryToken(key), obj[key]]));
  for (const key of candidates) {
    const normalized = normalizeSummaryToken(key);
    if (normalizedMap.has(normalized)) return normalizedMap.get(normalized);
  }
  return undefined;
}

function collectGstr1SummaryCandidates(payload) {
  const root = getGstr1SummaryRoot(payload);
  const candidates = [];
  const visited = new Set();
  const visit = (node, path, depth) => {
    if (!node || typeof node !== "object" || visited.has(node) || depth > 7) return;
    visited.add(node);
    if (!Array.isArray(node)) {
      candidates.push({ node, path, normPath: normalizeSummaryToken(path) });
      Object.keys(node).forEach((key) => visit(node[key], path ? `${path}.${key}` : key, depth + 1));
      return;
    }
    candidates.push({ node, path, normPath: normalizeSummaryToken(path) });
    node.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
  };
  visit(root, "", 0);
  return candidates;
}

function pickGstr1SummaryNode(payload, aliases) {
  const index = buildGstr1SummarySectionIndex(payload);
  for (const alias of aliases || []) {
    const matches = index.get(normalizeSummaryToken(alias));
    if (matches && matches.length) return matches[0];
  }
  const normalizedAliases = (aliases || []).map(normalizeSummaryToken).filter(Boolean);
  const candidates = collectGstr1SummaryCandidates(payload);
  let best = null;
  candidates.forEach((candidate) => {
    let score = 0;
    normalizedAliases.forEach((alias) => {
      if (!alias) return;
      if (candidate.normPath === alias) score += 100;
      else if (candidate.normPath.endsWith(alias)) score += 70;
      else if (candidate.normPath.includes(alias)) score += 35;
    });
    if (Array.isArray(candidate.node)) score += candidate.node.length ? 8 : 1;
    if (candidate.node && typeof candidate.node === "object" && !Array.isArray(candidate.node)) {
      ["txval", "iamt", "camt", "samt", "csamt", "val", "ttl", "count", "num"].forEach((key) => {
        if (getNestedSummaryValue(candidate.node, key) !== undefined) score += 4;
      });
    }
    if (score > 0 && (!best || score > best.score)) best = { ...candidate, score };
  });
  return best ? best.node : null;
}

function pickGstr1SummaryNodes(payload, aliases) {
  const index = buildGstr1SummarySectionIndex(payload);
  const out = [];
  const seen = new Set();
  (aliases || []).forEach((alias) => {
    const matches = index.get(normalizeSummaryToken(alias)) || [];
    matches.forEach((match) => {
      if (seen.has(match)) return;
      seen.add(match);
      out.push(match);
    });
  });
  return out;
}

function sumGstr1SummaryNode(node, options) {
  const cfg = options || {};
  const totals = { count: 0, value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  let seen = false;
  const add = (item) => {
    if (!item || typeof item !== "object") return;
    const prefix = cfg.useActual ? "act_" : "ttl_";
    const count = asNumber(getNestedSummaryValue(item, cfg.countField || ["num", "count", "cnt", "records", "ttl_rec", "no_of_records", "noOfRecords"]));
    let value = 0;
    if (cfg.nilField === "total") {
      value = asNumber(item.ttl_nilsup_amt) + asNumber(item.ttl_expt_amt) + asNumber(item.ttl_ngsup_amt);
    } else if (cfg.nilField) {
      value = asNumber(getNestedSummaryValue(item, cfg.nilField));
    } else {
      value = asNumber(getNestedSummaryValue(item, [`${prefix}tax`, "txval", "taxable_value", "taxableValue", "tax", "ttl_tax"]));
    }
    const igst = asNumber(getNestedSummaryValue(item, [`${prefix}igst`, "iamt", "igst", "igst_amt", "integrated_tax", "ttl_igst"]));
    const cgst = asNumber(getNestedSummaryValue(item, [`${prefix}cgst`, "camt", "cgst", "cgst_amt", "central_tax", "ttl_cgst"]));
    const sgst = asNumber(getNestedSummaryValue(item, [`${prefix}sgst`, "samt", "sgst", "sgst_amt", "state_tax", "ut_tax", "ttl_sgst"]));
    const cess = asNumber(getNestedSummaryValue(item, [`${prefix}cess`, "csamt", "cess", "cess_amt", "ttl_cess"]));
    totals.count += count;
    totals.value += value;
    totals.igst += igst;
    totals.cgst += cgst;
    totals.sgst += sgst;
    totals.cess += cess;
    if (count || value || igst || cgst || sgst || cess) seen = true;
  };
  if (Array.isArray(node)) {
    node.forEach((item) => {
      if (item && typeof item === "object") add(item);
    });
  } else if (node && typeof node === "object") {
    add(node);
    Object.keys(node).forEach((key) => {
      const value = node[key];
      if (Array.isArray(value)) value.forEach((item) => item && typeof item === "object" && add(item));
    });
  }
  return { ...totals, seen };
}

function sumGstr1SummaryNodes(nodes, options) {
  return (nodes || []).reduce((totals, node) => {
    const current = sumGstr1SummaryNode(node, options);
    totals.count += current.count;
    totals.value += current.value;
    totals.igst += current.igst;
    totals.cgst += current.cgst;
    totals.sgst += current.sgst;
    totals.cess += current.cess;
    totals.seen = totals.seen || current.seen;
    return totals;
  }, { count: 0, value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, seen: false });
}

function formatGstr1SummaryAmount(value, blankZero) {
  const numeric = asNumber(value);
  if (blankZero && numeric === 0) return "";
  return numeric.toFixed(2);
}

function buildGstr1SummaryRows(payload) {
  const rows = [];
  GSTR1_SUMMARY_SECTION_DEFS.forEach((section) => {
    rows.push({ __kind: "section", Description: section.title });
    section.rows.forEach((rowDef) => {
      const summary = rowDef.combine
        ? sumGstr1SummaryNodes(pickGstr1SummaryNodes(payload, rowDef.aliases), rowDef)
        : sumGstr1SummaryNode(pickGstr1SummaryNode(payload, rowDef.aliases), rowDef);
      rows.push({
        __kind: "row",
        Description: rowDef.label,
        "No. of records": rowDef.valueOnly ? "" : (summary.count || ""),
        "Document Type": rowDef.docType || "",
        Value: rowDef.countOnly ? "" : formatGstr1SummaryAmount(summary.value, false),
        "Integrated Tax": rowDef.valueOnly || rowDef.countOnly ? "" : formatGstr1SummaryAmount(summary.igst, false),
        "Central Tax": rowDef.valueOnly || rowDef.countOnly ? "" : formatGstr1SummaryAmount(summary.cgst, false),
        "State/UT Tax": rowDef.valueOnly || rowDef.countOnly ? "" : formatGstr1SummaryAmount(summary.sgst, false),
        Cess: rowDef.valueOnly || rowDef.countOnly ? "" : formatGstr1SummaryAmount(summary.cess, false),
      });
    });
  });
  const liability = sumGstr1SummaryNode(pickGstr1SummaryNode(payload, ["TTL_LIAB"]));
  rows.push({
    __kind: "liability",
    Description: "Total Liability (Outward supplies other than Reverse charge)",
    Value: formatGstr1SummaryAmount(liability.value, false),
    "Integrated Tax": formatGstr1SummaryAmount(liability.igst, false),
    "Central Tax": formatGstr1SummaryAmount(liability.cgst, false),
    "State/UT Tax": formatGstr1SummaryAmount(liability.sgst, false),
    Cess: formatGstr1SummaryAmount(liability.cess, false),
  });
  return rows;
}

function buildGstr1SummaryWorkbookXml(payload, sheetName) {
  const root = getGstr1SummaryRoot(payload);
  const period = String(root.rtnprd || root.rtn_prd || root.ret_period || root.fp || "");
  const gstin = String(root.gstin || root.gstinid || session.gstin || "");
  const legalName = String(root.lgnm || root.legal_name || root.legalName || "");
  const tradeName = String(root.trade_name || root.tradeName || root.trdnm || legalName || "");
  const arn = String(root.arn || root.arn_no || root.arnNo || "");
  const arnDate = String(root.arndt || root.arn_date || root.arnDate || "");
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const periodLabel = period && period.length === 6 ? (monthNames[Math.max(0, Math.min(11, Number(period.slice(0, 2)) - 1))] || period) : period;
  const yearLabel = period && period.length === 6 ? `${period.slice(2, 6)}-${String(Number(period.slice(2, 6)) + 1).slice(-2)}` : "";
  const rows = [];
  const cell = (value, style, extra, type) => `<Cell ss:StyleID="${style || "G1SCell"}"${extra || ""}><Data ss:Type="${type || "String"}">${escapeXml(value == null ? "" : value)}</Data></Cell>`;
  const addRow = (cells) => rows.push(`<Row>${cells.join("")}</Row>`);
  addRow([cell("FORM GSTR-1", "G1STitle", ' ss:MergeAcross="7"')]);
  addRow([cell("[See rule 59(1)]", "G1SSubtitle", ' ss:MergeAcross="7"')]);
  addRow([cell("Details of outward supplies of goods or services", "G1SSubtitle", ' ss:MergeAcross="7"')]);
  addRow([cell("Financial year", "G1SLabel"), cell(yearLabel, "G1SValue"), cell("Tax period", "G1SLabel"), cell(periodLabel, "G1SValue", ' ss:MergeAcross="4"')]);
  [
    ["1 GSTIN", gstin],
    ["2(a) Legal name of the registered person", legalName],
    ["(b) Trade name if any", tradeName],
    ["(c) ARN", arn],
    ["(d) ARN date", arnDate],
  ].forEach(([label, value]) => addRow([cell(label, "G1SLabel"), cell(value, "G1SValue", ' ss:MergeAcross="6"')]));
  addRow(GSTR1_SUMMARY_COLUMNS.map((column) => cell(column, "G1SHeader")));
  buildGstr1SummaryRows(payload).forEach((row) => {
    if (row.__kind === "section") {
      addRow([cell(row.Description, "G1SSection", ' ss:MergeAcross="7"')]);
      return;
    }
    const style = row.__kind === "liability" ? "G1SSection" : "G1SCell";
    addRow(GSTR1_SUMMARY_COLUMNS.map((column, index) => {
      const value = row[column] == null ? "" : row[column];
      const cellStyle = index === 0 ? style : (index === 1 ? "G1SCount" : (index === 2 ? "G1SCell" : "G1SNumber"));
      const cellType = index !== 0 && index !== 2 && value !== "" ? "Number" : "String";
      return cell(value, cellStyle, "", cellType);
    }));
  });
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="G1STitle"><Font ss:Bold="1" ss:Size="14"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#F7E5D8" ss:Pattern="Solid"/></Style>
  <Style ss:ID="G1SSubtitle"><Font ss:Bold="1" ss:Size="10"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#FFFDFB" ss:Pattern="Solid"/></Style>
  <Style ss:ID="G1SLabel"><Font ss:Bold="1" ss:Size="9"/><Interior ss:Color="#F3E3D5" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SValue"><Font ss:Size="9"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SSection"><Font ss:Bold="1" ss:Size="8"/><Alignment ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#F7E5D8" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SHeader"><Font ss:Bold="1" ss:Size="8"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#FCF1E8" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SCell"><Font ss:Size="8"/><Alignment ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SCount"><Font ss:Size="8"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SNumber"><Font ss:Size="8"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0.00"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(sanitizeWorksheetName(sheetName || "GSTR-1 Summary"))}">
  <Table>
   <Column ss:Width="470"/><Column ss:Width="80"/><Column ss:Width="90"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="90"/>
   ${rows.join("\n   ")}
  </Table>
 </Worksheet>
</Workbook>`;
}

function buildCombinedGstr1SummaryWorkbookXml(entries) {
  if (!entries || entries.length === 0) return "";

  // Metrics shown as ROWS now (Document Type included)
  const metrics = ["No. of records", "Document Type", "Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"];
  const numericMetrics = new Set(["No. of records", "Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"]);

  const cell = (value, style, extra, type) =>
    `<Cell ss:StyleID="${style}"${extra || ""}><Data ss:Type="${
      type || (typeof value === "number" ? "Number" : "String")
    }">${escapeXml(value == null ? "" : value)}</Data></Cell>`;

  // ── 1. Collect periods ──────────────────────────────────────────────────────
  const periods = entries.map((entry) => {
    const root = getGstr1SummaryRoot(entry && entry.payload);
    return String(
      (entry && entry.period && entry.period.value) ||
        root.ret_period || root.rtn_prd || root.rtnprd || ""
    );
  });

  // ── 2. Build per-period lookup: Description → row ──────────────────────────
  const periodMaps = entries.map((entry) => {
    const map = new Map();
    buildGstr1SummaryRows(entry.payload).forEach((row) => {
      map.set(row.Description, row);
    });
    return map;
  });

  // ── 3. Master row order from first entry (structure is same across periods) ─
  const masterRows = buildGstr1SummaryRows((entries[0] || {}).payload);

  const numPeriods = periods.length;
  // Total columns = 1 (metric label) + numPeriods + 1 (Total) 
  // MergeAcross for section rows spans everything after first cell
  const sectionMerge = numPeriods + 1;

  const bodyRows = [];

  // ── 4. Header row ───────────────────────────────────────────────────────────
  bodyRows.push(
    `<Row>` +
      cell("", "G1SHeader") +
      periods.map((p) => cell(p, "G1SHeader")).join("") +
      cell("Total", "G1SHeader") +
    `</Row>`
  );

  // ── 5. Data rows ────────────────────────────────────────────────────────────
  masterRows.forEach((masterRow) => {
    // Section heading → merged row, no metric breakdown
    if (masterRow.__kind === "section") {
      bodyRows.push(
        `<Row>${cell(masterRow.Description, "G1SSection", ` ss:MergeAcross="${sectionMerge}"`)}</Row>`
      );
      return;
    }

    // One row per metric
    metrics.forEach((metric) => {
      const isNumeric = numericMetrics.has(metric);

      // Value for this metric from each period
      const values = periodMaps.map((map) => {
        const row = map.get(masterRow.Description);
        if (!row) return "";
        const v = row[metric];
        return v == null ? "" : v;
      });

      // Total column: sum for numeric, first non-empty for text (Document Type)
      const total = isNumeric
        ? values.reduce((acc, v) => {
            const n = asNumber(v);
            return acc + (isNaN(n) ? 0 : n);
          }, 0)
        : values.find((v) => v !== "") || "";

      const cellStyle = isNumeric
        ? metric === "No. of records" ? "G1SCount" : "G1SNumber"
        : "G1SCell";

      const formatVal = (v) => {
        if (!isNumeric) return v;
        const n = asNumber(v);
        return isNaN(n) || n === 0 ? "" : n;
      };

      bodyRows.push(
        `<Row>` +
          cell(metric, "G1SCell") +
          values.map((v) => cell(formatVal(v), cellStyle)).join("") +
          cell(isNumeric && total === 0 ? "" : total, cellStyle) +
        `</Row>`
      );
    });
  });

  // ── 6. Column widths: metric label + one per period + Total ─────────────────
  const columnXml = [
    '<Column ss:Width="160"/>',
    ...periods.map(() => '<Column ss:Width="120"/>'),
    '<Column ss:Width="120"/>',
  ].join("");

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="G1STitle"><Font ss:Bold="1" ss:Size="9"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#F7E5D8" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SHeader"><Font ss:Bold="1" ss:Size="8"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#FCF1E8" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SSection"><Font ss:Bold="1" ss:Size="8"/><Interior ss:Color="#F7E5D8" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SCell"><Font ss:Size="8"/><Alignment ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SCount"><Font ss:Size="8"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SNumber"><Font ss:Size="8"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0.00"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="G1SBlank"><Font ss:Size="8"/><Alignment ss:Vertical="Center"/></Style>
 </Styles>
 <Worksheet ss:Name="GSTR-1 Summary"><Table>${columnXml}${bodyRows.join("")}</Table></Worksheet>
</Workbook>`;
}

const GSTR2A_OTHER_SECTION_ORDER = [
  "B2B",
  "B2BA",
  "CDN",
  "CDNA",
  "ECOM",
  "ECOMA",
  "ISD",
  "ISDA",
  "TDSA",
  "TDS",
  "TCS",
  "IMPG",
  "IMPGSEZ",
];

function getSummaryRequestHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
  };
}

async function fetchSummaryJsonFromUrl(url, label) {
  const msg = await processAsync({
    request: "get",
    url,
    headers: getSummaryRequestHeaders(),
  });
  if (!msg || !msg.status) {
    const why = msg && msg.statusCode ? `HTTP ${msg.statusCode}` : ((msg && msg.error) || `${label} download failed`);
    throw new Error(why);
  }
  try {
    return JSON.parse(msg.response || "{}");
  } catch (err) {
    throw new Error(`Invalid ${label} response`);
  }
}

function getSummaryPeriodValue(period) {
  return period && period.value ? period.value : "";
}

function resolveSummaryGstin() {
  const direct = normalizeGstin(session.gstin || session.selectedClientGstin || session.portalGstin);
  if (direct) return direct;
  const candidates = [
    normalizeGstin(session.selectedClientGstin),
    normalizeGstin(session.portalGstin),
  ].filter(Boolean);
  for (let i = 0; i < candidates.length; i += 1) {
    const profile = getCachedCompanyProfile(candidates[i]);
    const profileGstin = normalizeGstin(profile && profile.gstin);
    if (profileGstin) return profileGstin;
  }
  return "";
}

function getGstr2aOtherRequestSpecs(periodValue, gstin) {
  const specs = GSTR2A_OTHER_SECTION_ORDER.map((sectionName) => {
    if (["TDSA", "TDS", "TCS", "IMPG", "IMPGSEZ"].includes(sectionName)) return null;
    const endpointSection = sectionName === "CDN" ? "CDN" : sectionName;
    return {
      key: sectionName,
      url: `https://return.gst.gov.in/returns/auth/api/gstr2a/ctin?rtn_prd=${encodeURIComponent(periodValue)}&section_name=${encodeURIComponent(endpointSection)}`,
    };
  }).filter(Boolean);
  specs.push(
    { key: "TDSA", url: `https://return.gst.gov.in/returns/auth/api/gstr2a/tdsa?rtn_prd=${encodeURIComponent(periodValue)}` },
    { key: "TDS", url: `https://return.gst.gov.in/returns/auth/api/gstr2a/tds?rtn_prd=${encodeURIComponent(periodValue)}` },
    { key: "TCS", url: `https://return.gst.gov.in/returns/auth/api/gstr2a/tcs?rtn_prd=${encodeURIComponent(periodValue)}` },
  );
  if (gstin) {
    specs.push(
      { key: "IMPG", url: `https://return.gst.gov.in/returns/auth/api/gstr2a/impg?gstin=${encodeURIComponent(gstin)}&rtn_prd=${encodeURIComponent(periodValue)}` },
      { key: "IMPGSEZ", url: `https://return.gst.gov.in/returns/auth/api/gstr2a/impgsez?gstin=${encodeURIComponent(gstin)}&rtn_prd=${encodeURIComponent(periodValue)}` },
    );
  }
  return specs;
}

async function fetchGstr2aOtherSummaryPayload(period) {
  const periodValue = getSummaryPeriodValue(period);
  const gstin = resolveSummaryGstin();
  const sectionPayloads = {};
  const failures = [];
  const specs = getGstr2aOtherRequestSpecs(periodValue, gstin);
  if (!gstin) {
    sectionPayloads.IMPG = {
      status: "failed",
      message: "GSTIN is required for IMPG/IMPGSEZ requests",
    };
    sectionPayloads.IMPGSEZ = {
      status: "failed",
      message: "GSTIN is required for IMPG/IMPGSEZ requests",
    };
    failures.push(
      {
        section: "IMPG",
        message: "GSTIN is required for IMPG/IMPGSEZ requests",
      },
      {
        section: "IMPGSEZ",
        message: "GSTIN is required for IMPG/IMPGSEZ requests",
      },
    );
  }
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      sectionPayloads[spec.key] = await fetchSummaryJsonFromUrl(spec.url, spec.key);
    } catch (err) {
      sectionPayloads[spec.key] = {
        status: "failed",
        message: err && err.message ? err.message : "Request failed",
      };
      failures.push({
        section: spec.key,
        url: spec.url,
        message: err && err.message ? err.message : "Request failed",
      });
    }
  }
  return {
    status: failures.length ? (Object.keys(sectionPayloads).length ? "partial" : "failed") : "success",
    data: {
      rtn_prd: periodValue,
      gstin,
      summary_type: "GSTR2A_OTHER",
      failures,
      ...sectionPayloads,
    },
  };
}

function addGstr2aTotalsFromValue(totals, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => addGstr2aTotalsFromValue(totals, item));
    return;
  }
  if (typeof value !== "object") return;
  totals.taxable_value += asNumber(value.txval ?? value.taxable_value ?? value.taxableValue ?? value.val);
  totals.igst += asNumber(value.igst ?? value.iamt ?? value.igst_amt ?? value.integrated_tax ?? value.ttl_igst);
  totals.cgst += asNumber(value.cgst ?? value.camt ?? value.cgst_amt ?? value.central_tax ?? value.ttl_cgst);
  totals.sgst += asNumber(value.sgst ?? value.samt ?? value.sgst_amt ?? value.state_tax ?? value.ut_tax ?? value.ttl_sgst);
  totals.cess += asNumber(value.cess ?? value.csamt ?? value.cess_amt ?? value.ttl_cess);
  Object.keys(value).forEach((key) => {
    addGstr2aTotalsFromValue(totals, value[key]);
  });
}

function buildGstr2aSummaryRows(payload, includePeriod) {
  const meta = extractWorkbookMeta(payload);
  const reportPeriod = meta.rtnprd || "";
  return buildGstr2aSectionWorkbookRows(payload, false).map((section) => {
    const sectionName = String(section && section.name || "").toUpperCase();
    const rows = section && section.rows ? section.rows : [];
    const textBlob = rows.map((row) => JSON.stringify(row || {})).join(" ").toUpperCase();
    const isRcmSection =
      ["IMPG", "IMPGSEZ"].includes(sectionName) ||
      /REVERSE.?CHARGE|RCM|RCHRG|RCHG|LIABLE/i.test(textBlob);
    const isIneligibleSection =
      /INELIG|INELIGIBLE|BLOCKED.?ITC|NOT.?ELIGIBLE|REVERSAL|REVERS?E/i.test(textBlob);
    const totals = {
      taxable_value: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    };
    addGstr2aTotalsFromValue(totals, rows);
    return {
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      section: sectionName,
      row_count: Array.isArray(rows) ? rows.length : 0,
      taxable_value: totals.taxable_value,
      igst: totals.igst,
      cgst: totals.cgst,
      sgst: totals.sgst,
      cess: totals.cess,
      summary_bucket: isIneligibleSection ? "Ineligible ITC" : (isRcmSection ? "RCM Applicability" : "Eligible ITC"),
    };
  });
}

function buildPeriodPivotRowsFromSummaryRecords(records, options) {
  const cfg = options || {};
  const periodOrder = Array.from(new Set((records || []).map((row) => String(row && row.report_period || "")).filter(Boolean)));
  const metricDefs = cfg.metrics || [];
  const rowKeyField = cfg.rowKeyField || "section";
  const rowLabelField = cfg.rowLabelField || rowKeyField;
  const rowOrder = cfg.rowOrder || [];
  const rowKeySet = new Set();
  const rowKeys = [];
  if (rowOrder.length) {
    rowOrder.forEach((key) => {
      const safeKey = String(key || "");
      if (safeKey && !rowKeySet.has(safeKey)) {
        rowKeySet.add(safeKey);
        rowKeys.push(safeKey);
      }
    });
  }
  (records || []).forEach((row) => {
    const key = String(row && row[rowKeyField] || "");
    if (!key || rowKeySet.has(key)) return;
    rowKeySet.add(key);
    rowKeys.push(key);
  });
  const rows = [];
  rowKeys.forEach((rowKey) => {
    metricDefs.forEach((metric) => {
      const pivotRow = {
        Particulars: `${rowKey} - ${metric.label}`,
      };
      let total = 0;
      periodOrder.forEach((period) => {
        const matched = (records || []).find((row) => String(row && row[rowKeyField] || "") === rowKey && String(row && row.report_period || "") === period);
        const value = asNumber(matched && matched[metric.field]);
        pivotRow[period] = value === 0 ? "" : value;
        total += value;
      });
      pivotRow.Total = total === 0 ? "" : total;
      rows.push(pivotRow);
    });
  });
  if (!rows.length) {
    rows.push({ Particulars: "No data", Total: "" });
  }
  return {
    rows,
    columns: ["Particulars"].concat(periodOrder).concat(["Total"]),
  };
}

function buildGstr2aSummaryWorkbookSheetsFromEntries(entries) {
  const records = (entries || []).flatMap((entry) => buildGstr2aSummaryRows(entry.payload, true));
  const sheetDefs = [
    {
      name: "RCM Applicability",
      filter: (row) => String(row && row.summary_bucket || "") === "RCM Applicability",
    },
    {
      name: "Eligible ITC",
      filter: (row) => String(row && row.summary_bucket || "") !== "Ineligible ITC",
    },
    {
      name: "Ineligible ITC",
      filter: (row) => String(row && row.summary_bucket || "") === "Ineligible ITC",
    },
  ];
  return sheetDefs.map((sheetDef) => {
    const filtered = records.filter(sheetDef.filter);
    const pivot = buildPeriodPivotRowsFromSummaryRecords(filtered, {
      rowKeyField: "section",
      metrics: [
        { field: "taxable_value", label: "Taxable Value" },
        { field: "igst", label: "IGST" },
        { field: "cgst", label: "CGST" },
        { field: "sgst", label: "SGST" },
        { field: "cess", label: "CESS" },
      ],
    });
    return {
      name: sheetDef.name,
      rows: pivot.rows,
      columns: pivot.columns,
      options: { schemaReturnType: "GSTR2A" },
    };
  });
}

function buildCombinedGstr3bTotalsWorksheet(payloads) {
  const records = [];
  (payloads || []).forEach((payload) => {
    buildGstr3bSummarySheetRows(payload, true).forEach((row) => records.push(row));
  });
  const periodOrder = Array.from(new Set(records.map((row) => String(row && row.report_period || "")).filter(Boolean)));
  const metricFields = ["Taxable Value", "IGST", "CGST", "SGST", "CESS"];
  const keyOrder = [];
  const keySet = new Set();
  records.forEach((row) => {
    const key = `${row && row.Section ? row.Section : ""}|${row && row.Particulars ? row.Particulars : ""}`;
    if (keySet.has(key)) return;
    keySet.add(key);
    keyOrder.push(key);
  });
  const rows = [];
  keyOrder.forEach((key) => {
    const sample = records.find((row) => `${row && row.Section ? row.Section : ""}|${row && row.Particulars ? row.Particulars : ""}` === key) || {};
    const hasAnyMetric = metricFields.some((metricField) =>
      records.some((item) =>
        `${item && item.Section ? item.Section : ""}|${item && item.Particulars ? item.Particulars : ""}` === key &&
        asNumber(item && item[metricField]) !== 0,
      ));
    if (!hasAnyMetric) return;
    metricFields.forEach((metricField) => {
      const row = {
        Particulars: `${sample.Section || ""} ${sample.Particulars || ""}`.trim() + ` - ${metricField}`,
      };
      let total = 0;
      periodOrder.forEach((period) => {
        const match = records.find((item) => `${item && item.Section ? item.Section : ""}|${item && item.Particulars ? item.Particulars : ""}` === key && String(item && item.report_period || "") === period);
        const value = asNumber(match && match[metricField]);
        row[period] = value === 0 ? "" : value;
        total += value;
      });
      row.Total = total === 0 ? "" : total;
      rows.push(row);
    });
  });
  if (!rows.length) rows.push({ Particulars: "No data", Total: "" });
  const headerXml = ["Particulars"].concat(periodOrder).concat(["Total"])
    .map((column) => `<Cell ss:StyleID="G3BHeader"><Data ss:Type="String">${escapeXml(column)}</Data></Cell>`)
    .join("");
  const bodyXml = rows.map((row) => {
    const cols = ["Particulars"].concat(periodOrder).concat(["Total"]);
    const cells = cols.map((column, index) => {
      const value = row[column] == null ? "" : row[column];
      const styleId = index === 0 ? "G3BCell" : (value === "" ? "G3BValue" : "G3BNumber");
      const type = index === 0 ? "String" : (typeof value === "number" ? "Number" : "String");
      return `<Cell ss:StyleID="${styleId}"><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
    }).join("");
    return `<Row>${cells}</Row>`;
  }).join("");
  const columnXml = ['<Column ss:AutoFitWidth="0" ss:Width="320"/>']
    .concat(periodOrder.map(() => '<Column ss:AutoFitWidth="0" ss:Width="110"/>'))
    .concat(['<Column ss:AutoFitWidth="0" ss:Width="110"/>'])
    .join("");
  return `<Worksheet ss:Name="Totals"><Table>${columnXml}<Row>${headerXml}</Row>${bodyXml}</Table></Worksheet>`;
}

function buildGstr3bSummarySheetRows(payload, includePeriod) {
  const workbookData = buildGstr3bPdfStyleRows(payload);
  return (workbookData.rows || []).map((row) => ({
    ...(includePeriod ? { report_period: workbookData.reportPeriod || "" } : {}),
    ...row,
  }));
}

function buildGstr1SummarySheetRows(payload, includePeriod, periodOverride) {
  const reportPeriod =
    periodOverride ||
    String(
      ((payload && payload.data) || payload || {}).rtnprd ||
      ((payload && payload.data) || payload || {}).rtn_prd ||
      ((payload && payload.data) || payload || {}).ret_period ||
      ((payload && payload.data) || payload || {}).fp ||
      "",
    );
  return buildGstr1SummaryRows(payload).map((row) => ({
    ...(includePeriod ? { report_period: reportPeriod } : {}),
    row_type: row.__kind || "row",
    Description: row.Description || "",
    "No. of records": row["No. of records"] || "",
    "Document Type": row["Document Type"] || "",
    Value: row.Value || "",
    "Integrated Tax": row["Integrated Tax"] || "",
    "Central Tax": row["Central Tax"] || "",
    "State/UT Tax": row["State/UT Tax"] || "",
    Cess: row.Cess || "",
  }));
}

function buildGstr2aOtherMetaRows(payload, includePeriod) {
  const data = payload && payload.data ? payload.data : {};
  const reportPeriod = data.rtn_prd || "";
  const failures = Array.isArray(data.failures) ? data.failures : [];
  const rows = [
    {
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      field: "rtn_prd",
      value: reportPeriod,
    },
    {
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      field: "gstin",
      value: data.gstin || "",
    },
    {
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      field: "status",
      value: payload && payload.status ? payload.status : "",
    },
    {
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      field: "failure_count",
      value: failures.length,
    },
  ];
  failures.forEach((failure, index) => {
    rows.push({
      ...(includePeriod ? { report_period: reportPeriod } : {}),
      field: `failure_${index + 1}`,
      value: `${failure.section || "section"}: ${failure.message || "Failed"}`,
    });
  });
  return rows;
}

function buildGstr2aOtherSectionRows(payload, includePeriod) {
  const reportPeriod = payload && payload.data && payload.data.rtn_prd ? payload.data.rtn_prd : "";
  return GSTR2A_OTHER_SECTION_ORDER
    .filter((key) => Object.prototype.hasOwnProperty.call((payload && payload.data) || {}, key))
    .map((sectionName) => {
      const sectionPayload = payload.data[sectionName];
      const rows = buildGstr2aSectionWorkbookRows(sectionPayload, false)
        .flatMap((section) => (section.rows || []).map((row) => ({
          ...(includePeriod ? { report_period: reportPeriod } : {}),
          ...row,
        })));
      if (rows.length) {
        return {
          name: sectionName,
          rows,
          columns: getSpreadsheetColumns(rows, includePeriod ? ["report_period", "row_no"] : ["row_no"]),
          options: { schemaReturnType: "GSTR2A" },
        };
      }
      return {
        name: sectionName,
        rows: [
          {
            ...(includePeriod ? { report_period: reportPeriod } : {}),
            row_no: 1,
            message:
              (sectionPayload && sectionPayload.message) ||
              (sectionPayload && sectionPayload.status === "failed" ? "Request failed" : "No data"),
          },
        ],
        columns: includePeriod ? ["report_period", "row_no", "message"] : ["row_no", "message"],
        options: { schemaReturnType: "GSTR2A" },
      };
    });
}
async function fetchGstr2bJsonPayload(period) {
  const parseGstr2bResponse = (rawResponse) => {
    const parsed = parseJsonOrBase64Message(rawResponse);
    if (parsed.decodedMessage) {
      throw createStructuredSkipError(period, parsed.decodedMessage);
    }
    return parsed.payload;
  };
  const fetchGstr2bEndpointPayload = async (url) => {
    const msg = await processAsync({ request: "get", url });
    if (!msg.status) {
      const why = msg.statusCode ? `HTTP ${msg.statusCode}` : "No response";
      throw new Error(why);
    }
    try {
      return parseGstr2bResponse(msg.response);
    } catch (err) {
      if (err && err.skipRecord) throw err;
      throw new Error("Invalid JSON");
    }
  };
  const mergeDocdataObjects = (baseDoc, chunkDoc) => {
    const base = baseDoc && typeof baseDoc === "object" ? baseDoc : {};
    const chunk = chunkDoc && typeof chunkDoc === "object" ? chunkDoc : {};
    const out = { ...base };
    Object.keys(chunk).forEach((key) => {
      const a = out[key];
      const b = chunk[key];
      if (Array.isArray(a) && Array.isArray(b)) {
        out[key] = a.concat(b);
        return;
      }
      if (a && typeof a === "object" && !Array.isArray(a) && b && typeof b === "object" && !Array.isArray(b)) {
        out[key] = mergeDocdataObjects(a, b);
        return;
      }
      out[key] = b;
    });
    return out;
  };

  const baseUrl = `https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getjson?rtnprd=${period.value}`;
  let payload = await fetchGstr2bEndpointPayload(baseUrl);
  const fcRaw = payload && payload.data ? payload.data.fc : null;
  const fc = Number(fcRaw);
  if (Number.isFinite(fc) && fc > 0) {
    let mergedDocdata = payload && payload.data && payload.data.docdata && typeof payload.data.docdata === "object"
      ? payload.data.docdata
      : {};
    for (let fn = 1; fn <= fc; fn += 1) {
      const chunkUrl = `${baseUrl}&fn=${fn}`;
      const chunkPayload = await fetchGstr2bEndpointPayload(chunkUrl);
      const chunkDoc = chunkPayload && chunkPayload.data && chunkPayload.data.docdata && typeof chunkPayload.data.docdata === "object"
        ? chunkPayload.data.docdata
        : {};
      mergedDocdata = mergeDocdataObjects(mergedDocdata, chunkDoc);
      if (fn === fc && chunkPayload && chunkPayload.data && typeof chunkPayload.data === "object") {
        payload = {
          ...payload,
          ...chunkPayload,
          data: {
            ...(payload.data || {}),
            ...(chunkPayload.data || {}),
            docdata: mergedDocdata,
          },
        };
      }
    }
  }
  payload = await attachLinkedStructuredPayloads(
    payload,
    rc("G2B"),
    payload && payload.data && Array.isArray(payload.data.url) ? payload.data.url : [],
  );
  if (payload && payload.data && payload.data.gstin && !session.gstin) {
    session.gstin = payload.data.gstin;
  }
  return payload;
}

async function fetchBlobFromUrl(url) {
  const response = await fetch(url, { credentials: "include", cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.blob();
}

function parseJsonTextSafely(text) {
  const raw = typeof text === "string" ? text : "";
  const cleaned = raw.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

async function extractJsonPayloadFromBlob(blob) {
  const name = (blob && typeof blob.name === "string" ? blob.name : "").toLowerCase();
  const type = (blob && typeof blob.type === "string" ? blob.type : "").toLowerCase();
  const looksLikeJson =
    name.endsWith(".json") ||
    type.includes("application/json") ||
    type.startsWith("text/json");

  // Some GST file URLs return JSON with generic content-types (for example octet-stream).
  // Try text->JSON parse first before assuming ZIP.
  try {
    const text = await blob.text();
    const parsed = parseJsonTextSafely(text);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (err) {
    // Ignore and continue with type-based handling.
  }

  if (looksLikeJson) {
    const text = await blob.text();
    const parsed = parseJsonTextSafely(text);
    if (parsed && typeof parsed === "object") return parsed;
    throw new Error("Invalid JSON file");
  }

  return extractJsonPayloadFromZip(blob);
}

async function extractJsonPayloadFromZip(blob) {
  const zip = await JSZip.loadAsync(blob);
  const jsonEntry = Object.keys(zip.files)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort()[0];
  if (!jsonEntry) {
    throw new Error("JSON file not found in ZIP");
  }
  const text = await zip.files[jsonEntry].async("string");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("Invalid JSON in ZIP");
  }
}

function getPayloadLinkedFileUrls(payload) {
  const candidates = [
    payload && payload.file_url,
    payload && payload.fileUrl,
    payload && payload.data && payload.data.file_url,
    payload && payload.data && payload.data.fileUrl,
    payload && payload.url,
    payload && payload.data && payload.data.url,
  ];
  const urls = [];
  const seen = new Set();
  const pushUrl = (url) => {
    if (typeof url !== "string") return;
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https:\/\/files\.gst\.gov\.in\/returns/i.test(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    urls.push(trimmed);
  };

  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i];
    if (Array.isArray(value)) {
      value.forEach(pushUrl);
    } else {
      pushUrl(value);
    }
  }
  return urls;
}

async function fetchJsonPayloadFromLinkedUrl(url) {
  if (!url) return null;
  try {
    const blob = await fetchBlobFromUrl(url);
    return extractJsonPayloadFromBlob(blob);
  } catch (primaryErr) {
    // Fallback through extension network bridge for environments where direct fetch fails.
    const msg = await processAsync({ request: "get", url });
    if (!msg || !msg.status) {
      throw primaryErr;
    }
    const parsed = parseJsonTextSafely(msg.response);
    if (parsed && typeof parsed === "object") return parsed;
    throw primaryErr;
  }
}

async function fetchAllJsonPayloadsFromUrls(urls, cfg) {
  const detailed = await fetchAllJsonPayloadsFromUrlsDetailed(urls, cfg);
  return detailed.payloads;
}

async function fetchAllJsonPayloadsFromUrlsDetailed(urls, cfg) {
  const queue = Array.isArray(urls) ? urls.slice() : [];
  const seen = new Set();
  const payloads = [];
  const statuses = [];

  while (queue.length) {
    const url = queue.shift();
    if (typeof url !== "string" || !url.trim() || seen.has(url)) continue;
    seen.add(url);
    try {
      const payload = await fetchJsonPayloadFromLinkedUrl(url);
      if (payload && typeof payload === "object") {
        payloads.push(payload);
        statuses.push({ url, status: "success", message: "" });
        getPayloadLinkedFileUrls(payload).forEach((linkedUrl) => {
          if (!seen.has(linkedUrl)) queue.push(linkedUrl);
        });
      }
    } catch (err) {
      statuses.push({ url, status: "failed", message: err && err.message ? err.message : "fetch failed" });
      addActivity(`Linked ${cfg && cfg.display ? cfg.display : "return"} file fetch failed: ${err.message}`, "text-warning");
    }
  }

  return { payloads, statuses };
}

function buildStructuredChunkKey(payload, returnType) {
  if (!payload || typeof payload !== "object") return "";
  const meta = extractWorkbookMeta(payload);
  const checksum = (meta.checksum || "").trim();
  const gstin = (meta.gstin || "").trim();
  const period = (meta.rtnprd || "").trim();
  if (checksum && String(returnType || "").toUpperCase() !== "GSTR1") {
    return `checksum:${gstin}|${period}|${checksum}`;
  }
  const sourceUrl =
    (payload.file_url || payload.fileUrl || (payload.data && (payload.data.file_url || payload.data.fileUrl)) || "")
      .toString()
      .trim();
  if (sourceUrl) return `url:${gstin}|${period}|${sourceUrl}`;
  try {
    return `fingerprint:${gstin}|${period}|${JSON.stringify(payload)}`;
  } catch (err) {
    return `fallback:${gstin}|${period}|${Object.keys(payload || {}).sort().join(",")}`;
  }
}

function dedupeStructuredPayloadChunks(payloads, returnType) {
  if (String(returnType || "").toUpperCase() === "GSTR1") {
    return (payloads || []).filter((payload) => payload && typeof payload === "object");
  }
  const seen = new Set();
  const deduped = [];
  (payloads || []).forEach((payload) => {
    if (!payload || typeof payload !== "object") return;
    const key = buildStructuredChunkKey(payload, returnType);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(payload);
  });
  return deduped;
}

function summarizeLinkStatuses(statuses) {
  const items = Array.isArray(statuses) ? statuses : [];
  if (!items.length) return "N/A";
  const counts = items.reduce((acc, item) => {
    const key = String((item && item.status) || "unknown").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return Object.keys(counts).map((k) => `${k}:${counts[k]}`).join(", ");
}

function dedupeLinkStatusesByUrl(statuses) {
  const items = Array.isArray(statuses) ? statuses : [];
  const byUrl = new Map();
  items.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const url = String(item.url || "").trim();
    if (!url) return;
    const current = byUrl.get(url);
    if (!current) {
      byUrl.set(url, item);
      return;
    }
    const currentStatus = String(current.status || "").toLowerCase();
    const nextStatus = String(item.status || "").toLowerCase();
    if (currentStatus !== "success" && nextStatus === "success") {
      byUrl.set(url, item);
    }
  });
  return Array.from(byUrl.values());
}

function getGstr1SectionKeysFromPayload(payload) {
  const obj = payload && typeof payload === "object" ? payload : {};
  const sectionExclusions = new Set([
    "gstin",
    "gstinid",
    "rtnprd",
    "rtn_prd",
    "ret_period",
    "retprd",
    "retPrd",
    "fp",
    "gendt",
    "gen_dt",
    "generated_on",
    "generatedon",
    "generatedOn",
    "gendate",
    "version",
    "ver",
    "chksum",
    "checksum",
    "status",
    "status_cd",
    "msg",
    "message",
    "date",
    "time",
    "timeStamp",
    "timestamp",
    "url",
    "file_url",
    "fileurl",
    "fileUrl",
    "rc",
    "__portalResponse",
    "__linkedPayloads",
    "__linkedFileUrls",
    "__sourceFileUrls",
    "__linkFetchStatuses",
    "__linkStatusText",
    "__gstr1SectionsConsolidated",
  ]);
  return Object.keys(obj).filter((key) => {
    if (!key || sectionExclusions.has(key)) return false;
    if (String(key).startsWith("__")) return false;
    const value = obj[key];
    return value !== null && value !== undefined && (Array.isArray(value) || typeof value === "object");
  });
}

function buildAttachedStructuredPayloadMetadata(payload, cfg, sourceUrls, statuses, fetchedPayloads) {
  const basePayload = payload && typeof payload === "object" ? payload : {};
  const returnType = cfg && cfg.apiCode ? cfg.apiCode : "";
  const initialUrls = (Array.isArray(sourceUrls) ? sourceUrls : []).filter((url) => typeof url === "string" && url.trim());
  const allPayloads = dedupeStructuredPayloadChunks((fetchedPayloads || []).filter((item) => item && typeof item === "object"), returnType);
  const allStatuses = dedupeLinkStatusesByUrl(Array.isArray(statuses) ? statuses : []);
  const discoveredUrls = getPayloadLinkedFileUrls(basePayload);
  const baseKey = buildStructuredChunkKey(basePayload, returnType);
  const linkedPayloads = String(returnType || "").toUpperCase() === "GSTR1"
    ? allPayloads.slice(1).filter((item) => item && typeof item === "object")
    : dedupeStructuredPayloadChunks(
      allPayloads.filter((item) => item && buildStructuredChunkKey(item, returnType) !== baseKey),
      returnType,
    );
  const linkedUrls = Array.from(
    new Set(
      initialUrls
        .concat(discoveredUrls)
        .concat(allPayloads.flatMap((item) => getPayloadLinkedFileUrls(item)))
        .filter((url) => typeof url === "string" && url.trim()),
    ),
  );

  return {
    ...basePayload,
    __sourceFileUrls: initialUrls,
    __linkedFileUrls: linkedUrls,
    __linkedPayloads: linkedPayloads,
    __linkFetchStatuses: allStatuses,
    __linkStatusText: summarizeLinkStatuses(allStatuses),
  };
}

async function buildGstr1PayloadViaBrowserCacheLayers(payloads) {
  const chunks = (payloads || []).filter((item) => item && typeof item === "object");
  if (!chunks.length) return {};
  if (chunks.length === 1) {
    return {
      ...chunks[0],
      __gstr1SectionsConsolidated: true,
    };
  }

  const cacheSupported = typeof caches !== "undefined" && typeof caches.open === "function";
  const cacheName = `gc-returns-pro-gstr1-link-layers-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rawLayerName = `gc-returns-pro-gstr1-link-raw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sectionLayerName = `gc-returns-pro-gstr1-link-sections-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mergedLayerName = `gc-returns-pro-gstr1-link-merged-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const memRaw = new Map();
  const memLayer1 = new Map();
  const memMerged = new Map();
  let cache = null;
  let rawCache = null;
  let sectionCache = null;
  let mergedCache = null;

  const rawKey = (index) => `https://gc-returns-pro.local/gstr1/raw/${index}.json`;
  const layer1Key = (index) => `https://gc-returns-pro.local/gstr1/layer1/${index}.json`;
  const mergedKey = (name) => `https://gc-returns-pro.local/gstr1/merged/${encodeURIComponent(String(name || ""))}.json`;

  try {
    if (cacheSupported) {
      cache = await caches.open(cacheName);
      rawCache = await caches.open(rawLayerName);
      sectionCache = await caches.open(sectionLayerName);
      mergedCache = await caches.open(mergedLayerName);
    }

    // Primary Layer: store each downloaded link payload (raw JSON) in browser cache.
    for (let i = 0; i < chunks.length; i += 1) {
      const payload = chunks[i];
      if (rawCache) {
        await rawCache.put(
          rawKey(i),
          new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }),
        );
      } else {
        memRaw.set(i, payload);
      }
      // release source array slot as soon as it is cached
      chunks[i] = null;
    }

    // Layer 1: build section-wise map from primary raw layer.
    for (let i = 0; i < chunks.length; i += 1) {
      let payload = null;
      if (rawCache) {
        const res = await rawCache.match(rawKey(i));
        payload = res ? await res.json() : null;
      } else {
        payload = memRaw.get(i) || null;
      }
      if (!payload || typeof payload !== "object") continue;
      const sectionKeys = getGstr1SectionKeysFromPayload(payload);
      const sections = {};
      sectionKeys.forEach((key) => {
        sections[key] = payload[key];
      });
      if (sectionCache) {
        await sectionCache.put(
          layer1Key(i),
          new Response(JSON.stringify(sections), { headers: { "Content-Type": "application/json" } }),
        );
      } else {
        memLayer1.set(i, sections);
      }
      // release raw payload
      payload = null;
    }

    // Raw layer no longer needed after Layer-1 creation.
    if (rawCache) {
      const keys = await rawCache.keys();
      await Promise.all(keys.map((req) => rawCache.delete(req)));
    } else {
      memRaw.clear();
    }

    // Merged layer: process B2B first (single-section pass), then all remaining sections.
    const mergedSections = {};
    const chunkCount = Array.isArray(payloads) ? payloads.filter((item) => item && typeof item === "object").length : 0;
    const isB2bKey = (key) => {
      const normalized = String(key || "").toLowerCase().replace(/[\s_\-]/g, "");
      return normalized === "b2b";
    };

    // Pass-1: only B2B
    for (let i = 0; i < chunkCount; i += 1) {
      let sections = null;
      if (sectionCache) {
        const res = await sectionCache.match(layer1Key(i));
        sections = res ? await res.json() : null;
      } else {
        sections = memLayer1.get(i) || null;
      }
      if (!sections || typeof sections !== "object") continue;
      Object.keys(sections).forEach((key) => {
        if (!isB2bKey(key)) return;
        mergedSections[key] = mergeGstr1SectionValues(mergedSections[key], sections[key]);
      });
      if (i > 0 && i % 10 === 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Persist B2B immediately before processing other sections.
    const b2bSectionNames = Object.keys(mergedSections).filter((name) => isB2bKey(name));
    for (let i = 0; i < b2bSectionNames.length; i += 1) {
      const sectionName = b2bSectionNames[i];
      if (mergedCache) {
        await mergedCache.put(
          mergedKey(sectionName),
          new Response(JSON.stringify(mergedSections[sectionName]), { headers: { "Content-Type": "application/json" } }),
        );
      } else {
        memMerged.set(sectionName, mergedSections[sectionName]);
      }
      delete mergedSections[sectionName];
    }

    // Pass-2: all sections except B2B
    for (let i = 0; i < chunkCount; i += 1) {
      let sections = null;
      if (sectionCache) {
        const res = await sectionCache.match(layer1Key(i));
        sections = res ? await res.json() : null;
      } else {
        sections = memLayer1.get(i) || null;
      }
      if (!sections || typeof sections !== "object") continue;
      Object.keys(sections).forEach((key) => {
        if (isB2bKey(key)) return;
        mergedSections[key] = mergeGstr1SectionValues(mergedSections[key], sections[key]);
      });
      if (i > 0 && i % 10 === 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Layer-1 no longer needed once merged sections are prepared.
    if (sectionCache) {
      const keys = await sectionCache.keys();
      await Promise.all(keys.map((req) => sectionCache.delete(req)));
    } else {
      memLayer1.clear();
    }

    // No third transformation layer: merged sections are directly cached/read for final payload.
    const mergedNames = Object.keys(mergedSections);
    for (let i = 0; i < mergedNames.length; i += 1) {
      const sectionName = mergedNames[i];
      if (mergedCache) {
        await mergedCache.put(
          mergedKey(sectionName),
          new Response(JSON.stringify(mergedSections[sectionName]), { headers: { "Content-Type": "application/json" } }),
        );
      } else {
        memMerged.set(sectionName, mergedSections[sectionName]);
      }
      // release merged section from temp object
      mergedSections[sectionName] = null;
    }

    const finalSections = {};
    const sectionNames = Array.from(new Set(b2bSectionNames.concat(mergedNames)));
    for (let i = 0; i < sectionNames.length; i += 1) {
      const name = sectionNames[i];
      if (mergedCache) {
        const res = await mergedCache.match(mergedKey(name));
        finalSections[name] = res ? await res.json() : null;
      } else {
        finalSections[name] = memMerged.get(name);
      }
    }

    return {
      ...(Array.isArray(payloads) && payloads[0] && typeof payloads[0] === "object" ? payloads[0] : {}),
      ...finalSections,
      __gstr1SectionsConsolidated: true,
    };
  } finally {
    if (mergedCache) {
      const keys = await mergedCache.keys();
      await Promise.all(keys.map((req) => mergedCache.delete(req)));
    }
    if (sectionCache) {
      const keys = await sectionCache.keys();
      await Promise.all(keys.map((req) => sectionCache.delete(req)));
    }
    if (rawCache) {
      const keys = await rawCache.keys();
      await Promise.all(keys.map((req) => rawCache.delete(req)));
    }
    if (cache) {
      const keys = await cache.keys();
      await Promise.all(keys.map((req) => cache.delete(req)));
      await caches.delete(cacheName);
      await caches.delete(rawLayerName);
      await caches.delete(sectionLayerName);
      await caches.delete(mergedLayerName);
    }
    memRaw.clear();
    memLayer1.clear();
    memMerged.clear();
  }
}

async function attachLinkedStructuredPayloads(basePayload, cfg, sourceUrls, sourceStatuses) {
  const payload = basePayload && typeof basePayload === "object" ? basePayload : {};
  const initialUrls = (Array.isArray(sourceUrls) ? sourceUrls : []).filter((url) => typeof url === "string" && url.trim());
  const discoveredUrls = getPayloadLinkedFileUrls(payload);
  const returnType = cfg && cfg.apiCode ? cfg.apiCode : "";
  const detailed = await fetchAllJsonPayloadsFromUrlsDetailed(initialUrls.concat(discoveredUrls), cfg);
  const allStatuses = dedupeLinkStatusesByUrl(
    (Array.isArray(sourceStatuses) ? sourceStatuses : []).concat(detailed.statuses || []),
  );
  const allPayloads = dedupeStructuredPayloadChunks(detailed.payloads || [], returnType);
  const baseKey = buildStructuredChunkKey(payload, returnType);
  const linkedPayloads = String(returnType || "").toUpperCase() === "GSTR1"
    ? allPayloads.slice(1).filter((item) => item && typeof item === "object")
    : dedupeStructuredPayloadChunks(
      allPayloads.filter((item) => item && buildStructuredChunkKey(item, returnType) !== baseKey),
      returnType,
    );
  const linkedUrls = Array.from(
    new Set(
      initialUrls
        .concat(discoveredUrls)
        .concat(allPayloads.flatMap((item) => getPayloadLinkedFileUrls(item)))
        .filter((url) => typeof url === "string" && url.trim()),
    ),
  );

  return {
    ...payload,
    __sourceFileUrls: initialUrls,
    __linkedFileUrls: linkedUrls,
    __linkedPayloads: linkedPayloads,
    __linkFetchStatuses: allStatuses,
    __linkStatusText: summarizeLinkStatuses(allStatuses),
  };
}

function mergeGstr1SectionValues(existingValue, nextValue) {
  if (nextValue === undefined || nextValue === null) return existingValue;
  if (existingValue === undefined || existingValue === null) return nextValue;
  if (Array.isArray(existingValue) && Array.isArray(nextValue)) {
    return existingValue.concat(nextValue);
  }
  if (
    existingValue &&
    nextValue &&
    typeof existingValue === "object" &&
    typeof nextValue === "object" &&
    !Array.isArray(existingValue) &&
    !Array.isArray(nextValue)
  ) {
    return { ...existingValue, ...nextValue };
  }
  return existingValue;
}

function isEmptyGstr1SectionValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function consolidateGstr1PayloadSections(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const linkedPayloads = Array.isArray(payload.__linkedPayloads) ? payload.__linkedPayloads : [];
  if (!linkedPayloads.length) return payload;
  if (payload.__gstr1SectionsConsolidated) return payload;

  const sectionExclusions = new Set([
    "gstin",
    "gstinid",
    "rtnprd",
    "rtn_prd",
    "ret_period",
    "retprd",
    "retPrd",
    "fp",
    "gendt",
    "gen_dt",
    "generated_on",
    "generatedon",
    "generatedOn",
    "gendate",
    "version",
    "ver",
    "chksum",
    "checksum",
    "status",
    "status_cd",
    "msg",
    "message",
    "date",
    "time",
    "timeStamp",
    "timestamp",
    "url",
    "file_url",
    "fileurl",
    "fileUrl",
    "rc",
    "__portalResponse",
    "__linkedPayloads",
    "__linkedFileUrls",
    "__sourceFileUrls",
    "__linkFetchStatuses",
    "__linkStatusText",
  ]);

  const chunks = [payload].concat(linkedPayloads).filter((item) => item && typeof item === "object");
  const gstr1SectionKeys = [
    "b2b",
    "b2ba",
    "b2cl",
    "b2cla",
    "b2cs",
    "b2csa",
    "cdnr",
    "cdnra",
    "cdnur",
    "cdnura",
    "exp",
    "expa",
    "at",
    "ata",
    "atadj",
    "atadja",
    "txpd",
    "txpda",
    "nil",
    "hsn",
    "docs",
    "doc_issue",
    "supecom",
    "supecoma",
    "eco_dtls",
    "eco_dtlsa",
  ];
  const rootSectionKeys = gstr1SectionKeys.filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const linkedSectionKeys = Array.from(
    new Set(
      linkedPayloads.flatMap((item) =>
        gstr1SectionKeys.filter((key) => Object.prototype.hasOwnProperty.call(item || {}, key)),
      ),
    ),
  );
  const sectionKeys = Array.from(
    new Set(
      chunks.flatMap((chunk) =>
        Object.keys(chunk).filter((key) => {
          if (!key || sectionExclusions.has(key)) return false;
          if (String(key).startsWith("__")) return false;
          const value = chunk[key];
          return value !== null && value !== undefined && (Array.isArray(value) || typeof value === "object");
        }),
      ),
    ),
  );

  if (!sectionKeys.length) return payload;

  const merged = { ...payload };
  const rootSections = {};
  sectionKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      rootSections[key] = payload[key];
    }
  });

  sectionKeys.forEach((key) => {
    const rootValue = Object.prototype.hasOwnProperty.call(rootSections, key) ? rootSections[key] : undefined;
    const rootHasData = !isEmptyGstr1SectionValue(rootValue);
    let mergedValue = rootHasData ? rootValue : undefined;

    // If root already has section data, avoid re-merging same section from linked chunks.
    // This prevents huge duplicated row explosions and allocation overflow.
    if (!rootHasData) {
      chunks.forEach((chunk) => {
        if (!Object.prototype.hasOwnProperty.call(chunk, key)) return;
        mergedValue = mergeGstr1SectionValues(mergedValue, chunk[key]);
      });
    } else {
      chunks.forEach((chunk, idx) => {
        if (idx === 0) return;
        if (!Object.prototype.hasOwnProperty.call(chunk, key)) return;
        const chunkValue = chunk[key];
        if (isEmptyGstr1SectionValue(chunkValue)) return;
        // Merge only when root section is object-like but sparse/placeholder.
        if (isEmptyGstr1SectionValue(mergedValue)) {
          mergedValue = mergeGstr1SectionValues(mergedValue, chunkValue);
        }
      });
    }

    if (mergedValue !== undefined) {
      merged[key] = mergedValue;
    }
  });

  merged.__gstr1SectionsConsolidated = true;
  return merged;
}

async function fetchGeneratedZipJsonPayload(cfg, period) {
  const msgFile = await processAsync({
    request: "get",
    url: gstn.generateFile(cfg, period, false),
  });

  if (!msgFile.status) {
    const why = msgFile.statusCode ? `HTTP ${msgFile.statusCode}` : "No response";
    throw new Error(why);
  }

  let resp;
  try {
    const parsed = parseJsonOrBase64Message(msgFile.response);
    if (parsed.decodedMessage) {
      throw createStructuredSkipError(period, parsed.decodedMessage);
    }
    resp = parsed.payload;
  } catch (err) {
    if (err && err.skipRecord) throw err;
    throw new Error("Invalid JSON");
  }
  const fileGenStatus = getFileGenStatus(resp);
  if (fileGenStatus) {
    throw new Error(fileGenStatus);
  }
  if (!resp.data || !resp.data.url || !resp.data.url.length) {
    throw new Error("Download URL not found");
  }

  const sourceUrls = resp.data.url.filter((url) => typeof url === "string" && url.trim());
  const detailed = await fetchAllJsonPayloadsFromUrlsDetailed(sourceUrls, cfg);
  const allPayloads = detailed.payloads || [];
  if (!allPayloads.length) {
    const failedReasons = (detailed.statuses || [])
      .filter((item) => String(item && item.status || "").toLowerCase() === "failed")
      .map((item) => (item && item.message ? item.message : "read failed"))
      .filter(Boolean);
    const reason = failedReasons.length ? failedReasons[0] : "no readable JSON/ZIP payload";
    throw new Error(`Unable to read JSON from generated file URLs (${reason})`);
  }
  const isGstr1 = cfg && String(cfg.apiCode || "").toUpperCase() === "GSTR1";
  const payload = isGstr1
    ? buildAttachedStructuredPayloadMetadata(
        await buildGstr1PayloadViaBrowserCacheLayers(allPayloads),
        cfg,
        sourceUrls,
        detailed.statuses || [],
        allPayloads,
      )
    : await attachLinkedStructuredPayloads(allPayloads[0], cfg, sourceUrls, detailed.statuses || []);
  const mergedPayload =
    payload && typeof payload === "object"
      ? {
          ...resp,
          ...payload,
          __portalResponse: resp,
          data:
            payload.data && typeof payload.data === "object"
              ? {
                  ...(resp && resp.data && typeof resp.data === "object" ? resp.data : {}),
                  ...payload.data,
                }
              : payload.data || (resp ? resp.data : undefined),
        }
      : payload;
  const consolidatedPayload =
    isGstr1
      ? consolidateGstr1PayloadSections(mergedPayload)
      : mergedPayload;
  if (isGstr1 && Array.isArray(allPayloads)) {
    for (let i = 0; i < allPayloads.length; i += 1) {
      allPayloads[i] = null;
    }
  }
  if (consolidatedPayload && consolidatedPayload.data && consolidatedPayload.data.gstin && !session.gstin) {
    session.gstin = consolidatedPayload.data.gstin;
  }
  return consolidatedPayload;
}

async function fetchGstr2aJsonPayload(period) {
  return fetchGeneratedZipJsonPayload(rc("G2A"), period);
}

async function fetchGstr1JsonPayload(period) {
  return fetchGeneratedZipJsonPayload(rc("G1"), period);
}

function unwrapGstr3bApiPayload(response, kind) {
  if (!response || typeof response !== "object") {
    throw new Error(`Invalid ${kind} response`);
  }

  if (response.status !== undefined && response.status != 1) {
    const message =
      (response.error && (response.error.message || response.error.errMsg || response.error.error)) ||
      response.message ||
      response.msg;
    throw new Error(message || `Rejected (${kind})`);
  }

  const payload = response && response.data && typeof response.data === "object" ? response.data : response;
  if (!payload || typeof payload !== "object") {
    throw new Error(`Empty ${kind} response`);
  }

  return payload;
}

async function fetchGstr3bJsonPayload(period) {
  const msg3bSummary = await processAsync({
    request: "get",
    url: gstn.gstr3bSummary(period),
  });

  if (!msg3bSummary.status) {
    const why = msg3bSummary.statusCode ? `HTTP ${msg3bSummary.statusCode}` : (msg3bSummary.error || "Summary download failed");
    throw new Error(why);
  }

  const r3bSummary = JSON.parse(msg3bSummary.response);
  const summaryData = unwrapGstr3bApiPayload(r3bSummary, "Summary");

  const msg3bPayable = await processAsync({
    request: "get",
    url: gstn.gstr3bPayable(period),
  });

  if (!msg3bPayable.status) {
    const why = msg3bPayable.statusCode ? `HTTP ${msg3bPayable.statusCode}` : (msg3bPayable.error || "Payments download failed");
    throw new Error(why);
  }

  const r3bPayable = JSON.parse(msg3bPayable.response);
  const payableData = unwrapGstr3bApiPayload(r3bPayable, "Payments");

  const payload = {
    ...r3bSummary,
    data: {
      ...summaryData,
      taxpayble: payableData,
      tx_pmt:
        (payableData && (payableData.tx_pmt || payableData.tax_pmt)) ||
        (summaryData && (summaryData.tx_pmt || summaryData.tax_pmt)) ||
        {},
    },
  };

  if (payload && payload.data && payload.data.gstin && !session.gstin) {
    session.gstin = payload.data.gstin;
  }

  return payload;
}

async function fetchStructuredReturnJsonPayload(cfg, period) {
  if (isGstr1Return(cfg)) return fetchGstr1JsonPayload(period);
  if (isGstr2bReturn(cfg)) return fetchGstr2bJsonPayload(period);
  if (isGstr2aReturn(cfg)) return fetchGstr2aJsonPayload(period);
  throw new Error("Unsupported structured return");
}

async function downloadGstr2bJson(period, button) {
  const payload = await fetchGstr2bJsonPayload(period);
  const filename = `${makeJsonFileName("R2B", session.gstin || "GSTIN", period.value)}.json`;
  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  await downloadAs(blobUrl, filename);
  if (button) button.textContent = "Done";
}

async function downloadStructuredReturnJson(period, button) {
  const payload = await fetchStructuredReturnJsonPayload(session.return, period);
  const filename = `${makeJsonFileName(session.return.fileNameCode, session.gstin || "GSTIN", period.value)}.json`;
  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  await downloadAs(blobUrl, filename);
  if (button) button.textContent = "Done";
}

async function downloadStructuredReturnExcel(period, button) {
  const payload = await fetchStructuredReturnJsonPayload(session.return, period);
  const filename = `${makeJsonFileName(session.return.fileNameCode, session.gstin || "GSTIN", period.value)}.xlsx`;
  if (isGstr1Return(session.return)) {
    const workbookState = createGstr1WorkbookState({
      maxWorksheetRows: XLSX_MAX_WORKSHEET_DATA_ROWS,
      lightweightMode: true,
    });
    appendGstr1PayloadToWorkbookState(workbookState, payload);
    const blob = await buildGstr1WorkbookXlsxBlob(workbookState, { compression: true, useWorker: true });
    await downloadBlobAs(blob, filename);
  } else if (isGstr2bReturn(session.return)) {
    const blob = await buildGstr2bWorkbookXlsxBlob(payload);
    await downloadBlobAs(blob, filename);
  } else if (isGstr2aReturn(session.return)) {
    const blob = await buildGstr2aWorkbookXlsxBlob(payload);
    await downloadBlobAs(blob, filename);
  } else {
    const workbookXml = buildGenericWorkbookXml(payload);
    await downloadBlobAs(new Blob([workbookXml], { type: "application/vnd.ms-excel" }), filename);
  }
  if (button) button.textContent = "Done";
}

async function downloadGstr2bExcel(period, button) {
  const payload = await fetchGstr2bJsonPayload(period);
  const filename = `${makeJsonFileName("R2B", session.gstin || "GSTIN", period.value)}.xlsx`;
  const blob = await buildGstr2bWorkbookXlsxBlob(payload);
  await downloadBlobAs(blob, filename);
  if (button) button.textContent = "Done";
}

function getFileGenStatus(resp) {
  if (resp.status === undefined) {
    return "Invalid response received";
  } else if (resp.status != 1) {
    if (resp.error === undefined) return "Unknown error occurred";

    if (resp.error.errorCode == "RTN_24") {
      getElement("banner-generating").hidden = false;
      return "Generating file...";
    } else {
      return resp.error.message;
    }
  } else if (resp.data === undefined) {
    return "No response received";
  } else if (resp.data.status == 0) {
    return null; //file already generated
  } else if (resp.data.status == 1) {
    getElement("banner-generating").hidden = false;
    return "Generating file...";
  } else {
    return resp.data.msg;
  }
}

function getReturnInfo(info, gstReturnType) {
  var i;

  for (i = 0; i < info.data.user.length; i++) {
    var j;
    var u = info.data.user[i];

    for (j = 0; j < u.returns.length; j++) {
      if (u.returns[j].return_ty == gstReturnType) {
        return u.returns[j];
      }
    }
  }

  return { status: "Not available" };
}

async function startupAsync() {
  applySelectedClientContext();
  if (!(await ensureStartupUrl())) {
    const prefs = loadPrefs();
    const preferredReturnKey = prefs[prefKeyForReturn("returns")] || "G2B";
    const fallbackHost = preferredReturnKey === "G2B"
      ? "https://gstr2b.gst.gov.in/gstr2b/returns"
      : "https://return.gst.gov.in/returns";
    currentUrl = new URL(fallbackHost);
    session.portalFallbackMode = true;
    showEmbeddedWorkspaceMessage("GST Portal tab not detected. Running in offline period mode.");
    getElement("msgOtherWebsite").hidden = false;
  }
  const host = currentUrl.hostname.toLowerCase();
  const is2bHost = host === "gstr2b.gst.gov.in";
  const isReturnHost = host === "return.gst.gov.in";
  const isPaymentHost = host === "payment.gst.gov.in";
  session.is2bHost = is2bHost;
  const path = currentUrl.pathname.toLowerCase();
  if (!isReturnHost && !isPaymentHost && !is2bHost) {
    showEmbeddedWorkspaceMessage("Unable to select period. Open Returns, GSTR-2B, or Payments in GST Portal, then reload this download workspace.");
    getElement("msgNotOnReturnDashboard").hidden = false;
    return;
  }
  if (!session.portalFallbackMode) {
    showStatus("Connecting...");
    await connect();
  } else {
    showStatus("Running in offline period mode.");
  }
  if (!is2bHost) {
    session.registrationDate =
      (await fetchRegistrationDateFromClientData()) || session.registrationDate;
  }
  if (is2bHost) {
    showStatus(null);
    session.gstRegType = "";
    session.gstin = session.gstin || "";
    session.portalOnline = true;
    session.portalGstin = normalizeGstin(session.gstin);
    const bi = getElement("businessInfo");
    bi.hidden = false;
    applyBusinessIdentity({ businessName: "GSTR-2B", subText: "GST Portal" });
    updatePortalStatusPill();
    getElement("workspace").hidden = false;
  } else if (isPaymentHost) {
    showStatus("Getting information...");
    const ustatusUrl = `${currentUrl.origin}/services/api/ustatus`;
    const msg = await processAsync({ request: "get", url: ustatusUrl });
    if (!msg.status) {
      // Fallback: try to scrape GSTIN from page.
      session.gstRegType = "";
      session.gstin = session.gstin || "";
      session.portalOnline = false;
      session.portalGstin = "";
      if (!session.gstin) {
        const gstinMsg = await processAsync({ request: "getGstin" });
        if (gstinMsg && gstinMsg.status && gstinMsg.response) {
          session.gstin = gstinMsg.response;
        }
      }
      showStatus(null);
      const bi = getElement("businessInfo");
      bi.hidden = false;
      applyBusinessIdentity({ businessName: "GST Portal", subText: "Payments" });
      updatePortalStatusPill();
      getElement("workspace").hidden = false;
      return;
    }

    const info = JSON.parse(msg.response);
    if (!hasPortalIdentity(info)) {
      session.portalOnline = false;
      session.portalGstin = "";
      updatePortalStatusPill();
      showPortalOfflineFallback("Please login to GST Portal first.");
      showStatus("Please login to GST Portal first!");
      return;
    }
    showStatus(null);
    applyPortalSessionIdentity(info);
    session.registrationDate =
      getRegistrationDateFromCachedProfile(session.gstin) ||
      session.registrationDate;
    const bi = getElement("businessInfo");
    bi.hidden = false;
    applyBusinessIdentity({
      businessName: session.businessName || "GST Portal",
      gstin: session.gstin,
      regType: info.regType,
    });
    getElement("workspace").hidden = false;
    if (!info.regType || info.regType == "NT" || info.regType == "TP" || info.regType == "CA") session.gstRegType = ""; else if (info.regType == "CO") session.gstRegType = "CO"; else { showStatus(`Registration type ${info.regType} is not supported.`); return; }
  } else if (!session.portalFallbackMode) {
    showStatus("Getting information...");
    const ustatusUrl = `${currentUrl.origin}/services/api/ustatus`;
    const msg = await processAsync({ request: "get", url: ustatusUrl });
    if (!msg.status) {
      session.portalOnline = false;
      session.portalGstin = "";
      updatePortalStatusPill();
      showPortalOfflineFallback("Failed to get business information from GST Portal.");
      showStatus("Failed to get business information!");
      return;
    }
    const info = JSON.parse(msg.response);
    if (!hasPortalIdentity(info)) {
      session.portalOnline = false;
      session.portalGstin = "";
      updatePortalStatusPill();
      showPortalOfflineFallback("Please login to GST Portal first.");
      showStatus("Please login to GST Portal first!");
      return;
    }
    if (!isReturnHost && !isPaymentHost) { showStatus("Please open GST portal first!"); return; }
    showStatus(null);
    applyPortalSessionIdentity(info);
    session.registrationDate =
      getRegistrationDateFromCachedProfile(session.gstin) ||
      session.registrationDate;
    applyBusinessIdentity({
      businessName: session.businessName,
      gstin: session.gstin,
      regType: info.regType,
    });
    getElement("businessInfo").hidden = false;
    if (!info.regType || info.regType == "NT" || info.regType == "TP" || info.regType == "CA") session.gstRegType = ""; else if (info.regType == "CO") session.gstRegType = "CO"; else { showStatus(`Registration type ${info.regType} is not supported.`); return; }
  } else {
    showStatus(null);
    session.gstRegType = "";
    session.gstin = session.gstin || "";
    session.portalOnline = false;
    session.portalGstin = "";
    updatePortalStatusPill();
    applyBusinessIdentity({ businessName: "GST Portal", subText: "Offline Period Mode" });
    getElement("businessInfo").hidden = false;
    getElement("workspace").hidden = false;
  }
  const catSelect = getElement("gstCategory");
  catSelect.innerHTML = "";
  if (isPaymentHost) {
    addOption(catSelect, "Returns (HAR v1)", "returns");
    addOption(catSelect, "Ledgers (HAR v2)", "ledger");
    addOption(catSelect, "Summary", "summary");
    addOption(catSelect, "Other (HAR v3)", "other");
  } else {
    addOption(catSelect, "Returns (HAR v1)", "returns");
    addOption(catSelect, "Ledgers (HAR v2)", "ledger");
    addOption(catSelect, "Summary", "summary");
    addOption(catSelect, "Other (HAR v3)", "other");
  }

  const prefs = loadPrefs();
  // If user is already on a ledger page, default to ledgers; otherwise use saved pref.
  if (isPaymentHost) {
    session.category = "ledger";
  } else if (is2bHost) {
    session.category = "returns";
  } else if (path.includes("/ledger/")) {
    session.category = "ledger";
  } else {
    session.category = prefs.category || "returns";
  }
  if (urlCategory && ["returns", "ledger", "summary", "other"].includes(urlCategory)) {
    session.category = urlCategory;
  }
  catSelect.value = session.category;
  catSelect.onchange = async function () {
    session.category = catSelect.value;
    session.typeListLocked = false;
    applyCategoryUI();
    rebuildTypeOptions();
    renderCategoryPills();
    renderTypeList();
    session.return = getCurrentTypeConfig();
    if (session.category === "ledger") {
      await updateWorkspaceForLedger();
      return;
    }
    if (session.category === "summary") {
      await updatePeriods();
      await updateWorkspaceForSummary();
      return;
    }
    await updatePeriods();
    await updateWorkspace();
  };

  // Defaults for ledger date range: last 30 days.
  const ledgerFrom = prefs.ledgerFrom || moment().subtract(30, "days").format("YYYY-MM-DD");
  const ledgerTo = prefs.ledgerTo || moment().format("YYYY-MM-DD");
  getElement("ledgerDateFrom").value = ledgerFrom;
  getElement("ledgerDateTo").value = ledgerTo;
  session.ledgerFrom = ledgerFrom;
  session.ledgerTo = ledgerTo;

  rebuildTypeOptions();
  // Apply saved return selection per category
  const savedReturnKey =
    prefs[prefKeyForReturn(session.category)] ||
    (session.category === "ledger"
      ? "ITC_LED"
      : session.category === "summary"
        ? "G1SUM"
      : session.category === "other"
        ? "CHALLAN_LIST"
        : session.is2bHost
          ? "G2B"
          : null);
  if (savedReturnKey) {
    const selector = getElement("gstReturnType");
    if (selector && selector.querySelector(`option[value="${savedReturnKey}"]`)) {
      selector.value = savedReturnKey;
    }
  }
  if (urlReturnType) {
    const selector = getElement("gstReturnType");
    if (selector && selector.querySelector(`option[value="${urlReturnType}"]`)) {
      selector.value = urlReturnType;
      session.typeListLocked = true;
    }
  }
  applyCategoryUI();
  renderCategoryPills();
  renderTypeList();
  session.return = getCurrentTypeConfig();
  const returnSelector = getElement("gstReturnType");
  if (returnSelector) {
    returnSelector.onchange = async function () {
      session.return = getCurrentTypeConfig();
      renderTypeList();
      if (session.category === "ledger") {
        await updateWorkspaceForLedger();
        return;
      }
      if (session.category === "summary") {
        await updatePeriods();
        await updateWorkspaceForSummary();
        return;
      }
      await updatePeriods();
      await updateWorkspace();
    };
  }
  if (session.category === "ledger") {
    await updateWorkspaceForLedger();
  } else if (session.category === "summary") {
    await updatePeriods();
    await updateWorkspaceForSummary();
  } else {
    await updatePeriods();
  }
  if (urlReturnType) {
    session.return = getCurrentTypeConfig();
    await refreshWorkspace();
  }
}

function makeFinancialYearLabel(startYear) {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function annualPeriodValueFromFy(startYear) {
  return `03${startYear + 1}`;
}

function getCurrentFinancialYearStart() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 4 ? year : year - 1;
}

function extractAnnualYearsFromDropdownResponse(responseText) {
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (e) {
    return [];
  }

  const years = new Set();
  const candidates = [];
  if (parsed && parsed.data) candidates.push(parsed.data);
  if (parsed) candidates.push(parsed);

  const pushYear = (value) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    const fyMatch = text.match(/^(\d{4})-(\d{2}|\d{4})$/);
    if (fyMatch) {
      years.add(parseInt(fyMatch[1], 10));
      return;
    }
    const yearMatch = text.match(/^20\d{2}$/);
    if (yearMatch) {
      const yr = parseInt(text, 10) - 1;
      if (yr >= 2016) years.add(yr);
    }
  };

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      Object.keys(node).forEach((key) => {
        if (["year", "fy", "finYear", "financialYear", "rtnprd", "ret_period", "value"].includes(key)) {
          pushYear(node[key]);
        }
        walk(node[key]);
      });
      return;
    }
    pushYear(node);
  };

  candidates.forEach(walk);
  return Array.from(years).sort((a, b) => b - a);
}

function getAnnualDownloadConfig(cfg, mode) {
  if (cfg.key === "G9") {
    return {
      key: mode === "excel" ? "G9EX" : "G9",
      display: "GSTR-9",
      apiCode: "GSTR9",
      fileNameCode: "R9",
      fileType: mode === "excel" ? "EX" : "",
      fileTypeCode: mode === "excel" ? "EXL" : "",
      generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
      downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
    };
  }
  if (cfg.key === "G9C" || cfg.key === "G9CEX") {
    return {
      key: mode === "excel" ? "G9CEX" : "G9C",
      display: "GSTR-9C",
      apiCode: "GSTR9C",
      fileNameCode: "R9C",
      fileType: mode === "excel" ? "EX" : "",
      fileTypeCode: mode === "excel" ? "EXL" : "",
      generateBase: "https://return.gst.gov.in/returns/auth/api/offline/download/generate",
      downloadBase: "https://return.gst.gov.in/returns/auth/api/offline/download/url",
    };
  }
  return cfg;
}

const addOption = (sel, text, value) => {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = text;
  sel.appendChild(opt);
};

function getCurrentTypeConfig() {
  const key = getElement("gstReturnType").value;
  if (session.category === "ledger") return ledgerConfig[key];
  if (session.category === "summary") return summaryConfig[key];
  if (session.category === "other") return otherConfig[key];
  return returnConfig[key];
}

function getCategoryLabel(category) {
  if (category === "ledger") return "Ledgers";
  if (category === "summary") return "Summary";
  if (category === "other") return "Other";
  return "Returns";
}

function renderCategoryPills() {
  const holder = getElement("categoryPills");
  if (!holder) return;
  const categories = [
    { value: "returns", label: "Returns" },
    { value: "ledger", label: "Ledgers" },
    { value: "summary", label: "Summary" },
    { value: "other", label: "Other" },
  ];
  holder.innerHTML = "";
  categories.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `choice-pill${session.category === item.value ? " active" : ""}`;
    btn.textContent = item.label;
    btn.onclick = async function () {
      if (session.category === item.value) return;
      session.category = item.value;
      getElement("gstCategory").value = item.value;
      session.typeListLocked = false;
      applyCategoryUI();
      rebuildTypeOptions();
      renderCategoryPills();
      renderTypeList();
      session.return = getCurrentTypeConfig();
      if (session.category === "summary") {
        await updatePeriods();
        await updateWorkspaceForSummary();
        return;
      }
      await updatePeriods();
    };
    holder.appendChild(btn);
  });
}

function renderTypeList() {
  const holder = getElement("typeList");
  const selector = getElement("gstReturnType");
  if (!holder || !selector) return;

  const options = Array.from(selector.options).map((opt) => ({
    value: opt.value,
    label: opt.textContent,
  }));
  const selected = options.find((opt) => opt.value === selector.value) || options[0];
  holder.innerHTML = "";

  if (!options.length) return;

  if (session.typeListLocked && selected) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "type-card active";
    card.innerHTML = `<div class="type-title">${selected.label}</div>`;
    card.onclick = function () {};
    holder.appendChild(card);

    const actions = document.createElement("div");
    actions.className = "type-actions";
    const changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.className = "btn btn-link btn-sm p-0";
    changeBtn.textContent = "Change selection";
    changeBtn.onclick = function () {
      session.typeListLocked = false;
      renderTypeList();
    };
    actions.appendChild(changeBtn);
    holder.appendChild(actions);
    return;
  }

  options.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `type-card${selected && selected.value === item.value ? " active" : ""}`;
    card.innerHTML = `<div class="type-title">${item.label}</div>`;
    card.onclick = async function () {
      selector.value = item.value;
      session.return = getCurrentTypeConfig();
      session.typeListLocked = true;
      renderTypeList();
      await refreshWorkspace();
    };
    holder.appendChild(card);
  });
}

async function refreshWorkspace() {
  getElement("banner-generating").hidden = true;

  const selectorGstReturnType = getElement("gstReturnType");
  const selectorFinYear = getElement("finYear");
  const selectorPeriodFrom = getElement("periodFrom");
  const selectorPeriodTo = getElement("periodTo");

  session.category = getElement("gstCategory").value;
  if (session.category === "ledger") {
    session.return = ledgerConfig[selectorGstReturnType.value];
    session.ledgerFrom = getElement("ledgerDateFrom").value;
    session.ledgerTo = getElement("ledgerDateTo").value;
    session.useCustomPeriods = false;
  } else if (session.category === "summary") {
    session.return = summaryConfig[selectorGstReturnType.value];
    session.finYear = selectorFinYear.value;
    session.periodFrom = selectorPeriodFrom.value;
    session.periodTo = selectorPeriodTo.value;
  } else if (session.category === "other") {
    session.return = otherConfig[selectorGstReturnType.value];
    session.useCustomPeriods = true;
    session.periodFrom = selectorPeriodFrom.value;
    session.periodTo = selectorPeriodTo.value;
  } else {
    session.return = returnConfig[selectorGstReturnType.value];
    session.finYear = selectorFinYear.value;
    session.periodFrom = selectorPeriodFrom.value;
    session.periodTo = selectorPeriodTo.value;
  }

  const prefs = loadPrefs();
  prefs.category = session.category;
  prefs[prefKeyForReturn(session.category)] = session.return.key;
  prefs.finYear = session.finYear;
  prefs.useCustomPeriods = session.useCustomPeriods;
  prefs.periodFrom = session.periodFrom;
  prefs.periodTo = session.periodTo;
  prefs.ledgerFrom = session.ledgerFrom;
  prefs.ledgerTo = session.ledgerTo;
  savePrefs(prefs);

  if (session.category === "ledger") {
    let ledgerHost = "payment.gst.gov.in";
    try {
      const ledgerUrl = new URL((session.return && (session.return.generateBase || session.return.base)) || "https://payment.gst.gov.in");
      ledgerHost = ledgerUrl.hostname.toLowerCase();
    } catch (e) {
      ledgerHost = "payment.gst.gov.in";
    }
    await ensureConnectedToHost(ledgerHost);
    await updateWorkspaceForLedger();
    return;
  }
  if (session.category === "summary") {
    await updatePeriods();
    await updateWorkspaceForSummary();
    return;
  }

  await updatePeriods();
  await updateWorkspace();
}

function applyCategoryUI() {
  const cat = session.category;
  const finWrap = getElement("finYearWrap");
  const returnWrap = getElement("returnPeriodWrap");
  const customWrap = getElement("customPeriodsWrap");
  const toggleBtn = getElement("toggleCustomBtn");
  const ledgerWrap = getElement("ledgerDateWrap");
  const finYearSelect = getElement("finYear");

  const isLedger = cat === "ledger";
  const isPaymentHost = currentUrl && currentUrl.hostname && currentUrl.hostname.toLowerCase() === "payment.gst.gov.in";
  if (isLedger) {
    session.useCustomPeriods = false;
  } else if (cat === "other" || isPaymentHost) {
    session.useCustomPeriods = true;
  }
  finWrap.hidden = false;
  if (returnWrap) returnWrap.hidden = isLedger ? true : false;
  customWrap.hidden = isLedger || !session.useCustomPeriods;
  if (toggleBtn) toggleBtn.hidden = isLedger || cat === "other" || isPaymentHost;
  if (finYearSelect) finYearSelect.hidden = isPaymentHost || session.useCustomPeriods;
  ledgerWrap.hidden = !isLedger;

  // For "other" behave like returns UI (needs period selectors).
  if (!isLedger) ledgerWrap.hidden = true;
}

function rebuildTypeOptions() {
  if (session.category === "ledger") {
    updateLedgers();
  } else if (session.category === "summary") {
    updateSummaries();
  } else if (session.category === "other") {
    updateOthers();
  } else {
    updateReturns();
  }
  renderTypeList();
}

function updateReturns() {
  const returnSelector = getElement("gstReturnType");
  returnSelector.innerHTML = "";

  const regularOrder = ["G3B", "G1", "G2A", "G2B", "G9", "G9C", "G4", "G4A"];
  const compositionOrder = ["G4", "G4A", "G3B", "G1", "G2A", "G2B", "G9", "G9C"];
  const order = session.gstRegType ? compositionOrder : regularOrder;
  order.forEach((key) => {
    const cfg = rc(key);
    addOption(returnSelector, cfg.display, cfg.key);
  });
  if (session.is2bHost) returnSelector.value = "G2B";
}

function updateLedgers() {
  const returnSelector = getElement("gstReturnType");
  returnSelector.innerHTML = "";
  const order = ["ITC_LED", "REV_RCLM", "RCM_LED", "LIAB_RET", "LIAB_PAY", "CASH_LED"];
  order.forEach((key) => {
    const cfg = ledgerConfig[key];
    if (cfg) addOption(returnSelector, cfg.display, cfg.key);
  });
}

function updateOthers() {
  const returnSelector = getElement("gstReturnType");
  returnSelector.innerHTML = "";
  const order = ["CHALLAN_LIST", "IMS_IN", "IMS_OUT", "G3B_VS_G1SUM", "G3B_VS_G2ASUM"];
  order.forEach((key) => {
    const cfg = otherConfig[key];
    if (cfg) addOption(returnSelector, cfg.display, cfg.key);
  });
}

function updateSummaries() {
  const returnSelector = getElement("gstReturnType");
  returnSelector.innerHTML = "";
  const order = ["G1SUM", "G2ASUM", "G2AOTHER", "G2BSUM"];
  order.forEach((key) => {
    const cfg = summaryConfig[key];
    if (cfg) addOption(returnSelector, cfg.display, cfg.key);
  });
}

async function updatePeriods() {
  showStatus("Getting periods...");

  const buildSyntheticMonthlyDropdown = (fromMoment, toMoment) => {
    const months = [];
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const yearsMap = {};
    if (!fromMoment || !toMoment || !fromMoment.isValid() || !toMoment.isValid() || fromMoment.isAfter(toMoment, "month")) {
      return { Years: [] };
    }
    const cursor = fromMoment.clone().startOf("month");
    const end = toMoment.clone().startOf("month");
    while (cursor.isSameOrBefore(end, "month")) {
      const mm = cursor.format("MM");
      const yy = cursor.format("YYYY");
      const monthObj = { month: names[cursor.month()], value: `${mm}${yy}`, year: yy };
      months.push(monthObj);
      cursor.add(1, "month");
    }
    months.forEach((m) => {
      yearsMap[m.year] = yearsMap[m.year] || { year: m.year, months: [] };
      yearsMap[m.year].months.push({ month: m.month, value: m.value });
    });
    return { Years: Object.values(yearsMap) };
  };

  if (session.portalFallbackMode) {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const yearsMap = {};
    const fromMoment = session.useCustomPeriods
      ? moment(session.periodFrom || "042017", "MMYYYY").startOf("month")
      : moment(`04${(session.finYear || "2017-18").slice(0, 4)}`, "MMYYYY").startOf("month");
    const toMoment = session.useCustomPeriods
      ? moment(session.periodTo || moment().format("MMYYYY"), "MMYYYY").startOf("month")
      : moment(`03${((session.finYear || "2017-18").slice(0, 4) * 1) + 1}`, "MMYYYY").startOf("month");
    if (fromMoment.isValid() && toMoment.isValid() && !fromMoment.isAfter(toMoment, "month")) {
      const cursor = fromMoment.clone();
      while (cursor.isSameOrBefore(toMoment, "month")) {
        const fyStartYear = cursor.month() >= 3 ? cursor.year() : cursor.year() - 1;
        const fyLabel = `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
        yearsMap[fyLabel] = yearsMap[fyLabel] || { year: fyLabel, months: [] };
        yearsMap[fyLabel].months.push({
          month: names[cursor.month()],
          value: cursor.format("MMYYYY"),
        });
        cursor.add(1, "month");
      }
    }
    session.dropdown = { Years: Object.values(yearsMap) };
    showStatus("Periods loaded (offline mode).");
    return;
  }

  const isPaymentHost = currentUrl.hostname.toLowerCase() === "payment.gst.gov.in";
  if (isPaymentHost) {
    // Build last 12 months synthetic dropdown for payment host.
    const months = [];
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear());
      months.push({ month: names[d.getMonth()], value: `${mm}${yy}`, year: yy });
    }
    const yearsMap = {};
    months.forEach((m) => {
      yearsMap[m.year] = yearsMap[m.year] || { year: m.year, months: [] };
      yearsMap[m.year].months.push({ month: m.month, value: m.value });
    });
    session.dropdown = { Years: Object.values(yearsMap) };
    showStatus(null);
    return;
  }

  const is2bHost = currentUrl.hostname.toLowerCase() === "gstr2b.gst.gov.in";
  if (is2bHost) {
    // Build GSTR-2B dropdown from FY 2017-18 till current month.
    const months = [];
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const start = moment("042017", "MMYYYY").startOf("month");
    const end = moment().startOf("month");
    const cursor = start.clone();
    while (cursor.isSameOrBefore(end, "month")) {
      const monthNo = cursor.month() + 1;
      const fyStartYear = monthNo >= 4 ? cursor.year() : cursor.year() - 1;
      const fyLabel = `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
      months.push({
        month: names[cursor.month()],
        value: cursor.format("MMYYYY"),
        year: fyLabel,
      });
      cursor.add(1, "month");
    }
    // Group by FY label to mimic portal dropdown shape.
    const yearsMap = {};
    months.forEach((m) => {
      yearsMap[m.year] = yearsMap[m.year] || { year: m.year, months: [] };
      yearsMap[m.year].months.push({ month: m.month, value: m.value });
    });
    session.dropdown = { Years: Object.values(yearsMap).reverse() };
    showStatus(null);
  } else {
    const msg = await processAsync({ request: "get", url: gstn.dropdown });

    if (!msg.status) {
      if (isGstr2aReturn(session.return)) {
        const fromMoment = session.useCustomPeriods
          ? moment(session.periodFrom || "", "MMYYYY")
          : moment(`01${selectorFinYear.value}`, "MMYYYY");
        const toMoment = session.useCustomPeriods
          ? moment(session.periodTo || "", "MMYYYY")
          : moment(`12${selectorFinYear.value}`, "MMYYYY");
        session.dropdown = buildSyntheticMonthlyDropdown(fromMoment, toMoment);
        showStatus(null);
      } else {
        showStatus("Unable to select period. Failed to get periods.");
        session.dropdown = null;
      }
    } else {
      const respObj = JSON.parse(msg.response);
      if (respObj.status != 1) {
        if (isGstr2aReturn(session.return)) {
          const fromMoment = session.useCustomPeriods
            ? moment(session.periodFrom || "", "MMYYYY")
            : moment(`01${selectorFinYear.value}`, "MMYYYY");
          const toMoment = session.useCustomPeriods
            ? moment(session.periodTo || "", "MMYYYY")
            : moment(`12${selectorFinYear.value}`, "MMYYYY");
          session.dropdown = buildSyntheticMonthlyDropdown(fromMoment, toMoment);
          showStatus(null);
        } else {
          showStatus("Unable to select period. Failed to get periods.");
          session.dropdown = null;
        }
      } else {
        showStatus(null);
        session.dropdown = respObj.data;
      }
    }
  }

  // IMS Outward: if dropdown is empty, synthesize periods from selected range or fin year.
  if (
    session.category === "other" &&
    session.return &&
    session.return.key === "IMS_OUT" &&
    (!session.dropdown || !session.dropdown.Years || session.dropdown.Years.length === 0)
  ) {
    const months = [];
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const fromVal = session.periodFrom || moment().startOf("year").format("MMYYYY");
    const toVal = session.periodTo || moment().endOf("year").format("MMYYYY");
    const fromDate = moment(fromVal, "MMYYYY");
    const toDate = moment(toVal, "MMYYYY");
    const addMonth = (d) => {
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear());
      months.push({ month: names[d.getMonth()], value: `${mm}${yy}`, year: yy });
    };
    if (fromDate.isValid() && toDate.isValid() && !fromDate.isAfter(toDate)) {
      const cursor = fromDate.clone();
      while (cursor.isSameOrBefore(toDate, "month")) {
        addMonth(cursor.toDate());
        cursor.add(1, "month");
      }
    } else {
      // default last 12 months
      for (let i = 0; i < 12; i++) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        addMonth(d);
      }
    }
    const yearsMap = {};
    months.forEach((m) => {
      yearsMap[m.year] = yearsMap[m.year] || { year: m.year, months: [] };
      yearsMap[m.year].months.push({ month: m.month, value: m.value });
    });
    session.dropdown = { Years: Object.values(yearsMap) };
    showStatus(null);
  }

  // Fallback: if dropdown empty, synthesize full financial years from 2016-17 to current FY.
  if (!session.dropdown || !session.dropdown.Years || session.dropdown.Years.length === 0) {
    session.dropdown = buildFinancialYearDropdownFrom2016();
    showStatus(null);
  }
  // Sort years and months in descending chronological order (latest first).
  session.dropdown.Years.sort((a, b) => parseInt(b.year) - parseInt(a.year));
  session.dropdown.Years.forEach((y) => {
    y.months.sort((a, b) => periodKey(b.value) - periodKey(a.value));
  });

  const selectorFinYear = getElement("finYear");
  const selectorPeriodFrom = getElement("periodFrom");
  const selectorPeriodTo = getElement("periodTo");
  const toggleCustomBtn = getElement("toggleCustomBtn");
  const prefs = loadPrefs();

  selectorFinYear.innerHTML = "";
  selectorPeriodFrom.innerHTML = "";
  selectorPeriodTo.innerHTML = "";

  function applyCustomToggleState() {
    const wrap = getElement("customPeriodsWrap");
    const fySelect = selectorFinYear;
    const useCustom = session.category === "ledger" ? false : !!session.useCustomPeriods;

    wrap.hidden = !useCustom;
    fySelect.hidden = useCustom;
    selectorPeriodFrom.disabled = !useCustom;
    selectorPeriodTo.disabled = !useCustom;
    if (toggleCustomBtn) {
      toggleCustomBtn.textContent = useCustom ? "Use Financial Year" : "Custom Periods";
    }
    rebuildPeriodToOptions();
  }

  for (let i = 0; i < session.dropdown.Years.length; i++) {
    let opt = document.createElement("option");
    opt.value = session.dropdown.Years[i].year;
    opt.textContent = session.dropdown.Years[i].year;
    selectorFinYear.appendChild(opt);

    for (let j = 0; j < session.dropdown.Years[i].months.length; j++) {
      const p = session.dropdown.Years[i].months[j];
      let optP = document.createElement("option");
      optP.value = p.value;
      optP.textContent = `${p.value.substring(0, 2)}/${p.value.substring(2)}`;
      selectorPeriodFrom.appendChild(optP.cloneNode(true));
      selectorPeriodTo.appendChild(optP);
    }
  }

  if (toggleCustomBtn && toggleCustomBtn.tagName === "BUTTON") {
    toggleCustomBtn.onclick = function () {
      session.useCustomPeriods = !session.useCustomPeriods;
      prefs.useCustomPeriods = session.useCustomPeriods;
      savePrefs(prefs);
      applyCustomToggleState();
    };
  }

  function rebuildPeriodToOptions() {
    const fromVal = selectorPeriodFrom.value;
    const fromKey = periodKey(fromVal);
    const currentToValue = selectorPeriodTo.value;
    const allOptions = Array.from(selectorPeriodFrom.options).map((o) => ({
      value: o.value,
      text: o.textContent,
    }));
    selectorPeriodTo.innerHTML = "";
    allOptions.forEach((o) => {
      const ok = !fromKey || periodKey(o.value) >= fromKey;
      if (ok) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.text;
        selectorPeriodTo.appendChild(opt);
      }
    });
    // keep same selection if still valid; otherwise clamp to first valid
    if (
      currentToValue &&
      selectorPeriodTo.querySelector(`option[value="${currentToValue}"]`)
    ) {
      selectorPeriodTo.value = currentToValue;
    } else if (
      prefs.periodTo &&
      selectorPeriodTo.querySelector(`option[value="${prefs.periodTo}"]`)
    ) {
      selectorPeriodTo.value = prefs.periodTo;
    } else if (selectorPeriodTo.options.length) {
      selectorPeriodTo.value = selectorPeriodTo.options[0].value;
    }
  }

  // apply saved prefs
  if (
    prefs.finYear &&
    selectorFinYear.querySelector(`option[value="${prefs.finYear}"]`)
  ) {
    selectorFinYear.value = prefs.finYear;
  }
  if (
    prefs[prefKeyForReturn(session.category)] &&
    getElement("gstReturnType").querySelector(
      `option[value="${prefs[prefKeyForReturn(session.category)]}"]`,
    )
  ) {
    getElement("gstReturnType").value = prefs[prefKeyForReturn(session.category)];
  }
  if (
    prefs.periodFrom &&
    selectorPeriodFrom.querySelector(`option[value="${prefs.periodFrom}"]`)
  ) {
    selectorPeriodFrom.value = prefs.periodFrom;
  }
  rebuildPeriodToOptions();
  if (
    prefs.periodTo &&
    selectorPeriodTo.querySelector(`option[value="${prefs.periodTo}"]`)
  ) {
    selectorPeriodTo.value = prefs.periodTo;
  }
  if (session.category === "ledger") {
    session.useCustomPeriods = false;
  } else if (session.category === "other") {
    session.useCustomPeriods = true;
  } else {
    session.useCustomPeriods = !!prefs.useCustomPeriods;
  }
  applyCustomToggleState();
  // Keep runtime session in sync with the effective selector values.
  if (selectorFinYear && selectorFinYear.value) session.finYear = selectorFinYear.value;
  if (selectorPeriodFrom && selectorPeriodFrom.value) session.periodFrom = selectorPeriodFrom.value;
  if (selectorPeriodTo && selectorPeriodTo.value) session.periodTo = selectorPeriodTo.value;

  const btnRefresh = getElement("refresh");
  btnRefresh.onclick = async function (evt) {
    reportButtonClicked(evt);
    await refreshWorkspace();
  };

  selectorPeriodFrom.onchange = function () {
    rebuildPeriodToOptions();
  };
  selectorPeriodTo.onchange = function () {
    // keep prefs in sync if user changes To without hitting refresh
    prefs.periodTo = selectorPeriodTo.value;
    savePrefs({
      [prefKeyForReturn(session.category)]:
        prefs[prefKeyForReturn(session.category)] || getElement("gstReturnType").value,
      finYear: selectorFinYear.value,
      useCustomPeriods: session.useCustomPeriods,
      periodFrom: selectorPeriodFrom.value,
      periodTo: selectorPeriodTo.value,
    });
  };

  getElement("workspace").hidden = false;
}

async function updateWorkspace() {
  if (session.category === "ledger") {
    await updateWorkspaceForLedger();
    return;
  }
  if (session.category === "summary") {
    await updateWorkspaceForSummary();
    return;
  }
  if (session.category === "other") {
    await updateWorkspaceForOther();
    return;
  }
  // Annual returns use a dedicated FY table.
  if (session.return.isAnnual) {
    await updateWorkspaceForAnnualReturn();
    return;
  }

  const divStatus = getElement("returnStatus");
  divStatus.textContent = `Getting ${session.return.display} status...`;

  session.periods.length = 0;
  // Annual returns (G9, G9C) are single FY-based periods, not monthly.
  if (session.return.isAnnual) {
    const fyStart = parseInt(session.finYear.substring(0, 4), 10);
    session.useCustomPeriods = false;
    session.periods.push({
      value: `03${fyStart + 1}`, // matches HAR annual rtn_prd pattern
      month: "Mar",
      year: session.finYear,
      isValid: false,
    });
  } else {
    const hasCustom = session.useCustomPeriods;
    const fromVal = hasCustom ? periodKey(session.periodFrom) : null;
    const toVal = hasCustom ? periodKey(session.periodTo) : null;

    for (let i = 0; i < session.dropdown.Years.length; i++) {
      for (let j = 0; j < session.dropdown.Years[i].months.length; j++) {
        let p = session.dropdown.Years[i].months[j];
        p.isValid = false;

        if (hasCustom) {
          const val = periodKey(p.value);
          if (fromVal && val !== null && val < fromVal) continue;
          if (toVal && val !== null && val > toVal) continue;
        } else {
          const dropdownYearLabel = String(session.dropdown.Years[i].year || "");
          const derivedFyLabel = financialYearFromPeriodValue(p.value);
          if (dropdownYearLabel != session.finYear && derivedFyLabel != session.finYear) continue;
        }

        p.year = session.dropdown.Years[i].year;
        session.periods.push(p);
      }
    }
    if (!session.periods.length && !hasCustom && session.finYear) {
      syntheticFyMonths(session.finYear).forEach((p) => {
        p.isValid = false;
        p.year = session.finYear;
        session.periods.push(p);
      });
    }
  }

  // For downloads/workspace: show oldest first (ascending).
  session.periods.sort((a, b) => periodKey(a.value) - periodKey(b.value));

  let rowsHtml = "";
  for (let i = 0; i < session.periods.length; i++) {
    const p = session.periods[i];
    const rowActions = isStructuredJsonExcelReturn(session.return)
      ? `<button type="button" class="btn btn-success btn-sm" id="btn-download-json-${p.value}" data-fp="${p.value}" hidden>JSON</button>`
      : session.return.needsFileGeneration
        ? `<div class="btn-group btn-group-sm" role="group"><button type="button" class="btn btn-success" id="btn-download-${p.value}" data-fp="${p.value}" hidden>Download</button><button type="button" class="btn btn-warning" id="btn-gen-${p.value}" data-fp="${p.value}" hidden>Generate</button></div>`
        : `<button type="button" class="btn btn-success btn-sm" id="btn-download-${p.value}" data-fp="${p.value}" hidden>Download</button>`;
    const rowExcelAction = supportsExcelDownloadReturn(session.return)
      ? `<button type="button" class="btn btn-primary btn-sm" id="btn-download-excel-${p.value}" data-fp="${p.value}" hidden>Excel</button>`
      : "";
    const rowGenerateAction = isGeneratedStructuredReturn(session.return)
      ? `<button type="button" class="btn btn-warning btn-sm" id="btn-generate-${p.value}" data-fp="${p.value}">Generate</button>`
      : "";
    const periodLabel = p.value && p.value.length >= 6 ? `${p.month} ${p.value.substring(2)}` : `${p.month} ${p.year || ""}`.trim();
    rowsHtml += `<tr><td class="align-middle">${periodLabel}</td><td class="align-middle"><div id="info-${p.value}"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="sr-only">Loading...</span></div></div></td><td class="align-middle">${rowActions}</td>${supportsExcelDownloadReturn(session.return) ? `<td class="align-middle">${rowExcelAction}</td>` : ""}${isGeneratedStructuredReturn(session.return) ? `<td class="align-middle">${rowGenerateAction}</td>` : ""}</tr>`;
  }
  if (!rowsHtml) {
    rowsHtml = `<tr><td colspan="${isGeneratedStructuredReturn(session.return) ? "5" : supportsExcelDownloadReturn(session.return) ? "4" : "3"}" class="text-muted">No periods available for the selected ${session.useCustomPeriods ? "custom range" : "financial year"}.</td></tr>`;
  }

  let workspaceActions = isStructuredJsonExcelReturn(session.return)
    ? `<div class="btn-group btn-group-sm float-right mr-2" role="group"><button type="button" class="btn btn-success" id="btn-download-all-json" hidden><strong>Download All JSON</strong></button><button type="button" class="btn btn-primary" id="btn-download-all-excel" hidden><strong>Download All Excel</strong></button>${session.return.needsFileGeneration ? `<button type="button" class="btn btn-warning" id="btn-gen-all" hidden><strong>Generate All</strong></button>` : ""}</div>`
    : isGstr3bReturn(session.return)
      ? `<div class="btn-group btn-group-sm float-right mr-2" role="group"><button type="button" class="btn btn-success" id="btn-download-all" hidden><strong>Download All</strong></button><button type="button" class="btn btn-primary" id="btn-download-all-excel" hidden><strong>Download All Excel</strong></button></div>`
    : session.return.needsFileGeneration
      ? `<div class="btn-group btn-group-sm float-right mr-2" role="group"><button type="button" class="btn btn-success" id="btn-download-all" hidden><strong>Download All</strong></button><button type="button" class="btn btn-warning" id="btn-gen-all" hidden><strong>Generate All</strong></button></div>`
      : `<div class="btn-group btn-group-sm float-right mr-2" role="group"><button type="button" class="btn btn-success" id="btn-download-all" hidden><strong>Download All</strong></button></div>`;

  divStatus.innerHTML = `<div class="row mb-2 align-items-center" id="all" hidden><div class="col px-0"><div id="bulk-action-status" hidden></div></div><div class="col px-0 text-right">${workspaceActions}</div></div><div class="row"><table class="table table-bordered table-sm table-status"><tr><th>Period</th><th>Status</th><th>${isStructuredJsonExcelReturn(session.return) ? "JSON" : "Action"}</th>${supportsExcelDownloadReturn(session.return) ? "<th>Excel</th>" : ""}${isGeneratedStructuredReturn(session.return) ? "<th>Generate</th>" : ""}</tr>${rowsHtml}</table></div>`;

  let validPeriodCount = 0;

  //Check in series
  //for (let i=0; i<session.periods.length; i++) {
  //  await updateRow(session.periods[i]);
  //}

  //Check in parallel
  await Promise.all(session.periods.map((p) => updateRow(p)));

  for (let i = 0; i < session.periods.length; i++) {
    if (session.periods[i].isValid) validPeriodCount++;
  }

  const showBulkStructured = isStructuredJsonExcelReturn(session.return) && session.periods.length > 1;
  const showBulkGstr3b = isGstr3bReturn(session.return) && validPeriodCount > 1;
  const showBulkDefault = !isStructuredJsonExcelReturn(session.return) && !isGstr3bReturn(session.return) && validPeriodCount > 1;

  if (showBulkStructured || showBulkGstr3b || showBulkDefault) {
    getElement("all").hidden = false;

    if (isStructuredJsonExcelReturn(session.return)) {
      const btnDownloadAllJson = getElement("btn-download-all-json");
      const btnDownloadAllExcel = getElement("btn-download-all-excel");
      if (btnDownloadAllJson) {
        btnDownloadAllJson.hidden = false;
        btnDownloadAllJson.disabled = validPeriodCount === 0;
        btnDownloadAllJson.onclick = function (evt) {
          reportButtonClicked(evt);
          downloadAllStructuredReturn("json");
        };
      }
      if (btnDownloadAllExcel) {
        btnDownloadAllExcel.hidden = false;
        btnDownloadAllExcel.disabled = validPeriodCount === 0;
        btnDownloadAllExcel.onclick = function (evt) {
          reportButtonClicked(evt);
          downloadAllStructuredReturn("excel");
        };
      }
      const btnGenAll = getElement("btn-gen-all");
      if (btnGenAll) {
        btnGenAll.hidden = false;
        btnGenAll.onclick = function (evt) {
          reportButtonClicked(evt);
          generateAll();
        };
      }
    } else if (isGstr3bReturn(session.return)) {
      const btnDownloadAll = getElement("btn-download-all");
      const btnDownloadAllExcel = getElement("btn-download-all-excel");
      if (btnDownloadAll) {
        btnDownloadAll.hidden = false;
        btnDownloadAll.onclick = function (evt) {
          reportButtonClicked(evt);
          downloadAll();
        };
      }
      if (btnDownloadAllExcel) {
        btnDownloadAllExcel.hidden = false;
        btnDownloadAllExcel.disabled = validPeriodCount === 0;
        btnDownloadAllExcel.onclick = function (evt) {
          reportButtonClicked(evt);
          downloadAllExcel();
        };
      }
    } else {
      const btnDownloadAll = getElement("btn-download-all");
      btnDownloadAll.hidden = false;
      btnDownloadAll.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadAll();
      };

      const btnGenAll = getElement("btn-gen-all");

      if (btnGenAll) {
        btnGenAll.hidden = false;
        btnGenAll.onclick = function (evt) {
          reportButtonClicked(evt);
          generateAll();
        };
      }
    }
  }

  const btnDownloadNow = getElement("downloadNow");
  if (btnDownloadNow) {
    btnDownloadNow.disabled = !getDownloadValidationState().matches;
    btnDownloadNow.onclick = function (evt) {
      reportButtonClicked(evt);
      if (isStructuredJsonExcelReturn(session.return)) downloadAllStructuredReturn("json");
      else downloadAll();
    };
  }

  const validation = getDownloadValidationState();
  if (!validation.matches) {
    [
      getElement("btn-download-all"),
      getElement("btn-download-all-json"),
      getElement("btn-download-all-excel"),
    ]
      .filter(Boolean)
      .forEach((button) => {
        button.disabled = true;
      });
    if (session.periods.some((p) => p.isValid)) renderDownloadValidationAlert(validation);
  } else {
    renderDownloadValidationAlert(null);
  }
}

async function updateRow(period) {
  const divInfo = getElement(`info-${period.value}`);
  const btnDownload = getElement(`btn-download-${period.value}`);
  const btnDownloadJson = getElement(`btn-download-json-${period.value}`);
  const btnDownloadExcel = getElement(`btn-download-excel-${period.value}`);
  const btnGenerate = getElement(`btn-generate-${period.value}`) || getElement(`btn-gen-${period.value}`);

  if (session.return.isQuarterly) {
    var isMonth = parseInt(period.value.substring(0, 2)) < 13;

    if (isMonth) {
      divInfo.innerHTML = pill("Not available", "warning");
      return;
    }
  }

  const downloadsAllowed = enforceDownloadValidation(period, {
    buttons: [btnDownload, btnDownloadJson, btnDownloadExcel],
  });

  if (!session.return.isAnnual && !isStructuredJsonExcelReturn(session.return)) {
    const role = await processAsync({ request: "get", url: gstn.rolestatus(period) });
    if (!role.status) {
      divInfo.innerHTML = pill(extractFailureText(role, "Failed"), "danger");
      return;
    }
    let info = null;
    try {
      info = JSON.parse(role.response);
    } catch (err) {
      divInfo.innerHTML = pill("Invalid GST role status response", "danger");
      return;
    }
    const filingStatus = getReturnInfo(info, session.return.apiCode).status;
    if (filingStatus != session.return.expFilingStatus) {
      const text = displayFilingStatus(filingStatus);
      const type = text.toLowerCase().includes("not") ? "warning" : "muted";
      divInfo.innerHTML = pill(text, type);
      if (!downloadsAllowed && btnGenerate) {
        btnGenerate.hidden = true;
      }
      return;
    }
  }

  if (session.return.needsFileGeneration) {
    divInfo.innerHTML = `${pill("Filed", "success")} <small class="text-muted ml-1">Checking files...</small>`;

    //Check whether the file is generated or not

    let msgFile = await processAsync({
      request: "get",
      url: gstn.generateFile(session.return, period, false),
    });

    if (!msgFile.status) {
      if (isGstr2aReturn(session.return)) {
        divInfo.innerHTML = pill("Ready to generate", "warning");
      } else {
        divInfo.innerHTML = pill(extractFailureText(msgFile, "Failed"), "danger");
      }
      return;
    }

    let resp = null;
    try {
      resp = JSON.parse(msgFile.response);
    } catch (err) {
      divInfo.innerHTML = pill("Invalid generated-file response from GST portal", "danger");
      return;
    }
    const fileGenStatus = getFileGenStatus(resp);

    if (fileGenStatus) {
      const type = fileGenStatus.toLowerCase().includes("generating")
        ? "warning"
        : "danger";
      divInfo.innerHTML = pill(fileGenStatus, type);
      return;
    }

    showGenTime(divInfo, resp.data.date, resp.data.time);
    period.isValid = true;
    period.fileCount = resp.data.url.length;
  } else {
    divInfo.innerHTML = pill("Filed", "success");
    period.isValid = true;
    period.fileCount = 1;
  }

  if (isStructuredJsonExcelReturn(session.return)) {
    if (btnDownloadJson) {
      btnDownloadJson.hidden = false;
      btnDownloadJson.disabled = !downloadsAllowed;
      btnDownloadJson.textContent = "JSON";
      btnDownloadJson.onclick = function (evt) {
        reportButtonClicked(evt);
        download(period, "json");
      };
    }
    if (btnDownloadExcel) {
      btnDownloadExcel.hidden = false;
      btnDownloadExcel.disabled = !downloadsAllowed;
      btnDownloadExcel.textContent = "Excel";
      btnDownloadExcel.onclick = function (evt) {
        reportButtonClicked(evt);
        download(period, "excel");
      };
    }
    if (isGeneratedStructuredReturn(session.return)) {
      if (btnGenerate) {
        btnGenerate.hidden = false;
        btnGenerate.textContent = "Generate";
        btnGenerate.onclick = function (evt) {
          reportButtonClicked(evt);
          generate(period);
        };
      }
    }
  } else {
    if (btnDownload) {
      btnDownload.textContent =
        period.fileCount == 1 ? "Download" : `Download ${period.fileCount} files`;
      btnDownload.hidden = false;
      btnDownload.disabled = !downloadsAllowed;
      btnDownload.onclick = function (evt) {
        reportButtonClicked(evt);
        download(period);
      };
    }

    if (supportsExcelDownloadReturn(session.return)) {
      if (btnDownloadExcel) {
        btnDownloadExcel.hidden = false;
        btnDownloadExcel.disabled = !downloadsAllowed;
        btnDownloadExcel.textContent = "Excel";
        btnDownloadExcel.onclick = function (evt) {
          reportButtonClicked(evt);
          download(period, "excel");
        };
      }
    }
  }

  if (session.return.needsFileGeneration && !isStructuredJsonExcelReturn(session.return)) {
    if (btnGenerate) {
      btnGenerate.hidden = false;
      btnGenerate.onclick = function (evt) {
        reportButtonClicked(evt);
        generate(period);
      };
    }
  }

  if (!downloadsAllowed && divInfo) {
    divInfo.innerHTML = pill(getDownloadValidationState().message, "danger");
  }
}

async function download(period, mode) {
  const isStructured = isStructuredJsonExcelReturn(session.return);
  const btnDownload = isStructured
    ? getElement(`btn-download-${mode === "excel" ? "excel" : "json"}-${period.value}`)
    : isGstr3bReturn(session.return) && mode === "excel"
      ? getElement(`btn-download-excel-${period.value}`)
    : getElement(`btn-download-${period.value}`);
  const divInfo = getElement(`info-${period.value}`);
  if (!enforceDownloadValidation(period, { buttons: [btnDownload] })) {
    btnDownload.disabled = false;
    return;
  }
  btnDownload.disabled = true;

  //GSTR-3B needs special processing
  if (session.return.key == rc("G3B").key) {
    try {
      const gstr3bPayload = await fetchGstr3bJsonPayload(period);
      if (mode === "excel") {
        btnDownload.textContent = "Preparing...";
        const gstinForFile = (gstr3bPayload && gstr3bPayload.data && gstr3bPayload.data.gstin) || session.gstin || "GSTIN";
        const fileName = `${makeJsonFileName("R3B", gstinForFile, period.value)}.xlsx`;
        const workbookXml = buildGstr3bWorkbookXml(gstr3bPayload);
        const blob = await buildXlsxBlobFromWorkbookXml(workbookXml);
        await downloadBlobAs(
          blob,
          fileName,
        );
      } else {
        btnDownload.textContent = "Downloading";
        const jsonData = JSON.stringify(gstr3bPayload.data);
        const gstin = (gstr3bPayload && gstr3bPayload.data && gstr3bPayload.data.gstin) || session.gstin || "GSTIN";
        const jsonfileName = makeJsonFileName("R3B", gstin, period.value);
        const zipfileName = makeZipFileName("R3B", gstin, period.value);
        await saveJsonAsZipAsync(jsonfileName, zipfileName, jsonData);
      }
    } catch (err) {
      btnDownload.textContent = "Failed";
      btnDownload.disabled = false;
      if (divInfo) {
        divInfo.innerHTML = pill(err && err.message ? err.message : "Failed", "danger");
      }
      return;
    }
  }
  // GSTR-1 via e-invoice endpoint (HAR reference)
  else if (session.return.key == rc("G1").key && session.return.useEinvoice && !isStructuredJsonExcelReturn(session.return)) {
    const url = `https://return.gst.gov.in/einvoice/auth/api/geteinvdata?rtn_prd=${period.value}`;
    let msg = await processAsync({ request: "getBlob", url });
    let blobUrl = msg && msg.status ? msg.response : null;

    if (!blobUrl) {
      msg = await processAsync({ request: "get", url });
      if (!msg.status) {
        btnDownload.textContent = "Failed! Retry Download";
        btnDownload.disabled = false;
        if (divInfo) {
          divInfo.innerHTML = pill(extractFailureText(msg, "E-invoice download failed"), "danger");
        }
        return;
      }
      const type = "application/zip";
      blobUrl = URL.createObjectURL(new Blob([msg.response], { type }));
    }

    const zipfileName = makeZipFileName(
      session.return.fileNameCode,
      session.gstin || "GSTIN",
      period.value,
      "EINV",
    ) + ".zip";
    downloadAs(blobUrl, zipfileName);
  }
  // GSTR-2B uses a different host and direct JSON payload
  else if (isStructured) {
    try {
      if (divInfo) {
        divInfo.innerHTML = pill(
          mode === "excel" ? "Preparing Excel..." : "Downloading JSON...",
          "warning",
        );
      }
      if (mode === "excel") {
        btnDownload.textContent = "Preparing...";
        await downloadStructuredReturnExcel(period, btnDownload);
      } else {
        btnDownload.textContent = "Downloading...";
        await downloadStructuredReturnJson(period, btnDownload);
      }
      if (divInfo) {
        divInfo.innerHTML = pill("Downloaded", "success");
      }
    } catch (err) {
      addActivity(
        `${session.return.display} ${mode === "excel" ? "Excel" : "JSON"} download ${err && err.skipRecord ? "skipped" : "failed"} for ${period.value}: ${err.message}`,
        err && err.skipRecord ? "text-warning" : "text-danger",
      );
      btnDownload.textContent = err && err.skipRecord ? "Skipped" : "Failed";
      btnDownload.disabled = false;
      if (divInfo) {
        divInfo.innerHTML = pill(
          err && err.message ? err.message : "Failed",
          err && err.skipRecord ? "warning" : "danger",
        );
      }
      return;
    }
  }
  //all other returns
  else {
  const msgFile = await processAsync({
      request: "get",
      url: gstn.generateFile(session.return, period, false),
    });

    if (!msgFile.status) {
      const why = msgFile.statusCode ? `HTTP ${msgFile.statusCode}` : "No response";
      addActivity(`Download failed for ${session.return.display} ${period.value}: ${why}`, "text-danger");
      btnDownload.textContent = `Failed (${msgFile.statusCode || "?"})`;
      btnDownload.disabled = false;
      return;
    }

    const resp = JSON.parse(msgFile.response);
    const fileGenStatus = getFileGenStatus(resp);

    if (fileGenStatus) {
      btnDownload.textContent = fileGenStatus;
      // If the portal says file is still being generated, surface live banner.
      startGenerationBanner(
        resp && resp.data && resp.data.retry_after
          ? parseInt(resp.data.retry_after)
          : null,
      );
      return;
    }

    for (let i = 0; i < resp.data.url.length; i++) {
      btnDownload.textContent = `Downloading (${i + 1}/${resp.data.url.length})`;

      const zipfileName =
        makeZipFileName(
          session.return.fileNameCode,
          session.gstin,
          period.value,
          session.return.fileTypeCode,
        ) + ".zip";
      saveBlobUrl(zipfileName, resp.data.url[i]);
    }
  }

  btnDownload.textContent = "Done";
  if (divInfo && !isStructured) {
    divInfo.innerHTML = pill("Downloaded", "success");
  }
  stopGenerationBanner();
}

async function generate(period, userMessage) {
  const btnDownload = isStructuredJsonExcelReturn(session.return)
    ? getElement(`btn-download-json-${period.value}`)
    : getElement(`btn-download-${period.value}`);
  const divInfo = getElement(`info-${period.value}`);
  const btnGenerate = isGeneratedStructuredReturn(session.return)
    ? getElement(`btn-generate-${period.value}`)
    : getElement(`btn-gen-${period.value}`);

  if (!btnGenerate) return;
  btnGenerate.textContent = "Requesting...";
  btnGenerate.disabled = true;

  const msgGen = await processAsync({
    request: "get",
    url: gstn.generateFile(session.return, period, true),
  });

  if (!msgGen.status) {
    btnGenerate.textContent = "Failed!";
    btnGenerate.disabled = false;
    return;
  }

  if (btnDownload) btnDownload.hidden = true;
  let retryAfterSec = null;
  try {
    const parsed = JSON.parse(msgGen.response);
    retryAfterSec =
      parsed && parsed.data && parsed.data.retry_after
        ? parseInt(parsed.data.retry_after)
        : null;
  } catch (e) {
    retryAfterSec = null;
  }
  divInfo.textContent = userMessage ? userMessage : "Generating file...";
  startGenerationBanner(retryAfterSec);
}

async function downloadAll() {
  const btnDownloadAll = getElement("btn-download-all");
  if (!enforceDownloadValidation(null, { buttons: [btnDownloadAll] })) return;
  btnDownloadAll.disabled = true;
  btnDownloadAll.textContent = "Downloading...";

  for (let i = 0; i < session.periods.length; i++) {
    if (!session.periods[i].isValid) continue;

    await download(session.periods[i]);
  }

  btnDownloadAll.textContent = "Done";
}

async function downloadAllExcel() {
  const btnDownloadAllExcel = getElement("btn-download-all-excel");
  if (!btnDownloadAllExcel) return;
  if (!enforceDownloadValidation(null, { buttons: [btnDownloadAllExcel] })) return;
  btnDownloadAllExcel.disabled = true;
  btnDownloadAllExcel.textContent = "Preparing Excel...";
  setBulkActionMessage(null);

  try {
    if (isStructuredJsonExcelReturn(session.return)) {
      await downloadAllStructuredReturn("excel");
      return;
    }

    if (!isGstr3bReturn(session.return)) {
      btnDownloadAllExcel.textContent = "Done";
      return;
    }

    const payloads = [];
    const failures = [];
    for (let i = 0; i < session.periods.length; i++) {
      if (!session.periods[i].isValid) continue;
      const period = session.periods[i];
      btnDownloadAllExcel.textContent = `Preparing Excel (${payloads.length + 1})...`;
      try {
        payloads.push(await fetchGstr3bJsonPayload(period));
      } catch (err) {
        failures.push(`${period.value}: ${describeUiError(err, "Failed to fetch data")}`);
      }
    }

    if (!payloads.length) {
      throw new Error(failures[0] || "No periods were ready for Excel download");
    }

    const periodLabels = session.periods
      .filter((p) => p.isValid)
      .map((p) => p.value);
    const periodTag =
      periodLabels.length > 1
        ? `${periodLabels[0]}_to_${periodLabels[periodLabels.length - 1]}`
        : periodLabels[0] || "ALL";
    const combinedGstin = ((payloads[0] && payloads[0].data && payloads[0].data.gstin) || session.gstin || "GSTIN");
    const fileName = `${makeJsonFileName("R3B", combinedGstin, periodTag)}_ALL.xlsx`;
    const workbookXml = buildCombinedGstr3bWorkbookXml(payloads);
    const blob = await buildXlsxBlobFromWorkbookXml(workbookXml);
    await downloadBlobAs(
      blob,
      fileName,
    );
    releaseLargeArray(payloads);
    btnDownloadAllExcel.textContent = "Done";
    if (failures.length) {
      setBulkActionMessage(`Downloaded with issues. ${failures.slice(0, 3).join(" | ")}`, "warning");
    } else {
      setBulkActionMessage("Downloaded all Excel successfully.", "success");
    }
  } catch (err) {
    addActivity(`${session.return.display} consolidated Excel download failed: ${err.message}`, "text-danger");
    btnDownloadAllExcel.textContent = "Failed";
    btnDownloadAllExcel.disabled = false;
    setBulkActionMessage(describeUiError(err, "Excel download failed"), "danger");
  }
}

function getEstimatedHeapUsageBytes() {
  try {
    if (typeof performance !== "undefined" && performance && performance.memory) {
      const used = Number(performance.memory.usedJSHeapSize);
      return Number.isFinite(used) && used > 0 ? used : null;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function computeAdaptiveConcurrencyLimit(baseLimit) {
  const minLimit = 1;
  return Math.max(minLimit, Math.floor(baseLimit));
}

function getAdaptivePressureState() {
  const used = getEstimatedHeapUsageBytes();
  if (!used || !Number.isFinite(used)) return "unknown";
  // No fixed cap. Use relative pressure bands only.
  if (used > 3.2 * 1024 * 1024 * 1024) return "unstable";
  if (used < 1.2 * 1024 * 1024 * 1024) return "stable";
  return "normal";
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  if (!list.length) return results;

  const baseLimit = Math.max(1, Number(limit) || 1);
  let cursor = 0;
  let inFlight = 0;
  let completed = 0;
  let failed = false;
  let resolver = null;
  let rejecter = null;
  let currentLimit = computeAdaptiveConcurrencyLimit(baseLimit);
  let nextAdaptiveCheckAt = 0;
  let pauseUntil = 0;
  let pauseRequested = false;
  let pauseTimer = null;
  let lastGrowthAt = Date.now();
  const stableStepUp = 2;
  const pauseMs = 2000;
  const stableBoostCooldownMs = 2000;

  const updateAdaptiveLimitIfNeeded = () => {
    const now = Date.now();
    if (now < nextAdaptiveCheckAt) return;
    nextAdaptiveCheckAt = now + 300;
    const adaptiveLimit = computeAdaptiveConcurrencyLimit(baseLimit);
    const pressure = getAdaptivePressureState();
    if (pressure === "unstable") {
      pauseRequested = true;
      pauseUntil = now + pauseMs;
      currentLimit = Math.max(1, currentLimit - 2);
      try {
        if (typeof window !== "undefined") window.__neo_gstr1_target_concurrency = currentLimit;
      } catch (err) {
        // ignore
      }
      return;
    }
    if (now - lastGrowthAt >= stableBoostCooldownMs) {
      // Increase every 2s while system is not unstable.
      currentLimit = Math.max(adaptiveLimit, currentLimit + stableStepUp);
      lastGrowthAt = now;
      try {
        if (typeof window !== "undefined") window.__neo_gstr1_target_concurrency = currentLimit;
      } catch (err) {
        // ignore
      }
    }
    currentLimit = Math.max(1, currentLimit);
  };

  const pump = () => {
    if (failed) return;
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    updateAdaptiveLimitIfNeeded();
    if (pauseRequested) {
      const now = Date.now();
      const pressure = getAdaptivePressureState();
      if (now < pauseUntil || pressure === "unstable") {
        pauseTimer = setTimeout(() => pump(), Math.max(20, pauseUntil - now));
        return;
      }
      pauseRequested = false;
      try {
        if (typeof window !== "undefined") window.__neo_gstr1_target_concurrency = currentLimit;
      } catch (err) {
        // ignore
      }
    }
    while (inFlight < currentLimit && cursor < list.length) {
      const index = cursor;
      cursor += 1;
      inFlight += 1;
      try {
        if (typeof window !== "undefined") window.__neo_gstr1_active_tasks = inFlight;
      } catch (err) {
        // ignore
      }
      Promise.resolve(worker(list[index], index))
        .then((value) => {
          results[index] = value;
        })
        .catch((err) => {
          failed = true;
          if (rejecter) rejecter(err);
        })
        .finally(() => {
          inFlight -= 1;
          try {
            if (typeof window !== "undefined") window.__neo_gstr1_active_tasks = inFlight;
          } catch (err) {
            // ignore
          }
          completed += 1;
          if (failed) return;
          if (completed >= list.length) {
            if (pauseTimer) {
              clearTimeout(pauseTimer);
              pauseTimer = null;
            }
            if (resolver) resolver(results);
            return;
          }
          pump();
        });
    }
  };

  await new Promise((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
    pump();
  });
  try {
    if (typeof window !== "undefined") window.__neo_gstr1_active_tasks = 0;
  } catch (err) {
    // ignore
  }
  return results;
}

class SectionBufferManager {
  constructor(config) {
    const cfg = config && typeof config === "object" ? config : {};
    this.cache = cfg.cache || null;
    this.useIndexedDb = !!cfg.useIndexedDb;
    this.dbName = String(cfg.dbName || "gc-returns-pro-section-stage");
    this.dbPromise = null;
    this.basePrefix = String(cfg.basePrefix || "https://gc-returns-pro.local/gstr1/stage");
    this.bufferSize = Math.max(100, Number(cfg.bufferSize) || 2000);
    this.buffers = new Map(); // section -> { columns: {key:[]}, rowCount:number, keys:Set }
    this.sectionOrder = [];
    this.sectionMeta = new Map(); // section -> { chunks, rows }
  }

  isChecksumKey(key) {
    return /(check.?sum|chksum|chksm)$/i.test(String(key || ""));
  }

  normalizeSection(sectionName) {
    return String(sectionName || "").trim();
  }

  chunkKey(sectionName, chunkIndex) {
    return `${this.basePrefix}/sectionname--${encodeURIComponent(sectionName)}/chunk-${chunkIndex}.ndjson`;
  }

  async getDb() {
    if (!this.useIndexedDb || typeof indexedDB === "undefined") return null;
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("chunks")) {
          db.createObjectStore("chunks", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
    return this.dbPromise;
  }

  async idbPut(id, data) {
    const db = await this.getDb();
    if (!db) return false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["chunks"], "readwrite");
      const store = tx.objectStore("chunks");
      store.put({ id, data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB put failed"));
    });
    return true;
  }

  async idbGet(id) {
    const db = await this.getDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["chunks"], "readonly");
      const store = tx.objectStore("chunks");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
    });
  }

  async idbDeletePrefix(prefix) {
    const db = await this.getDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["chunks"], "readwrite");
      const store = tx.objectStore("chunks");
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String(cursor.key || "");
        if (key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete prefix failed"));
    });
  }

  getSections() {
    return this.sectionOrder.slice();
  }

  ensureSection(sectionName) {
    if (!this.buffers.has(sectionName)) {
      this.buffers.set(sectionName, { columns: {}, rowCount: 0, keys: new Set() });
      if (!this.sectionOrder.includes(sectionName)) this.sectionOrder.push(sectionName);
    }
    return this.buffers.get(sectionName);
  }

  async append(sectionName, row) {
    const section = this.normalizeSection(sectionName);
    if (!section || !row || typeof row !== "object") return;
    const bucket = this.ensureSection(section);
    const keys = Object.keys(row).filter((key) => !this.isChecksumKey(key));
    if (!keys.length) return;
    // Dynamic schema support: add missing arrays for new keys and backfill previous rows.
    keys.forEach((key) => {
      if (!bucket.keys.has(key)) {
        bucket.keys.add(key);
        bucket.columns[key] = Array(bucket.rowCount).fill(null);
      }
    });
    bucket.keys.forEach((key) => {
      if (this.isChecksumKey(key)) return;
      if (!Object.prototype.hasOwnProperty.call(bucket.columns, key)) {
        bucket.columns[key] = Array(bucket.rowCount).fill(null);
      }
      bucket.columns[key].push(Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null);
    });
    bucket.rowCount += 1;
    if (bucket.rowCount >= this.bufferSize) {
      await this.flushSection(section);
    }
  }

  async flushSection(sectionName) {
    const section = this.normalizeSection(sectionName);
    if (!section) return;
    const bucket = this.buffers.get(section);
    if (!bucket || !bucket.rowCount) return;
    const keyList = Array.from(bucket.keys);
    const lines = [];
    for (let i = 0; i < bucket.rowCount; i += 1) {
      const row = {};
      for (let k = 0; k < keyList.length; k += 1) {
        const key = keyList[k];
        row[key] = bucket.columns[key] ? bucket.columns[key][i] : null;
      }
      lines.push(JSON.stringify(row));
    }
    const meta = this.sectionMeta.get(section) || { chunks: 0, rows: 0 };
    const chunkIndex = meta.chunks;
    const chunkId = this.chunkKey(section, chunkIndex);
    const payload = lines.join("\n");
    let stored = false;
    if (this.useIndexedDb) {
      stored = await this.idbPut(chunkId, payload);
    }
    if (!stored && this.cache) {
      await this.cache.put(
        chunkId,
        new Response(payload, { headers: { "Content-Type": "application/x-ndjson" } }),
      );
    }
    meta.chunks += 1;
    meta.rows += bucket.rowCount;
    this.sectionMeta.set(section, meta);
    this.buffers.set(section, { columns: {}, rowCount: 0, keys: new Set() });
  }

  async flushAll() {
    for (let i = 0; i < this.sectionOrder.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.flushSection(this.sectionOrder[i]);
    }
  }

  getSectionMeta(sectionName) {
    return this.sectionMeta.get(this.normalizeSection(sectionName)) || { chunks: 0, rows: 0 };
  }

  async readSectionChunkRows(sectionName, chunkIndex) {
    const chunkId = this.chunkKey(sectionName, chunkIndex);
    let text = null;
    if (this.useIndexedDb) {
      text = await this.idbGet(chunkId);
    }
    if (!text && this.cache) {
      const resp = await this.cache.match(chunkId);
      if (resp) text = await resp.text();
    }
    if (!text) return [];
    const rows = [];
    text.split(/\r?\n/).forEach((line) => {
      const raw = String(line || "").trim();
      if (!raw) return;
      try {
        rows.push(JSON.parse(raw));
      } catch (err) {
        // ignore malformed line
      }
    });
    return rows;
  }

  async clearAll() {
    if (this.useIndexedDb) {
      await this.idbDeletePrefix(this.basePrefix);
    }
    if (this.cache) {
      const keys = await this.cache.keys();
      const prefix = this.basePrefix;
      await Promise.all(keys.filter((req) => String(req && req.url || "").includes(prefix)).map((req) => this.cache.delete(req)));
    }
    this.buffers.clear();
    this.sectionMeta.clear();
    this.sectionOrder.length = 0;
  }
}

function buildGstr1BulkCacheKey(periodValue) {
  return `https://gc-returns-pro.local/gstr1-bulk/${encodeURIComponent(String(periodValue || ""))}.json`;
}

async function downloadAllStructuredReturn(mode) {
  const btn = getElement(mode === "excel" ? "btn-download-all-excel" : "btn-download-all-json");
  if (!btn) return;
  if (!enforceDownloadValidation(null, { buttons: [btn] })) return;
  btn.disabled = true;
  btn.textContent = mode === "excel" ? "Downloading Excel..." : "Downloading JSON...";
  setBulkActionMessage(null);

  if (mode === "excel") {
    const failures = [];
    const notices = [];
    try {
      let workbookState = null;
      const validPeriods = session.periods.filter((p) => p.isValid);
      if (isGstr1Return(session.return)) {
        workbookState = createGstr1WorkbookState({
          maxWorksheetRows: XLSX_MAX_WORKSHEET_DATA_ROWS,
          lightweightMode: true,
        });
        const hsnAccumulator = createGstr1HsnBulkAccumulator();
        let appendedCount = 0;
        for (let i = 0; i < validPeriods.length; i++) {
          const period = validPeriods[i];
          btn.textContent = `Preparing Excel (${i + 1}/${validPeriods.length})...`;
          try {
            const payload = await fetchStructuredReturnJsonPayload(session.return, period);
            if (!payload) continue;
            const normalizedPayload =
              payload && payload.__gstr1SectionsConsolidated
                ? payload
                : consolidateGstr1PayloadSections(payload);
            appendGstr1MetaToWorkbookState(workbookState, normalizedPayload);
            const meta = extractWorkbookMeta(normalizedPayload);
            const reportPeriod = meta.rtnprd || period.value || "";
            const sections = buildGstr1CombinedSections(normalizedPayload, reportPeriod);
            for (let s = 0; s < sections.length; s += 1) {
              const section = sections[s] || {};
              if (!section || !section.name) continue;
              if (isGstr1HsnSectionName(section.name)) {
                const rows = Array.isArray(section.rows) ? section.rows : [];
                for (let r = 0; r < rows.length; r += 1) {
                  upsertHsnAggregates(hsnAccumulator, rows[r] || {});
                }
                // eslint-disable-next-line no-await-in-loop
                await spillHsnAccumulatorIfNeeded(hsnAccumulator, false);
              } else {
                appendRowsToGstr1WorkbookState(workbookState, section.name, section.rows || []);
              }
            }
            appendedCount += 1;
          } catch (err) {
            if (err && err.skipRecord && err.summaryPayload) {
              notices.push(`${period.value}: ${describeUiError(err, "Skipped")}`);
              const normalizedPayload =
                err.summaryPayload && err.summaryPayload.__gstr1SectionsConsolidated
                  ? err.summaryPayload
                  : consolidateGstr1PayloadSections(err.summaryPayload);
              appendGstr1MetaToWorkbookState(workbookState, normalizedPayload);
              const meta = extractWorkbookMeta(normalizedPayload);
              const reportPeriod = meta.rtnprd || period.value || "";
              const sections = buildGstr1CombinedSections(normalizedPayload, reportPeriod);
              for (let s = 0; s < sections.length; s += 1) {
                const section = sections[s] || {};
                if (!section || !section.name) continue;
                if (isGstr1HsnSectionName(section.name)) {
                  const rows = Array.isArray(section.rows) ? section.rows : [];
                  for (let r = 0; r < rows.length; r += 1) {
                    upsertHsnAggregates(hsnAccumulator, rows[r] || {});
                  }
                  // eslint-disable-next-line no-await-in-loop
                  await spillHsnAccumulatorIfNeeded(hsnAccumulator, false);
                } else {
                  appendRowsToGstr1WorkbookState(workbookState, section.name, section.rows || []);
                }
              }
              appendedCount += 1;
            } else {
              failures.push(`${period.value}: ${describeUiError(err, "Failed to fetch data")}`);
            }
          }
        }

        btn.textContent = "Finalizing HSN...";
        const finalHsn = await finalizeGstr1HsnAccumulator(hsnAccumulator);
        if (finalHsn.hsnRows && finalHsn.hsnRows.length) {
          appendRowsToGstr1WorkbookState(workbookState, "HSN", finalHsn.hsnRows);
        }
        if (finalHsn.periodRows && finalHsn.periodRows.length) {
          appendRowsToGstr1WorkbookState(workbookState, "HSN0PERIODWISE", finalHsn.periodRows);
        }

        if (!appendedCount) {
          throw new Error(failures[0] || "No periods were ready for Excel download");
        }
      } else {
        for (let i = 0; i < session.periods.length; i++) {
          if (!session.periods[i].isValid) continue;
          const period = session.periods[i];
          btn.textContent = `Preparing Excel (${i + 1})...`;
          try {
            const payload = await fetchStructuredReturnJsonPayload(session.return, period);
            if (!workbookState) workbookState = [];
            workbookState.push(payload);
          } catch (err) {
            if (err && err.skipRecord && err.summaryPayload) {
              notices.push(`${period.value}: ${describeUiError(err, "Skipped")}`);
              if (!workbookState) workbookState = [];
              workbookState.push(err.summaryPayload);
            } else {
              failures.push(`${period.value}: ${describeUiError(err, "Failed to fetch data")}`);
            }
          }
        }
      }

      if (!workbookState || (Array.isArray(workbookState) && !workbookState.length)) {
        throw new Error(failures[0] || "No periods were ready for Excel download");
      }

      const periodLabels = session.periods
        .filter((p) => p.isValid)
        .map((p) => p.value);
      const periodTag =
        periodLabels.length > 1
          ? `${periodLabels[0]}_to_${periodLabels[periodLabels.length - 1]}`
          : periodLabels[0] || "ALL";
      const fileName = `${makeJsonFileName(session.return.fileNameCode, session.gstin || "GSTIN", periodTag)}_ALL.xlsx`;
      if (isGstr1Return(session.return)) {
        btn.textContent = "Writing Excel...";
        const blob = await buildGstr1WorkbookXlsxBlob(workbookState, { compression: true, useWorker: true });
        await downloadBlobAs(blob, fileName);
      } else if (isGstr2bReturn(session.return)) {
        const blob = await buildCombinedGstr2bWorkbookXlsxBlob(workbookState);
        await downloadBlobAs(blob, fileName);
      } else if (isGstr2aReturn(session.return)) {
        const blob = await buildCombinedGstr2aWorkbookXlsxBlob(workbookState);
        await downloadBlobAs(blob, fileName);
      } else {
        const workbookXml = isGstr2bReturn(session.return)
          ? buildCombinedGstr2bWorkbookXml(workbookState)
          : isGstr2aReturn(session.return)
            ? buildCombinedGstr2aWorkbookXml(workbookState)
            : buildCombinedGenericWorkbookXml(workbookState);
        await downloadBlobAs(
          new Blob([workbookXml], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          fileName,
        );
      }
      if (Array.isArray(workbookState)) {
        releaseLargeArray(workbookState);
      }
      workbookState = null;
      btn.textContent = "Done";
      if (failures.length || notices.length) {
        const issues = failures.concat(notices).slice(0, 3).join(" | ");
        setBulkActionMessage(
          failures.length ? `Downloaded with issues. ${issues}` : `Downloaded with skips. ${issues}`,
          "warning",
        );
      } else {
        setBulkActionMessage(`Downloaded ${mode.toUpperCase()} for all ready periods.`, "success");
      }
      return;
    } catch (err) {
      addActivity(`${session.return.display} consolidated Excel download failed: ${err.message}`, "text-danger");
      btn.textContent = "Failed";
      btn.disabled = false;
      setBulkActionMessage(describeUiError(err, "Excel download failed"), "danger");
      return;
    }
  }

  for (let i = 0; i < session.periods.length; i++) {
    if (!session.periods[i].isValid) continue;
    await download(session.periods[i], mode);
  }

  btn.textContent = "Done";
}

async function generateAll() {
  const btnDownloadAll = getElement("btn-download-all");
  if (btnDownloadAll) btnDownloadAll.hidden = true;

  const btnGenAll = getElement("btn-gen-all");
  if (!btnGenAll) return;
  btnGenAll.disabled = true;
  btnGenAll.textContent = "Requesting...";

  for (let i = 0; i < session.periods.length; i++) {
    await generate(session.periods[i]);
  }

  btnGenAll.textContent = "Done";
}

// Ledger downloads (HAR v2)
function splitLedgerRange(cfg, fromDate, toDate) {
  const ranges = [];
  if (cfg && cfg.format === "MMYYYY") {
    let startMonth = moment(fromDate, ["YYYY-MM-DD", "YYYY-MM"], true).startOf("month");
    let endMonth = moment(toDate, ["YYYY-MM-DD", "YYYY-MM"], true).startOf("month");
    const registrationBound = getRegistrationBoundDate(cfg);
    const todayBound = moment().startOf("month");
    if (registrationBound && startMonth.isBefore(registrationBound, "month")) {
      startMonth = registrationBound.clone();
    }
    if (registrationBound && endMonth.isBefore(registrationBound, "month")) {
      endMonth = registrationBound.clone();
    }
    if (endMonth.isAfter(todayBound, "month")) {
      endMonth = todayBound.clone();
    }
    if (!startMonth.isValid() || !endMonth.isValid() || startMonth.isAfter(endMonth, "month")) {
      return ranges;
    }
    let cursor = startMonth.clone();
    while (cursor.isSameOrBefore(endMonth, "month")) {
      const chunkEnd = cursor.clone().add(5, "months").endOf("month");
      const end = chunkEnd.isAfter(endMonth, "month") ? endMonth.clone().endOf("month") : chunkEnd;
      ranges.push({
        from: cursor.format("YYYY-MM-DD"),
        to: end.format("YYYY-MM-DD"),
      });
      cursor = end.clone().add(1, "day").startOf("month");
    }
    return ranges;
  }

  let startDate = moment(fromDate, "YYYY-MM-DD", true);
  let endDate = moment(toDate, "YYYY-MM-DD", true);
  const registrationBound = getRegistrationBoundDate(cfg);
  const todayBound = moment().endOf("day");
  if (registrationBound && startDate.isBefore(registrationBound, "day")) {
    startDate = registrationBound.clone();
  }
  if (registrationBound && endDate.isBefore(registrationBound, "day")) {
    endDate = registrationBound.clone();
  }
  if (endDate.isAfter(todayBound, "day")) {
    endDate = todayBound.clone();
  }
  if (!startDate.isValid() || !endDate.isValid() || startDate.isAfter(endDate, "day")) {
    return ranges;
  }
  let cursor = startDate.clone();
  while (cursor.isSameOrBefore(endDate, "day")) {
    const chunkEnd = cursor.clone().add(1, "year").subtract(1, "day");
    const end = chunkEnd.isAfter(endDate, "day") ? endDate.clone() : chunkEnd;
    ranges.push({
      from: cursor.format("YYYY-MM-DD"),
      to: end.format("YYYY-MM-DD"),
    });
    cursor = end.clone().add(1, "day");
  }
  return ranges;
}


function buildItcLedgerWorkbookXml(parsedRows) {
  const summaryRows = [];
  const entryRows = [];

  (parsedRows || []).forEach((entry, index) => {
    summaryRows.push({
      chunk_no: index + 1,
      from_date: entry && entry.fr_dt ? entry.fr_dt : "",
      to_date: entry && entry.to_dt ? entry.to_dt : "",
      gstin: entry && entry.gstin ? entry.gstin : "",
      rows: entry && Array.isArray(entry.tr) ? entry.tr.length : 0,
    });
    (entry && Array.isArray(entry.tr) ? entry.tr : []).forEach((row) => {
      entryRows.push({
        fr_dt: entry.fr_dt || "",
        to_dt: entry.to_dt || "",
        gstin: entry.gstin || "",
        ...(row || {}),
      });
    });
  });

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", summaryRows, ["chunk_no", "from_date", "to_date", "gstin", "rows"])}
 ${buildSpreadsheetWorksheet("ITC Ledger", entryRows, ["fr_dt", "to_dt", "gstin"])}
</Workbook>`;
}

function decodeDataUrlPayload(text) {
  if (typeof text !== "string" || !text.trim().startsWith("data:")) return text;
  const commaIdx = text.indexOf(",");
  const payload = commaIdx >= 0 ? text.substring(commaIdx + 1) : "";
  try {
    return decodeURIComponent(payload);
  } catch (e) {
    return payload;
  }
}

async function resolveLedgerChunkPayload(cfg, chunk) {
  await ensureConnectedToHost(getLedgerHost(cfg));
  const requestChunk = async (activeChunk) => {
    const chunkUrl = buildLedgerUrl(cfg, activeChunk.from, activeChunk.to);
    addActivity(`${cfg.display} request: ${chunkUrl}`, "text-muted");
    const msg = await processAsync({ request: "get", url: chunkUrl });
    if (!msg || !msg.status || !msg.response) {
      throw new Error(msg && msg.statusCode ? `HTTP ${msg.statusCode}` : "Failed");
    }

    const text = msg.response;
    const decodedText = decodeDataUrlPayload(text);
    let parsed = null;
    try {
      parsed = JSON.parse(decodedText);
    } catch (e) {
      parsed = null;
    }

    if (
      parsed &&
      (parsed.status_cd === "0" ||
        parsed.status === 0 ||
        parsed.status === "0" ||
        parsed.success === false ||
        parsed.error)
    ) {
      const message = getOtherResponseMessage(parsed, "Ledger request failed");
      throw new Error(message);
    }

    if (parsed) {
      const fileUrl = getImsOutDownloadUrl(parsed);
      const fileNum =
        (parsed &&
          parsed.data &&
          (parsed.data.file_num || parsed.data.fileNo || parsed.data.fileNum)) ||
        parsed.file_num ||
        parsed.fileNo ||
        parsed.fileNum ||
        null;
      if (fileUrl) {
        const fileTextMsg = await processAsync({ request: "get", url: fileUrl });
        if (fileTextMsg && fileTextMsg.status && fileTextMsg.response) {
          return {
            chunk: activeChunk,
            parsed,
            text: decodeDataUrlPayload(fileTextMsg.response),
          };
        }
      } else if (fileNum && cfg.downloadBase) {
        const downloadUrl = withParams(cfg.downloadBase, [["file_num", fileNum]]);
        const fileTextMsg = await processAsync({ request: "get", url: downloadUrl });
        if (fileTextMsg && fileTextMsg.status && fileTextMsg.response) {
          return {
            chunk: activeChunk,
            parsed,
            text: decodeDataUrlPayload(fileTextMsg.response),
          };
        }
      }
    }

    return {
      chunk: activeChunk,
      parsed,
      text: decodedText,
    };
  };

  try {
    return await requestChunk(chunk);
  } catch (error) {
    const message = error && error.message ? error.message : "";
    const needsRegistrationRetry = /before date of registration/i.test(message);
    const registrationBound = getRegistrationBoundDate(cfg);
    if (!needsRegistrationRetry || !registrationBound) {
      throw error;
    }
    const retriedChunk = {
      from: moment.max(
        moment(chunk.from, "YYYY-MM-DD", true),
        registrationBound.clone(),
      ).format("YYYY-MM-DD"),
      to: chunk.to,
    };
    if (moment(retriedChunk.to, "YYYY-MM-DD", true).isBefore(moment(retriedChunk.from, "YYYY-MM-DD", true), "day")) {
      retriedChunk.to = retriedChunk.from;
    }
    addActivity(
      `${cfg.display} auto-adjusted to registration date: ${retriedChunk.from} to ${retriedChunk.to}`,
      "text-muted",
    );
    return requestChunk(retriedChunk);
  }
}

function buildGenericLedgerWorkbookXml(cfg, chunkPayloads) {
  const summaryRows = [];
  const rawFlattenedRows = [];
  const textRows = [];
  const dataRows = [];

  const flattenCashLedgerValue = (value, prefix, output) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (!value.length) {
        output[prefix] = "";
        return;
      }
      value.forEach((item, index) => {
        flattenCashLedgerValue(item, `${prefix}_${index + 1}`, output);
      });
      return;
    }
    if (typeof value === "object") {
      Object.keys(value).forEach((key) => {
        const nextPrefix = prefix ? `${prefix}_${key}` : key;
        flattenCashLedgerValue(value[key], nextPrefix, output);
      });
      return;
    }
    output[prefix] = value;
  };

  (chunkPayloads || []).forEach((entry, index) => {
    summaryRows.push({
      chunk_no: index + 1,
      from_date: entry.chunk.from,
      to_date: entry.chunk.to,
      payload_type: entry.parsed ? "json" : "text",
    });
    if (entry.parsed) {
      buildRawFlattenedRows(entry.parsed, false, "").forEach((row) => {
        rawFlattenedRows.push({
          chunk_no: index + 1,
          from_date: entry.chunk.from,
          to_date: entry.chunk.to,
          field: row.field,
          value: row.value,
        });
      });
    }
    if (entry.parsed) {
      if (cfg && cfg.key === "CASH_LED" && Array.isArray(entry.parsed.tr)) {
        entry.parsed.tr.forEach((row, rowIndex) => {
          const out = {
            chunk_no: index + 1,
            row_no: rowIndex + 1,
            from_date: entry.chunk.from,
            to_date: entry.chunk.to,
            gstin: entry.parsed.gstin || session.gstin || "",
          };
          Object.keys(row || {}).forEach((key) => {
            flattenCashLedgerValue(row[key], key, out);
          });
          dataRows.push(out);
        });
      } else {
        const source =
          Array.isArray(entry.parsed)
            ? entry.parsed
            : entry.parsed && entry.parsed.data && Array.isArray(entry.parsed.data)
              ? entry.parsed.data
              : entry.parsed && entry.parsed.data && Array.isArray(entry.parsed.data.list)
                ? entry.parsed.data.list
                : entry.parsed && entry.parsed.data && Array.isArray(entry.parsed.data.challans)
                  ? entry.parsed.data.challans
                  : [];
        source.forEach((row, rowIndex) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return;
          dataRows.push({
            chunk_no: index + 1,
            row_no: rowIndex + 1,
            from_date: entry.chunk.from,
            to_date: entry.chunk.to,
            ...(row || {}),
          });
        });
      }
    }
    if (entry.text) {
      String(entry.text)
        .split(/\r?\n/)
        .forEach((line, lineIndex) => {
          if (!line && !lineIndex) return;
          textRows.push({
            chunk_no: index + 1,
            from_date: entry.chunk.from,
            to_date: entry.chunk.to,
            line_no: lineIndex + 1,
            text: line,
          });
        });
    }
  });

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
 <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E8FB" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", summaryRows, ["chunk_no", "from_date", "to_date", "payload_type"])}
 ${buildSpreadsheetWorksheet("Data", dataRows, ["chunk_no", "row_no", "from_date", "to_date"])}
 ${buildSpreadsheetWorksheet("Raw Flattened", rawFlattenedRows, ["chunk_no", "from_date", "to_date", "field", "value"], { hidden: true })}
 ${buildSpreadsheetWorksheet("Raw Text", textRows, ["chunk_no", "from_date", "to_date", "line_no", "text"], { hidden: true })}
</Workbook>`;
}

function buildLedgerConsolidatedJsonPayload(cfg, chunkPayloads, from, to) {
  const consolidated = {
    key: cfg.key,
    display: cfg.display,
    gstin: session.gstin || "",
    from,
    to,
    chunks: [],
    data: [],
    raw: [],
  };

  (chunkPayloads || []).forEach((entry, index) => {
    consolidated.chunks.push({
      chunk_no: index + 1,
      from_date: entry && entry.chunk ? entry.chunk.from : "",
      to_date: entry && entry.chunk ? entry.chunk.to : "",
      payload_type: entry && entry.parsed ? "json" : "text",
    });
    if (entry && entry.parsed !== null && entry.parsed !== undefined) {
      consolidated.raw.push(entry.parsed);
      if (Array.isArray(entry.parsed)) {
        consolidated.data = consolidated.data.concat(entry.parsed);
      } else if (entry.parsed.data && Array.isArray(entry.parsed.data)) {
        consolidated.data = consolidated.data.concat(entry.parsed.data);
      } else if (entry.parsed.data && Array.isArray(entry.parsed.data.list)) {
        consolidated.data = consolidated.data.concat(entry.parsed.data.list);
      } else if (entry.parsed.data && Array.isArray(entry.parsed.data.challans)) {
        consolidated.data = consolidated.data.concat(entry.parsed.data.challans);
      } else {
        consolidated.data.push(entry.parsed);
      }
    } else if (entry && entry.text) {
      consolidated.raw.push(entry.text);
    }
  });

  return consolidated;
}

function buildChallanWorkbookXml(consolidated) {
  const summaryRows = [
    { field: "gstin", value: consolidated.gstin || "" },
    { field: "from", value: consolidated.from || "" },
    { field: "to", value: consolidated.to || "" },
    { field: "chunks", value: (consolidated.chunks || []).length },
    { field: "rows", value: (consolidated.data || []).length },
  ];
  const chunkRows = (consolidated.chunks || []).map((row) => ({ ...(row || {}) }));
  const dataRows = (consolidated.data || []).map((row, index) => ({
    row_no: index + 1,
    ...(row || {}),
  }));
  const rawRows = [];
  (consolidated.raw || []).forEach((row, index) => {
    rawRows.push({
      chunk_no: index + 1,
      json: JSON.stringify(row == null ? "" : row),
    });
  });

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E8FB" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${buildSpreadsheetWorksheet("Summary", summaryRows, ["field", "value"])}
 ${buildSpreadsheetWorksheet("Chunks", chunkRows, ["chunk_no", "from_date", "to_date", "payload_type"])}
 ${buildSpreadsheetWorksheet("Challans", dataRows, ["row_no"])}
 ${buildSpreadsheetWorksheet("Raw JSON", rawRows, ["chunk_no", "json"], { hidden: true })}
</Workbook>`;
}

function buildLedgerUrl(cfg, fromDate, toDate) {
  const base = cfg.generateBase || cfg.base;
  const url = new URL(base);
  url.searchParams.set(cfg.fromParam || "fdate", formatLedgerDate(fromDate, cfg.format));
  url.searchParams.set(cfg.toParam || "tdate", formatLedgerDate(toDate, cfg.format));
  if (cfg.needsGstinParam) {
    url.searchParams.set("gstin", session.gstin || "");
  }
  // extra params from HAR for payment api
  if (cfg.key === "LIAB_PAY") {
    url.searchParams.set("staystatus", "");
    url.searchParams.set("demandid", "");
  }
  return url.toString();
}

function getLedgerHost(cfg) {
  try {
    return new URL((cfg && (cfg.generateBase || cfg.base)) || "https://payment.gst.gov.in").hostname.toLowerCase();
  } catch (e) {
    return "payment.gst.gov.in";
  }
}

async function updateWorkspaceForLedger() {
  const divStatus = getElement("returnStatus");
  const cfg = ledgerConfig[getElement("gstReturnType").value];
  if (cfg) {
    await ensureConnectedToHost(getLedgerHost(cfg));
  }
  const fromInput = getElement("ledgerDateFrom");
  const toInput = getElement("ledgerDateTo");
  const minValue = getLedgerInputMinValue(cfg);
  const maxValue = getLedgerInputMaxValue(cfg);
  if (fromInput) fromInput.min = minValue;
  if (toInput) toInput.min = minValue;
  if (fromInput) fromInput.max = maxValue;
  if (toInput) toInput.max = maxValue;
  const from = fromInput.value;
  const to = toInput.value;
  const effectiveRange = getEffectiveLedgerRange(cfg, from, to);
  const previewFrom = effectiveRange.isValid ? effectiveRange.from : from;
  const previewTo = effectiveRange.isValid ? effectiveRange.to : to;

  if (!cfg) {
    divStatus.innerHTML = `<div class="alert alert-warning">Select a ledger type.</div>`;
    return;
  }
  if (!from || !to) {
    divStatus.innerHTML = `<div class="alert alert-warning">Select a date range for ledger download.</div>`;
    return;
  }

  divStatus.innerHTML = `<div class="row"><table class="table table-bordered table-sm table-status"><tr><th>Ledger</th><th>From</th><th>To</th><th>JSON</th><th>Excel</th></tr><tr><td>${cfg.display}</td><td>${previewFrom}</td><td>${previewTo}</td><td class="text-center"><button class="btn btn-success btn-sm" id="btn-ledger-json"><strong>JSON</strong></button></td><td class="text-center"><button class="btn btn-primary btn-sm" id="btn-ledger-excel"><strong>Excel</strong></button></td></tr><tr><td colspan="5" id="ledger-status"><span class="pill muted">Ready</span></td></tr></table></div>`;

  const btnJson = getElement("btn-ledger-json");
  const btnExcel = getElement("btn-ledger-excel");
  btnJson.onclick = function (evt) {
    reportButtonClicked(evt);
    const liveFrom = getElement("ledgerDateFrom") ? getElement("ledgerDateFrom").value : from;
    const liveTo = getElement("ledgerDateTo") ? getElement("ledgerDateTo").value : to;
    downloadLedger(cfg, liveFrom, liveTo, "json");
  };
  btnExcel.onclick = function (evt) {
    reportButtonClicked(evt);
    const liveFrom = getElement("ledgerDateFrom") ? getElement("ledgerDateFrom").value : from;
    const liveTo = getElement("ledgerDateTo") ? getElement("ledgerDateTo").value : to;
    downloadLedger(cfg, liveFrom, liveTo, "excel");
  };
}

async function downloadLedger(cfg, from, to, mode) {
  await ensureConnectedToHost(getLedgerHost(cfg));
  const btnJson = getElement("btn-ledger-json");
  const btnExcel = getElement("btn-ledger-excel");
  const statusCell = getElement("ledger-status");
  const activeMode = mode === "json" ? "json" : "excel";
  const activeBtn = activeMode === "json" ? btnJson : btnExcel;
  const requestedFrom = from;
  const requestedTo = to;
  const effectiveRange = getEffectiveLedgerRange(cfg, from, to);
  if (!effectiveRange.isValid) {
    statusCell.innerHTML = pill("Invalid date range", "danger");
    if (btnJson) btnJson.disabled = false;
    if (btnExcel) btnExcel.disabled = false;
    return;
  }
  from = effectiveRange.from;
  to = effectiveRange.to;
  if (btnJson) btnJson.disabled = true;
  if (btnExcel) btnExcel.disabled = true;
  if (activeBtn) activeBtn.textContent = activeMode === "json" ? "Downloading..." : "Preparing...";
  const adjusted =
    String(requestedFrom || "") !== String(from || "") || String(requestedTo || "") !== String(to || "");
  statusCell.innerHTML = pill(adjusted ? `${activeMode === "json" ? "Downloading" : "Preparing"} (using ${from} to ${to})` : activeMode === "json" ? "Downloading JSON" : "Preparing Excel", "warning");

  const chunks = splitLedgerRange(cfg, from, to);
  if (!chunks.length) {
    statusCell.innerHTML = pill("Invalid date range", "danger");
    if (btnJson) btnJson.disabled = false;
    if (btnExcel) btnExcel.disabled = false;
    return;
  }

  if (cfg.key === "ITC_LED") {
    try {
      const parsedRows = [];
      for (const chunk of chunks) {
        const chunkPayload = await resolveLedgerChunkPayload(cfg, chunk);
        if (!chunkPayload.parsed || !Array.isArray(chunkPayload.parsed.tr)) {
          throw new Error(getOtherResponseMessage(chunkPayload.parsed, "Invalid ITC ledger response"));
        }
        parsedRows.push(chunkPayload.parsed);
      }
      const fromStr = formatLedgerDate(from, cfg.format);
      const toStr = formatLedgerDate(to, cfg.format);
      if (activeMode === "json") {
        const consolidated = buildLedgerConsolidatedJsonPayload(
          cfg,
          parsedRows.map((row, index) => ({ chunk: chunks[index], parsed: row, text: null })),
          fromStr,
          toStr,
        );
        const blobUrl = URL.createObjectURL(
          new Blob([JSON.stringify(consolidated, null, 2)], { type: "application/json" }),
        );
        const fname = makeNamedRangeExportFileName(cfg, fromStr, toStr, "json");
        downloadAs(blobUrl, fname);
      } else {
        const workbookXml = buildItcLedgerWorkbookXml(parsedRows);
        const blobUrl = URL.createObjectURL(
          new Blob([workbookXml], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        );
        const fname = makeNamedRangeExportFileName(cfg, fromStr, toStr, "xls");
        downloadAs(blobUrl, fname);
      }
      statusCell.innerHTML = pill("Done", "success");
      if (activeBtn) activeBtn.textContent = "Done";
      return;
    } catch (e) {
      statusCell.innerHTML = pill(e && e.message ? e.message : "Failed", "danger");
      if (btnJson) {
        btnJson.disabled = false;
        btnJson.textContent = "JSON";
      }
      if (btnExcel) {
        btnExcel.disabled = false;
        btnExcel.textContent = "Excel";
      }
      return;
    }
  }
  try {
    const chunkPayloads = [];
    for (const chunk of chunks) {
      chunkPayloads.push(await resolveLedgerChunkPayload(cfg, chunk));
    }
    const fromStr = formatLedgerDate(from, cfg.format);
    const toStr = formatLedgerDate(to, cfg.format);
    if (activeMode === "json") {
      const consolidated = buildLedgerConsolidatedJsonPayload(cfg, chunkPayloads, fromStr, toStr);
      const blobUrl = URL.createObjectURL(
        new Blob([JSON.stringify(consolidated, null, 2)], { type: "application/json" }),
      );
      const fname = makeNamedRangeExportFileName(cfg, fromStr, toStr, "json");
      downloadAs(blobUrl, fname);
    } else {
      const workbookXml = buildGenericLedgerWorkbookXml(cfg, chunkPayloads);
      const blobUrl = URL.createObjectURL(
        new Blob([workbookXml], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const fname = makeNamedRangeExportFileName(cfg, fromStr, toStr, "xls");
      downloadAs(blobUrl, fname);
    }
    statusCell.innerHTML = pill("Done", "success");
    if (activeBtn) activeBtn.textContent = "Done";
  } catch (e) {
    statusCell.innerHTML = pill(e && e.message ? e.message : "Failed", "danger");
    if (btnJson) {
      btnJson.disabled = false;
      btnJson.textContent = "JSON";
    }
    if (btnExcel) {
      btnExcel.disabled = false;
      btnExcel.textContent = "Excel";
    }
  }
}

// Other endpoints (HAR v3)
async function updateWorkspaceForOther() {
  const divStatus = getElement("returnStatus");
  const cfg = otherConfig[getElement("gstReturnType").value];
  if (cfg && cfg.summaryType) {
    session.return = cfg;
    await updateWorkspaceForSummary();
    return;
  }
  const ledgerWrap = getElement("ledgerDateWrap");
  const returnWrap = getElement("returnPeriodWrap");
  const finWrap = getElement("finYearWrap");
  const toggleBtn = getElement("toggleCustomBtn");

  const imsMode = cfg && (cfg.key === "IMS_IN" || cfg.key === "IMS_OUT");
  const imsOut = cfg && cfg.key === "IMS_OUT";
  const needsDateRange = cfg && cfg.key === "CHALLAN_LIST";
  if (ledgerWrap) ledgerWrap.hidden = !needsDateRange;
  if (returnWrap) returnWrap.hidden = needsDateRange ? true : imsOut ? false : true;
  if (finWrap) finWrap.hidden = imsOut ? false : imsMode ? true : false; // show periods for IMS Outward
  if (toggleBtn) {
    toggleBtn.hidden = needsDateRange || imsMode;
    if (needsDateRange || imsMode) toggleBtn.style.display = "none";
  }
  const workspace = getElement("workspace");
  if (workspace) workspace.hidden = false;

  // Ensure date inputs have defaults when shown.
  if (needsDateRange && ledgerWrap && !ledgerWrap.hidden) {
    const lf = getElement("ledgerDateFrom");
    const lt = getElement("ledgerDateTo");
    if (lf && !lf.value) lf.value = moment().subtract(30, "days").format("YYYY-MM-DD");
    if (lt && !lt.value) lt.value = moment().format("YYYY-MM-DD");
  }

  if (!cfg) {
    divStatus.innerHTML = `<div class="alert alert-warning">Select an option to download.</div>`;
    return;
  }

  if (imsMode && imsOut) {
    // Ensure custom period bounds exist to build month list
    session.useCustomPeriods = true;
    const selFrom = getElement("periodFrom");
    const selTo = getElement("periodTo");
    if (selFrom && selFrom.value) {
      session.periodFrom = selFrom.value;
    }
    if (typeof rebuildPeriodToOptions === "function") rebuildPeriodToOptions();
    if (selTo && selTo.value && selTo.querySelector(`option[value="${selTo.value}"]`)) {
      session.periodTo = selTo.value;
    }
    if (selFrom && !selFrom.value && selFrom.options.length) {
      session.periodFrom = selFrom.options[0].value;
      selFrom.value = session.periodFrom;
    }
    if (selTo && !selTo.value && selTo.options.length) {
      session.periodTo = selTo.options[selTo.options.length - 1].value;
      selTo.value = session.periodTo;
    }
    if (selTo && !session.periodTo && selTo.value) {
      session.periodTo = selTo.value;
    }
    await updatePeriods();
    // IMS Outward: period-wise table like GSTR-1
    let rows = [];
    if (session.dropdown && Array.isArray(session.dropdown.Years)) {
      const fromVal = periodKey(session.periodFrom);
      const toVal = periodKey(session.periodTo);
      session.dropdown.Years.forEach((yearGroup) => {
        (yearGroup.months || []).forEach((month) => {
          const valueKey = periodKey(month.value);
          if (fromVal && valueKey !== null && valueKey < fromVal) return;
          if (toVal && valueKey !== null && valueKey > toVal) return;
          rows.push({
            ...month,
            year: yearGroup.year,
          });
        });
      });
      rows.sort((a, b) => periodKey(a.value) - periodKey(b.value));
    }
    if (!rows.length) {
      // synthesize months only within selected From/To range
      const months = [];
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const fromVal = session.periodFrom || moment().startOf("year").format("MMYYYY");
      const toVal = session.periodTo || moment().endOf("year").format("MMYYYY");
      const fromDate = moment(fromVal, "MMYYYY");
      const toDate = moment(toVal, "MMYYYY");
      if (fromDate.isValid() && toDate.isValid() && !fromDate.isAfter(toDate)) {
        const cursor = fromDate.clone();
        while (cursor.isSameOrBefore(toDate, "month")) {
          const mm = cursor.format("MM");
          const yy = cursor.format("YYYY");
          months.push({ month: names[cursor.month()], value: `${mm}${yy}`, year: yy });
          cursor.add(1, "month");
        }
      } else {
        // fallback to just the from month if invalid
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yy = String(d.getFullYear());
        months.push({ month: names[d.getMonth()], value: `${mm}${yy}`, year: yy });
      }
      rows = months;
    }
    let rowsHtml = "";
    rows.forEach((p) => {
      const label =
        p.value && p.value.length >= 6
          ? `${p.value.substring(0, 2)}/${p.value.substring(2)}`
          : p.value || "-";
      rowsHtml += `<tr><td class="align-middle">${label}</td><td class="align-middle"><div id="info-${p.value}"><span class="pill muted">Ready</span></div></td><td class="align-middle text-center"><button type="button" class="btn btn-warning btn-sm" id="btn-other-gen-${p.value}" data-fp="${p.value}">Generate</button></td><td class="align-middle text-center"><button type="button" class="btn btn-success btn-sm" id="btn-other-dl-${p.value}" data-fp="${p.value}">Download</button></td></tr>`;
    });
    if (!rowsHtml) rowsHtml = `<tr><td colspan="4">No periods available</td></tr>`;
    const actionBar = rows.length
      ? `<div class="btn-group btn-group-sm float-right mr-2" role="group"><button class="btn btn-success" id="btn-ims-download-all"><strong>Download All</strong></button><button class="btn btn-warning" id="btn-ims-generate-all"><strong>Generate All</strong></button></div>`
      : "";
    divStatus.innerHTML = `${actionBar}<div class="row"><div class="col px-0"><table class="table table-bordered table-sm table-status mb-2"><tr><th>Period</th><th>Status</th><th>Generate</th><th>Download</th></tr>${rowsHtml}</table></div></div>`;
    if (rows.length) {
      const btnAll = getElement("btn-ims-download-all");
      if (btnAll) {
        btnAll.onclick = async function (evt) {
          reportButtonClicked(evt);
          for (const p of rows) {
            await downloadOther(cfg, p.value);
          }
        };
      }
      const btnGenAll = getElement("btn-ims-generate-all");
      if (btnGenAll) {
        btnGenAll.onclick = async function (evt) {
          reportButtonClicked(evt);
          for (const p of rows) {
            await generateOther(cfg, p.value);
          }
        };
      }
    }
    rows.forEach((p) => {
      const btnGen = getElement(`btn-other-gen-${p.value}`);
      if (btnGen) {
        btnGen.onclick = function (evt) {
          reportButtonClicked(evt);
          addActivity(`IMS Outward generate ${p.value}`, "text-muted");
          generateOther(cfg, p.value);
        };
      }
      const btn = getElement(`btn-other-dl-${p.value}`);
      if (btn) {
        btn.onclick = function (evt) {
          reportButtonClicked(evt);
          addActivity(`IMS Outward click ${p.value}`, "text-muted");
          downloadOther(cfg, p.value);
        };
      }
    });
    } else if (imsMode) {
    // IMS Inward simple single row
    divStatus.innerHTML = `<div class="row"><table class="table table-bordered table-sm table-status"><tr><th>Type</th><th>Status</th><th>Action</th></tr><tr><td>${cfg.display}</td><td id="other-status"><span class="pill muted">Ready</span></td><td class="text-center"><button class="btn btn-success btn-sm" id="btn-other-download"><strong>Download</strong></button></td></tr></table></div>`;

    const btn = getElement("btn-other-download");
    if (btn) {
      btn.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadOther(cfg, null);
      };
    }
  } else {
    // Use the same period list as returns for options where we need a month period.
    const selectorPeriodFrom = getElement("periodFrom");
    const period =
      (selectorPeriodFrom && selectorPeriodFrom.value) ||
      (session.periods[0] && session.periods[0].value) ||
      moment().format("MMYYYY");
    if (needsDateRange) {
      const from = getElement("ledgerDateFrom") ? getElement("ledgerDateFrom").value : "";
      const to = getElement("ledgerDateTo") ? getElement("ledgerDateTo").value : "";
      divStatus.innerHTML = `<div class="row"><table class="table table-bordered table-sm table-status"><tr><th>Ledger</th><th>From</th><th>To</th><th>JSON</th><th>Excel</th></tr><tr><td>${cfg.display}</td><td>${from || "-"}</td><td>${to || "-"}</td><td class="text-center"><button class="btn btn-success btn-sm" id="btn-other-json"><strong>JSON</strong></button></td><td class="text-center"><button class="btn btn-primary btn-sm" id="btn-other-excel"><strong>Excel</strong></button></td></tr><tr><td colspan="5" id="other-status"><span class="pill muted">Ready</span></td></tr></table></div>`;
      const btnJson = getElement("btn-other-json");
      const btnExcel = getElement("btn-other-excel");
      btnJson.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadOther(cfg, null, "json");
      };
      btnExcel.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadOther(cfg, null, "excel");
      };
    } else {
      divStatus.innerHTML = `<div class="row mb-2"><div class="col px-0 text-right"><button class="btn btn-success btn-sm" id="btn-other-download"><strong>${cfg.display}</strong></button></div></div><div class="row"><table class="table table-bordered table-sm table-status"><tr><th>Type</th><th>Period</th><th>Status</th></tr><tr><td>${cfg.display}</td><td>${period || "-"}</td><td id="other-status"><span class="pill muted">Ready</span></td></tr></table></div>`;

      const btn = getElement("btn-other-download");
      btn.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadOther(cfg, period);
      };
    }
  }
}

async function updateWorkspaceForSummary() {
  const divStatus = getElement("returnStatus");
  const periods = session.periods || [];
  if (!periods.length) {
    divStatus.innerHTML = '<div class="text-muted">No periods available for the selected range.</div>';
    return;
  }

  periods.forEach((period) => {
    period.isValid = true;
    period.fileCount = 1;
  });

  const rowsHtml = periods.map((period) => {
    const periodLabel = period.value && period.value.length >= 6
      ? `${period.month || period.value.substring(0, 2)} ${period.value.substring(2)}`
      : `${period.month || ""} ${period.year || ""}`.trim();
    return `<tr>
      <td class="align-middle">${escapeXml(periodLabel)}</td>
      <td class="align-middle"><div id="info-${period.value}">${pill("Ready", "success")}</div></td>
      <td class="align-middle">
        <button type="button" class="btn btn-success btn-sm" id="btn-summary-json-${period.value}" data-fp="${period.value}">JSON</button>
      </td>
      <td class="align-middle">
        <button type="button" class="btn btn-primary btn-sm" id="btn-summary-excel-${period.value}" data-fp="${period.value}">Excel</button>
      </td>
    </tr>`;
  }).join("");

  divStatus.innerHTML = `
    <div class="row mb-2 align-items-center" id="all">
      <div class="col px-0"><div id="bulk-action-status" hidden></div></div>
      <div class="col px-0 text-right">
        <div class="btn-group btn-group-sm float-right mr-2" role="group">
          <button type="button" class="btn btn-success" id="btn-summary-all-json"><strong>Download All JSON</strong></button>
          <button type="button" class="btn btn-primary" id="btn-summary-all-excel"><strong>Download All Excel</strong></button>
        </div>
      </div>
    </div>
    <div class="row">
      <table class="table table-bordered table-sm table-status">
        <tr><th>Period</th><th>Status</th><th>JSON</th><th>Excel</th></tr>
        ${rowsHtml}
      </table>
    </div>`;

  periods.forEach((period) => {
    const jsonBtn = getElement(`btn-summary-json-${period.value}`);
    const excelBtn = getElement(`btn-summary-excel-${period.value}`);
    if (jsonBtn) {
      jsonBtn.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadSummaryPeriod(period, "json");
      };
    }
    if (excelBtn) {
      excelBtn.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadSummaryPeriod(period, "excel");
      };
    }
  });

  const allJsonBtn = getElement("btn-summary-all-json");
  const allExcelBtn = getElement("btn-summary-all-excel");
  if (allJsonBtn) {
    allJsonBtn.onclick = function (evt) {
      reportButtonClicked(evt);
      downloadSummaryAll("json");
    };
  }
  if (allExcelBtn) {
    allExcelBtn.onclick = function (evt) {
      reportButtonClicked(evt);
      downloadSummaryAll("excel");
    };
  }
}

function getSummaryGstr1Url(period) {
  return `https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${encodeURIComponent(period.value)}`;
}

function makeBlankSummaryPayload(cfg, period) {
  return {
    status: "blank",
    message: `${cfg.display} is not configured yet.`,
    data: {
      rtn_prd: period && period.value ? period.value : "",
      summary_type: cfg.summaryType || cfg.key,
      blank: true,
    },
  };
}

async function fetchGstr1SummaryPayload(period) {
  const msg = await processAsync({
    request: "get",
    url: getSummaryGstr1Url(period),
    headers: {
      Accept: "application/json, text/plain, */*",
    },
  });
  if (!msg || !msg.status) {
    const why = msg && msg.statusCode ? `HTTP ${msg.statusCode}` : ((msg && msg.error) || "GSTR-1 summary download failed");
    throw new Error(why);
  }
  try {
    return JSON.parse(msg.response || "{}");
  } catch (err) {
    throw new Error("Invalid GSTR-1 summary response");
  }
}

async function fetchSummaryPayload(cfg, period) {
  if (!cfg) throw new Error("Summary type not selected");
  if (cfg.key === "G1SUM") {
    return fetchGstr1SummaryPayload(period);
  }
  if (cfg.key === "G2ASUM") {
    return fetchGstr2aJsonPayload(period);
  }
  if (cfg.key === "G2AOTHER") {
    return fetchGstr2aOtherSummaryPayload(period);
  }
  if (cfg.key === "G2BSUM") {
    return makeBlankSummaryPayload(cfg, period);
  }
  if (cfg.key === "G3B_VS_G1SUM") {
    const gstr3b = await fetchGstr3bJsonPayload(period);
    const gstr1Summary = await fetchGstr1SummaryPayload(period);
    return {
      data: {
        rtn_prd: period.value,
        gstr3b,
        gstr1_summary: gstr1Summary,
      },
    };
  }
  if (cfg.key === "G3B_VS_G2ASUM") {
    const gstr3b = await fetchGstr3bJsonPayload(period);
    return {
      data: {
        rtn_prd: period.value,
        gstr3b,
        gstr2a_summary: makeBlankSummaryPayload(summaryConfig.G2ASUM, period),
      },
    };
  }
  return makeBlankSummaryPayload(cfg, period);
}

function flattenSummaryPayloadRows(source, payload, reportPeriod) {
  const rows = [];
  const flatRows = [];
  flattenObjectToRows(payload || {}, "", flatRows);
  flatRows.forEach((row) => {
    rows.push({
      report_period: reportPeriod || "",
      source,
      field: row.field,
      value: row.value,
    });
  });
  if (!rows.length) {
    rows.push({
      report_period: reportPeriod || "",
      source,
      field: "status",
      value: "No data",
    });
  }
  return rows;
}

function buildSummaryWorkbookSheets(cfg, payload, period) {
  const reportPeriod = period && period.value ? period.value : "";
  if (cfg.key === "G3B_VS_G1SUM") {
    const data = payload && payload.data ? payload.data : {};
    const gstr3bRows = buildGstr3bSummarySheetRows(data.gstr3b, false);
    const gstr1Rows = buildGstr1SummarySheetRows(data.gstr1_summary, false, reportPeriod);
    return [
      {
        name: "GSTR-3B",
        rows: gstr3bRows,
        columns: getSpreadsheetColumns(gstr3bRows, ["Section", "Particulars", "Taxable Value", "IGST", "CGST", "SGST", "CESS"]),
        options: { schemaReturnType: "GENERIC" },
      },
      {
        name: "GSTR-1 Summary",
        rows: gstr1Rows,
        columns: getSpreadsheetColumns(gstr1Rows, ["row_type", "Description", "No. of records", "Document Type", "Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"]),
        options: { schemaReturnType: "GENERIC" },
      },
    ];
  }
  if (cfg.key === "G2ASUM") {
    return buildGstr2aSummaryWorkbookSheetsFromEntries([{ period, payload }]);
  }
  if (cfg.key === "G2AOTHER") {
    const metaRows = buildGstr2aOtherMetaRows(payload, false);
    return [
      {
        name: "Summary",
        rows: metaRows,
        columns: ["field", "value"],
        options: { schemaReturnType: "GENERIC" },
      },
    ].concat(buildGstr2aOtherSectionRows(payload, false));
  }
  if (cfg.key === "G3B_VS_G2ASUM") {
    const data = payload && payload.data ? payload.data : {};
    const rows = []
      .concat(flattenSummaryPayloadRows("GSTR-3B", data.gstr3b, reportPeriod))
      .concat(flattenSummaryPayloadRows("GSTR-2A (summ)", data.gstr2a_summary, reportPeriod));
    return [{
      name: "GSTR3B vs GSTR2A Summary",
      rows,
      columns: ["report_period", "source", "field", "value"],
      options: { schemaReturnType: "GENERIC" },
    }];
  }
  const sourceName = cfg.display || cfg.key;
  const rows = flattenSummaryPayloadRows(sourceName, payload, reportPeriod);
  return [{
    name: sourceName,
    rows,
    columns: ["report_period", "source", "field", "value"],
    options: { schemaReturnType: "GENERIC" },
  }];
}

function buildCombinedSummaryWorkbookSheets(cfg, entries) {
  if (cfg && cfg.key === "G3B_VS_G1SUM") {
    const gstr3bRows = [];
    const gstr1Rows = [];
    (entries || []).forEach((entry) => {
      const data = entry && entry.payload && entry.payload.data ? entry.payload.data : {};
      buildGstr3bSummarySheetRows(data.gstr3b, true).forEach((row) => gstr3bRows.push(row));
      buildGstr1SummarySheetRows(data.gstr1_summary, true, entry && entry.period ? entry.period.value : "").forEach((row) => gstr1Rows.push(row));
    });
    return [
      {
        name: "GSTR-3B",
        rows: gstr3bRows,
        columns: getSpreadsheetColumns(gstr3bRows, ["report_period", "Section", "Particulars", "Taxable Value", "IGST", "CGST", "SGST", "CESS"]),
        options: { schemaReturnType: "GENERIC" },
      },
      {
        name: "GSTR-1 Summary",
        rows: gstr1Rows,
        columns: getSpreadsheetColumns(gstr1Rows, ["report_period", "row_type", "Description", "No. of records", "Document Type", "Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"]),
        options: { schemaReturnType: "GENERIC" },
      },
    ];
  }
  if (cfg && cfg.key === "G2ASUM") {
    return buildGstr2aSummaryWorkbookSheetsFromEntries(entries);
  }
  if (cfg && cfg.key === "G2AOTHER") {
    const sheetsByName = new Map();
    const pushRows = (name, rows, columns, options) => {
      if (!sheetsByName.has(name)) {
        sheetsByName.set(name, { name, rows: [], preferredColumns: columns || [], options: options || { schemaReturnType: "GENERIC" } });
      }
      const target = sheetsByName.get(name);
      (rows || []).forEach((row) => target.rows.push(row));
    };
    (entries || []).forEach((entry) => {
      pushRows("Summary", buildGstr2aOtherMetaRows(entry.payload, true), ["report_period", "field", "value"], { schemaReturnType: "GENERIC" });
      buildGstr2aOtherSectionRows(entry.payload, true).forEach((sheet) => {
        pushRows(sheet.name, sheet.rows || [], sheet.columns || ["report_period", "row_no"], sheet.options || { schemaReturnType: "GSTR2A" });
      });
    });
    return Array.from(sheetsByName.values()).map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows,
      columns: getSpreadsheetColumns(sheet.rows, sheet.preferredColumns),
      options: sheet.options,
    }));
  }
  const sheetsByName = new Map();
  (entries || []).forEach((entry) => {
    const sheets = buildSummaryWorkbookSheets(cfg, entry.payload, entry.period);
    (sheets || []).forEach((sheet) => {
      if (!sheetsByName.has(sheet.name)) {
        sheetsByName.set(sheet.name, {
          name: sheet.name,
          rows: [],
          preferredColumns: sheet.columns || [],
          options: sheet.options || { schemaReturnType: "GENERIC" },
        });
      }
      const target = sheetsByName.get(sheet.name);
      (sheet.rows || []).forEach((row) => target.rows.push(row));
    });
  });
  return Array.from(sheetsByName.values()).map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows,
    columns: getSpreadsheetColumns(sheet.rows, sheet.preferredColumns),
    options: sheet.options,
  }));
}

async function downloadSummaryPeriod(period, mode) {
  const cfg = session.return;
  const btn = getElement(`btn-summary-${mode === "excel" ? "excel" : "json"}-${period.value}`);
  const info = getElement(`info-${period.value}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = mode === "excel" ? "Preparing..." : "Downloading...";
  }
  try {
    const payload = await fetchSummaryPayload(cfg, period);
    const gstinForFile = resolveSummaryGstin() || session.gstin || "GSTIN";
    const fileBase = makeJsonFileName(cfg.fileNameCode || cfg.key, gstinForFile, period.value);
    if (mode === "excel") {
      if (cfg.key === "G3B_VS_G1SUM") {
        const data = payload && payload.data ? payload.data : {};
        const gstr3bBlob = await buildXlsxBlobFromWorkbookXml(buildGstr3bWorkbookXml(data.gstr3b));
        const gstr1Blob = await buildXlsxBlobFromWorkbookXml(buildGstr1SummaryWorkbookXml(data.gstr1_summary));
        await downloadBlobAs(gstr3bBlob, `${makeJsonFileName("R3B", gstinForFile, period.value)}.xlsx`);
        await downloadBlobAs(gstr1Blob, `${makeJsonFileName("R1SUM", gstinForFile, period.value)}.xlsx`);
      } else {
        const blob = cfg.key === "G1SUM"
          ? await buildXlsxBlobFromWorkbookXml(buildGstr1SummaryWorkbookXml(payload))
          : await buildXlsxBlobFromSheets(buildSummaryWorkbookSheets(cfg, payload, period), { compression: true });
        await downloadBlobAs(blob, `${fileBase}.xlsx`);
      }
    } else {
      await downloadBlobAs(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        `${fileBase}.json`,
      );
    }
    if (info) info.innerHTML = pill("Downloaded", "success");
    if (btn) btn.textContent = mode === "excel" ? "Excel" : "JSON";
  } catch (err) {
    if (info) info.innerHTML = pill(err && err.message ? err.message : "Failed", "danger");
    if (btn) btn.textContent = "Failed";
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function downloadSummaryAll(mode) {
  const cfg = session.return;
  const btn = getElement(mode === "excel" ? "btn-summary-all-excel" : "btn-summary-all-json");
  if (btn) {
    btn.disabled = true;
    btn.textContent = mode === "excel" ? "Preparing Excel..." : "Downloading JSON...";
  }
  setBulkActionMessage(null);
  const periods = (session.periods || []).filter((period) => period && period.isValid);
  const entries = [];
  const failures = [];
  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i];
    if (btn) btn.textContent = mode === "excel" ? `Preparing (${i + 1}/${periods.length})...` : `Downloading (${i + 1}/${periods.length})...`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const payload = await fetchSummaryPayload(cfg, period);
      entries.push({ period, payload });
    } catch (err) {
      failures.push(`${period.value}: ${err && err.message ? err.message : "Failed"}`);
    }
  }
  try {
    if (!entries.length) throw new Error(failures[0] || "No summary data downloaded");
    const periodTag = entries.length > 1
      ? `${entries[0].period.value}_to_${entries[entries.length - 1].period.value}`
      : entries[0].period.value;
    const gstinForFile = resolveSummaryGstin() || session.gstin || "GSTIN";
    const fileBase = makeJsonFileName(cfg.fileNameCode || cfg.key, gstinForFile, periodTag);
    if (mode === "excel") {
      if (cfg.key === "G3B_VS_G1SUM") {
        const gstr3bPayloads = entries.map((entry) => entry.payload && entry.payload.data ? entry.payload.data.gstr3b : null).filter(Boolean);
        const gstr3bBlob = await buildXlsxBlobFromWorkbookXml(buildCombinedGstr3bWorkbookXml(gstr3bPayloads));
        const gstr1Entries = entries.map((entry) => ({
          period: entry.period,
          payload: entry.payload && entry.payload.data ? entry.payload.data.gstr1_summary : null,
        })).filter((entry) => entry.payload);
        const gstr1Blob = await buildXlsxBlobFromWorkbookXml(buildCombinedGstr1SummaryWorkbookXml(gstr1Entries));
        await downloadBlobAs(gstr3bBlob, `${makeJsonFileName("R3B", gstinForFile, periodTag)}_ALL.xlsx`);
        await downloadBlobAs(gstr1Blob, `${makeJsonFileName("R1SUM", gstinForFile, periodTag)}_ALL.xlsx`);
      } else {
        const blob = cfg.key === "G1SUM"
          ? await buildXlsxBlobFromWorkbookXml(buildCombinedGstr1SummaryWorkbookXml(entries))
          : await buildXlsxBlobFromSheets(buildCombinedSummaryWorkbookSheets(cfg, entries), { compression: true });
        await downloadBlobAs(blob, `${fileBase}_ALL.xlsx`);
      }
    } else {
      const payload = {
        return_type: cfg.key,
        entries: entries.map((entry) => ({ period: entry.period.value, payload: entry.payload })),
        failures,
      };
      await downloadBlobAs(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        `${fileBase}_ALL.json`,
      );
    }
    if (failures.length) {
      setBulkActionMessage(`Downloaded with issues. ${failures.slice(0, 3).join(" | ")}`, "warning");
    } else {
      setBulkActionMessage("Downloaded summary successfully.", "success");
    }
    if (btn) btn.textContent = mode === "excel" ? "Download All Excel" : "Download All JSON";
  } catch (err) {
    setBulkActionMessage(err && err.message ? err.message : "Summary download failed", "danger");
    if (btn) btn.textContent = "Failed";
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function downloadOther(cfg, period, mode) {
  const btn = getElement("btn-other-download");
  const btnJson = getElement("btn-other-json");
  const btnExcel = getElement("btn-other-excel");
  const statusCell =
    cfg.key === "IMS_IN" || cfg.key === "IMS_OUT"
      ? getElement(`info-${period || ""}`) || getElement("other-status")
      : getElement("other-status");
  const isIms = cfg.key === "IMS_IN" || cfg.key === "IMS_OUT";
  const activeMode = mode === "excel" ? "excel" : "json";
  const activeBtn = activeMode === "excel" ? btnExcel : btnJson;
  if (btn && !isIms) btn.disabled = true;
  if (btnJson) btnJson.disabled = true;
  if (btnExcel) btnExcel.disabled = true;
  if (activeBtn) activeBtn.textContent = activeMode === "excel" ? "Preparing..." : "Downloading...";
  if (statusCell) statusCell.innerHTML = pill("Working", "warning");

  try {
    if (cfg.key === "IMS_OUT") {
      addActivity(`IMS Outward firing for period ${period || "(none)"}`, "text-muted");
    } else if (cfg.key === "IMS_IN") {
      addActivity(`IMS Inward firing`, "text-muted");
    }
    if (cfg.key === "CHALLAN_LIST") {
      const from = getElement("ledgerDateFrom") ? getElement("ledgerDateFrom").value : "";
      const to = getElement("ledgerDateTo") ? getElement("ledgerDateTo").value : "";
      if (!session.gstin) {
        const gstinMsg = await processAsync({ request: "getGstin" });
        if (gstinMsg && gstinMsg.status && gstinMsg.response) {
          session.gstin = gstinMsg.response;
        }
      }
      if (!session.gstin) throw new Error("Missing GSTIN");
      const startDate = moment(from, "YYYY-MM-DD", true);
      const endDate = moment(to, "YYYY-MM-DD", true);
      if (!startDate.isValid() || !endDate.isValid()) throw new Error("Invalid date range");

      const ranges = [];
      let cursor = startDate.clone();
      while (cursor.isSameOrBefore(endDate, "day")) {
        const chunkEnd = cursor.clone().add(3, "months").subtract(1, "day");
        const end = chunkEnd.isAfter(endDate) ? endDate.clone() : chunkEnd;
        ranges.push({ from: cursor.clone(), to: end.clone() });
        cursor = end.clone().add(1, "day");
      }

      const consolidated = {
        gstin: session.gstin,
        from: formatLedgerDate(startDate, "DD/MM/YYYY"),
        to: formatLedgerDate(endDate, "DD/MM/YYYY"),
        chunks: [],
        data: [],
        raw: [],
      };

      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const url = withParams(cfg.base, [
          ["fm_dt", formatLedgerDate(r.from, "DD/MM/YYYY")],
          ["to_dt", formatLedgerDate(r.to, "DD/MM/YYYY")],
          ["gstin", session.gstin],
        ]);
        const msg = await processAsync({ request: "get", url });
        if (!msg.status) throw new Error("Failed");
        let parsed = null;
        try {
          parsed = JSON.parse(msg.response);
        } catch (e) {
          parsed = msg.response;
        }
        consolidated.chunks.push({
          from: formatLedgerDate(r.from, "DD/MM/YYYY"),
          to: formatLedgerDate(r.to, "DD/MM/YYYY"),
        });
        consolidated.raw.push(parsed);

        if (Array.isArray(parsed)) {
          consolidated.data = consolidated.data.concat(parsed);
        } else if (parsed && Array.isArray(parsed.data)) {
          consolidated.data = consolidated.data.concat(parsed.data);
        } else if (parsed && parsed.data && Array.isArray(parsed.data.challans)) {
          consolidated.data = consolidated.data.concat(parsed.data.challans);
        } else if (parsed && parsed.data && Array.isArray(parsed.data.list)) {
          consolidated.data = consolidated.data.concat(parsed.data.list);
        }
      }

      const exportFrom = consolidated.from || formatLedgerDate(startDate, "DD/MM/YYYY");
      const exportTo = consolidated.to || formatLedgerDate(endDate, "DD/MM/YYYY");
      if (activeMode === "excel") {
        const workbookXml = buildChallanWorkbookXml(consolidated);
        const blobUrl = URL.createObjectURL(
          new Blob([workbookXml], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        );
        const fname = makeNamedRangeExportFileName(cfg, exportFrom, exportTo, "xls");
        downloadAs(blobUrl, fname);
      } else {
        const fname = makeNamedRangeExportFileName(cfg, exportFrom, exportTo, "json");
        const blobUrl = URL.createObjectURL(
          new Blob([JSON.stringify(consolidated, null, 2)], { type: "application/json" }),
        );
        downloadAs(blobUrl, fname);
      }
      if (statusCell) statusCell.innerHTML = pill("Downloaded", "success");
    } else if (cfg.key === "IMS_IN" || cfg.key === "IMS_OUT") {
      const requestUrl =
        cfg.key === "IMS_IN"
          ? cfg.base
          : withParams(cfg.base, [
              ["rtnTyp", "R1"],
              ["section", "ALLOSP"],
              ["viewTyp", "UNI"],
              ["rtnPrd", period || ""],
            ]);
      addActivity(`${cfg.display} request: ${requestUrl}`, "text-muted");
      const msg = await processAsync({ request: "get", url: requestUrl });
      if (!msg.status) {
        addActivity(`${cfg.display} failed (${msg.statusCode || "no status"})`, "text-danger");
        throw new Error("Failed");
      }
      let parsed = null;
      try { parsed = JSON.parse(msg.response); } catch (e) { parsed = null; }
      const finalUrl = getImsOutDownloadUrl(parsed);
      if (finalUrl) {
        addActivity(`${cfg.display} URL: ${finalUrl}`, "text-muted");
        const safePeriod = period || moment().format("MMYYYY");
        const fname = `${session.gstin || "GSTIN"}_${cfg.fileNameCode}_${safePeriod}.json`;
        if (statusCell) statusCell.innerHTML = pill("Downloading...", "warning");
        await saveRemoteFileWithName(finalUrl, fname, cfg.contentType);
        if (statusCell) statusCell.innerHTML = pill("Downloaded", "success");
      } else {
        const failureText = getOtherResponseMessage(parsed, "No file url");
        addActivity(`${cfg.display}: ${failureText}`, "text-danger");
        if (statusCell) statusCell.innerHTML = pill(failureText, "danger");
      }
    }
  } catch (e) {
    if (statusCell) statusCell.innerHTML = pill(e && e.message ? e.message : "Failed", "danger");
    if (btn) btn.disabled = false;
    if (btnJson) {
      btnJson.disabled = false;
      btnJson.textContent = "JSON";
    }
    if (btnExcel) {
      btnExcel.disabled = false;
      btnExcel.textContent = "Excel";
    }
    return;
  }

  if (btn) {
    btn.textContent = "Download";
    btn.disabled = false;
  }
  if (btnJson) {
    btnJson.textContent = "JSON";
    btnJson.disabled = false;
  }
  if (btnExcel) {
    btnExcel.textContent = "Excel";
    btnExcel.disabled = false;
  }
}

async function generateOther(cfg, period) {
  const statusCell =
    cfg.key === "IMS_OUT" ? getElement(`info-${period || ""}`) || getElement("other-status") : getElement("other-status");

  if (statusCell) statusCell.innerHTML = pill("Generating...", "warning");

  try {
    if (cfg.key !== "IMS_OUT") {
      if (statusCell) statusCell.innerHTML = pill("Unsupported", "danger");
      return;
    }

    const requestUrl = withParams(cfg.generateBase, [
      ["rtnTyp", "R1"],
      ["section", "ALLOSP"],
      ["viewTyp", "UNI"],
      ["rtnPrd", period || ""],
    ]);
    addActivity(`${cfg.display} generate request: ${requestUrl}`, "text-muted");
    const msg = await processAsync({ request: "get", url: requestUrl });
    if (!msg.status) {
      throw new Error(msg.statusCode ? `HTTP ${msg.statusCode}` : "Generate failed");
    }

    let parsed = null;
    try { parsed = JSON.parse(msg.response); } catch (e) { parsed = null; }

    const successText = getOtherResponseMessage(parsed, "Generated");
    if (
      parsed &&
      (
        parsed.status === 1 ||
        parsed.status === "1" ||
        (parsed.data && (parsed.data.status === 1 || parsed.data.status === "1"))
      )
    ) {
      if (statusCell) statusCell.innerHTML = pill(successText, "success");
    } else {
      if (statusCell) statusCell.innerHTML = pill(successText, "warning");
    }
  } catch (e) {
    if (statusCell) statusCell.innerHTML = pill(e && e.message ? e.message : "Failed", "danger");
  }
}

// Annual returns (GSTR-9 / GSTR-9C)

async function updateWorkspaceForAnnualReturn() {
  const divStatus = getElement("returnStatus");
  divStatus.textContent = `Getting ${session.return.display} status...`;

  let years = [];
  const dropdownMsg = await processAsync({
    request: "get",
    url: gstn.annualDropdown(),
  });
  if (dropdownMsg.status) {
    years = extractAnnualYearsFromDropdownResponse(dropdownMsg.response);
  }
  if (!years.length) {
    const currentFyStart = getCurrentFinancialYearStart();
    for (let fy = currentFyStart; fy >= 2016; fy--) years.push(fy);
  }

  let rowsHtml = "";
  years.forEach((fy) => {
    rowsHtml += `<tr>
      <td class="align-middle">${makeFinancialYearLabel(fy)}</td>
      <td class="align-middle"><div id="annual-info-${fy}"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="sr-only">Loading...</span></div></div></td>
      <td class="align-middle"><button type="button" class="btn btn-warning btn-sm" id="btn-annual-generate-${fy}">Generate</button></td>
      <td class="align-middle"><button type="button" class="btn btn-success btn-sm" id="btn-annual-json-${fy}" hidden>JSON</button></td>
      <td class="align-middle"><button type="button" class="btn btn-primary btn-sm" id="btn-annual-excel-${fy}" hidden>Excel</button></td>
    </tr>`;
  });

  divStatus.innerHTML = `<div class="row mb-2"><div class="col px-0 text-right"><div class="btn-group btn-group-sm float-right mr-2" role="group"><button type="button" class="btn btn-warning" id="btn-annual-generate-all"><strong>Generate All</strong></button></div></div></div><div class="row"><table class="table table-bordered table-sm table-status"><tr><th>F.Y</th><th>Status</th><th>Generate</th><th>JSON</th><th>Excel</th></tr>${rowsHtml}</table></div>`;

  const btnGenAll = getElement("btn-annual-generate-all");
  if (btnGenAll) {
    btnGenAll.onclick = function (evt) {
      reportButtonClicked(evt);
      generateAllAnnual();
    };
  }

  await Promise.all(years.map((fy) => updateAnnualRow(fy)));
}

async function updateAnnualRow(fy) {
  const infoCell = getElement(`annual-info-${fy}`);
  const btnGenerate = getElement(`btn-annual-generate-${fy}`);
  const btnJson = getElement(`btn-annual-json-${fy}`);
  const btnExcel = getElement(`btn-annual-excel-${fy}`);
  const period = { value: annualPeriodValueFromFy(fy), year: makeFinancialYearLabel(fy) };

  const roleMsg = await processAsync({
    request: "get",
    url: gstn.annualrolestatus(fy),
  });

  if (!roleMsg.status) {
    infoCell.innerHTML = pill(extractFailureText(roleMsg, "Failed"), "danger");
  }

  const checkCfg = getAnnualDownloadConfig(session.return, "json");
  const msgFile = await processAsync({
    request: "get",
    url: gstn.generateFile(checkCfg, period, false),
  });

  if (!msgFile.status) {
    infoCell.innerHTML = pill(extractFailureText(msgFile, "Failed"), "danger");
    btnJson.hidden = true;
    btnExcel.hidden = true;
  } else {
    const resp = JSON.parse(msgFile.response);
    const fileGenStatus = getFileGenStatus(resp);

    if (fileGenStatus) {
      infoCell.innerHTML = pill(
        fileGenStatus,
        fileGenStatus.toLowerCase().includes("generating") ? "warning" : "danger",
      );
      btnJson.hidden = true;
      btnExcel.hidden = true;
    } else {
      showGenTime(infoCell, resp.data.date, resp.data.time);
      btnJson.hidden = false;
      btnExcel.hidden = false;
      btnJson.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadAnnualFile(fy, "json");
      };
      btnExcel.onclick = function (evt) {
        reportButtonClicked(evt);
        downloadAnnualFile(fy, "excel");
      };
    }
  }

  btnGenerate.onclick = function (evt) {
    reportButtonClicked(evt);
    generateAnnualFile(fy);
  };
}

async function generateAnnualFile(fy) {
  const btnGenerate = getElement(`btn-annual-generate-${fy}`);
  const infoCell = getElement(`annual-info-${fy}`);
  const period = { value: annualPeriodValueFromFy(fy), year: makeFinancialYearLabel(fy) };

  btnGenerate.disabled = true;
  btnGenerate.textContent = "Requesting...";

  const jsonCfg = getAnnualDownloadConfig(session.return, "json");
  const excelCfg = getAnnualDownloadConfig(session.return, "excel");

  const msgGenJson = await processAsync({
    request: "get",
    url: gstn.generateFile(jsonCfg, period, true),
  });

  if (!msgGenJson.status) {
    btnGenerate.textContent = "Failed";
    btnGenerate.disabled = false;
    infoCell.innerHTML = pill(extractFailureText(msgGenJson, "Failed"), "danger");
    return;
  }

  const msgGenExcel = await processAsync({
    request: "get",
    url: gstn.generateFile(excelCfg, period, true),
  });

  if (!msgGenExcel.status) {
    btnGenerate.textContent = "Failed";
    btnGenerate.disabled = false;
    infoCell.innerHTML = pill(extractFailureText(msgGenExcel, "Failed"), "danger");
    return;
  }

  infoCell.innerHTML = pill("Generating JSON & Excel...", "warning");
  btnGenerate.textContent = "Requested";
}

async function downloadAnnualFile(fy, mode) {
  const btn = getElement(`btn-annual-${mode}-${fy}`);
  const infoCell = getElement(`annual-info-${fy}`);
  const period = { value: annualPeriodValueFromFy(fy), year: makeFinancialYearLabel(fy) };
  const cfg = getAnnualDownloadConfig(session.return, mode);

  btn.disabled = true;
  btn.textContent = mode === "excel" ? "Downloading Excel..." : "Downloading JSON...";
  infoCell.innerHTML = pill(mode === "excel" ? "Downloading Excel..." : "Downloading JSON...", "warning");

  const msgFile = await processAsync({
    request: "get",
    url: gstn.generateFile(cfg, period, false),
  });

  if (!msgFile.status) {
    btn.textContent = "Failed";
    btn.disabled = false;
    infoCell.innerHTML = pill(extractFailureText(msgFile, "Failed"), "danger");
    return;
  }

  const resp = JSON.parse(msgFile.response);
  const fileGenStatus = getFileGenStatus(resp);
  if (fileGenStatus) {
    btn.textContent = "Failed";
    btn.disabled = false;
    infoCell.innerHTML = pill(fileGenStatus, fileGenStatus.toLowerCase().includes("generating") ? "warning" : "danger");
    return;
  }

  const finalUrl = resp && resp.data && resp.data.url && resp.data.url[0] ? resp.data.url[0] : null;
  if (!finalUrl) {
    btn.textContent = "Failed";
    btn.disabled = false;
    infoCell.innerHTML = pill("No file url", "danger");
    return;
  }

  const fileName =
    makeZipFileName(
      cfg.fileNameCode,
      session.gstin || "GSTIN",
      period.value,
      mode === "excel" ? "EXL" : "",
    ) + ".zip";
  downloadAs(finalUrl, fileName);
  btn.textContent = "Done";
  infoCell.innerHTML = pill(mode === "excel" ? "Downloaded Excel" : "Downloaded JSON", "success");
}

async function generateAllAnnual() {
  const btnGenAll = getElement("btn-annual-generate-all");
  if (!btnGenAll) return;
  btnGenAll.disabled = true;
  btnGenAll.textContent = "Requesting...";

  const fyCells = Array.from(document.querySelectorAll("[id^='annual-info-']"));
  const years = fyCells
    .map((node) => parseInt(String(node.id).replace("annual-info-", ""), 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);

  for (const fy of years) {
    await generateAnnualFile(fy);
  }

  btnGenAll.textContent = "Done";
}
