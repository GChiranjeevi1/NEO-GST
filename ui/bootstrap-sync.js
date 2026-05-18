const APP_BUNDLE_SRC = "./assets/index-DYccarUx.js";
const FALLBACK_DATASET_SRC = "./client-masters1.json";
const GITHUB_CONFIG_SRC = "./github-config.json";
const GITHUB_CONFIG_FALLBACK_SRC = "./github-config.example.json";
const CLIENTS_KEY = "neo-gst-clients";
const DATASET_CACHE_KEY = "neo-gst-dataset-cache";
const USER_GITHUB_CONFIG_KEY = "neo-gst-github-config";
const STATUS_EVENT = "neo-gst-remote-status";
const SAVE_DEBOUNCE_MS = 900;
const DATASET_FORMAT = "neo-gst-client-store";
const DATASET_FORMAT_VERSION = 2;
const CLIENT_SHEET_NAME = "Clients";
const RETURN_SHEET_NAME = "ReturnStatus";
const RETURN_STATUS_PORTAL_GSTIN = "29AAICA3918J1ZE";

const state = {
  meta: null,
  dataset: null,
  saveTimer: null,
  lastSavedSignature: "",
  clientShadow: "[]",
  nativeStorage: null,
  remoteInitialized: false,
  returnStatusDetails: [],
};

const runtimeApi =
  typeof browser !== "undefined"
    ? browser
    : typeof chrome !== "undefined"
      ? chrome
      : null;

if (
  runtimeApi &&
  runtimeApi.runtime &&
  typeof runtimeApi.runtime.sendMessage === "function" &&
  !runtimeApi.runtime.__neoGstPatchedSendMessage
) {
  const originalSendMessage = runtimeApi.runtime.sendMessage.bind(runtimeApi.runtime);
  const portalMessageTypesNeedingTab = new Set([
    "portal-ustatus",
    "portal-profile-detail",
    "portal-busplaces",
    "portal-filing-snapshot",
    "open-download-popup",
  ]);
  const resolveLiveGstTabId = (done) => {
    originalSendMessage({ type: "get-active-gst-tab" }, (resp) => {
      if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
        done(null);
        return;
      }
      done(resp && resp.status && resp.tabId ? Number(resp.tabId) : null);
    });
  };
  const buildRetriedMessage = (message, tabId) => {
    if (!message || !portalMessageTypesNeedingTab.has(message.type) || !tabId) return message;
    if (message.type === "open-download-popup") {
      return Object.assign({}, message, {
        payload: Object.assign({}, message.payload || {}, { tabId }),
      });
    }
    return Object.assign({}, message, { tabId });
  };
  runtimeApi.runtime.sendMessage = function patchedSendMessage(message, callback) {
    const needsTab = message && portalMessageTypesNeedingTab.has(message.type);
    if (needsTab && !message.tabId && !(message.payload && message.payload.tabId)) {
      if (typeof callback === "function") {
        resolveLiveGstTabId((tabId) => {
          originalSendMessage(buildRetriedMessage(message, tabId), callback);
        });
        return;
      }
      return new Promise((resolve, reject) => {
        resolveLiveGstTabId((tabId) => {
          try {
            const maybePromise = originalSendMessage(buildRetriedMessage(message, tabId), (resp) => {
              if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
                reject(new Error(runtimeApi.runtime.lastError.message));
                return;
              }
              resolve(resp);
            });
            if (maybePromise && typeof maybePromise.then === "function") {
              maybePromise.then(resolve, reject);
            }
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    }
    if (needsTab && typeof callback === "function") {
      const wrappedCallback = (resp) => {
        const runtimeError =
          runtimeApi.runtime && runtimeApi.runtime.lastError
            ? String(runtimeApi.runtime.lastError.message || "")
            : "";
        if (/receiving end does not exist/i.test(runtimeError)) {
          resolveLiveGstTabId((tabId) => {
            const retried = buildRetriedMessage(message, tabId);
            const sameTab =
              (retried && retried.tabId) === message.tabId &&
              ((retried && retried.payload && retried.payload.tabId) ===
                (message && message.payload && message.payload.tabId));
            if (!tabId || sameTab) {
              callback({ status: false, error: runtimeError });
              return;
            }
            originalSendMessage(retried, callback);
          });
          return;
        }
        callback(resp);
      };
      return originalSendMessage(message, wrappedCallback);
    }
    if (needsTab) {
      return new Promise((resolve, reject) => {
        try {
          const maybePromise = originalSendMessage(message, (resp) => {
            const runtimeError =
              runtimeApi.runtime && runtimeApi.runtime.lastError
                ? String(runtimeApi.runtime.lastError.message || "")
                : "";
            if (/receiving end does not exist/i.test(runtimeError)) {
              resolveLiveGstTabId((tabId) => {
                const retried = buildRetriedMessage(message, tabId);
                const sameTab =
                  (retried && retried.tabId) === message.tabId &&
                  ((retried && retried.payload && retried.payload.tabId) ===
                    (message && message.payload && message.payload.tabId));
                if (!tabId || sameTab) {
                  reject(new Error(runtimeError));
                  return;
                }
                originalSendMessage(retried, (retryResp) => {
                  if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
                    reject(new Error(runtimeApi.runtime.lastError.message));
                    return;
                  }
                  resolve(retryResp);
                });
              });
              return;
            }
            if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
              reject(new Error(runtimeApi.runtime.lastError.message));
              return;
            }
            resolve(resp);
          });
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(resolve, reject);
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
    return originalSendMessage.apply(null, arguments);
  };
  runtimeApi.runtime.__neoGstPatchedSendMessage = true;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!runtimeApi || !runtimeApi.runtime || typeof runtimeApi.runtime.sendMessage !== "function") {
      reject(new Error("Extension runtime messaging is unavailable."));
      return;
    }
    let settled = false;
    try {
      const maybePromise = runtimeApi.runtime.sendMessage(message, (resp) => {
        if (settled) return;
        settled = true;
        if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
          reject(new Error(runtimeApi.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(
          (resp) => {
            if (settled) return;
            settled = true;
            resolve(resp);
          },
          (error) => {
            if (settled) return;
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      }
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function parseJson(raw, fallback) {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function signature(value) {
  try {
    return JSON.stringify(value || {});
  } catch (error) {
    return String(Date.now());
  }
}

function escapeHtml(value) {
  return text(value)
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
  return stripInvalidXmlChars(text(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeBase64(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function encodeBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function encodeBase64Text(value) {
  return btoa(unescape(encodeURIComponent(String(value == null ? "" : value))));
}

function decodeBase64Text(value) {
  return decodeURIComponent(escape(atob(String(value || ""))));
}

function emitStatus(detail) {
  window.dispatchEvent(
    new CustomEvent(STATUS_EVENT, {
      detail: Object.assign(
        {
          connected: false,
          canWrite: false,
          pending: false,
          message: "",
          error: "",
        },
        detail || {},
      ),
    }),
  );
}

function showBootMessage(message) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a;"><div style="max-width:560px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:24px;box-shadow:0 12px 36px rgba(15,23,42,0.08);"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;margin-bottom:10px;">Neo GST Sync</div><div style="font-size:16px;line-height:1.6;">${escapeHtml(
    message,
  )}</div></div></div>`;
}

function clearBootMessage() {
  const root = document.getElementById("root");
  if (!root) return;
  if (root.children.length === 1 && /Neo GST Sync/i.test(root.textContent || "")) {
    root.innerHTML = "";
  }
}

function buildEmptyDataset() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    clients: [],
    returnStatuses: [],
    schemaStore: { returns: {} },
  };
}

function normalizeClient(client, index) {
  const item = client && typeof client === "object" ? client : {};
  const profile = normalizeCompanyProfile(item);
  const id =
    text(item.id) ||
    `client-${upper(item.gstin || item.username || item.name || index).replace(/[^A-Z0-9]+/g, "-")}`;
  return {
    id,
    name: text(item.tradeName || item.trade_name || item.tradeNam || item.name || item.taxpayerName || item.legalName),
    gstin: upper(item.gstin),
    username: text(item.username || item.userId || item.gstin),
    password: text(item.password),
    status: text(item.status || "Active") || "Active",
    tradeName: profile.tradeName,
    businessName: profile.businessName,
    legalName: profile.legalName,
    registrationDate: profile.registrationDate,
    registrationType: profile.registrationType,
    registrationTypeCode: profile.registrationTypeCode,
    constitution: profile.constitution,
    constitutionCode: profile.constitutionCode,
    taxpayerType: profile.taxpayerType,
    userType: profile.userType,
    role: profile.role,
    portalStatus: profile.status,
    appStatus: profile.appStatus,
    einvoiceStatus: profile.einvoiceStatus,
    einvoiceFlag: profile.einvoiceFlag,
    bankStatus: profile.bankStatus,
    isManufacturer: profile.isManufacturer,
    isGeocoding: profile.isGeocoding,
    stateCode: profile.stateCode,
    lastLogin: profile.lastLogin,
    centerJurisdiction: profile.centerJurisdiction,
    stateJurisdiction: profile.stateJurisdiction,
    natureOfBusiness: profile.natureOfBusiness,
    natureOfTaxpayer: profile.natureOfTaxpayer,
    aadhaarVerified: profile.aadhaarVerified,
    aadhaarVerifiedDate: profile.aadhaarVerifiedDate,
    compositionRate: profile.compositionRate,
    ekycVFlag: profile.ekycVFlag,
    fieldVisitConducted: profile.fieldVisitConducted,
    cancellationDate: profile.cancellationDate,
    cancellationReasonCode: profile.cancellationReasonCode,
    cancellationEffectiveDate: profile.cancellationEffectiveDate,
    gtiFY: profile.gtiFY,
    gti: profile.gti,
    aggregateTurnoverFY: profile.aggregateTurnoverFY,
    aggregateTurnover: profile.aggregateTurnover,
    percentTaxInCashFY: profile.percentTaxInCashFY,
    percentTaxInCash: profile.percentTaxInCash,
    mandatedeInvoice: profile.mandatedeInvoice,
    compDetl: profile.compDetl,
    members: profile.members,
    principalAddress: profile.principalAddress,
    additionalAddresses: profile.additionalAddresses,
    additionalPlacesOfBusiness: profile.additionalPlacesOfBusiness,
    contactName: profile.contactName,
    mobile: profile.mobile,
    email: profile.email,
    goodsServices: profile.goodsServices,
    rawJson: profile.rawJson,
  };
}

function normalizeFilingsMap(raw) {
  const map = raw && typeof raw === "object" ? raw : {};
  const result = {};
  Object.keys(map).forEach((key) => {
    const month = text(key);
    const value = text(map[key]);
    if (!month || !value) return;
    result[month] = value;
  });
  return result;
}

function formatPrincipalAddress(value) {
  if (!value) return "";
  if (typeof value === "string") return text(value);
  if (typeof value !== "object") return text(value);
  const parts = [
    value.bno,
    value.flno,
    value.bnm,
    value.st,
    value.loc,
    value.locality,
    value.landMark,
    value.dst,
    value.stcd,
    value.pncd,
  ]
    .map((item) => text(item))
    .filter(Boolean);
  return parts.join(", ");
}

function summarizeAddressEntry(value) {
  const item = value && typeof value === "object" ? value : {};
  const address = formatPrincipalAddress(item.addr || item.adr || item.address || item);
  const nature = Array.isArray(item.ntr)
    ? item.ntr.map((entry) => text(entry)).filter(Boolean).join(", ")
    : text(item.ntr);
  return [address, nature].filter(Boolean).join(" | ");
}

function summarizeAddressCollection(value) {
  if (!Array.isArray(value) || !value.length) return "";
  return value
    .map((entry) => summarizeAddressEntry(entry))
    .filter(Boolean)
    .join(" || ");
}

function summarizeBusinessPlaces(value) {
  const list = Array.isArray(value)
    ? value
    : value && Array.isArray(value.adadr)
      ? value.adadr
      : [];
  if (!list.length) return "";
  return list
    .map((entry) => {
      const item = entry && typeof entry === "object" ? entry : {};
      return summarizeAddressEntry({
        addr: item.addr || item.adr || item.address,
        ntr: item.ntr,
      });
    })
    .filter(Boolean)
    .join(" || ");
}

function yesNoLabel(value) {
  const source = text(value);
  if (!source) return "";
  if (/^(y|yes|true|1|a)$/i.test(source)) return "Yes";
  if (/^(n|no|false|0)$/i.test(source)) return "No";
  return source;
}

function appStatusLabel(value) {
  const source = text(value);
  if (!source) return "";
  if (/^a$/i.test(source)) return "Active";
  if (/^i$/i.test(source)) return "Inactive";
  return source;
}

function safeScalar(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return text(value);
}

function hasOwnValue(source, key) {
  return !!(source && Object.prototype.hasOwnProperty.call(source, key) && source[key] != null);
}

function firstDefinedValue(source, keys, fallback) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (let index = 0; index < list.length; index += 1) {
    const key = list[index];
    if (hasOwnValue(source, key)) return source[key];
  }
  return fallback;
}

function normalizeCompanyProfile(entry) {
  const item = entry && typeof entry === "object" ? entry : {};
  const contacted = item.contacted && typeof item.contacted === "object" ? item.contacted : {};
  const principalAddress =
    item.principalAddress ||
    item.principal_address ||
    (item.pradr && (item.pradr.adr || item.pradr.addr || item.pradr.address)) ||
    item.address;
  const formattedPrincipalAddress = formatPrincipalAddress(principalAddress);
  const stateJurisdiction = [text(item.stateJurisdiction || item.stj), text(item.stjCd)].filter(Boolean).join(" ").trim();
  const centerJurisdiction = [text(item.centerJurisdiction || item.ctj), text(item.ctjCd)].filter(Boolean).join(" ").trim();
  const natureOfBusiness = Array.isArray(item.natureOfBusiness || item.nba)
    ? (item.natureOfBusiness || item.nba).map((value) => text(value)).filter(Boolean).join(", ")
    : text(item.natureOfBusiness || item.nba || (item.pradr && item.pradr.ntr));
  const additionalAddresses =
    text(item.additionalAddresses) ||
    summarizeAddressCollection(item.adadr) ||
    summarizeAddressCollection(item.additional_addresses);
  const additionalPlacesOfBusiness =
    text(item.additionalPlacesOfBusiness) ||
    summarizeBusinessPlaces(item.busplaces) ||
    summarizeBusinessPlaces(item.additionalBusinessPlaces);
  return {
    gstin: upper(item.gstin),
    businessName: text(item.businessName || item.bname || item.tradeName || item.tradeNam || item.lgnm),
    clientName: text(item.tradeName || item.trade_name || item.tradeNam || item.clientName || item.client_name || item.lgnm || item.legalName),
    clientStatus: text(item.status || item.sts || item.appStatus || item.clientStatus || item.client_status),
    tradeName: text(item.tradeName || item.trade_name || item.tradeNam || item.lgnm || item.businessName),
    legalName: text(item.legalName || item.legal_name || item.lgnm),
    registrationDate: text(item.registrationDate || item.registration_date || item.rgdt),
    registrationType: text(item.registrationType || item.registration_type || item.regType || item.dty),
    registrationTypeCode: text(item.registrationTypeCode || item.regType),
    constitution: text(item.constitution || item.businessType || item.ctb || item.cob),
    constitutionCode: text(item.constitutionCode || item.cob),
    taxpayerType: text(item.taxpayerType || item.dty || item.utype),
    userType: text(item.userType || item.utype),
    role: text(item.role),
    status: appStatusLabel(item.status || item.sts || item.appStatus),
    appStatus: appStatusLabel(item.appStatus || item.applicationStatus || item.sts),
    einvoiceStatus: yesNoLabel(item.einvoiceStatus || item.eInvoiceStatus || item.einvStatus),
    einvoiceFlag: text(item.einvoiceFlag || item.einvStatus),
    bankStatus: yesNoLabel(item.bankStatus || item.bnkStat),
    isManufacturer: yesNoLabel(item.isManufacturer),
    isGeocoding: yesNoLabel(item.isGeocoding),
    stateCode: text(item.stateCode || item.stcd),
    lastLogin: text(item.lastLogin || item.Llogin),
    centerJurisdiction: centerJurisdiction,
    stateJurisdiction: stateJurisdiction,
    natureOfBusiness: natureOfBusiness,
    goodsServices: text(item.goodsServices || item.goods_services || natureOfBusiness),
    natureOfTaxpayer: text(item.natureOfTaxpayer || item.ntcrbs),
    aadhaarVerified: yesNoLabel(item.aadhaarVerified || item.adhrVFlag),
    aadhaarVerifiedDate: text(item.aadhaarVerifiedDate || item.adhrVdt),
    compositionRate: safeScalar(item.compositionRate || item.cmpRt),
    ekycVFlag: text(item.ekycVFlag || item.ekycvFlag),
    fieldVisitConducted: yesNoLabel(item.fieldVisitConducted || item.isFieldVisitConducted),
    cancellationDate: text(item.cancellationDate || item.canclDt),
    cancellationReasonCode: text(item.cancellationReasonCode || item.rsnCd),
    cancellationEffectiveDate: text(item.cancellationEffectiveDate || item.cxdt),
    gtiFY: safeScalar(item.gtiFY),
    gti: safeScalar(item.gti),
    aggregateTurnoverFY: safeScalar(item.aggregateTurnoverFY || item.aggreTurnOverFY),
    aggregateTurnover: safeScalar(item.aggregateTurnover || item.aggreTurnOver),
    percentTaxInCashFY: safeScalar(item.percentTaxInCashFY),
    percentTaxInCash: safeScalar(item.percentTaxInCash),
    mandatedeInvoice: yesNoLabel(item.mandatedeInvoice),
    compDetl: safeScalar(item.compDetl),
    members: Array.isArray(item.members || item.mbr) ? (item.members || item.mbr).join(", ") : text(item.members || item.mbr),
    principalAddress: formattedPrincipalAddress,
    additionalAddresses,
    additionalPlacesOfBusiness,
    contactName: text(item.contactName || contacted.name),
    mobile: text(item.mobile || item.mobNum || contacted.mobNum),
    email: text(item.email || contacted.email),
    rawJson: text(item.rawJson || item.raw_json),
  };
}

const COMPANY_PROFILE_FIELDS = [
  "gstin",
  "businessName",
  "clientName",
  "clientStatus",
  "tradeName",
  "legalName",
  "registrationDate",
  "registrationType",
  "registrationTypeCode",
  "constitution",
  "constitutionCode",
  "taxpayerType",
  "userType",
  "role",
  "status",
  "appStatus",
  "einvoiceStatus",
  "einvoiceFlag",
  "bankStatus",
  "isManufacturer",
  "isGeocoding",
  "stateCode",
  "lastLogin",
  "centerJurisdiction",
  "stateJurisdiction",
  "natureOfBusiness",
  "goodsServices",
  "natureOfTaxpayer",
  "aadhaarVerified",
  "aadhaarVerifiedDate",
  "compositionRate",
  "ekycVFlag",
  "fieldVisitConducted",
  "cancellationDate",
  "cancellationReasonCode",
  "cancellationEffectiveDate",
  "gtiFY",
  "gti",
  "aggregateTurnoverFY",
  "aggregateTurnover",
  "percentTaxInCashFY",
  "percentTaxInCash",
  "mandatedeInvoice",
  "compDetl",
  "members",
  "principalAddress",
  "additionalAddresses",
  "additionalPlacesOfBusiness",
  "contactName",
  "mobile",
  "email",
  "rawJson",
];

function isMeaningfulProfileValue(value, fieldName) {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => isMeaningfulProfileValue(entry, fieldName));
  }
  if (typeof value === "object") {
    return Object.keys(value).some((key) => isMeaningfulProfileValue(value[key], key));
  }
  const source = text(value);
  if (!source) return false;
  if (/mobile|mobnum/i.test(String(fieldName || ""))) {
    return !looksMaskedMobile(source);
  }
  return !looksMaskedText(source);
}

function mergeProfilePayload(existingValue, incomingValue, fieldName) {
  if (incomingValue == null) return existingValue;
  if (Array.isArray(incomingValue)) {
    return incomingValue.length ? incomingValue.slice() : existingValue;
  }
  if (incomingValue && typeof incomingValue === "object") {
    if (!existingValue || typeof existingValue !== "object" || Array.isArray(existingValue)) {
      const next = {};
      Object.keys(incomingValue).forEach((key) => {
        const merged = mergeProfilePayload(undefined, incomingValue[key], key);
        if (merged !== undefined) next[key] = merged;
      });
      return next;
    }
    const next = Object.assign({}, existingValue);
    Object.keys(incomingValue).forEach((key) => {
      next[key] = mergeProfilePayload(existingValue[key], incomingValue[key], key);
    });
    return next;
  }
  return isMeaningfulProfileValue(incomingValue, fieldName) ? incomingValue : existingValue;
}

function mergeCompanyProfileEntry(existingEntry, incomingPayload) {
  const existing = normalizeCompanyProfile(existingEntry || {});
  const existingRaw = parseResponseJson(existing.rawJson) || {};
  const mergedRaw = mergeProfilePayload(existingRaw, incomingPayload && typeof incomingPayload === "object" ? incomingPayload : {}, "");
  const incoming = normalizeCompanyProfile(Object.assign({}, existingEntry || {}, mergedRaw || {}));
  const merged = {};
  COMPANY_PROFILE_FIELDS.forEach((field) => {
    if (field === "rawJson") return;
    merged[field] = isMeaningfulProfileValue(incoming[field], field) ? incoming[field] : existing[field];
  });
  merged.gstin = upper(incoming.gstin || existing.gstin || (incomingPayload && incomingPayload.gstin));
  merged.rawJson = text(JSON.stringify(mergedRaw || {}));
  return normalizeCompanyProfile(merged);
}

function normalizeClientStatus(value, fallback) {
  const source = text(value);
  if (!source) return text(fallback || "Active") || "Active";
  if (/active/i.test(source)) return "Active";
  if (/cancel|inactive|suspend|blocked/i.test(source)) return "Inactive";
  return source;
}

function parseResponseJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (error) {
    return null;
  }
}

function unwrapApiPayload(raw) {
  const parsed = parseResponseJson(raw);
  if (!parsed || typeof parsed !== "object") return {};
  const direct = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const nested =
    (direct.taxpayerInfo && typeof direct.taxpayerInfo === "object" && direct.taxpayerInfo) ||
    (direct.taxpayer && typeof direct.taxpayer === "object" && direct.taxpayer) ||
    (direct.tp && typeof direct.tp === "object" && direct.tp) ||
    direct;
  if (Array.isArray(nested)) {
    const firstObject = nested.find((item) => item && typeof item === "object");
    return firstObject || {};
  }
  return nested && typeof nested === "object" ? nested : {};
}

function hasUsablePublicClientDetails(result) {
  if (!result || typeof result !== "object") return false;
  if (result.status) return true;
  const tpPayload = unwrapApiPayload(result.tpResponse);
  return !!(tpPayload && typeof tpPayload === "object" && Object.keys(tpPayload).length);
}

function clientDetailsRowValues(client, profile) {
  return [
    client.id,
    client.name,
    client.gstin,
    client.username,
    client.password,
    client.status,
    profile.tradeName,
    profile.legalName,
    profile.registrationType,
    profile.constitution,
    profile.appStatus || profile.status,
    profile.einvoiceStatus,
    profile.registrationDate,
    profile.natureOfTaxpayer,
    profile.aadhaarVerified,
    profile.aadhaarVerifiedDate,
    profile.natureOfBusiness,
    profile.compositionRate,
    profile.ekycVFlag,
    profile.fieldVisitConducted,
    profile.members,
    profile.principalAddress,
    profile.contactName,
    profile.mobile,
    profile.email,
    profile.stateJurisdiction,
    profile.centerJurisdiction,
    profile.gtiFY,
    profile.gti,
    profile.aggregateTurnoverFY,
    profile.aggregateTurnover,
    profile.percentTaxInCashFY,
    profile.percentTaxInCash,
    profile.mandatedeInvoice,
    profile.compDetl,
    profile.goodsServices,
  ];
}

const CLIENT_DETAILS_COLUMNS = [
  { label: "Client ID", getValue: (client) => client.id },
  { label: "Client Name", getValue: (client) => client.name },
  { label: "GSTIN", getValue: (client) => client.gstin },
  { label: "User ID", getValue: (client) => client.username },
  { label: "Password", getValue: (client) => client.password },
  { label: "Status", getValue: (client) => client.status },
  { label: "Trade Name", getValue: (_, profile) => profile.tradeName },
  { label: "Business Name", getValue: (_, profile) => profile.businessName },
  { label: "Legal Name", getValue: (_, profile) => profile.legalName },
  { label: "Registration Type", getValue: (_, profile) => profile.registrationType },
  { label: "Registration Type Code", getValue: (_, profile) => profile.registrationTypeCode },
  { label: "Business Type", getValue: (_, profile) => profile.constitution },
  { label: "Constitution Code", getValue: (_, profile) => profile.constitutionCode },
  { label: "App Status", getValue: (_, profile) => profile.appStatus || profile.status },
  { label: "User Role", getValue: (_, profile) => profile.role },
  { label: "User Type", getValue: (_, profile) => profile.userType },
  { label: "E-Invoice", getValue: (_, profile) => profile.einvoiceStatus },
  { label: "E-Invoice Flag", getValue: (_, profile) => profile.einvoiceFlag },
  { label: "Date Of Registration", getValue: (_, profile) => profile.registrationDate },
  { label: "Nature Of Taxpayer", getValue: (_, profile) => profile.natureOfTaxpayer },
  { label: "Aadhaar Verified", getValue: (_, profile) => profile.aadhaarVerified },
  { label: "Aadhaar Verified Date", getValue: (_, profile) => profile.aadhaarVerifiedDate },
  { label: "Bank Status", getValue: (_, profile) => profile.bankStatus },
  { label: "Manufacturer", getValue: (_, profile) => profile.isManufacturer },
  { label: "Geocoding", getValue: (_, profile) => profile.isGeocoding },
  { label: "State Code", getValue: (_, profile) => profile.stateCode },
  { label: "Last Login", getValue: (_, profile) => profile.lastLogin },
  { label: "Nature Of Business", getValue: (_, profile) => profile.natureOfBusiness },
  { label: "Composition Rate", getValue: (_, profile) => profile.compositionRate },
  { label: "EKYC VFlag", getValue: (_, profile) => profile.ekycVFlag },
  { label: "Field Visit Conducted", getValue: (_, profile) => profile.fieldVisitConducted },
  { label: "Cancellation Date", getValue: (_, profile) => profile.cancellationDate },
  { label: "Cancellation Reason Code", getValue: (_, profile) => profile.cancellationReasonCode },
  { label: "Cancellation Effective Date", getValue: (_, profile) => profile.cancellationEffectiveDate },
  { label: "Members", getValue: (_, profile) => profile.members },
  { label: "Principal Address", getValue: (_, profile) => profile.principalAddress },
  { label: "Additional Place Of Business", getValue: (_, profile) => profile.additionalPlacesOfBusiness || profile.additionalAddresses },
  { label: "Contact Name", getValue: (_, profile) => profile.contactName },
  { label: "Mobile", getValue: (_, profile) => profile.mobile },
  { label: "Email", getValue: (_, profile) => profile.email },
  { label: "State Jurisdiction", getValue: (_, profile) => profile.stateJurisdiction },
  { label: "CTJ", getValue: (_, profile) => profile.centerJurisdiction },
  { label: "GTI FY", getValue: (_, profile) => profile.gtiFY },
  { label: "GTI", getValue: (_, profile) => profile.gti },
  { label: "Aggregate Turnover FY", getValue: (_, profile) => profile.aggregateTurnoverFY },
  { label: "Aggregate Turnover", getValue: (_, profile) => profile.aggregateTurnover },
  { label: "Percent Tax In Cash FY", getValue: (_, profile) => profile.percentTaxInCashFY },
  { label: "Percent Tax In Cash", getValue: (_, profile) => profile.percentTaxInCash },
  { label: "Mandate eInvoice", getValue: (_, profile) => profile.mandatedeInvoice },
  { label: "Comp Detl", getValue: (_, profile) => profile.compDetl },
  { label: "Goods/Services", getValue: (_, profile) => profile.goodsServices },
  { label: "Actions", getValue: () => "" },
];

const CLIENT_DETAILS_KNOWN_LABELS = new Set(CLIENT_DETAILS_COLUMNS.map((column) => text(column.label)));
const CLIENT_DETAILS_EXCLUDED_DYNAMIC_LABELS = new Set([
  "Adadr",
  "Busplaces",
  "Ctb",
  "Ctj",
  "Ctj Cd",
  "Dty",
  "Einvoice Status",
  "Gstin",
  "Lgnm",
  "Pradr",
  "Rgdt",
  "Stj",
  "Stj Cd",
  "Sts",
  "Trade Nam",
  "Goods/Services",
  "Bzgddtls",
  "Bzsdtls",
]);

function extractDynamicProfilePairs(profile) {
  const raw = parseResponseJson(profile && profile.rawJson);
  const dynamicPairs = [];
  if (raw && typeof raw === "object") {
    const payloads = raw.tp || raw.goodservice || raw.busplaces ? raw : { tp: raw };
    if (payloads.tp) flattenDynamicDetailPairs(payloads.tp, "", dynamicPairs);
  }
  const byLabel = new Map();
  dynamicPairs.forEach(([label, value]) => {
    const safeLabel = text(label);
    const safeValue = text(value);
    if (
      !safeLabel ||
      !safeValue ||
      CLIENT_DETAILS_KNOWN_LABELS.has(safeLabel) ||
      CLIENT_DETAILS_EXCLUDED_DYNAMIC_LABELS.has(safeLabel)
    ) {
      return;
    }
    if (!byLabel.has(safeLabel)) byLabel.set(safeLabel, safeValue);
  });
  return byLabel;
}

function hasMeaningfulClientDetailsRow(client, profile) {
  const baseValues = clientDetailsRowValues(client, profile).slice(0, 6);
  const detailValues = clientDetailsRowValues(client, profile).slice(6);
  return baseValues.some((value) => text(value)) || detailValues.some((value) => text(value));
}

function buildClientDetailsTableModel(rows, profileByGstin) {
  const normalizedRows = [];
  const visibleColumnIndexes = new Set([0, 1, 2, 3, 4, 5]);
  const dynamicLabels = new Set();

  rows.forEach((client) => {
    const profile = profileByGstin.get(upper(client && client.gstin)) || normalizeCompanyProfile(client);
    if (!hasMeaningfulClientDetailsRow(client, profile)) return;
    const dynamicFields = extractDynamicProfilePairs(profile);
    normalizedRows.push({ client, profile, dynamicFields });

    for (let index = 6; index < CLIENT_DETAILS_COLUMNS.length; index += 1) {
      if (text(CLIENT_DETAILS_COLUMNS[index].getValue(client, profile))) {
        visibleColumnIndexes.add(index);
      }
    }
    dynamicFields.forEach((_, label) => dynamicLabels.add(label));
  });

  const visibleColumns = CLIENT_DETAILS_COLUMNS.filter((_, index) => visibleColumnIndexes.has(index));
  const dynamicColumns = Array.from(dynamicLabels).map((label) => ({
    label,
    getValue: (_, __, dynamicFields) => text(dynamicFields && dynamicFields.get(label)),
  }));
  return {
    rows: normalizedRows,
    columns: visibleColumns.concat(dynamicColumns.sort((left, right) => left.label.localeCompare(right.label))),
  };
}

function renderClientDetailsRows(tableModel) {
  return (tableModel.rows || [])
    .map(({ client, profile, dynamicFields }) => {
      return `<tr data-gstin="${escapeHtml(client.gstin || "")}">${(tableModel.columns || [])
        .map((column) => {
          if (column.label === "Actions") {
            return `<td><button type="button" class="neo-gst-btn neo-gst-btn-secondary neo-gst-clear-details" data-gstin="${escapeHtml(client.gstin || "")}" style="padding:6px 10px;font-size:11px;">Clear Details</button></td>`;
          }
          return `<td>${escapeHtml(column.getValue(client, profile, dynamicFields) || "")}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
}

function formatReturnStatusFinancialYear(year) {
  const value = text(year);
  if (!value) return "";
  const range = value.match(/(\d{4})\D+(\d{2,4})/);
  if (range) return `${range[1]}-${range[2].slice(-2)}`;
  const single = value.match(/(\d{4})/);
  if (!single) return value;
  const start = Number(single[1]);
  return start ? `${start}-${String(start + 1).slice(-2)}` : value;
}

function formatReturnStatusPeriod(period, year) {
  const value = text(period);
  if (!value) return "";
  if (/^annual$/i.test(value)) {
    const fy = formatReturnStatusFinancialYear(year);
    return fy ? `Annual ${fy}` : "Annual";
  }
  if (/^[A-Za-z]{3}-\d{2,4}$/.test(value)) return value;
  if (/^\d{6}$/.test(value)) {
    const month = MONTH_LABELS[Number(value.slice(4, 6)) - 1];
    return month ? `${month}-${value.slice(0, 4)}` : value;
  }
  const monthMap = {
    january: "Jan",
    february: "Feb",
    march: "Mar",
    april: "Apr",
    may: "May",
    june: "Jun",
    july: "Jul",
    august: "Aug",
    september: "Sep",
    october: "Oct",
    november: "Nov",
    december: "Dec",
  };
  const normalized = monthMap[value.toLowerCase()];
  if (!normalized) return value;
  const match = String(year || "").match(/(\d{4})/);
  if (!match) return normalized;
  const fyYear = Number(match[1]);
  const closingQuarter = /january|february|march/i.test(value);
  return `${normalized}-${closingQuarter ? fyYear : fyYear - 1}`;
}

function returnStatusValue(row) {
  const source = row && typeof row === "object" ? row : {};
  const explicit = text(source.status || source.sts || source.filingStatus || source.returnStatus || source.retstatus);
  if (explicit) return explicit;
  return text(source.dof) ? "Filed" : "Not filed";
}

function returnStatusType(row) {
  const source = row && typeof row === "object" ? row : {};
  return text(source.rtntype || source.returnType || source.retType || source.rtnType) || "GSTR-3B";
}

function returnStatusPeriod(row, year) {
  const source = row && typeof row === "object" ? row : {};
  return formatReturnStatusPeriod(
    source.taxp || source.taxPeriod || source.period || source.fp || source.ret_period || source.month,
    source.fy || source.financialYear || source.fin_year || year,
  );
}

function parseReturnStatusPayload(item) {
  const result = item && item.result ? item.result : item;
  const gstin = upper((item && item.gstin) || (result && result.gstin));
  const year = text(result && (result.fy || result.year));
  const parsed = parseResponseJson(result && result.taxpayerReturnDetails);
  const rows =
    parsed && Array.isArray(parsed.filingStatus) && Array.isArray(parsed.filingStatus[0])
      ? parsed.filingStatus[0]
      : parsed && Array.isArray(parsed.filingStatus)
        ? parsed.filingStatus
        : [];
  return rows
    .map((row) => {
      const rowYear = text((row && (row.fy || row.financialYear || row.fin_year)) || year);
      return {
        gstin,
        fy: rowYear,
        returnType: returnStatusType(row),
        period: returnStatusPeriod(row, rowYear),
        status: returnStatusValue(row),
        dof: text(row && row.dof),
        mof: text(row && row.mof),
        rawJson: JSON.stringify(row || {}),
      };
    })
    .filter((entry) => entry.gstin && entry.returnType && entry.period);
}

function mergeReturnStatusResults(results) {
  const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
  const byGstin = new Map((dataset.returnStatuses || []).map((entry) => [upper(entry.gstin), normalizeReturnStatus(entry)]));
  const detailByKey = new Map(
    (state.returnStatusDetails || []).map((entry) => [
      `${upper(entry.gstin)}::${text(entry.fy)}::${text(entry.returnType)}::${text(entry.period)}`,
      entry,
    ]),
  );
  results.forEach((item) => {
    const gstin = upper(item && item.gstin);
    if (!gstin) return;
    byGstin.set(gstin, normalizeReturnStatus({ id: `status-${gstin}`.replace(/[^A-Z0-9-]+/gi, "-"), gstin }));
    parseReturnStatusPayload(item).forEach((entry) => {
      detailByKey.set(`${upper(entry.gstin)}::${text(entry.fy)}::${text(entry.returnType)}::${text(entry.period)}`, entry);
    });
  });
  state.returnStatusDetails = Array.from(detailByKey.values());
  dataset.returnStatuses = Array.from(byGstin.values()).map((entry, index) => normalizeReturnStatus(entry, index));
  state.dataset = syncStatusesFromClients(dataset);
  return state.dataset;
}

function normalizeReturnStatus(entry, index) {
  const item = entry && typeof entry === "object" ? entry : {};
  const gstin = upper(item.gstin);
  return {
    id: text(item.id) || `status-${upper(gstin || index).replace(/[^A-Z0-9]+/g, "-")}`,
    gstin,
    manual: item.manual === true,
  };
}

function normalizeDataset(raw) {
  const source = unwrapDatasetEnvelope(raw && typeof raw === "object" ? raw : {}) || {};
  const byGstin = new Map();
  (Array.isArray(source.clients) ? source.clients : []).forEach((entry, index) => {
    const client = normalizeClient(entry, index);
    if (client.gstin) byGstin.set(client.gstin, client);
  });
  const statusRows = []
    .concat(Array.isArray(source.returnStatuses) ? source.returnStatuses : [])
    .concat(Array.isArray(source.returnStatus) ? source.returnStatus : [])
    .concat(Array.isArray(source.returnStatusGstins) ? source.returnStatusGstins : []);
  const statusByGstin = new Map();
  statusRows.forEach((entry, index) => {
    const gstin = upper(typeof entry === "string" ? entry : entry && entry.gstin);
    if (!gstin) return;
    statusByGstin.set(gstin, normalizeReturnStatus({ id: typeof entry === "object" && entry ? entry.id : "", gstin }, index));
  });
  return {
    version: 1,
    updatedAt: text(source.updatedAt) || new Date().toISOString(),
    clients: Array.from(byGstin.values()).filter((item) => item.id && item.gstin),
    returnStatuses: Array.from(statusByGstin.values()).filter((item) => item.id && item.gstin),
    schemaStore:
      source.schemaStore && typeof source.schemaStore === "object" && source.schemaStore.returns && typeof source.schemaStore.returns === "object"
        ? source.schemaStore
        : { returns: {} },
  };
}

function syncStatusesFromClients(dataset) {
  const normalized = dataset && typeof dataset === "object" ? dataset : buildEmptyDataset();
  normalized.clients = (normalized.clients || []).map(normalizeClient).filter((entry) => entry.id && entry.gstin);
  const known = new Set((dataset.clients || []).map((client) => upper(client.gstin)).filter(Boolean));
  normalized.returnStatuses = (normalized.returnStatuses || []).map((entry) =>
    Object.assign({}, entry, {
      gstin: upper(entry.gstin),
      knownClient: known.has(upper(entry.gstin)),
      manual: entry.manual === true,
    }),
  );
  return normalized;
}

function allReturnStatusGstins(dataset) {
  const normalized = syncStatusesFromClients(normalizeDataset(dataset || buildEmptyDataset()));
  const gstins = new Set();
  (normalized.clients || []).forEach((client) => {
    if (upper(client.gstin)) gstins.add(upper(client.gstin));
  });
  (normalized.returnStatuses || []).forEach((entry) => {
    if (upper(entry.gstin)) gstins.add(upper(entry.gstin));
  });
  return Array.from(gstins).filter(Boolean).sort();
}

function ensureReturnStatusRowsForGstin(dataset, gstin, options) {
  const normalized = syncStatusesFromClients(normalizeDataset(dataset || buildEmptyDataset()));
  const safeGstin = upper(gstin);
  if (!safeGstin) return normalized;
  const next = normalizeDataset(normalized);
  const rows = next.returnStatuses || [];
  const flags = options && options.manual ? { manual: true } : {};
  const exists = rows.some((entry) => upper(entry.gstin) === safeGstin);
  if (!exists) {
    rows.push(
      normalizeReturnStatus(
        Object.assign(
          {
            id: `status-${safeGstin}`.replace(/[^A-Z0-9-]+/gi, "-"),
            gstin: safeGstin,
          },
          flags,
        ),
        rows.length,
      ),
    );
  }
  next.returnStatuses = rows;
  return syncStatusesFromClients(next);
}

function preserveUniqueGstinRows(dataset) {
  const normalized = syncStatusesFromClients(normalizeDataset(dataset || buildEmptyDataset()));
  const clientGstins = new Set((normalized.clients || []).map((client) => upper(client.gstin)).filter(Boolean));
  const manualOnlyGstins = Array.from(
    new Set(
      (normalized.returnStatuses || [])
        .filter((entry) => entry.manual === true && upper(entry.gstin) && !clientGstins.has(upper(entry.gstin)))
        .map((entry) => upper(entry.gstin)),
    ),
  );
  normalized.returnStatuses = manualOnlyGstins.map((gstin, index) =>
    normalizeReturnStatus(
      {
        id: `status-${gstin}`.replace(/[^A-Z0-9-]+/gi, "-"),
        gstin,
        manual: true,
      },
      index,
    ),
  );
  return syncStatusesFromClients(normalized);
}

function stripTransientFields(dataset) {
  const merged = syncStatusesFromClients(normalizeDataset(dataset || buildEmptyDataset()));
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    clients: (merged.clients || []).map((client) => {
      const profile = normalizeCompanyProfile(client);
      return {
        id: client.id,
        name: client.name,
        gstin: client.gstin,
        username: client.username,
        password: client.password,
        status: client.status,
        tradeName: text(profile.tradeName),
        businessName: text(profile.businessName),
        legalName: text(profile.legalName),
        registrationDate: text(profile.registrationDate),
        registrationType: text(profile.registrationType),
        registrationTypeCode: text(profile.registrationTypeCode),
        constitution: text(profile.constitution),
        constitutionCode: text(profile.constitutionCode),
        taxpayerType: text(profile.taxpayerType),
        userType: text(profile.userType),
        role: text(profile.role),
        portalStatus: text(profile.status),
        appStatus: text(profile.appStatus),
        einvoiceStatus: text(profile.einvoiceStatus),
        einvoiceFlag: text(profile.einvoiceFlag),
        bankStatus: text(profile.bankStatus),
        isManufacturer: text(profile.isManufacturer),
        isGeocoding: text(profile.isGeocoding),
        stateCode: text(profile.stateCode),
        lastLogin: text(profile.lastLogin),
        centerJurisdiction: text(profile.centerJurisdiction),
        stateJurisdiction: text(profile.stateJurisdiction),
        natureOfBusiness: text(profile.natureOfBusiness),
        natureOfTaxpayer: text(profile.natureOfTaxpayer),
        aadhaarVerified: text(profile.aadhaarVerified),
        aadhaarVerifiedDate: text(profile.aadhaarVerifiedDate),
        compositionRate: text(profile.compositionRate),
        ekycVFlag: text(profile.ekycVFlag),
        fieldVisitConducted: text(profile.fieldVisitConducted),
        cancellationDate: text(profile.cancellationDate),
        cancellationReasonCode: text(profile.cancellationReasonCode),
        cancellationEffectiveDate: text(profile.cancellationEffectiveDate),
        gtiFY: text(profile.gtiFY),
        gti: text(profile.gti),
        aggregateTurnoverFY: text(profile.aggregateTurnoverFY),
        aggregateTurnover: text(profile.aggregateTurnover),
        percentTaxInCashFY: text(profile.percentTaxInCashFY),
        percentTaxInCash: text(profile.percentTaxInCash),
        mandatedeInvoice: text(profile.mandatedeInvoice),
        compDetl: text(profile.compDetl),
        members: text(profile.members),
        principalAddress: text(profile.principalAddress),
        additionalAddresses: text(profile.additionalAddresses),
        contactName: text(profile.contactName),
        mobile: text(profile.mobile),
        email: text(profile.email),
        goodsServices: text(profile.goodsServices),
        rawJson: text(profile.rawJson),
      };
    }),
    returnStatuses: (merged.returnStatuses || []).map((entry) => ({
      id: entry.id,
      gstin: entry.gstin,
    })),
    schemaStore:
      merged.schemaStore && typeof merged.schemaStore === "object" && merged.schemaStore.returns && typeof merged.schemaStore.returns === "object"
        ? merged.schemaStore
        : { returns: {} },
  };
}

function buildPersistedDataset(dataset) {
  const payload = stripTransientFields(syncStatusesFromClients(normalizeDataset(dataset || buildEmptyDataset())));
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    clients: payload.clients || [],
    returnStatuses: (payload.returnStatuses || [])
      .map((entry) => ({
        id: text(entry && entry.id),
        gstin: upper(entry && entry.gstin),
      }))
      .filter((entry) => entry.id && entry.gstin),
    schemaStore:
      payload.schemaStore && typeof payload.schemaStore === "object" && payload.schemaStore.returns && typeof payload.schemaStore.returns === "object"
        ? payload.schemaStore
        : { returns: {} },
  };
}

function buildDatasetEnvelope(dataset, source) {
  const payload = buildPersistedDataset(dataset);
  return {
    format: DATASET_FORMAT,
    version: DATASET_FORMAT_VERSION,
    updatedAt: new Date().toISOString(),
    source: text(source || ""),
    data: payload,
  };
}

function unwrapDatasetEnvelope(raw) {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.format === DATASET_FORMAT && raw.data && typeof raw.data === "object") {
    return raw.data;
  }
  if (raw.data && typeof raw.data === "object" && Array.isArray(raw.data.clients)) {
    return raw.data;
  }
  return raw;
}

function requireZip() {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip is unavailable for workbook sync.");
  }
  return JSZip;
}

function parseXmlDocument(xmlText) {
  return new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
}

function columnLabel(index) {
  let value = Number(index) + 1;
  let label = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    label = String.fromCharCode(65 + mod) + label;
    value = Math.floor((value - mod) / 26);
  }
  return label;
}

function columnIndexFromRef(ref) {
  const letters = String(ref || "").replace(/[^A-Z]/gi, "").toUpperCase();
  let value = 0;
  for (let index = 0; index < letters.length; index += 1) {
    value = value * 26 + (letters.charCodeAt(index) - 64);
  }
  return Math.max(0, value - 1);
}

function parseWorksheetRows(xmlText, sharedStrings) {
  const doc = parseXmlDocument(xmlText);
  const rows = [];
  Array.from(doc.getElementsByTagName("row")).forEach((rowNode) => {
    const row = [];
    Array.from(rowNode.getElementsByTagName("c")).forEach((cellNode) => {
      const ref = cellNode.getAttribute("r") || "";
      const index = columnIndexFromRef(ref);
      const type = cellNode.getAttribute("t") || "";
      let value = "";
      if (type === "inlineStr") {
        value = Array.from(cellNode.getElementsByTagName("t"))
          .map((node) => node.textContent || "")
          .join("");
      } else {
        const raw = cellNode.getElementsByTagName("v")[0];
        const textValue = raw ? raw.textContent || "" : "";
        value = type === "s" ? text(sharedStrings[Number(textValue)] || "") : textValue;
      }
      row[index] = text(value);
    });
    rows.push(row);
  });
  return rows;
}

function rowsToObjects(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const headers = (list[0] || []).map((value) => text(value));
  return list.slice(1).filter((row) => row.some((value) => text(value))).map((row) => {
    const entry = {};
    headers.forEach((header, index) => {
      if (!header) return;
      entry[header] = text(row[index]);
    });
    return entry;
  });
}

function monthKey(month) {
  return text(month).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function datasetFromSheetObjects(clientRows, returnRows) {
  const clients = clientRows.map((row, index) =>
    normalizeClient(
      {
        id: row.client_id || row.id,
        name: row.client_name || row.name || row.taxpayer_name,
        gstin: row.gstin,
        username: row.username || row.user_id,
        password: row.password,
        status: row.status,
      },
      index,
    ),
  );
  const returnStatuses = returnRows.map((row, index) =>
    normalizeReturnStatus(
      {
        id: row.row_id || row.id,
        gstin: row.gstin,
      },
      index,
    ),
  );
  return syncStatusesFromClients(
    normalizeDataset({
      updatedAt: new Date().toISOString(),
      clients,
      returnStatuses,
    }),
  );
}

async function parseWorkbookDataset(workbookBuffer) {
  const Zip = requireZip();
  const zip = await Zip.loadAsync(workbookBuffer);
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const workbookDoc = parseXmlDocument(workbookXml);
  const relsDoc = parseXmlDocument(relsXml);
  const relMap = new Map();
  Array.from(relsDoc.getElementsByTagName("Relationship")).forEach((node) => {
    relMap.set(node.getAttribute("Id"), node.getAttribute("Target"));
  });
  const sharedStrings = zip.file("xl/sharedStrings.xml")
    ? Array.from(parseXmlDocument(await zip.file("xl/sharedStrings.xml").async("string")).getElementsByTagName("si")).map((node) =>
        Array.from(node.getElementsByTagName("t")).map((textNode) => textNode.textContent || "").join(""),
      )
    : [];
  const sheets = {};
  Array.from(workbookDoc.getElementsByTagName("sheet")).forEach((node) => {
    const name = node.getAttribute("name");
    const relId = node.getAttribute("r:id");
    const target = relMap.get(relId);
    if (!name || !target) return;
    const resolved = target.startsWith("/") ? target.replace(/^\//, "") : `xl/${target.replace(/^\.?\//, "")}`;
    sheets[name] = resolved;
  });
  const clientSheetPath = sheets[CLIENT_SHEET_NAME];
  const returnSheetPath = sheets[RETURN_SHEET_NAME];
  if (!clientSheetPath) {
    throw new Error(`Workbook must contain a sheet named "${CLIENT_SHEET_NAME}".`);
  }
  const clientRows = rowsToObjects(parseWorksheetRows(await zip.file(clientSheetPath).async("string"), sharedStrings));
  const returnRows =
    returnSheetPath && zip.file(returnSheetPath)
      ? rowsToObjects(parseWorksheetRows(await zip.file(returnSheetPath).async("string"), sharedStrings))
      : [];
  return datasetFromSheetObjects(clientRows, returnRows);
}

function workbookLoadMessage(dataset, meta) {
  const safeDataset = normalizeDataset(dataset || buildEmptyDataset());
  const clientCount = (safeDataset.clients || []).length;
  const returnCount = (safeDataset.returnStatuses || []).length;
  if (!clientCount) {
    return "GitHub data file connected, but no client data was found.";
  }
  if (!returnCount) {
    return "GitHub data file connected. Client details loaded, but Return Status is empty.";
  }
  return meta && meta.canWrite ? "GitHub data file connected." : "GitHub data file loaded in read-only mode.";
}

function returnStatusExportCellStyle(value, columnIndex) {
  if (columnIndex < 3) return "";
  const source = text(value);
  if (/^not\s*filed$/i.test(source)) return "2";
  if (!source) return "";
  return "1";
}

function worksheetXml(sheetName, rows, styleResolver) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const lastColumn = Math.max(1, ...safeRows.map((row) => (Array.isArray(row) ? row.length : 0)));
  const dimension = `A1:${columnLabel(lastColumn - 1)}${Math.max(1, safeRows.length)}`;
  const xmlRows = safeRows
    .map((row, rowIndex) => {
      const cells = (row || [])
        .map((value, column) => {
          const ref = `${columnLabel(column)}${rowIndex + 1}`;
          const styleId = typeof styleResolver === "function" ? text(styleResolver(value, rowIndex, column, row, sheetName)) : "";
          const styleAttr = styleId ? ` s="${escapeXml(styleId)}"` : "";
          return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${xmlRows}</sheetData>
</worksheet>`;
}

async function buildWorkbookBase64(dataset) {
  const Zip = requireZip();
  const zip = new Zip();
  const payload = stripTransientFields(syncStatusesFromClients(normalizeDataset(dataset)));
  const clientRowsSource = (payload.clients || []).slice().sort((a, b) => text(a.name).localeCompare(text(b.name)));
  const profileByGstin = new Map(clientRowsSource.map((entry) => [upper(entry.gstin), normalizeCompanyProfile(entry)]));
  const clientTableModel = buildClientDetailsTableModel(clientRowsSource, profileByGstin);
  const clientRows = [
    (clientTableModel.columns || []).map((column) => text(column.label)),
    ...(clientTableModel.rows || []).map(({ client, profile, dynamicFields }) =>
      (clientTableModel.columns || []).map((column) => text(column.getValue(client, profile, dynamicFields))),
    ),
  ];
  const returnRows = [
    ...(state.returnStatusDetails || []).length
      ? (() => {
          const data = returnStatusViewData();
          return [
            ["gstin", "client_name", "return_type", ...data.months.map(monthKey)],
            ...(data.rows || []).map((row) => [
              row.gstin,
              row.taxpayerName,
              row.returnType,
              ...data.months.map((month) => text((row.filings || {})[month])),
            ]),
          ];
        })()
      : [
          ["row_id", "gstin"],
          ...(payload.returnStatuses || []).map((entry) => [
            entry.id,
            entry.gstin,
          ]),
        ],
  ];
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Neo GST</dc:creator>
  <cp:lastModifiedBy>Neo GST</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Neo GST</Application>
</Properties>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${CLIENT_SHEET_NAME}" sheetId="1" r:id="rId1"/>
    <sheet name="${RETURN_SHEET_NAME}" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="3">
    <xf xfId="0"/>
    <xf xfId="0" fillId="2" applyFill="1"/>
    <xf xfId="0" fillId="3" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
  );
  zip.file("xl/worksheets/sheet1.xml", worksheetXml(CLIENT_SHEET_NAME, clientRows));
  zip.file(
    "xl/worksheets/sheet2.xml",
    worksheetXml(RETURN_SHEET_NAME, returnRows, (value, rowIndex, columnIndex) =>
      rowIndex > 0 ? returnStatusExportCellStyle(value, columnIndex) : "",
    ),
  );
  return zip.generateAsync({ type: "base64" });
}

function setClientShadow(clients) {
  const serialized = JSON.stringify(clients || []);
  state.clientShadow = serialized;
  if (state.nativeStorage && typeof state.nativeStorage.setItem === "function") {
    try {
      state.nativeStorage.setItem.call(localStorage, CLIENTS_KEY, serialized);
    } catch (error) {
      // ignore hydration storage failures
    }
  }
}

function setDatasetCache(dataset) {
  if (!state.nativeStorage || typeof state.nativeStorage.setItem !== "function") return;
  try {
    state.nativeStorage.setItem.call(localStorage, DATASET_CACHE_KEY, JSON.stringify(buildDatasetEnvelope(dataset, "local-cache")));
  } catch (error) {
    // ignore cache storage failures
  }
}

function getDatasetCache() {
  try {
    const raw = localStorage.getItem(DATASET_CACHE_KEY);
    const parsed = parseJson(raw, null);
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeDataset(unwrapDatasetEnvelope(parsed));
  } catch (error) {
    return null;
  }
}

function maybeHydrateMountedApp(clients) {
  const list = Array.isArray(clients) ? clients : [];
  if (!list.length) return;
  const flag = "neo-gst-client-hydrated";
  const nextSignature = JSON.stringify(
    list.map((client) => ({
      id: text(client.id),
      name: text(client.name),
      gstin: upper(client.gstin),
      username: text(client.username),
      password: text(client.password),
      status: text(client.status),
    })),
  );
  if (sessionStorage.getItem(flag) === nextSignature) return;
  let currentSignature = "";
  try {
    const current = parseJson(localStorage.getItem(CLIENTS_KEY), []);
    currentSignature = JSON.stringify(
      (Array.isArray(current) ? current : []).map((client) => ({
        id: text(client && client.id),
        name: text(client && client.name),
        gstin: upper(client && client.gstin),
        username: text(client && client.username),
        password: text(client && client.password),
        status: text(client && client.status),
      })),
    );
  } catch (error) {
    currentSignature = "";
  }
  if (currentSignature === nextSignature) {
    sessionStorage.setItem(flag, nextSignature);
    return;
  }
  const bodyText = document.body ? document.body.textContent || "" : "";
  if (
    /No clients found/i.test(bodyText) ||
    /\b0 Active\b/i.test(bodyText) ||
    /Acme Corp|Global Tech|Inactive LLC/i.test(bodyText)
  ) {
    sessionStorage.setItem(flag, nextSignature);
    window.location.reload();
    return;
  }
  sessionStorage.setItem(flag, nextSignature);
}

function parseRemoteJsonText(rawText) {
  const parsed = parseJson(text(rawText), null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Remote JSON file is empty or invalid.");
  }
  return normalizeDataset(unwrapDatasetEnvelope(parsed));
}

function readStoredGithubConfig() {
  try {
    const raw = state.nativeStorage && state.nativeStorage.getItem
      ? state.nativeStorage.getItem.call(localStorage, USER_GITHUB_CONFIG_KEY)
      : localStorage.getItem(USER_GITHUB_CONFIG_KEY);
    const parsed = parseJson(raw, null);
    return normalizeGithubConfig(parsed);
  } catch (error) {
    return null;
  }
}

function writeStoredGithubConfig(config) {
  const normalized = normalizeGithubConfig(config);
  if (!normalized) throw new Error("GitHub config is incomplete.");
  const raw = JSON.stringify(normalized);
  if (state.nativeStorage && state.nativeStorage.setItem) {
    state.nativeStorage.setItem.call(localStorage, USER_GITHUB_CONFIG_KEY, raw);
  } else {
    localStorage.setItem(USER_GITHUB_CONFIG_KEY, raw);
  }
  return normalized;
}

function clearStoredGithubConfig() {
  if (state.nativeStorage && state.nativeStorage.removeItem) {
    state.nativeStorage.removeItem.call(localStorage, USER_GITHUB_CONFIG_KEY);
  } else {
    localStorage.removeItem(USER_GITHUB_CONFIG_KEY);
  }
}

function normalizeGithubConfig(config) {
  const normalized = {
    token: text(config && config.token),
    owner: text(config && config.owner),
    repo: text(config && config.repo),
    path: text(config && config.path),
    branch: text((config && config.branch) || "main") || "main",
  };
  if (!normalized.token || /PASTE|TOKEN/i.test(normalized.token)) return null;
  if (!normalized.owner || !normalized.repo || !normalized.path) return null;
  return normalized;
}

function parseGithubConfigInput(value) {
  const raw = text(value);
  const urlMatch = raw.match(/https?:\/\/\S+/i);
  if (!urlMatch) {
    throw new Error("Paste data like: github_token&https://github.com/owner/repo/blob/main/path/file.json");
  }
  const urlText = urlMatch[0].replace(/[)\],;]+$/g, "");
  const token = raw.slice(0, urlMatch.index).replace(/[&\s]+$/g, "").trim();
  if (!token) throw new Error("Token is missing before the GitHub link.");
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch (error) {
    throw new Error("GitHub link is invalid.");
  }
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let owner = "";
  let repo = "";
  let branch = parsed.searchParams.get("ref") || "main";
  let path = "";
  if (host === "github.com") {
    owner = parts[0] || "";
    repo = parts[1] || "";
    if (parts[2] === "blob" || parts[2] === "raw") {
      branch = parts[3] || branch;
      path = parts.slice(4).join("/");
    } else {
      path = parts.slice(2).join("/");
    }
  } else if (host === "raw.githubusercontent.com") {
    owner = parts[0] || "";
    repo = parts[1] || "";
    branch = parts[2] || branch;
    path = parts.slice(3).join("/");
  } else if (host === "api.github.com") {
    const reposIndex = parts.indexOf("repos");
    const contentsIndex = parts.indexOf("contents");
    owner = reposIndex >= 0 ? parts[reposIndex + 1] || "" : "";
    repo = reposIndex >= 0 ? parts[reposIndex + 2] || "" : "";
    path = contentsIndex >= 0 ? parts.slice(contentsIndex + 1).join("/") : "";
  } else {
    throw new Error("Use a github.com, raw.githubusercontent.com, or api.github.com file link.");
  }
  const config = normalizeGithubConfig({ token, owner, repo, path, branch });
  if (!config) throw new Error("Could not read owner, repo, branch, and file path from the GitHub link.");
  return config;
}

function buildRemoteJsonText(dataset) {
  return JSON.stringify(buildDatasetEnvelope(dataset, "github"), null, 2);
}

async function fetchRemoteDataset() {
  const config = await fetchGithubConfig();
  const fileState = await fetchGithubFileState(config);
  const cachedDataset = getDatasetCache();
  const dataset = fileState.missing
    ? cachedDataset || buildEmptyDataset()
    : parseRemoteJsonText(fileState.content);
  return {
    meta: {
      provider: "github",
      canWrite: true,
      config,
      sha: fileState.sha,
    },
    dataset,
  };
}

async function fetchBundledDataset() {
  const response = await fetch(FALLBACK_DATASET_SRC, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Unable to load bundled client dataset (${response.status})`);
  }
  const raw = await response.json();
  return normalizeDataset(raw);
}

async function fetchGithubConfig() {
  const stored = readStoredGithubConfig();
  if (stored) return stored;
  let config = null;
  let source = GITHUB_CONFIG_SRC;
  let primaryStatus = 0;
  const primary = await fetch(GITHUB_CONFIG_SRC, { cache: "no-store" });
  if (primary.ok) {
    config = await primary.json();
  } else {
    primaryStatus = primary.status;
    const fallback = await fetch(GITHUB_CONFIG_FALLBACK_SRC, { cache: "no-store" });
    if (!fallback.ok) {
      throw new Error(
        `Unable to load GitHub config (${primaryStatus || "n/a"}). Also failed fallback config (${fallback.status}).`,
      );
    }
    config = await fallback.json();
    source = GITHUB_CONFIG_FALLBACK_SRC;
  }
  const normalized = normalizeGithubConfig(config);
  if (!normalized) {
    throw new Error(`GitHub token is missing/placeholder in ${source}.`);
  }
  return normalized;
}

async function githubApiRequest(config, path, options) {
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
  const textBody = await response.text();
  const jsonBody = parseJson(textBody, null);
  if (!response.ok) {
    const error = new Error(
      (jsonBody && (jsonBody.message || jsonBody.error)) ||
      textBody ||
      `GitHub API failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return jsonBody;
}

function isGithubNotFoundError(error) {
  return !!(error && (error.status === 404 || /\bnot found\b/i.test(error.message || "")));
}

async function ensureGithubBranch(config) {
  const branch = text(config && config.branch) || "main";
  try {
    await githubApiRequest(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return false;
  } catch (error) {
    if (!isGithubNotFoundError(error)) throw error;
  }
  const repo = await githubApiRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
  );
  const defaultBranch = text(repo && repo.default_branch) || "main";
  const defaultRef = await githubApiRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
  );
  const sha = text(defaultRef && defaultRef.object && defaultRef.object.sha);
  if (!sha) throw new Error(`Unable to find base SHA for ${defaultBranch}.`);
  await githubApiRequest(
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

async function fetchGithubFileState(config) {
  await ensureGithubBranch(config);
  const encodedPath = config.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  let json = null;
  try {
    json = await githubApiRequest(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`,
    );
  } catch (error) {
    if (isGithubNotFoundError(error)) {
      return { sha: "", content: "", missing: true };
    }
    throw error;
  }
  if (!json || typeof json !== "object" || !json.content) {
    throw new Error("GitHub file response did not include file content.");
  }
  return {
    sha: text(json.sha),
    content: decodeBase64Text(String(json.content || "").replace(/\s+/g, "")),
  };
}

async function writeRemoteDataset(dataset, meta) {
  const config = meta && meta.config;
  if (!config) {
    throw new Error("GitHub config is unavailable.");
  }
  const current = await fetchGithubFileState(config);
  const jsonText = buildRemoteJsonText(dataset);
  const encodedPath = config.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const body = {
    message: `${current.missing ? "Create" : "Update"} ${config.path} from Neo GST`,
    content: encodeBase64Text(jsonText),
    branch: config.branch,
  };
  const sha = current.sha || (meta && meta.sha) || "";
  if (sha) body.sha = sha;
  const response = await githubApiRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (meta) {
    meta.sha = text((response && response.content && response.content.sha) || current.sha || meta.sha || "");
  }
}

async function flushSave(reason) {
  if (!state.remoteInitialized) {
    if (state.dataset) setDatasetCache(state.dataset);
    return false;
  }
  if (!state.dataset || !state.meta || !state.meta.canWrite) {
    if (state.dataset) setDatasetCache(state.dataset);
    emitStatus({
      connected: Boolean(state.meta),
      canWrite: false,
      pending: false,
      message: "Local mode. Changes are saved in browser storage.",
    });
    return false;
  }
  const payload = stripTransientFields(syncStatusesFromClients(normalizeDataset(state.dataset)));
  const nextSignature = signature(payload);
  if (nextSignature === state.lastSavedSignature) return true;
  try {
    await writeRemoteDataset(payload, state.meta);
    state.lastSavedSignature = nextSignature;
    state.dataset = payload;
    setClientShadow(payload.clients);
    setDatasetCache(payload);
    emitStatus({
      connected: true,
      canWrite: true,
      pending: false,
      message: "GitHub sync is active.",
    });
    return true;
  } catch (error) {
    emitStatus({
      connected: true,
      canWrite: true,
      pending: true,
      error: error && error.message ? error.message : "Save failed.",
      message: "Failed to update the GitHub JSON file.",
    });
    return false;
  }
}

function scheduleSave(reason) {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    flushSave(reason).catch((error) => console.warn("Neo GST remote save failed", error));
  }, SAVE_DEBOUNCE_MS);
}

function patchStorage() {
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  state.nativeStorage = {
    getItem: originalGetItem,
    setItem: originalSetItem,
    removeItem: originalRemoveItem,
  };

  Storage.prototype.getItem = function patchedGetItem(key) {
    if (this === localStorage && key === CLIENTS_KEY) {
      return state.clientShadow;
    }
    return originalGetItem.apply(this, arguments);
  };

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    if (this === localStorage && key === CLIENTS_KEY) {
      const parsed = parseJson(String(value || "[]"), []);
      if (Array.isArray(parsed)) {
        if (!state.remoteInitialized && !state.dataset) {
          return;
        }
        const dataset = state.dataset ? normalizeDataset(state.dataset) : buildEmptyDataset();
        dataset.clients = parsed.map(normalizeClient);
        state.dataset = syncStatusesFromClients(dataset);
        setClientShadow(state.dataset.clients);
        scheduleSave("clients-changed");
        setTimeout(() => {
          flushSave("clients-changed-immediate").catch((error) => console.warn("Neo GST immediate client save failed", error));
        }, 0);
      }
      return;
    }
    if (this === localStorage && /^neo-gst-profile-/i.test(String(key || ""))) {
      const parsed = parseJson(String(value || "{}"), null);
      if (parsed && typeof parsed === "object") {
        const dataset = state.dataset ? normalizeDataset(state.dataset) : buildEmptyDataset();
        const portalInfo = parsed.portalInfo && typeof parsed.portalInfo === "object" ? parsed.portalInfo : {};
        const portalProfile = parsed.portalProfile && typeof parsed.portalProfile === "object" ? parsed.portalProfile : {};
        const profilePayload = Object.assign({}, portalInfo, portalProfile, parsed);
        const gstin = upper(
          profilePayload.gstin ||
          profilePayload.gstinId ||
          portalInfo.gstin ||
          portalProfile.gstin ||
          portalProfile.gstinId,
        );
        if (gstin) {
          const byGstin = new Map((dataset.clients || []).map((client) => [upper(client.gstin), client]));
          const existing = byGstin.get(gstin) || { id: `client-${gstin}`, gstin, username: gstin, password: "", status: "Active" };
          const mergedProfile = mergeCompanyProfileEntry(normalizeCompanyProfile(existing), Object.assign({}, profilePayload, { gstin }));
          byGstin.set(
            gstin,
            normalizeClient(
              Object.assign({}, existing, mergedProfile, {
                name: text(mergedProfile.tradeName || mergedProfile.clientName || mergedProfile.legalName) || existing.name || gstin,
                status: normalizeClientStatus(mergedProfile.status || mergedProfile.clientStatus, existing.status),
              }),
            ),
          );
          dataset.clients = Array.from(byGstin.values());
          state.dataset = syncStatusesFromClients(dataset);
          setClientShadow(state.dataset.clients);
          scheduleSave("company-profile-local-save");
          setTimeout(() => {
            flushSave("company-profile-local-save-immediate").catch((error) =>
              console.warn("Neo GST immediate company profile save failed", error),
            );
          }, 0);
        }
      }
      return originalSetItem.apply(this, arguments);
    }
    return originalSetItem.apply(this, arguments);
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    if (this === localStorage && key === CLIENTS_KEY) {
      if (!state.remoteInitialized && !state.dataset) {
        return;
      }
      const dataset = state.dataset ? normalizeDataset(state.dataset) : buildEmptyDataset();
      dataset.clients = [];
      state.dataset = syncStatusesFromClients(dataset);
      setClientShadow([]);
      scheduleSave("clients-cleared");
      return;
    }
    return originalRemoveItem.apply(this, arguments);
  };
}

function monthOrder(months) {
  const rank = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const partsFor = (value) => {
    const label = text(value);
    const annual = label.match(/^annual\s+(\d{4})-(\d{2,4})$/i);
    if (annual) return { year: Number(annual[1]), rank: 12, label };
    const [month, year] = label.split("-");
    return {
      year: parseInt(year || "0", 10),
      rank: Object.prototype.hasOwnProperty.call(rank, String(month || "").toLowerCase())
        ? rank[String(month || "").toLowerCase()]
        : 99,
      label,
    };
  };
  return months.slice().sort((left, right) => {
    const leftParts = partsFor(left);
    const rightParts = partsFor(right);
    const yearGap = leftParts.year - rightParts.year;
    if (yearGap !== 0) return yearGap;
    const rankGap = leftParts.rank - rightParts.rank;
    if (rankGap !== 0) return rankGap;
    return leftParts.label.localeCompare(rightParts.label);
  });
}

function returnStatusYearOptions() {
  const currentYear = new Date().getFullYear();
  const options = [];
  for (let year = currentYear; year >= 2017; year -= 1) {
    options.push(String(year));
  }
  return options;
}

function yearRange(fromYear, toYear) {
  const start = Number(fromYear);
  const end = Number(toYear);
  if (!start || !end) return [];
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const years = [];
  for (let year = high; year >= low; year -= 1) {
    years.push(String(year));
  }
  return years;
}

function returnStatusViewData() {
  const dataset = syncStatusesFromClients(normalizeDataset(state.dataset || buildEmptyDataset()));
  const clientByGstin = new Map((dataset.clients || []).map((client) => [upper(client.gstin), client]));
  const detailsByGstin = new Map();
  const months = new Set();
  const types = new Set();
  const monthStatuses = {};
  (state.returnStatusDetails || []).forEach((entry) => {
    const gstin = upper(entry && entry.gstin);
    if (!gstin) return;
    if (!detailsByGstin.has(gstin)) detailsByGstin.set(gstin, []);
    detailsByGstin.get(gstin).push(entry);
    if (text(entry.returnType)) types.add(text(entry.returnType));
    if (text(entry.period)) {
      months.add(text(entry.period));
      monthStatuses[text(entry.period)] = monthStatuses[text(entry.period)] || new Set();
      monthStatuses[text(entry.period)].add(text(entry.dof || entry.status));
    }
  });
  const rows = [];
  allReturnStatusGstins(dataset).forEach((gstin) => {
    const client = clientByGstin.get(gstin);
    const details = detailsByGstin.get(gstin) || [];
    if (!details.length) {
      rows.push({
        gstin,
        taxpayerName: client ? client.name : "Manual GSTIN",
        returnType: "",
        filings: {},
      });
      return;
    }
    const byType = new Map();
    details.forEach((entry) => {
      const type = text(entry.returnType) || "GSTR-3B";
      if (!byType.has(type)) byType.set(type, {});
      byType.get(type)[text(entry.period)] = text(entry.dof || entry.status);
    });
    byType.forEach((filings, returnType) => {
      rows.push({
        gstin,
        taxpayerName: client ? client.name : "Manual GSTIN",
        returnType,
        filings,
      });
    });
  });
  return {
    rows,
    months: monthOrder(Array.from(months)),
    returnTypes: Array.from(types).filter(Boolean).sort(),
    monthStatuses: Object.keys(monthStatuses).reduce((acc, key) => {
      acc[key] = Array.from(monthStatuses[key]).filter(Boolean).sort();
      return acc;
    }, {}),
  };
}

function ensureModalStyle() {
  if (document.getElementById("neo-gst-return-style")) return;
  const style = document.createElement("style");
  style.id = "neo-gst-return-style";
  style.textContent = `
    .neo-gst-overlay{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.34);backdrop-filter:blur(4px);padding:28px;display:flex;justify-content:center;align-items:flex-start;overflow:auto}
    .neo-gst-modal{width:min(1480px,100%);margin:20px 0;background:#ffffff;border:1px solid #cfd8e3;border-radius:18px;box-shadow:0 28px 80px rgba(15,23,42,.20);overflow:hidden;display:flex;flex-direction:column;font-family:Calibri,Arial,sans-serif}
    .neo-gst-head{padding:22px 24px;background:linear-gradient(180deg,#f8fbff 0%,#eef6ff 100%);border-bottom:1px solid #d9e1ea;display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
    .neo-gst-body{padding:20px 24px 24px;overflow:auto}
    .neo-gst-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:nowrap}
    .neo-gst-toolbar-row{display:flex;gap:10px;flex-wrap:nowrap;align-items:center;justify-content:flex-start}
    .neo-gst-btn{border:1px solid #c7d2e0;border-radius:10px;padding:9px 14px;font-size:12px;font-weight:700;letter-spacing:.01em;cursor:pointer;background:#fff;color:#1f2937;transition:all .18s ease;box-shadow:0 6px 16px rgba(15,23,42,.05)}
    .neo-gst-btn:hover{transform:translateY(-1px);background:#f8fbff;border-color:#8fb0d6;box-shadow:0 10px 22px rgba(15,23,42,.08)}
    .neo-gst-btn:active{transform:translateY(0)}
    .neo-gst-btn-secondary{background:#fff;color:#334155}
    .neo-gst-btn-primary{background:linear-gradient(135deg,#0f766e 0%,#0b8f84 100%);color:#fff;border-color:#0f766e;box-shadow:0 12px 24px rgba(15,118,110,.22)}
    .neo-gst-btn-primary:hover{background:linear-gradient(135deg,#0d6d66 0%,#0a8379 100%);border-color:#0d6d66}
    .neo-gst-btn-accent{background:linear-gradient(135deg,#d97706 0%,#ea580c 100%);color:#fff;border-color:#d97706;box-shadow:0 12px 24px rgba(217,119,6,.22)}
    .neo-gst-btn-accent:hover{background:linear-gradient(135deg,#c56b05 0%,#d65109 100%);border-color:#c56b05}
    .neo-gst-btn-danger{background:#fff7f7;color:#b42318;border-color:#efb4b4}
    .neo-gst-btn-danger:hover{background:#fff1f1;border-color:#e78f8f}
    .neo-gst-select-compact{width:auto;min-width:120px;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;background:#f8fbff;border:1px solid #c7d2e0;color:#0f172a;box-shadow:0 6px 16px rgba(15,23,42,.04)}
    .neo-gst-inline-label{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .neo-gst-mini-overlay{position:fixed;inset:0;background:rgba(15,23,42,.28);display:flex;align-items:center;justify-content:center;z-index:10001}
    .neo-gst-mini-modal{width:min(560px,92vw);background:#fff;border:1px solid #cfd8e3;border-radius:14px;box-shadow:0 24px 70px rgba(15,23,42,.20);padding:18px}
    .neo-gst-mini-title{font-size:18px;font-weight:700;color:#0f172a;margin-bottom:8px}
    .neo-gst-mini-copy{font-size:13px;color:#64748b;margin-bottom:12px}
    .neo-gst-mini-textarea{width:100%;min-height:180px;border:1px solid #c7d2e0;border-radius:10px;padding:12px;font:12px Consolas,"Courier New",monospace;resize:vertical;outline:none}
    .neo-gst-mini-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:12px}
    .neo-gst-table-wrap{background:#fff;border:1px solid #cfd8e3;border-radius:14px;overflow:auto;box-shadow:inset 0 1px 0 rgba(255,255,255,.65)}
    .neo-gst-table{width:100%;border-collapse:separate;border-spacing:0;min-width:900px}
    .neo-gst-table th{position:sticky;top:0;background:linear-gradient(180deg,#dbeafe 0%,#bfdbfe 100%);text-align:left;padding:12px 14px;font-size:12px;font-weight:700;border-right:1px solid #b7c8de;border-bottom:1px solid #b7c8de;color:#0f172a;white-space:nowrap}
    .neo-gst-table th:first-child{border-left:none}
    .neo-gst-table td{padding:12px 14px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#111827;white-space:nowrap;line-height:1.35;vertical-align:middle;background:#fff}
    .neo-gst-table tbody tr:nth-child(even) td{background:#f8fbff}
    .neo-gst-table tbody tr:hover td{background:#eef6ff}
    .neo-gst-table th:last-child,.neo-gst-table td:last-child{border-right:none}
    .neo-gst-filter-row th{background:#eef4fb;padding:4px 6px;position:sticky;top:31px;z-index:1}
    .neo-gst-filter-input,.neo-gst-filter-select{width:100%;border:1px solid #b8c4d1;border-radius:6px;padding:4px 6px;font-size:11px;background:#fff;color:#111827;outline:none;min-height:28px}
    .neo-gst-filter-input:focus,.neo-gst-filter-select:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.12)}
    .neo-gst-filter-select{min-width:96px}
    .neo-gst-code{font-family:Consolas,"Courier New",monospace}
    .neo-gst-status-filed{background:#dcfce7;color:#166534;font-weight:700}
    .neo-gst-status-pending{background:#fef3c7;color:#92400e;font-weight:700}
    .neo-gst-status-missing{background:#f1f5f9;color:#64748b}
    @media (max-width:768px){.neo-gst-overlay{padding:10px}.neo-gst-head,.neo-gst-body{padding:14px}.neo-gst-head{align-items:flex-start}}
  `;
  document.head.appendChild(style);
}

function pill(status) {
  const value = text(status) || "-";
  const cls = /filed/i.test(value) ? "neo-gst-pill-filed" : /pending/i.test(value) ? "neo-gst-pill-pending" : "neo-gst-pill-other";
  return `<span class="neo-gst-pill ${cls}">${escapeHtml(value)}</span>`;
}

function excelMonthLabel(month) {
  const [monthName, year] = String(month || "").split("-");
  const normalizedYear = String(year || "").length === 2 ? `20${String(year || "")}` : String(year || "");
  return `${String(monthName || "").toUpperCase()}-${normalizedYear.toUpperCase()}`;
}

function renderStatusCell(status) {
  const value = text(status);
  if (!value) return '<td class="neo-gst-status-missing">-</td>';
  if (/filed/i.test(value)) return `<td class="neo-gst-status-filed">${escapeHtml(value)}</td>`;
  if (/pending|not filed/i.test(value)) return `<td class="neo-gst-status-pending">${escapeHtml(value)}</td>`;
  return `<td>${escapeHtml(value)}</td>`;
}

function looksMaskedText(value) {
  const normalized = text(value);
  if (!normalized) return true;
  const compact = normalized.replace(/\s+/g, "");
  if (/^(x+|xx[\w.@-]*xx)$/i.test(compact)) return true;
  if (/x{5,}/i.test(compact)) return true;
  return false;
}

function looksMaskedMobile(value) {
  const normalized = text(value).replace(/\D+/g, "");
  if (!normalized) return true;
  if (/^9{10,}$/.test(normalized) || /^0{10,}$/.test(normalized)) return true;
  return /^(\d)\1{9,}$/.test(normalized);
}

function isUsableContactValue(value, type) {
  const source = text(value);
  if (!source) return false;
  if (type === "mobile") return !looksMaskedMobile(source);
  return !looksMaskedText(source);
}

function isValidContactPayload(contacted) {
  const payload = contacted && typeof contacted === "object" ? contacted : {};
  const name = text(payload.name);
  const mobile = text(payload.mobNum);
  const email = text(payload.email);
  if (!name && !mobile && !email) return false;
  if (looksMaskedText(name) && looksMaskedMobile(mobile) && looksMaskedText(email)) return false;
  return true;
}

function normalizePublicServicePayload(result) {
  const tpPayload = unwrapApiPayload(result && result.tpResponse);
  const goodsPayload = unwrapApiPayload(result && result.goodserviceResponse);
  const busplacesPayload = unwrapApiPayload(result && result.busplacesResponse);
  const goodsSource = goodsPayload.goodsServices || goodsPayload.goods_services || goodsPayload.nba || goodsPayload.hsn || goodsPayload;
  const goodsValue = Array.isArray(goodsSource)
    ? goodsSource
        .map((item) => {
          if (item && typeof item === "object") {
            return text(item.goodsDesc || item.serviceDesc || item.description || item.hsnDescription || item.name);
          }
          return text(item);
        })
        .filter(Boolean)
        .join(", ")
    : text(goodsSource);
  return {
    tpPayload,
    goodsPayload,
    busplacesPayload,
    goodsValue,
  };
}

function toTitleCaseLabel(key) {
  const source = text(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : "";
}

function flattenDynamicDetailPairs(value, prefix, pairs) {
  const labelPrefix = text(prefix);
  if (value == null || value === "") return;
  if (Array.isArray(value)) {
    if (!value.length) return;
    if (value.every((item) => item == null || typeof item !== "object")) {
      pairs.push([labelPrefix, value.map((item) => text(item)).filter(Boolean).join(", ")]);
      return;
    }
    if (/^Adadr$/i.test(labelPrefix)) {
      const summary = summarizeAddressCollection(value);
      if (summary) pairs.push(["Additional Addresses", summary]);
      return;
    }
    value.forEach((item, index) => {
      flattenDynamicDetailPairs(item, `${labelPrefix} ${index + 1}`, pairs);
    });
    return;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach((key) => {
      flattenDynamicDetailPairs(value[key], labelPrefix ? `${labelPrefix} - ${toTitleCaseLabel(key)}` : toTitleCaseLabel(key), pairs);
    });
    return;
  }
  pairs.push([labelPrefix, text(value)]);
}

function extractClientDetailPairs(client) {
  const profile = normalizeCompanyProfile(client);
  const basePairs = [
    ["Client ID", client.id],
    ["Client Name", client.name],
    ["GSTIN", client.gstin],
    ["User ID", client.username],
    ["Password", client.password],
    ["Status", client.status],
    ["Trade Name", profile.tradeName],
    ["Legal Name", profile.legalName],
    ["Registration Type", profile.registrationType],
    ["Business Type", profile.constitution],
    ["App Status", profile.appStatus || profile.status],
    ["E-Invoice", profile.einvoiceStatus],
    ["Date Of Registration", profile.registrationDate],
    ["Nature Of Taxpayer", profile.natureOfTaxpayer],
    ["Aadhaar Verified", profile.aadhaarVerified],
    ["Aadhaar Verified Date", profile.aadhaarVerifiedDate],
    ["Nature Of Business", profile.natureOfBusiness],
    ["Composition Rate", profile.compositionRate],
    ["EKYC VFlag", profile.ekycVFlag],
    ["Field Visit Conducted", profile.fieldVisitConducted],
    ["Members", profile.members],
    ["Principal Address", profile.principalAddress],
    ["Additional Place Of Business", profile.additionalPlacesOfBusiness || profile.additionalAddresses],
    ["Contact Name", profile.contactName],
    ["Mobile", profile.mobile],
    ["Email", profile.email],
    ["State Jurisdiction", profile.stateJurisdiction],
    ["CTJ", profile.centerJurisdiction],
    ["GTI FY", profile.gtiFY],
    ["GTI", profile.gti],
    ["Aggregate Turnover FY", profile.aggregateTurnoverFY],
    ["Aggregate Turnover", profile.aggregateTurnover],
    ["Percent Tax In Cash FY", profile.percentTaxInCashFY],
    ["Percent Tax In Cash", profile.percentTaxInCash],
    ["Mandate eInvoice", profile.mandatedeInvoice],
    ["Comp Detl", profile.compDetl],
    ["Goods/Services", profile.goodsServices],
  ].filter((pair) => text(pair[1]));
  const raw = parseResponseJson(client && client.rawJson);
  const dynamicPairs = [];
  if (raw && typeof raw === "object") {
    const payloads = raw.tp || raw.goodservice || raw.busplaces ? raw : { tp: raw };
    if (payloads.tp) flattenDynamicDetailPairs(payloads.tp, "", dynamicPairs);
  }
  const seen = new Set();
  return basePairs
    .concat(dynamicPairs)
    .filter(([label, value]) => {
      const signature = `${text(label)}::${text(value)}`;
      if (!text(value) || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
}

function renderPairsTwoPerRow(pairs) {
  const rows = [];
  for (let index = 0; index < pairs.length; index += 2) {
    rows.push(pairs.slice(index, index + 2));
  }
  return rows
    .map(
      (row) => `<div style="display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:12px;margin-top:10px;">
        ${row
          .map(
            ([label, value]) => `<div style="border:1px solid #d7e2ee;border-radius:10px;padding:10px 12px;background:#f8fafc;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">${escapeHtml(label)}</div>
              <div style="font-size:12px;color:#0f172a;white-space:pre-wrap;word-break:break-word;">${escapeHtml(value)}</div>
            </div>`,
          )
          .join("")}
      </div>`,
    )
    .join("");
}

function mergeCompanyProfileResults(results) {
  const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
  const clientsByGstin = new Map((dataset.clients || []).map((client) => [upper(client.gstin), client]));
  const normalizeClientStatus = (value, fallback) => {
    const source = text(value);
    if (!source) return text(fallback || "Active") || "Active";
    if (/active/i.test(source)) return "Active";
    if (/cancel|inactive|suspend|blocked/i.test(source)) return "Inactive";
    return source;
  };
  results.forEach((item) => {
    const payload = parseResponseJson(item && item.response);
    const gstin = upper(item && item.gstin);
    const existingClient = clientsByGstin.get(gstin) || { id: `client-${gstin}`, gstin, username: gstin, password: "", status: "Active" };
    const existing = normalizeCompanyProfile(existingClient);
    const tradeName = text(payload && (payload.tradeNam || payload.tradeName || payload.trade_name));
    const legalName = text(payload && (payload.lgnm || payload.legalName || payload.legal_name));
    const profileStatus = text(payload && (payload.sts || payload.status));
    const next = mergeCompanyProfileEntry(existing, Object.assign({}, payload || {}, {
      gstin,
      clientName: tradeName || existing.clientName || legalName,
      clientStatus: profileStatus || existing.clientStatus,
      tradeName: tradeName || existing.tradeName || legalName,
      legalName,
    }));
    clientsByGstin.set(
      gstin,
      normalizeClient(
        Object.assign({}, existingClient, next, {
          name: text(next.tradeName || next.clientName || next.legalName) || existingClient.name,
          status: normalizeClientStatus(next.status || next.clientStatus, existingClient.status),
        }),
      ),
    );
  });
  dataset.clients = Array.from(clientsByGstin.values()).sort((a, b) => text(a.name).localeCompare(text(b.name)));
  state.dataset = syncStatusesFromClients(dataset);
  return state.dataset;
}

function mergePublicClientDetailsResults(results) {
  const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
  const clientsByGstin = new Map((dataset.clients || []).map((client) => [upper(client.gstin), client]));
  results.forEach((item) => {
    const gstin = upper(item && item.gstin);
    if (!gstin) return;
    const existingClient = clientsByGstin.get(gstin) || { id: `client-${gstin}`, gstin, username: gstin, password: "", status: "Active" };
    const existing = normalizeCompanyProfile(existingClient);
    const normalized = normalizePublicServicePayload(item);
    const tp = normalized.tpPayload || {};
    const contacted = tp.contacted && typeof tp.contacted === "object" ? tp.contacted : {};
    const busplaceRoot = normalized.busplacesPayload && normalized.busplacesPayload.principalPlace
      ? normalized.busplacesPayload.principalPlace
      : normalized.busplacesPayload || {};
    const next = mergeCompanyProfileEntry(existing, Object.assign({}, tp, {
      gstin,
      clientName: firstDefinedValue(tp, ["tradeNam", "tradeName", "lgnm"], existing.clientName),
      clientStatus: firstDefinedValue(tp, ["sts", "status"], existing.clientStatus),
      tradeName: firstDefinedValue(tp, ["tradeNam", "tradeName", "lgnm"], existing.tradeName),
      legalName: firstDefinedValue(tp, ["lgnm", "legalName"], existing.legalName),
      registrationDate: firstDefinedValue(tp, "rgdt", existing.registrationDate),
      registrationType: firstDefinedValue(tp, "dty", existing.registrationType),
      constitution: firstDefinedValue(tp, "ctb", existing.constitution),
      taxpayerType: firstDefinedValue(tp, "dty", existing.taxpayerType),
      status: firstDefinedValue(tp, ["sts", "status"], existing.status),
      appStatus: firstDefinedValue(tp, ["sts", "status"], existing.appStatus),
      einvoiceStatus: firstDefinedValue(tp, "einvoiceStatus", existing.einvoiceStatus),
      centerJurisdiction: hasOwnValue(tp, "ctj") || hasOwnValue(tp, "ctjCd")
        ? [text(tp.ctj), text(tp.ctjCd)].filter(Boolean).join(" ").trim()
        : existing.centerJurisdiction,
      stateJurisdiction: hasOwnValue(tp, "stj") || hasOwnValue(tp, "stjCd")
        ? [text(tp.stj), text(tp.stjCd)].filter(Boolean).join(" ").trim()
        : existing.stateJurisdiction,
      natureOfBusiness: hasOwnValue(tp, "nba") || (tp.pradr && hasOwnValue(tp.pradr, "ntr"))
        ? (Array.isArray(tp.nba)
            ? tp.nba.map((value) => text(value)).filter(Boolean).join(", ")
            : (tp.nba || (tp.pradr && tp.pradr.ntr)))
        : existing.natureOfBusiness,
      natureOfTaxpayer: firstDefinedValue(tp, "ntcrbs", existing.natureOfTaxpayer),
      aadhaarVerified: firstDefinedValue(tp, "adhrVFlag", existing.aadhaarVerified),
      aadhaarVerifiedDate: firstDefinedValue(tp, "adhrVdt", existing.aadhaarVerifiedDate),
      compositionRate: firstDefinedValue(tp, "cmpRt", existing.compositionRate),
      ekycVFlag: firstDefinedValue(tp, "ekycVFlag", existing.ekycVFlag),
      fieldVisitConducted: firstDefinedValue(tp, "isFieldVisitConducted", existing.fieldVisitConducted),
      gtiFY: firstDefinedValue(tp, "gtiFY", existing.gtiFY),
      gti: firstDefinedValue(tp, "gti", existing.gti),
      aggregateTurnoverFY: firstDefinedValue(tp, "aggreTurnOverFY", existing.aggregateTurnoverFY),
      aggregateTurnover: firstDefinedValue(tp, "aggreTurnOver", existing.aggregateTurnover),
      percentTaxInCashFY: firstDefinedValue(tp, "percentTaxInCashFY", existing.percentTaxInCashFY),
      percentTaxInCash: firstDefinedValue(tp, "percentTaxInCash", existing.percentTaxInCash),
      mandatedeInvoice: firstDefinedValue(tp, "mandatedeInvoice", existing.mandatedeInvoice),
      compDetl: tp.compDetl != null ? tp.compDetl : existing.compDetl,
      members: Array.isArray(tp.mbr) ? tp.mbr.join(", ") : (tp.mbr || existing.members),
      principalAddress:
        formatPrincipalAddress(
          (busplaceRoot && (busplaceRoot.principalAddress || busplaceRoot.adr || busplaceRoot.addr || busplaceRoot.address)) ||
          (tp.pradr && (tp.pradr.adr || tp.pradr.addr || tp.pradr.address)),
        ) || existing.principalAddress,
      contactName: isUsableContactValue(contacted.name, "text") ? contacted.name : existing.contactName,
      mobile: isUsableContactValue(contacted.mobNum, "mobile") ? contacted.mobNum : existing.mobile,
      email: isUsableContactValue(contacted.email, "text") ? contacted.email : existing.email,
      goodsServices: normalized.goodsValue ? normalized.goodsValue : existing.goodsServices,
      tp,
      goodservice: normalized.goodsPayload || {},
      busplaces: normalized.busplacesPayload || {},
    }));
    clientsByGstin.set(
      gstin,
      normalizeClient(
        Object.assign({}, existingClient, next, {
          name: text(next.tradeName || next.clientName || next.legalName) || existingClient.name || gstin,
          status: normalizeClientStatus(next.status || next.clientStatus, existingClient.status),
        }),
      ),
    );
  });
  dataset.clients = Array.from(clientsByGstin.values()).sort((a, b) => text(a.name).localeCompare(text(b.name)));
  state.dataset = syncStatusesFromClients(dataset);
  return state.dataset;
}

function openReturnStatusModal() {
  const existing = document.getElementById("neo-gst-return-overlay");
  if (existing) existing.remove();
  ensureModalStyle();
  const yearOptions = returnStatusYearOptions();
  const defaultYear = yearOptions[0] || String(new Date().getFullYear());
  const overlay = document.createElement("div");
  overlay.id = "neo-gst-return-overlay";
  overlay.className = "neo-gst-overlay";
  overlay.innerHTML = `
    <div class="neo-gst-modal" role="dialog" aria-modal="true" aria-label="Return Status">
      <div class="neo-gst-head">
        <div>
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;margin-bottom:6px;">Dynamic Filters</div>
          <div style="font-size:28px;font-weight:700;line-height:1.1;">Return Status</div>
          <div style="margin-top:8px;font-size:13px;color:#64748b;">GSTIN and taxpayer names are resolved from the <strong>${CLIENT_SHEET_NAME}</strong> sheet. Saved return status rows keep GSTIN and filing values only in <strong>${RETURN_SHEET_NAME}</strong>.</div>
          <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
            <span style="padding:6px 10px;border-radius:999px;background:#ecfdf3;border:1px solid #b7ebc9;color:#166534;font-size:12px;font-weight:700;">1. Vendor verification before payments</span>
            <span style="padding:6px 10px;border-radius:999px;background:#fff7ed;border:1px solid #fdc58b;color:#c2410c;font-size:12px;font-weight:700;">2. Checking fake GSTINs</span>
            <span style="padding:6px 10px;border-radius:999px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:12px;font-weight:700;">3. Compliance tracking of clients/vendors</span>
          </div>
        </div>
        <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-close-return">Close</button>
      </div>
      <div class="neo-gst-body">
        <div class="neo-gst-toolbar">
          <div class="neo-gst-toolbar-row">
            <div id="neo-gst-summary" style="font-size:13px;color:#64748b;margin-right:6px;white-space:nowrap;">Loading...</div>
            <span class="neo-gst-inline-label">From</span>
            <select class="neo-gst-select-compact" id="neo-gst-return-year-from">
              ${yearOptions.map((year) => `<option value="${escapeHtml(year)}" ${year === defaultYear ? "selected" : ""}>${escapeHtml(year)}</option>`).join("")}
            </select>
            <span class="neo-gst-inline-label">To</span>
            <select class="neo-gst-select-compact" id="neo-gst-return-year-to">
              ${yearOptions.map((year) => `<option value="${escapeHtml(year)}" ${year === defaultYear ? "selected" : ""}>${escapeHtml(year)}</option>`).join("")}
            </select>
            <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-open-portal">Open GST Portal</button>
            <button type="button" class="neo-gst-btn neo-gst-btn-primary" id="neo-gst-fetch-return">Get Return Status</button>
            <button type="button" class="neo-gst-btn neo-gst-btn-accent" id="neo-gst-export-excel">Export To Excel</button>
          </div>
          <div class="neo-gst-toolbar-row" style="justify-content:flex-end;">
            <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-bulk-gstin">Bulk Paste GSTINs</button>
            <button type="button" class="neo-gst-btn neo-gst-btn-danger" id="neo-gst-clear-all-gstin">Clear All GSTINs</button>
            <button type="button" class="neo-gst-btn neo-gst-btn-danger" id="neo-gst-clear-return-data">Clear All Data</button>
          </div>
        </div>
        <div class="neo-gst-table-wrap">
          <table class="neo-gst-table">
            <thead>
              <tr id="neo-gst-return-head"></tr>
              <tr class="neo-gst-filter-row" id="neo-gst-return-filter-row"></tr>
            </thead>
            <tbody id="neo-gst-return-body"></tbody>
          </table>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const head = overlay.querySelector("#neo-gst-return-head");
  const filterRow = overlay.querySelector("#neo-gst-return-filter-row");
  const body = overlay.querySelector("#neo-gst-return-body");
  const summary = overlay.querySelector("#neo-gst-summary");
  let data = returnStatusViewData();

  function rebuildTableChrome() {
    const previousGstin = overlay.querySelector("#neo-gst-filter-gstin");
    const previousName = overlay.querySelector("#neo-gst-filter-name");
    const previousType = overlay.querySelector("#neo-gst-filter-type");
    const previousMonthStatuses = {};
    Array.from(filterRow.querySelectorAll("[data-month-filter]")).forEach((select) => {
      previousMonthStatuses[text(select.getAttribute("data-month-filter"))] = text(select.value);
    });

    head.innerHTML = `<th>GSTIN</th><th>CLIENT_NAME</th><th>RETURN TYPE</th>${data.months
      .map((month) => `<th>${escapeHtml(excelMonthLabel(month))}</th>`)
      .join("")}`;

    filterRow.innerHTML = `
      <th><input class="neo-gst-filter-input" id="neo-gst-filter-gstin" type="text" placeholder="Filter GSTIN" /></th>
      <th><input class="neo-gst-filter-input" id="neo-gst-filter-name" type="text" placeholder="Filter name" /></th>
      <th>
        <select class="neo-gst-filter-select" id="neo-gst-filter-type">
          <option value="">All</option>
          ${data.returnTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
        </select>
      </th>
      ${data.months
        .map((month) => {
          const options = (data.monthStatuses[month] || [])
            .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
            .join("");
          return `<th><select class="neo-gst-filter-select" data-month-filter="${escapeHtml(month)}"><option value="">All</option>${options}</select></th>`;
        })
        .join("")}
    `;

    overlay.querySelector("#neo-gst-filter-gstin").value = previousGstin ? previousGstin.value : "";
    overlay.querySelector("#neo-gst-filter-name").value = previousName ? previousName.value : "";
    overlay.querySelector("#neo-gst-filter-type").value = previousType ? previousType.value : "";
    Array.from(filterRow.querySelectorAll("[data-month-filter]")).forEach((select) => {
      const month = text(select.getAttribute("data-month-filter"));
      select.value = previousMonthStatuses[month] || "";
    });
  }

  function refreshData() {
    data = returnStatusViewData();
    rebuildTableChrome();
  }

  function matches(row) {
    const gstinInput = overlay.querySelector("#neo-gst-filter-gstin");
    const nameInput = overlay.querySelector("#neo-gst-filter-name");
    const returnTypeSelect = overlay.querySelector("#neo-gst-filter-type");
    const gstinNeedle = upper(gstinInput.value);
    const nameNeedle = text(nameInput.value).toLowerCase();
    const selectedType = text(returnTypeSelect && returnTypeSelect.value);
    if (gstinNeedle && !upper(row.gstin).includes(gstinNeedle)) return false;
    if (nameNeedle && !text(row.taxpayerName).toLowerCase().includes(nameNeedle)) return false;
    if (selectedType && selectedType !== text(row.returnType)) return false;
    const blocked = Array.from(filterRow.querySelectorAll("[data-month-filter]")).some((select) => {
      const month = text(select.getAttribute("data-month-filter"));
      const value = text(select.value);
      return value && value !== text((row.filings || {})[month]);
    });
    if (blocked) return false;
    return true;
  }

  function renderRows() {
    refreshData();
    const gstinInput = overlay.querySelector("#neo-gst-filter-gstin");
    const nameInput = overlay.querySelector("#neo-gst-filter-name");
    const filtered = data.rows.filter(matches);
    summary.textContent = `${filtered.length} of ${data.rows.length} rows shown`;
    body.innerHTML = filtered.length
      ? filtered
          .map(
            (row) => `<tr><td class="neo-gst-code">${escapeHtml(row.gstin || "-")}</td><td>${escapeHtml(
              row.taxpayerName || "-",
            )}</td><td>${escapeHtml(row.returnType || "-")}</td>${data.months
              .map((month) => renderStatusCell(text((row.filings || {})[month]) || "-"))
              .join("")}</tr>`,
          )
          .join("")
      : `<tr><td colspan="${3 + data.months.length}" style="text-align:center;padding:28px;color:#64748b;">No rows match the current filters.</td></tr>`;
  }

  function resetFilters() {
    const gstinInput = overlay.querySelector("#neo-gst-filter-gstin");
    const nameInput = overlay.querySelector("#neo-gst-filter-name");
    gstinInput.value = "";
    nameInput.value = "";
    Array.from(filterRow.querySelectorAll("select")).forEach((select) => {
      select.value = "";
    });
    renderRows();
  }

  function openPortalSearch() {
    const targetUrl = `https://services.gst.gov.in/services/searchtp#gstin=${encodeURIComponent(RETURN_STATUS_PORTAL_GSTIN)}`;
    const opened = window.open(targetUrl, "_blank", "noopener");
    if (!opened) {
      summary.textContent = `Popup blocked. Open this link manually: https://services.gst.gov.in/services/searchtp`;
      return;
    }
    summary.textContent = "GST portal opened in a new tab.";
  }

  function addManualGstin() {
    const input = window.prompt("Enter GSTIN to add to Return Status");
    const gstin = upper(input);
    if (!gstin) return;
    if (!/^[0-9A-Z]{15}$/.test(gstin)) {
      summary.textContent = "Enter a valid 15-character GSTIN.";
      return;
    }
    state.dataset = ensureReturnStatusRowsForGstin(state.dataset || buildEmptyDataset(), gstin, { manual: true });
    scheduleSave("return-status-manual-gstin");
    renderRows();
    summary.textContent = `${gstin} added to Return Status.`;
  }

function openBulkGstinDialog() {
    const dialog = document.createElement("div");
    dialog.className = "neo-gst-mini-overlay";
    dialog.innerHTML = `
      <div class="neo-gst-mini-modal" role="dialog" aria-modal="true" aria-label="Bulk Paste GSTINs">
        <div class="neo-gst-mini-title">Bulk Paste GSTINs</div>
        <div class="neo-gst-mini-copy">Paste GSTINs separated by new lines, commas, or spaces.</div>
        <textarea class="neo-gst-mini-textarea" id="neo-gst-bulk-text" placeholder="29AALFN5621M1ZT&#10;27AAQCS1842K1Z7"></textarea>
        <div class="neo-gst-mini-actions">
          <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-bulk-cancel">Cancel</button>
          <button type="button" class="neo-gst-btn neo-gst-btn-primary" id="neo-gst-bulk-save">Add GSTINs</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    const textarea = dialog.querySelector("#neo-gst-bulk-text");
    textarea.focus();
    const close = () => dialog.remove();
    dialog.querySelector("#neo-gst-bulk-cancel").addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    dialog.querySelector("#neo-gst-bulk-save").addEventListener("click", () => {
      const tokens = String(textarea.value || "")
        .split(/[\s,;]+/)
        .map((item) => upper(item))
        .filter(Boolean);
      const unique = Array.from(new Set(tokens)).filter((gstin) => /^[0-9A-Z]{15}$/.test(gstin));
      if (!unique.length) {
        summary.textContent = "No valid GSTINs found in bulk paste.";
        close();
        return;
      }
      let nextDataset = state.dataset || buildEmptyDataset();
      unique.forEach((gstin) => {
        nextDataset = ensureReturnStatusRowsForGstin(nextDataset, gstin, { manual: true });
      });
      state.dataset = nextDataset;
      scheduleSave("return-status-bulk-gstin");
      renderRows();
      summary.textContent = `${unique.length} GSTIN(s) added from bulk paste.`;
      close();
    });
  }

function openBulkClientGstinDialog(statusNode, onComplete) {
  const nativeInput = window.prompt(
    "Paste GSTINs separated by new lines, commas, spaces, or semicolons.",
    "",
  );
  if (nativeInput == null) {
    return;
  }
  const nativeTokens = String(nativeInput || "")
    .split(/[\s,;]+/)
    .map((item) => upper(item))
    .filter(Boolean);
  const nativeUnique = Array.from(new Set(nativeTokens)).filter((gstin) => /^[0-9A-Z]{15}$/.test(gstin));
  if (nativeUnique.length) {
    const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
    const byGstin = new Map((dataset.clients || []).map((client) => [upper(client.gstin), client]));
    nativeUnique.forEach((gstin) => {
      if (byGstin.has(gstin)) return;
      byGstin.set(
        gstin,
        normalizeClient({
          id: `client-${gstin}`,
          name: gstin,
          gstin,
          username: gstin,
          password: "",
          status: "Active",
        }),
      );
    });
    dataset.clients = Array.from(byGstin.values()).sort((a, b) => text(a.name).localeCompare(text(b.name)));
    state.dataset = syncStatusesFromClients(dataset);
    setClientShadow(state.dataset.clients);
    scheduleSave("clients-bulk-gstin");
    setTimeout(() => {
      flushSave("clients-bulk-gstin-immediate").catch((error) => console.warn("Neo GST immediate bulk client save failed", error));
    }, 0);
    if (statusNode) {
      statusNode.textContent = `${nativeUnique.length} GSTIN(s) processed for client list.`;
    }
    if (typeof onComplete === "function") {
      onComplete({
        addedCount: nativeUnique.length,
      });
    }
    return;
  }
  if (statusNode) statusNode.textContent = "No valid GSTINs found in bulk paste.";
  const existing = document.querySelector(".neo-gst-mini-overlay");
  if (existing) existing.remove();
  const dialog = document.createElement("div");
  dialog.className = "neo-gst-mini-overlay";
  dialog.innerHTML = `
    <div class="neo-gst-mini-modal" role="dialog" aria-modal="true" aria-label="Bulk Add Client GSTINs">
      <div class="neo-gst-mini-title">Bulk Add Client GSTINs</div>
      <div class="neo-gst-mini-copy">Paste GSTINs separated by new lines, commas, or spaces. New client rows will be created automatically.</div>
      <textarea class="neo-gst-mini-textarea" id="neo-gst-client-bulk-text" placeholder="29AALFN5621M1ZT&#10;27AAQCS1842K1Z7"></textarea>
      <div class="neo-gst-mini-actions">
        <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-client-bulk-cancel">Cancel</button>
        <button type="button" class="neo-gst-btn neo-gst-btn-primary" id="neo-gst-client-bulk-save">Add GSTINs</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  const textarea = dialog.querySelector("#neo-gst-client-bulk-text");
  if (textarea) textarea.focus();
  const close = () => dialog.remove();
  dialog.querySelector("#neo-gst-client-bulk-cancel").addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.querySelector("#neo-gst-client-bulk-save").addEventListener("click", () => {
    const tokens = String(textarea.value || "")
      .split(/[\s,;]+/)
      .map((item) => upper(item))
      .filter(Boolean);
    const unique = Array.from(new Set(tokens)).filter((gstin) => /^[0-9A-Z]{15}$/.test(gstin));
    if (!unique.length) {
      if (statusNode) statusNode.textContent = "No valid GSTINs found in bulk paste.";
      return;
    }
    const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
    const byGstin = new Map((dataset.clients || []).map((client) => [upper(client.gstin), client]));
    unique.forEach((gstin) => {
      if (byGstin.has(gstin)) return;
      byGstin.set(
        gstin,
        normalizeClient({
          id: `client-${gstin}`,
          name: gstin,
          gstin,
          username: gstin,
          password: "",
          status: "Active",
        }),
      );
    });
    dataset.clients = Array.from(byGstin.values()).sort((a, b) => text(a.name).localeCompare(text(b.name)));
    state.dataset = syncStatusesFromClients(dataset);
    setClientShadow(state.dataset.clients);
    scheduleSave("clients-bulk-gstin");
    setTimeout(() => {
      flushSave("clients-bulk-gstin-immediate").catch((error) => console.warn("Neo GST immediate bulk client save failed", error));
    }, 0);
    if (statusNode) {
      statusNode.textContent = `${unique.length} GSTIN(s) processed for client list.`;
    }
    if (typeof onComplete === "function") {
      onComplete({
        addedCount: unique.length,
      });
    }
    close();
  });
}

  function exportCurrentDataToExcel() {
    const snapshot = stripTransientFields(syncStatusesFromClients(normalizeDataset(state.dataset || buildEmptyDataset())));
    buildWorkbookBase64(snapshot)
      .then((base64) => {
        const bytes = decodeBase64(base64);
        const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `neo-gst-return-status-${new Date().toISOString().slice(0, 10)}.xlsx`;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
          URL.revokeObjectURL(anchor.href);
          anchor.remove();
        }, 1000);
        summary.textContent = "Current return status data exported to Excel.";
      })
      .catch((error) => {
        summary.textContent = error && error.message ? error.message : "Unable to export Excel.";
      });
  }

  function clearAllReturnData() {
    const confirmed = window.confirm("Clear all Return Status data?");
    if (!confirmed) return;
    state.dataset = preserveUniqueGstinRows(state.dataset || buildEmptyDataset());
    scheduleSave("return-status-clear-all");
    renderRows();
    summary.textContent = "Return Status data cleared. Unique GSTINs were kept.";
  }

  function clearAllGstins() {
    const confirmed = window.confirm("Clear all GSTINs and all related return status data?");
    if (!confirmed) return;
    const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
    dataset.returnStatuses = [];
    state.dataset = syncStatusesFromClients(
      normalizeDataset({
        version: dataset.version,
        updatedAt: new Date().toISOString(),
        clients: [],
        returnStatuses: [],
      }),
    );
    scheduleSave("return-status-clear-all-gstins");
    renderRows();
    summary.textContent = "All GSTINs and related return data cleared.";
  }

  function getReturnStatus() {
    return fetchReturnStatusData(false);
  }

  function fetchReturnStatusData() {
    let activeGstTabId = null;
    const fromYear = text(overlay.querySelector("#neo-gst-return-year-from").value) || defaultYear;
    const toYear = text(overlay.querySelector("#neo-gst-return-year-to").value) || defaultYear;
    const selectedYears = yearRange(fromYear, toYear);
    const sourceDataset = syncStatusesFromClients(normalizeDataset(state.dataset || buildEmptyDataset()));
    state.dataset = sourceDataset;
    sendRuntimeMessage({ type: "get-active-gst-tab" })
      .then((resp) => {
        if (resp && resp.status && resp.tabId) {
          activeGstTabId = Number(resp.tabId);
        }
        const dataset = syncStatusesFromClients(normalizeDataset(state.dataset || buildEmptyDataset()));
        const requestKeys = new Set();
        const requestItems = [];
        allReturnStatusGstins(dataset).forEach((gstin) => {
          selectedYears.forEach((fy) => {
            const key = `${gstin}::${fy}`;
            if (requestKeys.has(key)) return;
            requestKeys.add(key);
            requestItems.push({ gstin, fy });
          });
        });
        if (!requestItems.length) {
          throw new Error("No GSTINs available.");
        }
        summary.textContent = `Fetching return status for ${requestItems.length} GSTIN/year combination(s)...`;
        return Promise.all(
          requestItems.map((item) =>
            sendRuntimeMessage({
              type: "searchtp-return-status",
              ...(activeGstTabId ? { tabId: activeGstTabId } : {}),
              payload: {
                gstin: item.gstin,
                year: text(item.fy) || fromYear,
                fy: text(item.fy) || fromYear,
              },
            }).then((result) => ({
              gstin: item.gstin,
              ok: !!(result && result.status),
              result,
              error: text(result && result.error),
            })),
          ),
        );
      })
      .then((results) => {
        const successCount = results.filter((item) => item.ok).length;
        const failed = results.filter((item) => !item.ok);
        if (successCount > 0) {
          mergeReturnStatusResults(results.filter((item) => item.ok));
          renderRows();
          return flushSave("return-status-refresh").then(() => ({ results, successCount, failed }));
        }
        return { results, successCount, failed };
      })
      .then(({ successCount, failed }) => {
        const failedGstins = failed
          .map((item) => (item.error ? `${item.gstin} (${item.error})` : item.gstin))
          .filter(Boolean);
        summary.textContent =
          failed.length === 0
            ? `Return status fetched and synced to Excel for all ${successCount} GSTIN(s).`
            : `Return status synced to Excel for ${successCount} GSTIN(s). Failed: ${failedGstins.join(", ") || failed.length}.`;
      })
      .catch((error) => {
        summary.textContent = error && error.message ? error.message : "Unable to get return status.";
      });
  }

  overlay.querySelector("#neo-gst-close-return").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#neo-gst-clear-all-gstin").addEventListener("click", clearAllGstins);
  overlay.querySelector("#neo-gst-clear-return-data").addEventListener("click", clearAllReturnData);
  overlay.querySelector("#neo-gst-bulk-gstin").addEventListener("click", openBulkGstinDialog);
  overlay.querySelector("#neo-gst-open-portal").addEventListener("click", openPortalSearch);
  overlay.querySelector("#neo-gst-fetch-return").addEventListener("click", getReturnStatus);
  overlay.querySelector("#neo-gst-export-excel").addEventListener("click", exportCurrentDataToExcel);
  overlay.addEventListener("input", renderRows);
  overlay.addEventListener("change", renderRows);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  rebuildTableChrome();
  renderRows();
}

function addReturnStatusButton() {
  if (document.getElementById("neo-gst-return-btn")) return;
  const addButton = Array.from(document.querySelectorAll("button")).find((button) => text(button.textContent) === "Add Client");
  if (!addButton || !addButton.parentElement) return;
  const button = document.createElement("button");
  button.id = "neo-gst-return-btn";
  button.type = "button";
  button.className = addButton.className;
  button.style.background = "#0f766e";
  button.style.boxShadow = "0 10px 22px rgba(15,118,110,.22)";
  button.textContent = "Return Status";
  button.addEventListener("click", (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    openReturnStatusModal();
  });
  addButton.parentElement.insertBefore(button, addButton);
}

function addBulkClientGstinButton() {
  const existing = document.getElementById("neo-gst-client-bulk-btn");
  if (existing) return;
}

function addGetDetailsByGstinButton() {
  if (document.getElementById("neo-gst-profile-btn")) return;
  const addButton = Array.from(document.querySelectorAll("button")).find((button) => text(button.textContent) === "Add Client");
  if (!addButton || !addButton.parentElement) return;
  const toolbarHost = addButton.parentElement.parentElement || addButton.parentElement;
  toolbarHost.style.display = "flex";
  toolbarHost.style.flexWrap = "wrap";
  toolbarHost.style.alignItems = "center";
  toolbarHost.style.gap = "14px";
  toolbarHost.style.justifyContent = "flex-end";
  let status = document.getElementById("neo-gst-profile-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "neo-gst-profile-status";
    status.style.minHeight = "22px";
    status.style.maxWidth = "320px";
    status.style.display = "flex";
    status.style.alignItems = "center";
    status.style.justifyContent = "flex-start";
    status.style.padding = "0";
    status.style.background = "transparent";
    status.style.border = "0";
    status.style.fontSize = "12px";
    status.style.fontWeight = "600";
    status.style.lineHeight = "1.45";
    status.style.color = "#64748b";
    status.style.textAlign = "left";
    status.textContent = "";
    toolbarHost && toolbarHost.appendChild(status);
  }
  const button = document.createElement("button");
  button.id = "neo-gst-profile-btn";
  button.type = "button";
  button.className = addButton.className;
  button.style.background = "linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%)";
  button.style.boxShadow = "0 12px 26px rgba(29,78,216,.24)";
  button.style.border = "1px solid rgba(29,78,216,.9)";
  button.style.color = "#fff";
  button.textContent = "Client Details";
  button.addEventListener("click", (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const clients = normalizeDataset(state.dataset || buildEmptyDataset()).clients || [];
    if (!clients.length) return;
    openClientDetailsModal(status);
  });
  addButton.parentElement.insertBefore(button, addButton);
}

function openClientDetailsModal(statusNode) {
  const existing = document.getElementById("neo-gst-client-details-overlay");
  if (existing) existing.remove();
  ensureModalStyle();
  const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
  const profileByGstin = new Map((dataset.clients || []).map((entry) => [upper(entry.gstin), normalizeCompanyProfile(entry)]));
  const rows = (dataset.clients || []).slice().sort((a, b) => text(a.name).localeCompare(text(b.name)));
  const tableModel = buildClientDetailsTableModel(rows, profileByGstin);
  const headerHtml = (tableModel.columns || []).map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const rowsHtml = renderClientDetailsRows(tableModel);
  const emptyStateHtml = `<tr><td colspan="${Math.max(1, (tableModel.columns || []).length)}" style="text-align:center;color:#64748b;padding:28px;">No client details available.</td></tr>`;
  const overlay = document.createElement("div");
  overlay.id = "neo-gst-client-details-overlay";
  overlay.className = "neo-gst-overlay";
  overlay.innerHTML = `
    <div class="neo-gst-modal" role="dialog" aria-modal="true" aria-label="Client Details">
      <div class="neo-gst-head">
        <div>
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d4ed8;margin-bottom:6px;">GitHub JSON View</div>
          <div style="font-size:28px;font-weight:700;line-height:1.1;">Client Details</div>
          <div id="neo-gst-client-details-summary" style="margin-top:10px;font-size:14px;color:#64748b;line-height:1.55;max-width:760px;">${rows.length} client(s) loaded from the JSON file.</div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;">
          <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-client-bulk">Bulk GSTIN</button>
          <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-client-analyze">Analyze</button>
          <button type="button" class="neo-gst-btn neo-gst-btn-primary" id="neo-gst-client-fetch" disabled style="opacity:.55;cursor:not-allowed;">Get Details</button>
          <button type="button" class="neo-gst-btn neo-gst-btn-primary" id="neo-gst-client-save">Save JSON</button>
          <button type="button" class="neo-gst-btn neo-gst-btn-accent" id="neo-gst-client-export">Download Excel</button>
          <button type="button" class="neo-gst-btn neo-gst-btn-secondary" id="neo-gst-client-close">Close</button>
        </div>
      </div>
      <div class="neo-gst-body">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
          <div style="font-size:13px;color:#64748b;line-height:1.5;">Only columns with at least one value are shown, so the table stays cleaner and easier to scan.</div>
        </div>
        <div class="neo-gst-table-wrap" id="neo-gst-client-details-list" style="max-height:72vh;overflow:auto;">
          <table class="neo-gst-table" style="min-width:2200px;">
            <thead>
              <tr>
                ${headerHtml}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || emptyStateHtml}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const summary = overlay.querySelector("#neo-gst-client-details-summary");
  const analyzeButton = overlay.querySelector("#neo-gst-client-analyze");
  const fetchButton = overlay.querySelector("#neo-gst-client-fetch");
  let analysisReady = false;
  let analyzePollTimer = null;
  const analysisCount = (status) =>
    [status && status.searchTp, status && status.goodservice, status && status.busplaces].filter(Boolean).length;
  const setAnalysisReady = (ready) => {
    analysisReady = !!ready;
    if (fetchButton) {
      fetchButton.disabled = !analysisReady;
      fetchButton.style.opacity = analysisReady ? "1" : ".55";
      fetchButton.style.cursor = analysisReady ? "pointer" : "not-allowed";
    }
    if (analyzeButton) {
      analyzeButton.textContent = analysisReady ? "Analyzed" : "Analyze";
    }
  };
  setAnalysisReady(false);
  const refreshClientDetailsTable = () => {
    const refreshed = normalizeDataset(state.dataset || buildEmptyDataset());
    const refreshedProfileByGstin = new Map(
      (refreshed.clients || []).map((entry) => [upper(entry.gstin), normalizeCompanyProfile(entry)]),
    );
    const refreshedRows = (refreshed.clients || [])
      .slice()
      .sort((a, b) => text(a.name).localeCompare(text(b.name)));
    const refreshedTableModel = buildClientDetailsTableModel(refreshedRows, refreshedProfileByGstin);
    const tbody = overlay.querySelector("tbody");
    const theadRow = overlay.querySelector("thead tr");
    const visibleRowsHtml = renderClientDetailsRows(refreshedTableModel);
    if (theadRow) {
      theadRow.innerHTML = (refreshedTableModel.columns || []).map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    }
    if (tbody) {
      tbody.innerHTML =
        visibleRowsHtml ||
        `<tr><td colspan="${Math.max(1, (refreshedTableModel.columns || []).length)}" style="text-align:center;color:#64748b;">No client details available.</td></tr>`;
    }
    return {
      rowCount: refreshedRows.length,
      visibleCount: visibleRowsHtml ? (visibleRowsHtml.match(/<tr>/g) || []).length : 0,
    };
  };
  const clearFetchedDetailsForGstin = (gstin) => {
    const safeGstin = upper(gstin);
    if (!safeGstin) return;
    const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
    dataset.clients = (dataset.clients || []).map((client) => {
      if (upper(client && client.gstin) !== safeGstin) return client;
      return normalizeClient({
        id: client.id,
        name: client.name,
        gstin: client.gstin,
        username: client.username,
        password: client.password,
        status: client.status,
      });
    });
    state.dataset = syncStatusesFromClients(dataset);
    setClientShadow(state.dataset.clients);
  };
  overlay.querySelector("#neo-gst-client-close").addEventListener("click", () => {
    if (analyzePollTimer) {
      clearInterval(analyzePollTimer);
      analyzePollTimer = null;
    }
    overlay.remove();
  });
  overlay.addEventListener("click", (event) => {
    const button = event.target && event.target.closest ? event.target.closest(".neo-gst-clear-details") : null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const gstin = upper(button.getAttribute("data-gstin"));
    if (!gstin) return;
    clearFetchedDetailsForGstin(gstin);
    const counts = refreshClientDetailsTable();
    summary.textContent = `Cleared fetched detail data for ${gstin}. Showing ${counts.visibleCount} row(s) in Client Details.`;
    if (statusNode) statusNode.textContent = summary.textContent;
  });
  analyzeButton.addEventListener("click", () => {
    const clients = normalizeDataset(state.dataset || buildEmptyDataset()).clients || [];
    if (analyzePollTimer) {
      clearInterval(analyzePollTimer);
      analyzePollTimer = null;
    }
    setAnalysisReady(false);
    summary.textContent = "Checking GST portal request capture status...";
    sendRuntimeMessage({ type: "searchtp-template-status" })
      .then((resp) => {
        if (!resp || resp.status === false) {
          throw new Error((resp && resp.error) || "Unable to access GST portal.");
        }
        if (clients[0] && clients[0].gstin && !resp.searchTp) {
          sendRuntimeMessage({ type: "gst-fill-searchtp", payload: { gstin: clients[0].gstin } }).catch(() => {});
        }
        let attempts = 0;
        analyzePollTimer = setInterval(() => {
          attempts += 1;
          sendRuntimeMessage({ type: "searchtp-template-status" })
            .then((status) => {
              const completed = analysisCount(status);
              summary.textContent =
                completed >= 3
                  ? "3/3 analysed. GST portal request templates are ready. You can now use Get Details."
                  : `${completed}/3 analysed. Search one GSTIN manually and click on Principal Place of Business in GST portal once. Then click Get Details to fetch all GSTINs.`;
              if (statusNode) statusNode.textContent = summary.textContent;
              if (completed >= 3) {
                if (analyzePollTimer) {
                  clearInterval(analyzePollTimer);
                  analyzePollTimer = null;
                }
                setAnalysisReady(true);
                return;
              }
              if (attempts >= 120) {
                if (analyzePollTimer) {
                  clearInterval(analyzePollTimer);
                  analyzePollTimer = null;
                }
                summary.textContent = `${completed}/3 analysed. Search one GSTIN manually and click on Principal Place of Business in GST portal once. Then click Get Details to fetch all GSTINs.`;
                if (statusNode) statusNode.textContent = summary.textContent;
              }
            })
            .catch(() => {
              if (attempts >= 120 && analyzePollTimer) {
                clearInterval(analyzePollTimer);
                analyzePollTimer = null;
              }
            });
        }, 1000);
        const initialCount = analysisCount(resp);
        summary.textContent =
          initialCount >= 3
            ? "3/3 analysed. GST portal request templates are ready. You can now use Get Details."
            : `${initialCount}/3 analysed. Search one GSTIN manually and click on Principal Place of Business in GST portal once. Then click Get Details to fetch all GSTINs.`;
        if (initialCount >= 3) {
          if (analyzePollTimer) {
            clearInterval(analyzePollTimer);
            analyzePollTimer = null;
          }
          setAnalysisReady(true);
        }
        if (statusNode) statusNode.textContent = summary.textContent;
      })
      .catch((error) => {
        setAnalysisReady(false);
        summary.textContent = error && error.message ? error.message : "Unable to open GST portal.";
        if (statusNode) statusNode.textContent = summary.textContent;
      });
  });
  const bulkButton = overlay.querySelector("#neo-gst-client-bulk");
  const handleBulkComplete = ({ addedCount }) => {
      const counts = refreshClientDetailsTable();
      summary.textContent = `${addedCount} GSTIN(s) added locally. Showing ${counts.visibleCount} row(s) in Client Details.`;
      if (statusNode) statusNode.textContent = summary.textContent;
    };
  const openBulkDialog = async (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
    const input = window.prompt(
      "Paste GSTINs separated by new lines, commas, spaces, or semicolons.",
      "",
    );
    if (input == null) return;
    const tokens = String(input || "")
      .split(/[\s,;]+/)
      .map((item) => upper(item))
      .filter(Boolean);
    const unique = Array.from(new Set(tokens)).filter((gstin) => /^[0-9A-Z]{15}$/.test(gstin));
    if (!unique.length) {
      summary.textContent = "No valid GSTINs found in bulk paste.";
      if (statusNode) statusNode.textContent = summary.textContent;
      return;
    }
    const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
    const byGstin = new Map((dataset.clients || []).map((client) => [upper(client.gstin), client]));
    unique.forEach((gstin) => {
      if (byGstin.has(gstin)) return;
      byGstin.set(
        gstin,
        normalizeClient({
          id: `client-${gstin}`,
          name: gstin,
          gstin,
          username: gstin,
          password: "",
          status: "Active",
        }),
      );
    });
    dataset.clients = Array.from(byGstin.values()).sort((a, b) => text(a.name).localeCompare(text(b.name)));
    state.dataset = syncStatusesFromClients(dataset);
    setClientShadow(state.dataset.clients);
    handleBulkComplete({ addedCount: unique.length });
  };
  bulkButton.addEventListener("pointerdown", openBulkDialog, true);
  bulkButton.addEventListener("click", openBulkDialog, true);
  overlay.querySelector("#neo-gst-client-save").addEventListener("click", () => {
    summary.textContent = "Saving current table to GitHub JSON...";
    flushSave("client-details-manual-save")
      .then((saved) => {
        const counts = refreshClientDetailsTable();
        summary.textContent = saved
          ? `Saved ${counts.rowCount} client record(s) to the GitHub JSON file.`
          : "Save completed locally, but the GitHub JSON file was not updated.";
        if (statusNode) statusNode.textContent = summary.textContent;
      })
      .catch((error) => {
        summary.textContent = error && error.message ? error.message : "Unable to save the GitHub JSON file.";
        if (statusNode) statusNode.textContent = summary.textContent;
      });
  });
  overlay.querySelector("#neo-gst-client-export").addEventListener("click", () => {
    const snapshot = stripTransientFields(syncStatusesFromClients(normalizeDataset(state.dataset || buildEmptyDataset())));
    buildWorkbookBase64(snapshot)
      .then((base64) => {
        const bytes = decodeBase64(base64);
        const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `neo-gst-client-details-${new Date().toISOString().slice(0, 10)}.xlsx`;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
          URL.revokeObjectURL(anchor.href);
          anchor.remove();
        }, 1000);
        summary.textContent = "Client details exported to Excel.";
      })
      .catch((error) => {
        summary.textContent = error && error.message ? error.message : "Unable to export Excel.";
      });
  });
  fetchButton.addEventListener("click", () => {
    if (!analysisReady) {
      summary.textContent = "Run Analyze first. Search one GSTIN manually and click on Principal Place of Business in GST portal once. Then click Get Details to fetch all GSTINs.";
      if (statusNode) statusNode.textContent = summary.textContent;
      return;
    }
    const clients = normalizeDataset(state.dataset || buildEmptyDataset()).clients || [];
    if (!clients.length) return;
    summary.textContent = `Fetching details for ${clients.length} GSTIN(s)...`;
    Promise.all(
      clients.map((client) =>
        sendRuntimeMessage({
          type: "public-client-details",
          payload: { gstin: client.gstin },
        }).then((result) => ({
          gstin: client.gstin,
          ok: hasUsablePublicClientDetails(result),
          tpResponse: result && result.tpResponse,
          goodserviceResponse: result && result.goodserviceResponse,
          busplacesResponse: result && result.busplacesResponse,
          error: text(result && result.error),
        })),
      ),
    )
      .then((results) => {
        const success = results.filter((item) => item.ok);
        if (!success.length) {
          const failedGstins = results.map((item) => (item.error ? `${item.gstin} (${item.error})` : item.gstin)).join(", ");
          throw new Error(failedGstins || "No client details were fetched.");
        }
        mergePublicClientDetailsResults(success);
        return flushSave("public-client-details-refresh").then((saved) => ({ saved, count: success.length }));
      })
      .then(({ saved, count }) => {
        maybeHydrateMountedApp((state.dataset && state.dataset.clients) || []);
        const counts = refreshClientDetailsTable();
        summary.textContent = saved
          ? `Fetched and updated details for ${count} GSTIN(s). Showing ${counts.visibleCount} populated row(s).`
          : `Fetched details for ${count} GSTIN(s), but the GitHub JSON file was not updated.`;
        if (statusNode) statusNode.textContent = summary.textContent;
      })
      .catch((error) => {
        summary.textContent = error && error.message ? error.message : "Unable to fetch client details.";
        if (statusNode) statusNode.textContent = summary.textContent;
      });
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
}

function addRemoteBadge() {
  if (document.getElementById("neo-gst-remote-badge")) return;
  const header = Array.from(document.querySelectorAll("header")).find((node) => /neo gst/i.test(node.textContent || ""));
  if (!header) return;
  const anchor = Array.from(header.querySelectorAll("div")).find((node) => /secure session active/i.test(node.textContent || "")) || header.querySelector("div");
  if (!anchor) return;
  const badge = document.createElement("div");
  badge.id = "neo-gst-remote-badge";
  badge.style.marginLeft = "12px";
  badge.style.padding = "7px 12px";
  badge.style.borderRadius = "999px";
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "700";
  badge.style.letterSpacing = ".06em";
  badge.style.textTransform = "uppercase";
  badge.style.background = "#dcfce7";
  badge.style.color = "#166534";
  badge.style.cursor = "pointer";
  badge.title = "Open GitHub sync setup";
  badge.textContent = "GitHub Setup";
  badge.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openGithubSetupModal();
  });
  anchor.appendChild(badge);
  window.addEventListener(STATUS_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.pending) {
      badge.style.background = "#fef3c7";
      badge.style.color = "#92400e";
      badge.textContent = "GitHub Updating";
      badge.title = detail.error || detail.message || "";
      return;
    }
    if (detail.connected) {
      badge.style.background = "#dcfce7";
      badge.style.color = "#166534";
      badge.textContent = detail.canWrite ? "GitHub Synced" : "GitHub Read Only";
      badge.title = detail.message || "Open GitHub sync setup";
      return;
    }
    if (detail.error) {
      badge.style.background = "#fee2e2";
      badge.style.color = "#991b1b";
      badge.textContent = "GitHub Error";
      badge.title = detail.error || detail.message || "Open GitHub sync setup";
      return;
    }
    badge.style.background = "#e2e8f0";
    badge.style.color = "#334155";
    badge.textContent = "Local Mode";
    badge.title = detail.message || "Open GitHub sync setup";
  });
}

function renderGithubConfigRows(config) {
  const safe = config || {};
  const rows = [
    ["Token", safe.token ? `${safe.token.slice(0, 6)}...${safe.token.slice(-4)}` : ""],
    ["Owner", safe.owner || ""],
    ["Repository", safe.repo || ""],
    ["File path", safe.path || ""],
    ["Branch", safe.branch || ""],
  ];
  return rows
    .map(
      ([label, value]) => `
        <tr>
          <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5edf7;background:#f8fbff;color:#475569;width:150px;">${escapeHtml(label)}</th>
          <td style="padding:10px 12px;border-bottom:1px solid #e5edf7;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(value || "-")}</td>
        </tr>`,
    )
    .join("");
}

function githubConfigFilePayload(config) {
  const safe = normalizeGithubConfig(config);
  if (!safe) return null;
  return {
    token: safe.token,
    owner: safe.owner,
    repo: safe.repo,
    path: safe.path,
    branch: safe.branch || "main",
  };
}

function downloadGithubConfigJson(config) {
  const payload = githubConfigFilePayload(config);
  if (!payload) throw new Error("No complete GitHub config is available to download.");
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `neo-gst-github-config-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
  }, 1000);
}

async function copyTextToClipboard(value) {
  const content = String(value == null ? "" : value);
  if (!content) throw new Error("Nothing to copy.");
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy failed.");
}

async function copyGithubConfigJson(config) {
  const payload = githubConfigFilePayload(config);
  if (!payload) throw new Error("No complete GitHub config is available to copy.");
  await copyTextToClipboard(JSON.stringify(payload, null, 2));
}

function downloadGithubDataJson(dataset) {
  const safeDataset = dataset ? normalizeDataset(unwrapDatasetEnvelope(dataset)) : getDatasetCache() || buildEmptyDataset();
  const blob = new Blob([buildRemoteJsonText(safeDataset)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `neo-gst-data-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
  }, 1000);
}

async function importGithubDataJson(rawText, config) {
  const dataset = parseRemoteJsonText(rawText);
  const payload = stripTransientFields(syncStatusesFromClients(normalizeDataset(dataset)));
  state.dataset = payload;
  state.remoteInitialized = true;
  setClientShadow(payload.clients || []);
  setDatasetCache(payload);
  maybeHydrateMountedApp(payload.clients || []);
  const safeConfig = normalizeGithubConfig(config || (state.meta && state.meta.config) || readStoredGithubConfig());
  if (safeConfig) {
    const savedConfig = writeStoredGithubConfig(safeConfig);
    state.meta = {
      provider: "github",
      canWrite: true,
      config: savedConfig,
      sha: state.meta && state.meta.sha ? state.meta.sha : "",
    };
    await writeRemoteDataset(payload, state.meta);
    state.lastSavedSignature = signature(payload);
    emitStatus({
      connected: true,
      canWrite: true,
      pending: false,
      message: `Imported data JSON and saved ${(payload.clients || []).length} client(s) to GitHub.`,
    });
    return { dataset: payload, savedRemote: true };
  }
  emitStatus({
    connected: false,
    canWrite: false,
    pending: false,
    message: `Imported data JSON locally with ${(payload.clients || []).length} client(s).`,
  });
  return { dataset: payload, savedRemote: false };
}

async function applyGithubConfig(config) {
  const fileState = await fetchGithubFileState(config);
  const dataset = fileState.missing ? getDatasetCache() || buildEmptyDataset() : parseRemoteJsonText(fileState.content);
  const savedConfig = writeStoredGithubConfig(config);
  state.meta = {
    provider: "github",
    canWrite: true,
    config: savedConfig,
    sha: fileState.sha,
  };
  state.dataset = dataset;
  state.lastSavedSignature = signature(stripTransientFields(dataset));
  state.remoteInitialized = true;
  setClientShadow(dataset.clients || []);
  setDatasetCache(dataset);
  maybeHydrateMountedApp(dataset.clients || []);
  if (fileState.missing) {
    await writeRemoteDataset(dataset, state.meta);
  }
  emitStatus({
    connected: true,
    canWrite: true,
    pending: false,
    message: fileState.missing
      ? "GitHub file was not found, so a new JSON file was created."
      : workbookLoadMessage(dataset, state.meta),
  });
  return dataset;
}

function openGithubSetupModal() {
  const existing = document.getElementById("neo-gst-github-setup-overlay");
  if (existing) existing.remove();
  const stored = readStoredGithubConfig();
  const overlay = document.createElement("div");
  overlay.id = "neo-gst-github-setup-overlay";
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.34);backdrop-filter:blur(5px);z-index:10000;"></div>
    <div role="dialog" aria-modal="true" aria-label="GitHub setup" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 48px));max-height:calc(100vh - 48px);background:#fff;border:1px solid #dbe7f5;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.2);z-index:10001;overflow:hidden;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid #e5edf7;background:linear-gradient(180deg,#f9fbff,#f4f8ff);">
        <div>
          <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">GitHub sync</div>
          <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:3px;">Connect client JSON file</div>
        </div>
        <button type="button" id="neo-gst-github-close" style="border:0;background:#eff6ff;color:#1d4ed8;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;">Close</button>
      </div>
      <div style="padding:18px 20px;display:grid;gap:14px;overflow:auto;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;color:#334155;">
          <label style="display:inline-flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid #cbdcf3;border-radius:999px;background:#f8fbff;cursor:pointer;">
            <input type="radio" name="neo-gst-github-mode" value="combo" checked>
            Token and GitHub file link
          </label>
          <label style="display:inline-flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid #cbdcf3;border-radius:999px;background:#fff;cursor:pointer;">
            <input type="radio" name="neo-gst-github-mode" value="table">
            Enter details separately
          </label>
        </div>
        <div id="neo-gst-github-combo-panel">
          <label style="display:grid;gap:7px;">
            <span style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.06em;">Token and GitHub file link</span>
            <input id="neo-gst-github-combo" type="password" placeholder="github_token&https://github.com/owner/repo/blob/main/neo-gst-data.json" style="width:100%;box-sizing:border-box;border:1px solid #cbdcf3;border-radius:12px;padding:12px 14px;font-size:13px;color:#0f172a;outline:none;">
          </label>
          <div style="font-size:12px;color:#64748b;line-height:1.55;margin-top:8px;">Paste one value. Everything before the GitHub link is treated as the token. The link is used to read owner, repository, branch, and file path.</div>
        </div>
        <div id="neo-gst-github-table-panel" hidden>
          <table style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cbdcf3;border-radius:12px;overflow:hidden;font-size:13px;">
            <tbody>
              ${[
                ["token", "Token", "GitHub token"],
                ["owner", "Owner", "GitHub username or organization"],
                ["repo", "Repository", "Repository name"],
                ["path", "File path", "neo-gst-data.json"],
                ["branch", "Branch", "main"],
              ].map(([key, label, placeholder]) => `
                <tr>
                  <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5edf7;background:#f8fbff;color:#475569;width:150px;">${label}</th>
                  <td style="padding:8px 10px;border-bottom:1px solid #e5edf7;">
                    <input id="neo-gst-github-${key}" type="${key === "token" ? "password" : "text"}" value="${escapeHtml(stored && stored[key] ? stored[key] : key === "branch" ? "main" : "")}" placeholder="${escapeHtml(placeholder)}" style="width:100%;box-sizing:border-box;border:1px solid #dbe7f5;border-radius:9px;padding:9px 10px;font-size:13px;color:#0f172a;outline:none;">
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <table style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cbdcf3;border-radius:12px;overflow:hidden;font-size:13px;">
          <tbody id="neo-gst-github-details">${renderGithubConfigRows(stored)}</tbody>
        </table>
        <div style="border:1px solid #dbe7f5;background:#f8fbff;border-radius:12px;padding:12px 14px;font-size:12px;color:#475569;line-height:1.55;">
          <div style="font-weight:800;color:#0f172a;margin-bottom:6px;">Config JSON format</div>
          <code style="display:block;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f172a;">{
  "token": "github_token",
  "owner": "github_user_or_org",
  "repo": "repository_name",
  "path": "neo-gst-data.json",
  "branch": "main"
}</code>
        </div>
        <div id="neo-gst-github-status" style="min-height:20px;font-size:13px;color:#64748b;"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <input type="file" id="neo-gst-github-upload-file" accept="application/json,.json" hidden>
          <button type="button" id="neo-gst-github-upload" style="border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer;">Upload Data JSON</button>
          <button type="button" id="neo-gst-github-download-data" style="border:1px solid #bfdbfe;background:#fff;color:#1d4ed8;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer;">Download Data JSON</button>
          <button type="button" id="neo-gst-github-copy" style="border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer;">Copy Config JSON</button>
          <button type="button" id="neo-gst-github-download" style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer;">Download Config JSON</button>
          <button type="button" id="neo-gst-github-clear" style="border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer;">Use Local Mode</button>
          <button type="button" id="neo-gst-github-test" style="border:0;background:#0f766e;color:#fff;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 10px 22px rgba(15,118,110,.18);">Test & Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const backdrop = overlay.firstElementChild;
  const input = overlay.querySelector("#neo-gst-github-combo");
  const modeInputs = Array.from(overlay.querySelectorAll("input[name='neo-gst-github-mode']"));
  const comboPanel = overlay.querySelector("#neo-gst-github-combo-panel");
  const tablePanel = overlay.querySelector("#neo-gst-github-table-panel");
  const tableBody = overlay.querySelector("#neo-gst-github-details");
  const status = overlay.querySelector("#neo-gst-github-status");
  const testButton = overlay.querySelector("#neo-gst-github-test");
  const clearButton = overlay.querySelector("#neo-gst-github-clear");
  const uploadButton = overlay.querySelector("#neo-gst-github-upload");
  const downloadButton = overlay.querySelector("#neo-gst-github-download");
  const copyButton = overlay.querySelector("#neo-gst-github-copy");
  const downloadDataButton = overlay.querySelector("#neo-gst-github-download-data");
  const uploadFile = overlay.querySelector("#neo-gst-github-upload-file");
  let parsedConfig = stored;
  const tableFields = ["token", "owner", "repo", "path", "branch"].reduce((acc, key) => {
    acc[key] = overlay.querySelector(`#neo-gst-github-${key}`);
    return acc;
  }, {});
  const activeMode = () => {
    const selected = modeInputs.find((item) => item.checked);
    return selected ? selected.value : "combo";
  };
  const readTableConfig = () =>
    normalizeGithubConfig({
      token: tableFields.token && tableFields.token.value,
      owner: tableFields.owner && tableFields.owner.value,
      repo: tableFields.repo && tableFields.repo.value,
      path: tableFields.path && tableFields.path.value,
      branch: (tableFields.branch && tableFields.branch.value) || "main",
    });
  const fillTableConfig = (config) => {
    const safe = normalizeGithubConfig(config);
    if (!safe) throw new Error("Uploaded JSON is missing token, owner, repo, path, or branch.");
    Object.keys(tableFields).forEach((key) => {
      if (tableFields[key]) tableFields[key].value = safe[key] || "";
    });
    const tableMode = modeInputs.find((item) => item.value === "table");
    if (tableMode) tableMode.checked = true;
    input.value = "";
    parsedConfig = safe;
    updatePreview();
    return safe;
  };
  const setStatus = (message, color) => {
    status.textContent = message || "";
    status.style.color = color || "#64748b";
  };
  const updatePreview = () => {
    try {
      const mode = activeMode();
      comboPanel.hidden = mode !== "combo";
      tablePanel.hidden = mode !== "table";
      parsedConfig = mode === "combo"
        ? input.value.trim() ? parseGithubConfigInput(input.value) : stored
        : readTableConfig();
      tableBody.innerHTML = renderGithubConfigRows(parsedConfig);
      setStatus(parsedConfig ? "Ready to test this GitHub file." : "Local mode is active until GitHub details are saved.");
    } catch (error) {
      parsedConfig = null;
      tableBody.innerHTML = renderGithubConfigRows(null);
      setStatus(error && error.message ? error.message : "Unable to parse GitHub details.", "#b91c1c");
    }
  };
  input.addEventListener("input", updatePreview);
  modeInputs.forEach((item) => item.addEventListener("change", updatePreview));
  Object.values(tableFields).forEach((field) => {
    if (field) field.addEventListener("input", updatePreview);
  });
  testButton.addEventListener("click", async () => {
    try {
      updatePreview();
      if (!parsedConfig) throw new Error("Enter token and GitHub file link first.");
      testButton.disabled = true;
      testButton.textContent = "Testing...";
      setStatus("Testing GitHub access and loading JSON file...");
      const dataset = await applyGithubConfig(parsedConfig);
      setStatus(`GitHub synced. Loaded ${(dataset.clients || []).length} client(s).`, "#166534");
    } catch (error) {
      setStatus(error && error.message ? error.message : "GitHub test failed.", "#b91c1c");
      emitStatus({
        connected: false,
        canWrite: false,
        pending: false,
        error: error && error.message ? error.message : "GitHub test failed.",
        message: "GitHub Error",
      });
    } finally {
      testButton.disabled = false;
      testButton.textContent = "Test & Save";
    }
  });
  clearButton.addEventListener("click", () => {
    clearStoredGithubConfig();
    state.meta = null;
    state.remoteInitialized = true;
    if (!state.dataset) state.dataset = getDatasetCache() || buildEmptyDataset();
    setDatasetCache(state.dataset);
    emitStatus({
      connected: false,
      canWrite: false,
      pending: false,
      message: "Local mode. Changes are saved in browser storage.",
    });
    input.value = "";
    parsedConfig = null;
    tableBody.innerHTML = renderGithubConfigRows(null);
    setStatus("Local mode enabled.", "#334155");
  });
  uploadButton.addEventListener("click", () => {
    if (uploadFile) uploadFile.click();
  });
  if (uploadFile) {
    uploadFile.addEventListener("change", () => {
      const file = uploadFile.files && uploadFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          try {
            updatePreview();
          } catch (error) {
            parsedConfig = null;
          }
          setStatus("Importing data JSON...");
          const result = await importGithubDataJson(String(reader.result || ""), parsedConfig || stored);
          setStatus(
            result.savedRemote
              ? `Data JSON imported and saved to GitHub. Loaded ${(result.dataset.clients || []).length} client(s).`
              : `Data JSON imported locally. Loaded ${(result.dataset.clients || []).length} client(s).`,
            "#166534",
          );
        } catch (error) {
          setStatus(error && error.message ? error.message : "Unable to read data JSON.", "#b91c1c");
        } finally {
          uploadFile.value = "";
        }
      };
      reader.onerror = () => {
        setStatus("Unable to read selected JSON file.", "#b91c1c");
        uploadFile.value = "";
      };
      reader.readAsText(file);
    });
  }
  if (downloadDataButton) {
    downloadDataButton.addEventListener("click", () => {
      try {
        downloadGithubDataJson(state.dataset || getDatasetCache() || buildEmptyDataset());
        setStatus("Data JSON downloaded.", "#166534");
      } catch (error) {
        setStatus(error && error.message ? error.message : "Unable to download data JSON.", "#b91c1c");
      }
    });
  }
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      try {
        updatePreview();
        await copyGithubConfigJson(parsedConfig || stored);
        setStatus("Config JSON copied.", "#166534");
      } catch (error) {
        setStatus(error && error.message ? error.message : "Unable to copy config JSON.", "#b91c1c");
      }
    });
  }
  downloadButton.addEventListener("click", () => {
    try {
      updatePreview();
      downloadGithubConfigJson(parsedConfig || stored);
      setStatus("Config JSON downloaded.", "#166534");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Unable to download config JSON.", "#b91c1c");
    }
  });
  backdrop.addEventListener("click", close);
  overlay.querySelector("#neo-gst-github-close").addEventListener("click", close);
  updatePreview();
}

function openGstApiGuideModal() {
  const existing = document.getElementById("neo-gst-api-guide-overlay");
  if (existing) existing.remove();
  const rows = [
    ["Client details by GSTIN", "services.gst.gov.in"],
    ["No login required for client details by GSTIN", "publicservices.gst.gov.in"],
    ["All returns and ledgers except GSTR-2B, cash ledger and challans", "return.gst.gov.in"],
    ["GSTR-2B", "gstr2b.gst.gov.in"],
    ["Cash ledger and challans", "payment.gst.gov.in"],
  ];
  const overlay = document.createElement("div");
  overlay.id = "neo-gst-api-guide-overlay";
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.34);backdrop-filter:blur(5px);z-index:10000;"></div>
    <div role="dialog" aria-modal="true" aria-label="GST API guide" style="position:fixed;right:24px;top:72px;width:min(560px,calc(100vw - 48px));background:#fff;border:1px solid #dbe7f5;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.2);z-index:10001;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid #e5edf7;background:linear-gradient(180deg,#f9fbff,#f4f8ff);">
        <div>
          <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">GST portal guide</div>
          <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:3px;">Where to go for each task</div>
        </div>
        <button type="button" id="neo-gst-api-guide-close" style="border:0;background:#eff6ff;color:#1d4ed8;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;">Close</button>
      </div>
      <div style="padding:18px 20px;">
        <table style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cbdcf3;border-radius:12px;overflow:hidden;font-size:13px;">
          <thead>
            <tr style="background:#dbeafe;color:#0f172a;text-align:left;">
              <th style="padding:11px 12px;border-bottom:1px solid #cbdcf3;">For this</th>
              <th style="padding:11px 12px;border-bottom:1px solid #cbdcf3;">Go to</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(([task, host], index) => `
              <tr style="background:${index % 2 ? "#fff" : "#f8fbff"};">
                <td style="padding:11px 12px;border-bottom:1px solid #e5edf7;color:#334155;">${escapeHtml(task)}</td>
                <td style="padding:11px 12px;border-bottom:1px solid #e5edf7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f172a;">${escapeHtml(host)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.firstElementChild.addEventListener("click", close);
  overlay.querySelector("#neo-gst-api-guide-close").addEventListener("click", close);
}

function addGstInfoButton() {
  const existing = document.getElementById("neo-gst-api-info-btn");
  if (existing) existing.remove();
  const loginButton = Array.from(document.querySelectorAll("button")).find((button) =>
    /\bLogin to Portal\b/i.test((button.textContent || "").trim()),
  );
  if (!loginButton || !loginButton.parentElement) return;
  const headerActions = loginButton.parentElement;
  const activePill = Array.from(headerActions.children).find((node) => /^active$/i.test(text(node.textContent)));
  if (!activePill) return;
  const button = document.createElement("button");
  button.id = "neo-gst-api-info-btn";
  button.type = "button";
  button.title = "GST portal guide";
  button.setAttribute("aria-label", "GST portal guide");
  button.textContent = "i";
  button.style.width = "28px";
  button.style.height = "28px";
  button.style.borderRadius = "999px";
  button.style.border = "1px solid #bfdbfe";
  button.style.background = "#eff6ff";
  button.style.color = "#1d4ed8";
  button.style.fontWeight = "800";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 6px 14px rgba(37,99,235,.12)";
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.flex = "0 0 auto";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openGstApiGuideModal();
  });
  headerActions.insertBefore(button, activePill);
}

function removePortalDebugNavigation() {
  Array.from(document.querySelectorAll("button")).forEach((button) => {
    if (/portal\s*debug/i.test(text(button.textContent))) {
      button.style.display = "none";
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    }
  });
}

function enhanceReconciliationWorkspace() {
  const label = currentViewLabel().toLowerCase();
  if (!/recon/.test(label)) return;
  if (document.getElementById("neo-gst-reconciliation-tabs")) return;
  const main = Array.from(document.querySelectorAll("div")).find((node) => {
    const className = text(node.className);
    return /\bflex-1\b/.test(className) && /overflow-y-auto/.test(className) && !/text-slate-300/.test(className);
  });
  if (!main) return;
  main.innerHTML = `
    <div id="neo-gst-reconciliation-tabs" style="padding:28px;min-height:100%;background:#f8fafc;">
      <div style="max-width:1180px;margin:0 auto;">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;">
          <div>
            <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Reconciliation</div>
            <h2 style="font-size:28px;line-height:1.15;margin:4px 0 0;color:#0f172a;">GST comparison workspace</h2>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
          ${["GSTR-1 vs GSTR-3B", "GSTR-2A vs GSTR-3B", "GSTR-3B vs GSTR-2B", "GSTR-2A vs GSTR-2B", "Books vs GSTR-1", "Books vs GSTR-2B"].map((name, index) => `
            <button type="button" style="border:1px solid ${index === 0 ? "#0f766e" : "#cbd5e1"};background:${index === 0 ? "#0f766e" : "#fff"};color:${index === 0 ? "#fff" : "#334155"};border-radius:10px;padding:10px 14px;font-size:13px;font-weight:700;box-shadow:${index === 0 ? "0 10px 22px rgba(15,118,110,.18)" : "0 5px 12px rgba(15,23,42,.05)"};">${name}</button>
          `).join("")}
        </div>
        <div style="border:1px solid #dbe7f5;background:#fff;border-radius:16px;padding:24px;box-shadow:0 16px 36px rgba(15,23,42,.06);">
          <div style="font-size:16px;font-weight:800;color:#0f172a;margin-bottom:6px;">UI preview only</div>
          <div style="font-size:13px;color:#64748b;line-height:1.6;">Select a reconciliation tab above. Data upload, matching rules, and variance reports can be wired in next.</div>
        </div>
      </div>
    </div>
  `;
}

function fixClientManagementHeaderAlignment() {
  const heading = Array.from(document.querySelectorAll("h1,h2")).find((node) => /^client management$/i.test(text(node.textContent)));
  if (!heading) return;
  heading.style.textAlign = "left";
  heading.style.width = "100%";
  heading.style.marginLeft = "0";
  heading.style.marginRight = "0";
  const parent = heading.parentElement;
  if (parent) {
    parent.style.textAlign = "left";
    parent.style.alignItems = "flex-start";
    parent.style.justifyContent = "flex-start";
    parent.style.justifySelf = "start";
    parent.style.alignSelf = "stretch";
    parent.style.width = "100%";
    parent.style.maxWidth = "100%";
    parent.style.order = "-1";
  }
  const heroRow = parent && parent.parentElement;
  if (heroRow) {
    heroRow.style.display = "grid";
    heroRow.style.gridTemplateColumns = "1fr";
    heroRow.style.justifyItems = "stretch";
    heroRow.style.alignItems = "start";
    heroRow.style.textAlign = "left";
    heroRow.style.gap = "22px";
  }
  const sub = Array.from(document.querySelectorAll("p,div")).find((node) =>
    /^manage credentials and automate gst return downloads\.$/i.test(text(node.textContent)),
  );
  if (sub) {
    sub.style.textAlign = "left";
    sub.style.width = "100%";
    sub.style.marginLeft = "0";
    sub.style.marginRight = "0";
    const subParent = sub.parentElement;
    if (subParent) {
      subParent.style.textAlign = "left";
      subParent.style.alignItems = "flex-start";
    }
  }
}

function currentViewLabel() {
  const activeSidebarButton = Array.from(document.querySelectorAll("button,a,[role='button']")).find((node) => {
    const className = text(node.className);
    const label = text(node.textContent).toLowerCase();
    if (!/^(company profile|download|download returns|reco-2a|reco-2b|itc claim|settings)$/.test(label)) return false;
    return /bg-blue-600|text-white|aria-current|active/i.test(className) || node.getAttribute("aria-current") === "page";
  });
  const activeSidebarLabel = text(activeSidebarButton && activeSidebarButton.textContent);
  if (activeSidebarLabel) return activeSidebarLabel;
  const heading = Array.from(document.querySelectorAll("h1")).find((node) => / - /i.test(text(node.textContent)));
  const content = text(heading && heading.textContent);
  const match = content.match(/^(.+?)\s*-\s*/);
  return text(match ? match[1] : "");
}

function activeDownloadNavigationPresent() {
  return Array.from(document.querySelectorAll("button,a,div,span,[role='button']")).some((node) => {
    const label = text(node.textContent).toLowerCase().replace(/\s+/g, " ");
    if (label !== "download" && label !== "downloads" && label !== "download returns") return false;
    const className = `${text(node.className)} ${text(node.parentElement && node.parentElement.className)}`;
    return (
      /bg-blue|text-white|active|selected|font-semibold|download/i.test(className) ||
      node.getAttribute("aria-current") === "page" ||
      !!node.closest("[class*='bg-blue'],[class*='text-white']")
    );
  });
}

function ensureDownloadProfileHideStyle() {
  if (document.getElementById("neo-gst-download-profile-hide-style")) return;
  const style = document.createElement("style");
  style.id = "neo-gst-download-profile-hide-style";
  style.textContent = `
    body.neo-gst-download-active #neo-gst-company-profile-card,
    body.neo-gst-download-active [data-neo-gst-hidden-download-profile="1"] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function downloadEmptyPeriodMessageNode() {
  const matches = Array.from(document.querySelectorAll("td,div,span,p"))
    .filter((node) => /no periods available.*selected financial year/i.test(text(node.textContent)))
    .sort((left, right) => text(left.textContent).length - text(right.textContent).length);
  return matches[0] || null;
}

function removeInjectedCompanyProfileDetails() {
  const cards = new Set();
  const idCard = document.getElementById("neo-gst-company-profile-card");
  if (idCard) cards.add(idCard);
  Array.from(document.querySelectorAll("h1,h2,h3,div")).forEach((node) => {
    if (!/^company profile details$/i.test(text(node.textContent))) return;
    let candidate = node.closest("#neo-gst-company-profile-card") || node;
    let cursor = candidate.parentElement;
    while (cursor && cursor !== document.body) {
      const cursorText = text(cursor.textContent).toLowerCase();
      if (!/company profile details/.test(cursorText)) break;
      if (/financial year|category|subcategory|download all json|download all excel|generate all/i.test(cursorText)) break;
      if (/gst portal details|mapped gst profile fields|principal address|additional place of business/i.test(cursorText)) {
        candidate = cursor;
      }
      cursor = cursor.parentElement;
    }
    if (candidate) cards.add(candidate);
  });
  cards.forEach((card) => {
    if (card && card.remove) card.remove();
  });
}

function forceHideCompanyProfileDetails() {
  ensureDownloadProfileHideStyle();
  document.body.classList.add("neo-gst-download-active");
  removeInjectedCompanyProfileDetails();
  Array.from(document.querySelectorAll("h1,h2,h3,div")).forEach((node) => {
    if (!/^company profile details$/i.test(text(node.textContent))) return;
    let card = node.closest("#neo-gst-company-profile-card") || node;
    let cursor = card.parentElement;
    while (cursor && cursor !== document.body) {
      const cursorText = text(cursor.textContent).toLowerCase();
      if (!/company profile details/.test(cursorText)) break;
      if (/financial year|category|subcategory|download all json|download all excel|generate all/i.test(cursorText)) break;
      if (/gst portal details|mapped gst profile fields|principal address|additional place of business/i.test(cursorText)) {
        card = cursor;
      }
      cursor = cursor.parentElement;
    }
    if (card) {
      card.style.display = "none";
      card.setAttribute("data-neo-gst-hidden-download-profile", "1");
    }
  });
}

function restoreHiddenCompanyProfileDetails() {
  document.body.classList.remove("neo-gst-download-active");
  Array.from(document.querySelectorAll("[data-neo-gst-hidden-download-profile='1']")).forEach((node) => {
    node.style.display = "";
    node.removeAttribute("data-neo-gst-hidden-download-profile");
  });
}

function restoreHiddenDownloadShells() {
  Array.from(document.querySelectorAll("[data-neo-gst-hidden-download-shell='1']")).forEach((node) => {
    node.style.display = "";
    node.removeAttribute("data-neo-gst-hidden-download-shell");
  });
}

function currentViewIsCompanyProfile() {
  if (
    activeDownloadNavigationPresent() ||
    downloadEmptyPeriodMessageNode() ||
    findDownloadPeriodsTable() ||
    document.getElementById("neo-gst-download-workspace")
  ) {
    return false;
  }
  const label = currentViewLabel().toLowerCase();
  return label === "company profile";
}

function currentViewIsDownload() {
  if (activeDownloadNavigationPresent() || downloadEmptyPeriodMessageNode() || findDownloadPeriodsTable()) return true;
  const label = currentViewLabel().toLowerCase();
  if (label === "download" || label === "download returns") return true;
  return false;
}

function currentClientNameFromPage() {
  const headerClient = Array.from(document.querySelectorAll("h1 span"))
    .map((node) => text(node.textContent))
    .find(Boolean);
  if (headerClient) return headerClient;
  const headingMatch = Array.from(document.querySelectorAll("h1,h2"))
    .map((node) => text(node.textContent))
    .find((value) => / - /i.test(value));
  if (!headingMatch) return "";
  return text(headingMatch.split(/\s-\s/i).slice(1).join(" - "));
}

function currentClientGstinFromPage() {
  const gstinLabel = Array.from(document.querySelectorAll("div,span,td,th,label"))
    .find((node) => /^gstin$/i.test(text(node.textContent)));
  if (gstinLabel) {
    const container = gstinLabel.closest("tr,section,div") || gstinLabel.parentElement;
    const scopedText = text(container && container.textContent);
    const scopedMatch = scopedText.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/);
    if (scopedMatch) return upper(scopedMatch[0]);
  }
  const codeMatch = Array.from(document.querySelectorAll("code,.font-mono"))
    .map((node) => text(node.textContent))
    .map((value) => value.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/))
    .find(Boolean);
  if (codeMatch) return upper(codeMatch[0]);
  return "";
}

function activeClientFromPage() {
  const dataset = normalizeDataset(state.dataset || buildEmptyDataset());
  const gstin = currentClientGstinFromPage();
  if (gstin) {
    return (dataset.clients || []).find((client) => upper(client.gstin) === gstin) || null;
  }
  const clientName = currentClientNameFromPage();
  if (!clientName) return null;
  return (dataset.clients || []).find((client) => text(client.name).toLowerCase() === clientName.toLowerCase()) || null;
}

function companyProfilePairsForClient(client) {
  const profile = normalizeCompanyProfile(client || {});
  const merged = Object.assign({}, profile, {
    gstin: text(profile.gstin || (client && client.gstin)),
  });
  return [
    ["GSTIN", merged.gstin],
    ["Trade Name", merged.tradeName],
    ["Legal Name", merged.legalName],
    ["Registration Type", merged.registrationType],
    ["Business Type", merged.constitution],
    ["App Status", merged.appStatus || merged.status],
    ["E-Invoice", merged.einvoiceStatus],
    ["Date Of Registration", merged.registrationDate],
    ["Nature Of Business", merged.natureOfBusiness],
    ["Contact Name", merged.contactName],
    ["Mobile", merged.mobile],
    ["Email", merged.email],
    ["State Jurisdiction", merged.stateJurisdiction],
    ["CTJ", merged.centerJurisdiction],
    ["Principal Address", merged.principalAddress],
    ["Additional Place Of Business", merged.additionalPlacesOfBusiness || merged.additionalAddresses],
  ];
}

function renderCompanyProfileDetailCard(client) {
  if (!client) return "";
  const pairs = companyProfilePairsForClient(client);
  if (!pairs.length) return "";
  return `
    <div id="neo-gst-company-profile-card" style="margin:18px 0 0;border:1px solid #d7e2ee;border-radius:16px;background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);box-shadow:0 12px 34px rgba(15,23,42,.06);padding:18px 20px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d4ed8;margin-bottom:6px;">GST Portal Details</div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;line-height:1.2;">Company Profile Details</div>
      <div style="margin-top:8px;font-size:13px;color:#64748b;line-height:1.6;">Mapped GST profile fields are shown here and are synced into the GitHub JSON when portal data is loaded.</div>
      ${renderPairsTwoPerRow(pairs)}
    </div>
  `;
}

function enhanceCompanyProfileView() {
  const existingCard = document.getElementById("neo-gst-company-profile-card");
  if (existingCard) existingCard.remove();
  removeInjectedCompanyProfileDetails();
  return;
  Array.from(document.querySelectorAll("button")).forEach((button) => {
    if (text(button.textContent) === "Load Profile Details") {
      button.textContent = "Load from GST Portal";
    }
  });
  const client = activeClientFromPage();
  if (!client) return;
  const editProfileButton = Array.from(document.querySelectorAll("button")).find((button) => /edit profile/i.test(text(button.textContent)));
  const loadButton = Array.from(document.querySelectorAll("button")).find((button) => /load from gst portal|load profile details/i.test(text(button.textContent)));
  const anchorCard =
    (editProfileButton && editProfileButton.closest("section,div")) ||
    (loadButton && loadButton.closest("section,div")) ||
    Array.from(document.querySelectorAll("div,section")).find((node) => /registration type/i.test(text(node.textContent)) && /business type/i.test(text(node.textContent)));
  const host = (anchorCard && anchorCard.parentElement) || document.querySelector("main") || document.body;
  if (!host) return;
  const cardHtml = renderCompanyProfileDetailCard(client);
  if (!cardHtml) {
    if (existingCard) existingCard.remove();
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = cardHtml;
  const nextCard = wrapper.firstElementChild;
  if (!nextCard) return;
  if (existingCard) {
    existingCard.replaceWith(nextCard);
    return;
  }
  if (anchorCard && anchorCard.parentElement) {
    anchorCard.insertAdjacentElement("afterend", nextCard);
    return;
  }
  host.appendChild(nextCard);
}

function enhanceHeaderClientTitle() {
  const client = activeClientFromPage();
  if (!client) return;
  const viewLabel = currentViewLabel();
  if (!viewLabel) return;
  const heading = Array.from(document.querySelectorAll("h1")).find((node) => {
    const content = text(node.textContent);
    return content.toLowerCase().startsWith(viewLabel.toLowerCase() + " -");
  });
  if (!heading) return;
  const titleText = `${viewLabel} - ${text(client.name)}${client.gstin ? ` (${upper(client.gstin)})` : ""}`;
  if (text(heading.textContent) === titleText) return;
  heading.textContent = titleText;
}

function currentFinancialYearStart() {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() >= 3 ? year : year - 1;
}

function financialYearLabel(startYear) {
  const start = Number(startYear);
  if (!Number.isFinite(start)) return "";
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function financialYearOptionsFrom2016() {
  const current = currentFinancialYearStart();
  const years = [];
  for (let year = current; year >= 2016; year -= 1) {
    years.push(financialYearLabel(year));
  }
  return years;
}

function parseFinancialYearStart(label) {
  const match = text(label).match(/^(\d{4})/);
  return match ? Number(match[1]) : currentFinancialYearStart();
}

function periodRowsForFinancialYear(fyLabel) {
  const startYear = parseFinancialYearStart(fyLabel);
  const months = [
    ["April", startYear],
    ["May", startYear],
    ["June", startYear],
    ["July", startYear],
    ["August", startYear],
    ["September", startYear],
    ["October", startYear],
    ["November", startYear],
    ["December", startYear],
    ["January", startYear + 1],
    ["February", startYear + 1],
    ["March", startYear + 1],
  ];
  return months.map(([month, year]) => ({
    label: `${month} ${year}`,
    value: `${month}-${year}`,
  }));
}

function downloadReturnTypes() {
  return [
    { key: "G1", label: "GSTR-1" },
    { key: "G3B", label: "GSTR-3B" },
    { key: "G2A", label: "GSTR-2A" },
    { key: "G2B", label: "GSTR-2B" },
    { key: "G4", label: "CMP-08" },
    { key: "G9", label: "GSTR-9" },
    { key: "G9C", label: "GSTR-9C" },
  ];
}

function findDownloadPeriodsTable() {
  const emptyMessage = downloadEmptyPeriodMessageNode();
  const emptyTable = emptyMessage && emptyMessage.closest("table");
  if (emptyTable) return emptyTable;
  return Array.from(document.querySelectorAll("table")).find((table) => {
    const headerCells = Array.from(table.querySelectorAll("thead th, thead td, tr:first-child th, tr:first-child td"));
    const headings = headerCells
      .map((node) => text(node.textContent).toLowerCase())
      .join("|");
    const bodyText = text(table.textContent).toLowerCase();
    return (
      /\bperiod\b/.test(headings) &&
      /\bstatus\b/.test(headings) &&
      /\baction\b/.test(headings) &&
      (/\bexcel\b/.test(headings) || /no periods available/.test(bodyText))
    );
  });
}

function downloadTableHasNoPeriods(table) {
  if (!table) return false;
  const bodyText = text(table.textContent);
  if (/no periods available/i.test(bodyText)) return true;
  const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => !row.id.startsWith("neo-gst-"));
  if (!bodyRows.length) return true;
  return bodyRows.every((row) => /no periods available/i.test(text(row.textContent)));
}

function ensureDashboardDownloadStyles() {
  if (document.getElementById("neo-gst-download-fallback-style")) return;
  const style = document.createElement("style");
  style.id = "neo-gst-download-fallback-style";
  style.textContent = `
    #neo-gst-download-workspace {
      border: 1px solid #d7e2ee;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 10px 28px rgba(15, 23, 42, .05);
      margin: 0 0 14px;
      padding: 14px;
    }
    #neo-gst-download-workspace .neo-gst-download-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 12px;
    }
    #neo-gst-download-workspace label {
      display: grid;
      gap: 6px;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    #neo-gst-download-workspace select {
      min-width: 150px;
      border: 1px solid #c9d8ea;
      border-radius: 10px;
      background: #f8fbff;
      color: #0f172a;
      font-size: 13px;
      font-weight: 600;
      outline: none;
      padding: 10px 12px;
    }
    #neo-gst-download-workspace .neo-gst-download-note {
      margin-top: 10px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.5;
    }
    .neo-gst-period-action {
      border: 1px solid #bad7ff;
      border-radius: 9px;
      background: #eef6ff;
      color: #0b57d0;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      padding: 7px 10px;
    }
    .neo-gst-period-action:hover {
      background: #dfeeff;
    }
    #neo-gst-download-workspace {
      width: 100%;
      min-height: calc(100vh - 90px);
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
    #neo-gst-download-workspace-frame {
      display: block;
      width: 100%;
      height: calc(100vh - 88px);
      min-height: 720px;
      border: 0;
      background: #ffffff;
    }
  `;
  document.head.appendChild(style);
}

function downloadWorkspaceSrc() {
  let base = "../popup.html";
  if (runtimeApi && runtimeApi.runtime && typeof runtimeApi.runtime.getURL === "function") {
    base = runtimeApi.runtime.getURL("popup.html");
  }
  const params = new URLSearchParams();
  params.set("category", "returns");
  const pageParams = new URLSearchParams(window.location.search || "");
  const tabId = text(pageParams.get("tabId"));
  if (tabId) params.set("tabId", tabId);
  const client = activeClientFromPage();
  const gstin = upper((client && client.gstin) || currentClientGstinFromPage());
  const name = text((client && client.name) || currentClientNameFromPage());
  if (gstin) params.set("selectedClientGstin", gstin);
  if (name) params.set("selectedClientName", name);
  return `${base}?${params.toString()}`;
}

function findNativeDownloadShell(table) {
  if (!table) return null;
  let candidate = table;
  let cursor = table.parentElement;
  let depth = 0;
  while (cursor && cursor !== document.body) {
    const content = text(cursor.textContent).toLowerCase();
    if (/company profile details/.test(content)) break;
    if (/financial year|category|subcategory|download all json|download all excel|generate all/i.test(content)) break;
    if (/neo gst|downloads\s+download|reconciliation|tools|client management/i.test(content)) break;
    if (/gst portal|gstr|period|no periods available/.test(content)) {
      candidate = cursor;
    }
    depth += 1;
    if (depth >= 6) {
      break;
    }
    cursor = cursor.parentElement;
  }
  return candidate;
}

function hideNativeDownloadShell() {
  const table = findDownloadPeriodsTable();
  const shell = findNativeDownloadShell(table);
  if (shell && shell.id !== "neo-gst-download-workspace") {
    shell.style.display = "none";
    shell.setAttribute("data-neo-gst-hidden-download-shell", "1");
  }
  return shell;
}

function downloadWorkspaceInsertionHost(anchor) {
  if (anchor && anchor.parentElement) return anchor.parentElement;
  return document.querySelector("main") || document.getElementById("root") || document.body;
}

function selectedDownloadFallbackValues(existingCard) {
  const fyOptions = financialYearOptionsFrom2016();
  const returnTypes = downloadReturnTypes();
  const fySelect = existingCard && existingCard.querySelector("#neo-gst-download-fy");
  const typeSelect = existingCard && existingCard.querySelector("#neo-gst-download-return-type");
  return {
    fy: text(fySelect && fySelect.value) || fyOptions[0],
    returnType: text(typeSelect && typeSelect.value) || returnTypes[0].key,
  };
}

function renderDownloadFallbackControls(card, values) {
  const fyOptions = financialYearOptionsFrom2016();
  const returnTypes = downloadReturnTypes();
  card.innerHTML = `
    <div class="neo-gst-download-controls">
      <label>
        Financial Year
        <select id="neo-gst-download-fy">
          ${fyOptions
            .map((fy) => `<option value="${escapeHtml(fy)}"${fy === values.fy ? " selected" : ""}>${escapeHtml(fy)}</option>`)
            .join("")}
        </select>
      </label>
      <label>
        Return Type
        <select id="neo-gst-download-return-type">
          ${returnTypes
            .map(
              (item) =>
                `<option value="${escapeHtml(item.key)}"${item.key === values.returnType ? " selected" : ""}>${escapeHtml(
                  item.label,
                )}</option>`,
            )
            .join("")}
        </select>
      </label>
    </div>
    <div class="neo-gst-download-note">No periods came from the portal page, so periods are generated from FY 2016-17 through the current financial year.</div>
  `;
  Array.from(card.querySelectorAll("select")).forEach((select) => {
    select.addEventListener("change", () => renderDownloadWorkspace());
  });
}

function openDownloadPopupForSelection(returnType) {
  if (!runtimeApi || !runtimeApi.runtime || typeof runtimeApi.runtime.sendMessage !== "function") return;
  runtimeApi.runtime.sendMessage({
    type: "open-download-popup",
    payload: {
      category: "returns",
      returnType,
    },
  });
}

function patchDownloadFallbackRows(table, values) {
  const tbody = table && table.querySelector("tbody");
  if (!tbody) return;
  Array.from(tbody.querySelectorAll("tr")).forEach((row) => row.remove());
  const rows = periodRowsForFinancialYear(values.fy);
  const returnTypeLabel =
    (downloadReturnTypes().find((item) => item.key === values.returnType) || downloadReturnTypes()[0]).label || "Return";
  rows.forEach((period) => {
    const row = document.createElement("tr");
    row.id = `neo-gst-download-period-${period.value.replace(/[^A-Za-z0-9]+/g, "-")}`;
    row.innerHTML = `
      <td>${escapeHtml(period.label)}</td>
      <td>Available</td>
      <td><button type="button" class="neo-gst-period-action" data-return-type="${escapeHtml(
        values.returnType,
      )}">Open ${escapeHtml(returnTypeLabel)}</button></td>
      <td>-</td>
    `;
    tbody.appendChild(row);
  });
  Array.from(tbody.querySelectorAll(".neo-gst-period-action")).forEach((button) => {
    button.addEventListener("click", () => openDownloadPopupForSelection(text(button.getAttribute("data-return-type"))));
  });
}

function renderStandaloneDownloadFallbackTable(card, values) {
  let table = document.getElementById("neo-gst-download-fallback-table");
  if (!table) {
    table = document.createElement("table");
    table.id = "neo-gst-download-fallback-table";
    table.style.width = "100%";
    table.style.marginTop = "12px";
    table.style.borderCollapse = "collapse";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="text-align:left;padding:9px 10px;background:#eef3fb;border:1px solid #dce7f5;">Period</th>
          <th style="text-align:left;padding:9px 10px;background:#eef3fb;border:1px solid #dce7f5;">Status</th>
          <th style="text-align:left;padding:9px 10px;background:#eef3fb;border:1px solid #dce7f5;">Action</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    card.insertAdjacentElement("afterend", table);
  }
  patchDownloadFallbackRows(table, values);
}

function downloadFallbackInsertionHost(anchor) {
  if (anchor && anchor.parentElement) return anchor.parentElement;
  return document.querySelector("main") || document.getElementById("root") || document.body;
}

function renderDownloadWorkspace() {
  const fallbackTable = document.getElementById("neo-gst-download-fallback-table");
  if (fallbackTable) fallbackTable.remove();
  if (currentViewIsDownload()) {
    ensureDashboardDownloadStyles();
    forceHideCompanyProfileDetails();
    const nativeShell = hideNativeDownloadShell();
    if (!nativeShell || !nativeShell.parentElement) {
      const misplacedWorkspace = document.getElementById("neo-gst-download-workspace");
      if (misplacedWorkspace) misplacedWorkspace.remove();
      return;
    }
    const src = downloadWorkspaceSrc();
    let workspace = document.getElementById("neo-gst-download-workspace");
    if (!workspace) {
      workspace = document.createElement("div");
      workspace.id = "neo-gst-download-workspace";
      workspace.innerHTML = `<iframe id="neo-gst-download-workspace-frame" title="Downloads Workspace" src="${escapeHtml(src)}"></iframe>`;
      nativeShell.insertAdjacentElement("beforebegin", workspace);
      return;
    }
    if (workspace.parentElement !== nativeShell.parentElement) {
      nativeShell.insertAdjacentElement("beforebegin", workspace);
    }
    const iframe = workspace.querySelector("iframe");
    if (iframe && iframe.getAttribute("src") !== src) iframe.setAttribute("src", src);
    workspace.style.display = "";
    return;
  }
  const existingCard = document.getElementById("neo-gst-download-workspace");
  if (existingCard) existingCard.remove();
  restoreHiddenDownloadShells();
  restoreHiddenCompanyProfileDetails();
}

function syncDownloadOverlayWithGstin() {
  const client = activeClientFromPage();
  if (!client || !text(client.gstin)) return;
  const iframe = Array.from(document.querySelectorAll("iframe")).find((node) => {
    const title = text(node.title);
    const src = text(node.getAttribute("src"));
    return /downloads workspace/i.test(title) || /popup\.html/i.test(src);
  });
  if (!iframe) return;
  const overlayMessage = Array.from(document.querySelectorAll("div"))
    .find((node) => {
      const content = text(node.textContent);
      return /please log in via client logins on the gst portal/i.test(content) ||
        /navigate to returns,\s*gstr-2b,\s*or payments/i.test(content);
    });
  if (!overlayMessage) return;
  const overlayRoot =
    overlayMessage.parentElement && overlayMessage.parentElement.parentElement
      ? overlayMessage.parentElement.parentElement
      : overlayMessage.parentElement || overlayMessage;
  const removeOverlay = () => {
    if (overlayRoot && overlayRoot.remove) {
      overlayRoot.remove();
      return true;
    }
    if (overlayRoot) {
      overlayRoot.style.display = "none";
      overlayRoot.style.pointerEvents = "none";
      overlayRoot.style.visibility = "hidden";
      return true;
    }
    return false;
  };
  let iframeGstin = "";
  try {
    const frameDoc = iframe.contentWindow && iframe.contentWindow.document;
    if (frameDoc) {
      const businessSub = frameDoc.getElementById("businessSub");
      const businessName = frameDoc.getElementById("businessName");
      const scopedText = text(
        (businessSub && businessSub.textContent) ||
        (businessName && businessName.parentElement && businessName.parentElement.textContent) ||
        frameDoc.body.textContent,
      );
      if (/GSTIN\s+[0-9A-Z]{15}/i.test(scopedText)) {
        removeOverlay();
      }
      const match = scopedText.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/);
      iframeGstin = upper(match && match[0]);
    }
  } catch (error) {
    iframeGstin = "";
  }
  if (!iframeGstin) {
    removeOverlay();
    return;
  }
  if (iframeGstin === upper(client.gstin)) {
    removeOverlay();
    return;
  }
  if (overlayRoot) {
    overlayRoot.style.display = "";
    overlayRoot.style.pointerEvents = "";
    overlayRoot.style.visibility = "";
  }
  overlayMessage.textContent = `Logged in GSTIN ${iframeGstin} does not match selected client ${upper(client.gstin)}.`;
}

function simplifyDownloadHeaderStatus() {
  const header = Array.from(document.querySelectorAll("header")).find((node) => /neo gst/i.test(node.textContent || ""));
  if (!header) return;
  const rightSide = header.firstElementChild && header.firstElementChild.lastElementChild;
  if (!rightSide) return;
  const statusPills = Array.from(rightSide.children).filter((node) => {
    const label = text(node.textContent).trim().toLowerCase();
    return label === "active" || label === "online" || label === "offline";
  });
  statusPills.forEach((node) => {
    node.style.display = currentViewIsDownload() ? "none" : "";
  });
}

function startEnhancements() {
  const runEnhancements = () => {
    removePortalDebugNavigation();
    addGstInfoButton();
    addBulkClientGstinButton();
    addReturnStatusButton();
    addGetDetailsByGstinButton();
    addRemoteBadge();
    fixClientManagementHeaderAlignment();
    enhanceReconciliationWorkspace();
    enhanceHeaderClientTitle();
    renderDownloadWorkspace();
    enhanceCompanyProfileView();
    if (activeDownloadNavigationPresent() || currentViewIsDownload()) forceHideCompanyProfileDetails();
    syncDownloadOverlayWithGstin();
    simplifyDownloadHeaderStatus();
  };
  let enhancementQueued = false;
  let overlayRetryCount = 0;
  let observer = null;
  const scheduleEnhancements = () => {
    if (enhancementQueued) return;
    enhancementQueued = true;
    const flush = () => {
      enhancementQueued = false;
      if (observer) observer.disconnect();
      runEnhancements();
      if (observer && document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      if (overlayRetryCount < 20) {
        overlayRetryCount += 1;
        setTimeout(runEnhancements, 300);
      }
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(flush);
      return;
    }
    setTimeout(flush, 0);
  };
  observer = new MutationObserver(() => {
    scheduleEnhancements();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  runEnhancements();
}

function loadAppBundle() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = APP_BUNDLE_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load the main UI bundle."));
    document.head.appendChild(script);
  });
}

function closeToolOverlay() {
  const existing = document.getElementById("neo-gst-tool-overlay");
  if (existing) existing.remove();
}

function openToolOverlay(tool) {
  const safeTool = /^(schema|converter)$/i.test(String(tool || "")) ? String(tool).toLowerCase() : "schema";
  closeToolOverlay();
  const overlay = document.createElement("div");
  overlay.id = "neo-gst-tool-overlay";
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.38);backdrop-filter:blur(6px);z-index:9998;"></div>
    <div style="position:fixed;inset:24px;z-index:9999;display:flex;align-items:stretch;justify-content:center;">
      <div style="width:min(1180px,100%);height:100%;background:#fff;border:1px solid #dbe7f5;border-radius:24px;box-shadow:0 24px 70px rgba(15,23,42,.18);overflow:hidden;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e5edf7;background:linear-gradient(180deg,#f9fbff,#f4f8ff);">
          <div style="font-size:15px;font-weight:700;color:#0f172a;">${safeTool === "schema" ? "Schema Manager" : "Converters"}</div>
          <button type="button" id="neo-gst-tool-overlay-close" style="border:0;background:#eff6ff;color:#1d4ed8;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">Close</button>
        </div>
        <iframe title="${safeTool}" src="../popup.html?tool=${safeTool}&open${safeTool === "schema" ? "Schema" : "Converter"}=1" style="flex:1 1 auto;width:100%;border:0;background:#fff;"></iframe>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const dismiss = () => closeToolOverlay();
  const backdrop = overlay.firstElementChild;
  const closeBtn = document.getElementById("neo-gst-tool-overlay-close");
  if (backdrop) backdrop.addEventListener("click", dismiss);
  if (closeBtn) closeBtn.addEventListener("click", dismiss);
}

function injectTopToolButtons() {
  const existingSchema = document.getElementById("neo-gst-schema-top-btn");
  const existingConverter = document.getElementById("neo-gst-converter-top-btn");
  const addClientButton = Array.from(document.querySelectorAll("button")).find((button) =>
    /\bAdd Client\b/i.test((button.textContent || "").trim()),
  );
  if (!addClientButton || !addClientButton.parentElement) return;
  const makeButton = (existing, id, label, title, accent, onClick) => {
    const button = existing || document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className =
      "flex items-center gap-2 bg-white text-slate-800 px-5 py-3 rounded-xl font-medium transition-all shadow-sm whitespace-nowrap border border-slate-200";
    button.style.minWidth = "150px";
    button.style.justifyContent = "center";
    button.style.boxShadow = "0 8px 20px rgba(15, 23, 42, 0.08)";
    button.innerHTML = `<span aria-hidden="true" style="display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:999px;background:${accent.bg};color:${accent.fg};font-size:12px;font-weight:700;line-height:1">${accent.icon}</span><span>${label}</span>`;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.onclick = onClick;
    return button;
  };
  const schemaButton = makeButton(
    existingSchema,
    "neo-gst-schema-top-btn",
    "Schema",
    "Open Schema Manager",
    { bg: "#d1fae5", fg: "#047857", icon: "#" },
    () => openToolOverlay("schema"),
  );
  const converterButton = makeButton(
    existingConverter,
    "neo-gst-converter-top-btn",
    "Converters",
    "Open Converters",
    { bg: "#dbeafe", fg: "#1d4ed8", icon: "C" },
    () => openToolOverlay("converter"),
  );
  if (!existingConverter) addClientButton.parentElement.insertBefore(converterButton, addClientButton);
  if (!existingSchema) addClientButton.parentElement.insertBefore(schemaButton, addClientButton);
}

function maintainTopToolButtons() {
  injectTopToolButtons();
  const observer = new MutationObserver(() => {
    observer.disconnect();
    injectTopToolButtons();
    observer.observe(document.body, { childList: true, subtree: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function initializeRemoteState() {
  emitStatus({ message: "Connecting to GitHub..." });
  const remote = await fetchRemoteDataset();
  state.meta = remote.meta;
  state.dataset = remote.dataset;
  state.lastSavedSignature = signature(stripTransientFields(remote.dataset));
  state.remoteInitialized = true;
  setClientShadow(remote.dataset.clients);
  setDatasetCache(remote.dataset);
  maybeHydrateMountedApp(remote.dataset.clients);
  emitStatus({
    connected: true,
    canWrite: remote.meta.canWrite,
    pending: false,
    message: workbookLoadMessage(remote.dataset, remote.meta),
  });
}

async function bootstrap() {
  patchStorage();
  const cachedDataset = getDatasetCache();
  if (cachedDataset) {
    state.dataset = cachedDataset;
    state.remoteInitialized = true;
    setClientShadow(cachedDataset.clients || []);
  }
  await loadAppBundle();
  clearBootMessage();
  maintainTopToolButtons();
  startEnhancements();
  try {
    await initializeRemoteState();
    } catch (error) {
      console.error("Neo GST bootstrap failed to initialize any dataset", error);
      try {
      const fallback = cachedDataset || (await fetchBundledDataset());
      state.remoteInitialized = true;
      state.dataset = fallback;
      setClientShadow(fallback.clients || []);
      maybeHydrateMountedApp(fallback.clients || []);
      setDatasetCache(fallback);
      emitStatus({
        connected: false,
        canWrite: false,
        pending: false,
        error: error && error.message ? error.message : "Remote sync failed.",
        message: cachedDataset
          ? "Local mode. Showing saved browser data."
          : "Unable to load the GitHub JSON file. Showing bundled client data instead.",
      });
    } catch (fallbackError) {
      state.remoteInitialized = true;
      state.dataset = buildEmptyDataset();
      setClientShadow([]);
      emitStatus({
        connected: false,
        canWrite: false,
        pending: false,
        error:
          (error && error.message ? error.message : "Remote sync failed.") +
          (fallbackError && fallbackError.message ? ` | Fallback failed: ${fallbackError.message}` : ""),
        message: "Unable to load GitHub or bundled client data.",
      });
    }
  }
}

bootstrap().catch((error) => {
  console.error("Neo GST bootstrap failed", error);
  state.dataset = buildEmptyDataset();
  setClientShadow([]);
  showBootMessage(error && error.message ? error.message : "Unable to load the client data from GitHub.");
});
