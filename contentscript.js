'use strict';

var browser = globalThis.browser || globalThis.chrome;

var initDone = !!globalThis.__neoGstInitDone;
var port;
var process;
var SEARCHTP_BRIDGE_VERSION = "2";
var SEARCHTP_REQUEST_EVENT = "gc-returns-pro-searchtp-request-v2";
var SEARCHTP_RESPONSE_EVENT = "gc-returns-pro-searchtp-response-v2";
var GOODSERVICE_REQUEST_EVENT = "gc-returns-pro-goodservice-request-v1";
var GOODSERVICE_RESPONSE_EVENT = "gc-returns-pro-goodservice-response-v1";
var GST_TEMPLATE_STATUS_REQUEST_EVENT = "gc-returns-pro-template-status-request-v1";
var GST_TEMPLATE_STATUS_RESPONSE_EVENT = "gc-returns-pro-template-status-response-v1";

if (!initDone) {
    init();
}

function init() {
  log('Initialising content script.');
  
  registerProcessors();
  fillSearchTpFromHash();
  ensureSearchTpPageBridge();
  ensureGoodservicePageBridge();

  if (!globalThis.__neoGstOnConnectListenerAdded) {
    browser.runtime.onConnect.addListener(function(p) {
      port = p;
      
      log(`Port ${port.name} is now open.`);
      port.onDisconnect.addListener(x => log(`Port ${port.name} is now closed.`));
      port.onMessage.addListener(function (msg) {
        var target = process[msg.request];

        if (target) {
          target(msg);
        }
        else {
          msg.status = false;
          msg.error = "Unknown request";
          log('Sending response: ' + JSON.stringify(msg));
          port.postMessage(msg);
        }
      });
    });
    globalThis.__neoGstOnConnectListenerAdded = true;
  }

  initDone = true;
  globalThis.__neoGstInitDone = true;
}

function ensureGoodservicePageBridge() {
  if (globalThis.__neoGstGoodserviceBridgeReady === SEARCHTP_BRIDGE_VERSION) return;
  const script = document.createElement("script");
  script.id = "gc-returns-pro-goodservice-bridge";
  script.textContent = `(function () {
    if (window.__neoGstGoodserviceBridgeInstalled === "${SEARCHTP_BRIDGE_VERSION}") return;
    window.__neoGstGoodserviceBridgeInstalled = "${SEARCHTP_BRIDGE_VERSION}";
    var SEARCH_TP_URL = "https://publicservices.gst.gov.in/publicservices/auth/api/search/tp";
    var BUSPLACES_URL = "https://publicservices.gst.gov.in/publicservices/auth/api/search/tp/busplaces";
    var GOODSERVICE_URL = "https://publicservices.gst.gov.in/publicservices/auth/api/search/goodservice";
    var lastSearchTpTemplate = null;
    var lastGoodserviceTemplate = null;
    var lastBusplacesTemplate = null;
    var pendingTemplateWaiters = [];

    function request(options) {
      return new Promise(function (resolve) {
        try {
          var xhr = new XMLHttpRequest();
          xhr.open(options.method || "GET", options.url, true);
          xhr.withCredentials = !!options.withCredentials;
          var headers = options.headers || {};
          Object.keys(headers).forEach(function (key) {
            if (headers[key] != null) {
              xhr.setRequestHeader(key, headers[key]);
            }
          });
          xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
              responseText: xhr.responseText || "",
              finalUrl: xhr.responseURL || options.url,
              headers: xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : "",
              error: xhr.status >= 200 && xhr.status < 300 ? "" : "Request failed (" + xhr.status + ")"
            });
          };
          xhr.onerror = function () {
            resolve({
              ok: false,
              status: 0,
              responseText: "",
              finalUrl: options.url,
              error: "NetworkError when attempting to fetch resource."
            });
          };
          xhr.send(options.body || null);
        } catch (error) {
          resolve({
            ok: false,
            status: 0,
            responseText: "",
            finalUrl: options.url,
            error: error && error.message ? error.message : "Page bridge request failed."
          });
        }
      });
    }

    function readStorageValue(storage, keys) {
      try {
        for (var i = 0; i < keys.length; i += 1) {
          var value = storage.getItem(keys[i]);
          if (value) return value;
        }
      } catch (error) {}
      return "";
    }

    function readTokenFromObject(value, seen) {
      if (!value) return "";
      if (!seen) seen = [];
      if (seen.indexOf(value) >= 0) return "";
      seen.push(value);
      if (typeof value === "string") {
        if (/^[a-f0-9]{16,}$/i.test(value.trim())) return value.trim();
        try {
          var parsed = JSON.parse(value);
          return readTokenFromObject(parsed, seen);
        } catch (error) {
          return "";
        }
      }
      if (typeof value !== "object") return "";
      var directKeys = ["at", "authToken", "AuthToken", "token"];
      for (var j = 0; j < directKeys.length; j += 1) {
        var direct = value[directKeys[j]];
        if (typeof direct === "string" && /^[a-f0-9]{16,}$/i.test(direct.trim())) return direct.trim();
      }
      var objectKeys = Object.keys(value);
      for (var k = 0; k < objectKeys.length; k += 1) {
        var nested = readTokenFromObject(value[objectKeys[k]], seen);
        if (nested) return nested;
      }
      return "";
    }

    function discoverAtToken(payload) {
      var explicit = String((payload && (payload.at || payload.authToken || payload.AuthToken)) || "").trim();
      if (explicit) return explicit;
      var storageKeys = [
        "at",
        "authToken",
        "AuthToken",
        "gstAuthToken",
        "gst_auth_token",
        "searchtpAuthToken",
        "searchtp_at",
        "token"
      ];
      var fromSession = readStorageValue(window.sessionStorage, storageKeys);
      var fromLocal = readStorageValue(window.localStorage, storageKeys);
      var nestedSession = readTokenFromObject(fromSession);
      var nestedLocal = readTokenFromObject(fromLocal);
      return nestedSession || nestedLocal || "";
    }

    function normalizeHeaderKey(key) {
      return String(key || "").trim().toLowerCase();
    }

    function resolveRequestUrl(url) {
      try {
        return new URL(String(url || ""), window.location.href).toString();
      } catch (error) {
        return String(url || "");
      }
    }

    function matchesEndpoint(url, method, endpointUrl) {
      var resolved = resolveRequestUrl(url);
      var normalizedMethod = String(method || "").toUpperCase();
      var expectedMethod = endpointUrl === GOODSERVICE_URL ? "GET" : "POST";
      if (normalizedMethod !== expectedMethod) return false;
      try {
        var parsed = new URL(resolved);
        var expected = new URL(endpointUrl);
        if (parsed.origin !== expected.origin) return false;
        return parsed.pathname === expected.pathname;
      } catch (error) {
        return resolved.indexOf(endpointUrl) >= 0;
      }
    }

    function captureTemplate(headers, bodyText, url) {
      var resolvedUrl = resolveRequestUrl(url);
      var safeHeaders = {};
      Object.keys(headers || {}).forEach(function (key) {
        var normalized = normalizeHeaderKey(key);
        if (!normalized) return;
        safeHeaders[normalized] = headers[key];
      });
      var parsedBody = null;
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) : null;
      } catch (error) {
        parsedBody = null;
      }
      var template = {
        headers: safeHeaders,
        body: parsedBody && typeof parsedBody === "object" ? parsedBody : null,
        at: String(safeHeaders.at || "").trim(),
        capturedAt: Date.now(),
        url: resolvedUrl
      };
      if (matchesEndpoint(template.url, "POST", SEARCH_TP_URL)) {
        lastSearchTpTemplate = template;
      } else if (matchesEndpoint(template.url, "POST", BUSPLACES_URL)) {
        lastBusplacesTemplate = template;
      } else if (matchesEndpoint(template.url, "GET", GOODSERVICE_URL)) {
        lastGoodserviceTemplate = template;
      }
      window.__neoGstCapturedTemplates = {
        searchTp: lastSearchTpTemplate,
        goodservice: lastGoodserviceTemplate,
        busplaces: lastBusplacesTemplate
      };
      if (pendingTemplateWaiters.length) {
        var waiters = pendingTemplateWaiters.splice(0, pendingTemplateWaiters.length);
        waiters.forEach(function (resolve) {
          try {
            resolve({
              searchTp: lastSearchTpTemplate,
              goodservice: lastGoodserviceTemplate,
              busplaces: lastBusplacesTemplate
            });
          } catch (error) {}
        });
      }
    }

    function waitForCapturedTemplates(timeoutMs) {
      return new Promise(function (resolve) {
        if (lastSearchTpTemplate && lastSearchTpTemplate.at) {
          resolve({
            searchTp: lastSearchTpTemplate,
            goodservice: lastGoodserviceTemplate,
            busplaces: lastBusplacesTemplate
          });
          return;
        }
        var completed = false;
        var timer = setTimeout(function () {
          if (completed) return;
          completed = true;
          resolve({
            searchTp: lastSearchTpTemplate,
            goodservice: lastGoodserviceTemplate,
            busplaces: lastBusplacesTemplate
          });
        }, timeoutMs || 120000);
        pendingTemplateWaiters.push(function (templates) {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          resolve(templates || {
            searchTp: lastSearchTpTemplate,
            goodservice: lastGoodserviceTemplate,
            busplaces: lastBusplacesTemplate
          });
        });
      });
    }

    function installSearchTpRequestCapture() {
      if (window.__neoGstSearchTpCaptureInstalled) return;
      window.__neoGstSearchTpCaptureInstalled = true;
      var originalOpen = XMLHttpRequest.prototype.open;
      var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      var originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__neoGstMethod = String(method || "GET").toUpperCase();
        this.__neoGstUrl = String(url || "");
        this.__neoGstHeaders = {};
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
        try {
          if (!this.__neoGstHeaders) this.__neoGstHeaders = {};
          this.__neoGstHeaders[String(key || "")] = String(value == null ? "" : value);
        } catch (error) {}
        return originalSetRequestHeader.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        try {
          var method = String(this.__neoGstMethod || "").toUpperCase();
          var url = String(this.__neoGstUrl || "");
          if (
            matchesEndpoint(url, method, SEARCH_TP_URL) ||
            matchesEndpoint(url, method, BUSPLACES_URL) ||
            matchesEndpoint(url, method, GOODSERVICE_URL)
          ) {
            captureTemplate(this.__neoGstHeaders || {}, typeof body === "string" ? body : "", url);
          }
        } catch (error) {}
        return originalSend.apply(this, arguments);
      };
    }

    function buildCapturedHeaders(template, fallbackHeaders, atToken) {
      var next = {};
      var source = template && template.headers ? template.headers : {};
      Object.keys(source).forEach(function (key) {
        var normalized = normalizeHeaderKey(key);
        if (!normalized) return;
        if (["content-length", "host", "connection", "origin", "referer", "user-agent", "accept-encoding"].indexOf(normalized) >= 0) return;
        next[key] = source[key];
      });
      Object.keys(fallbackHeaders || {}).forEach(function (key) {
        next[key] = fallbackHeaders[key];
      });
      if (atToken) next.at = atToken;
      return next;
    }

    function buildTpBody(template, gstin, captcha) {
      var next = template && template.body && typeof template.body === "object"
        ? JSON.parse(JSON.stringify(template.body))
        : {};
      next.gstin = gstin;
      if (captcha) {
        next.captcha = captcha;
      } else if ("captcha" in next && !next.captcha) {
        delete next.captcha;
      }
      return next;
    }

    function buildGoodserviceUrl(template, gstin) {
      var source = String((template && template.url) || GOODSERVICE_URL);
      try {
        var parsed = new URL(source, window.location.origin);
        parsed.searchParams.set("gstin", gstin);
        return parsed.toString();
      } catch (error) {
        return GOODSERVICE_URL + "?gstin=" + encodeURIComponent(gstin);
      }
    }

    function buildBusplacesBody(template, gstin) {
      var next = template && template.body && typeof template.body === "object"
        ? JSON.parse(JSON.stringify(template.body))
        : {};
      next.gstin = gstin;
      return next;
    }

    function appendAtHeader(headers, atToken) {
      var next = {};
      Object.keys(headers || {}).forEach(function (key) {
        next[key] = headers[key];
      });
      if (atToken) next.at = atToken;
      return next;
    }

    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      var data = event.data || {};
      if (data.type === "${GST_TEMPLATE_STATUS_REQUEST_EVENT}") {
        window.postMessage({
          type: "${GST_TEMPLATE_STATUS_RESPONSE_EVENT}",
          requestId: data.requestId,
          payload: {
            status: true,
            searchTp: !!(lastSearchTpTemplate && lastSearchTpTemplate.at),
            goodservice: !!lastGoodserviceTemplate,
            busplaces: !!lastBusplacesTemplate,
            at: !!(
              (lastSearchTpTemplate && lastSearchTpTemplate.at) ||
              (lastGoodserviceTemplate && lastGoodserviceTemplate.at) ||
              (lastBusplacesTemplate && lastBusplacesTemplate.at)
            )
          }
        }, "*");
        return;
      }
      if (data.type !== "${GOODSERVICE_REQUEST_EVENT}") return;
      var payload = data.payload || {};
      var gstin = String(payload.gstin || "").trim().toUpperCase();
      if (!gstin) {
        window.postMessage({ type: "${GOODSERVICE_RESPONSE_EVENT}", requestId: data.requestId, payload: { status: false, error: "Missing GSTIN" } }, "*");
        return;
      }
      var captchaInput =
        document.querySelector('input[name="captcha"]') ||
        document.querySelector('input[ng-model*="captcha"]') ||
        document.querySelector('input[id*="captcha"]');
      var captcha = String(payload.captcha || (captchaInput && captchaInput.value) || "").trim();
      var postHeaders = {
        "Accept": "application/json, text/plain",
        "Content-Type": "application/json;charset=UTF-8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Origin": "https://services.gst.gov.in",
        "Referer": "https://services.gst.gov.in/"
      };
      var getHeaders = {
        "Accept": "application/json, text/plain, */*",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Origin": "https://services.gst.gov.in",
        "Referer": "https://services.gst.gov.in/"
      };
      var discoveredAtToken = discoverAtToken(payload);
      waitForCapturedTemplates(120000).then(function (templates) {
        var tpTemplate = templates && templates.searchTp && templates.searchTp.at ? templates.searchTp : null;
        var goodserviceTemplate = templates && templates.goodservice ? templates.goodservice : tpTemplate;
        var busplacesTemplate = templates && templates.busplaces ? templates.busplaces : tpTemplate;
        var effectiveAtToken = String(
          (tpTemplate && tpTemplate.at) ||
          (goodserviceTemplate && goodserviceTemplate.at) ||
          (busplacesTemplate && busplacesTemplate.at) ||
          discoveredAtToken ||
          discoverAtToken(payload) ||
          ""
        ).trim();
        if (!effectiveAtToken) {
          throw new Error("No GST portal request template captured yet. Open the GST search page and manually search one GSTIN first.");
        }
        var tpBody = buildTpBody(tpTemplate, gstin, captcha);
        return request({
          method: "POST",
          url: SEARCH_TP_URL,
          headers: buildCapturedHeaders(tpTemplate, postHeaders, effectiveAtToken),
          body: JSON.stringify(tpBody),
          withCredentials: false
        }).then(function (tpResp) {
        return Promise.all([
          Promise.resolve(tpResp),
          request({
          method: "GET",
          url: buildGoodserviceUrl(goodserviceTemplate, gstin),
          headers: buildCapturedHeaders(goodserviceTemplate, getHeaders, effectiveAtToken),
          withCredentials: false
          }),
          request({
            method: "POST",
            url: BUSPLACES_URL,
            headers: buildCapturedHeaders(busplacesTemplate, postHeaders, effectiveAtToken),
            body: JSON.stringify(buildBusplacesBody(busplacesTemplate, gstin)),
            withCredentials: false
          })
        ]);
      });
      }).then(function (results) {
        var tpResp = results[0];
        var goodsResp = results[1];
        var busplacesResp = results[2];
        window.postMessage({
          type: "${GOODSERVICE_RESPONSE_EVENT}",
          requestId: data.requestId,
          payload: {
            status: !!((tpResp && tpResp.ok) || (goodsResp && goodsResp.ok) || (busplacesResp && busplacesResp.ok)),
            gstin: gstin,
            tpResponse: tpResp ? tpResp.responseText : "",
            goodserviceResponse: goodsResp ? goodsResp.responseText : "",
            busplacesResponse: busplacesResp ? busplacesResp.responseText : "",
            error: [tpResp, goodsResp, busplacesResp]
              .filter(function (resp) { return resp && !resp.ok; })
              .map(function (resp) { return resp.error || ("HTTP " + resp.status); })
              .join(" | ")
          }
        }, "*");
      }).catch(function (error) {
        window.postMessage({
          type: "${GOODSERVICE_RESPONSE_EVENT}",
          requestId: data.requestId,
          payload: { status: false, gstin: gstin, error: error && error.message ? error.message : "NetworkError when attempting to fetch resource." }
        }, "*");
      });
    });
    installSearchTpRequestCapture();
  })();`;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.parentNode.removeChild(script);
  globalThis.__neoGstGoodserviceBridgeReady = SEARCHTP_BRIDGE_VERSION;
}

function readGoodserviceTemplateStatusViaPage() {
  return new Promise(function (resolve) {
    ensureGoodservicePageBridge();
    var requestId = "gc-returns-pro-template-status-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve({ status: false, error: "Timed out waiting for GST template status." });
    }, 10000);
    function onMessage(event) {
      if (event.source !== window) return;
      var data = event.data || {};
      if (data.type !== GST_TEMPLATE_STATUS_RESPONSE_EVENT || data.requestId !== requestId) return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.payload || { status: false, error: "Empty GST template status response." });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: GST_TEMPLATE_STATUS_REQUEST_EVENT, requestId: requestId }, "*");
  });
}

function requestGoodserviceViaPage(payload) {
  return new Promise(function (resolve) {
    ensureGoodservicePageBridge();
    var requestId = "gc-returns-pro-goodservice-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve({ status: false, error: "Timed out waiting for GST portal response." });
    }, 130000);
    function onMessage(event) {
      if (event.source !== window) return;
      var data = event.data || {};
      if (data.type !== GOODSERVICE_RESPONSE_EVENT || data.requestId !== requestId) return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.payload || { status: false, error: "Empty GST portal response." });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: GOODSERVICE_REQUEST_EVENT, requestId: requestId, payload: payload || {} }, "*");
  });
}

function ensureSearchTpPageBridge() {
  if (globalThis.__neoGstSearchBridgeReady === SEARCHTP_BRIDGE_VERSION) return;
  const script = document.createElement("script");
  script.id = "gc-returns-pro-searchtp-bridge";
  script.textContent = `(function () {
    if (window.__neoGstSearchBridgeInstalled === "${SEARCHTP_BRIDGE_VERSION}") return;
    window.__neoGstSearchBridgeInstalled = "${SEARCHTP_BRIDGE_VERSION}";

    function request(options) {
      return new Promise(function (resolve) {
        try {
          var xhr = new XMLHttpRequest();
          xhr.open(options.method || "GET", options.url, true);
          xhr.withCredentials = true;
          var headers = options.headers || {};
          Object.keys(headers).forEach(function (key) {
            if (headers[key] != null) {
              xhr.setRequestHeader(key, headers[key]);
            }
          });
          xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
              responseText: xhr.responseText || "",
              finalUrl: xhr.responseURL || options.url
            });
          };
          xhr.onerror = function () {
            resolve({
              ok: false,
              status: 0,
              responseText: "",
              finalUrl: options.url,
              error: "NetworkError when attempting to fetch resource."
            });
          };
          xhr.send(options.body || null);
        } catch (error) {
          resolve({
            ok: false,
            status: 0,
            responseText: "",
            finalUrl: options.url,
            error: error && error.message ? error.message : "Page bridge request failed."
          });
        }
      });
    }

    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      var data = event.data || {};
      if (data.type !== "${SEARCHTP_REQUEST_EVENT}") return;
      var payload = data.payload || {};
      var gstin = String(payload.gstin || "").trim().toUpperCase();
      var year = String(payload.year || "").trim();
      var fy = String(payload.fy || "").trim();
      var captchaInput =
        document.querySelector('input[name="captcha"]') ||
        document.querySelector('input[ng-model*="captcha"]') ||
        document.querySelector('input[id*="captcha"]');
      var captcha = String(payload.captcha || (captchaInput && captchaInput.value) || "").trim();
      var jsonHeaders = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      };
      if (!year) {
        year = String(new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear());
      }
      if (!fy) fy = year;
      var detailsUrl = "/services/api/search/taxpayerDetails";
      var returnUrl = "/services/api/search/taxpayerReturnDetails";
      var detailsBody = { gstin: gstin };
      if (captcha) detailsBody.captcha = captcha;

      Promise.all([
        request({ method: "POST", url: detailsUrl, headers: jsonHeaders, body: JSON.stringify(detailsBody) })
      ]).then(function (results) {
        return request({
          method: "POST",
          url: returnUrl,
          headers: jsonHeaders,
          body: JSON.stringify({ gstin: gstin, fy: fy || year })
        }).then(function (returnResp) {
          window.postMessage({
            type: "gc-returns-pro-searchtp-response",
            type: "${SEARCHTP_RESPONSE_EVENT}",
            requestId: data.requestId,
            payload: {
              status: !!(returnResp && returnResp.ok),
              gstin: gstin,
              year: year,
              fy: fy || year,
              taxpayerDetails: results[0] ? results[0].responseText : null,
              taxpayerReturnDetails: returnResp ? returnResp.responseText : null,
              error: returnResp && !returnResp.ok ? (returnResp.error || ("taxpayerReturnDetails failed (" + returnResp.status + ")")) : ""
            }
          }, "*");
        });
      }).catch(function (error) {
        window.postMessage({
          type: "gc-returns-pro-searchtp-response",
          type: "${SEARCHTP_RESPONSE_EVENT}",
          requestId: data.requestId,
          payload: {
            status: false,
            gstin: gstin,
            error: error && error.message ? error.message : "searchtp-return-status failed"
          }
        }, "*");
      });
    });
  })();`;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.parentNode.removeChild(script);
  globalThis.__neoGstSearchBridgeReady = SEARCHTP_BRIDGE_VERSION;
}


function requestSearchTpViaPage(payload) {
  return new Promise(function (resolve) {
    ensureSearchTpPageBridge();
    var requestId = "gc-returns-pro-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    var completed = false;
    var timer = setTimeout(function () {
      if (completed) return;
      completed = true;
      window.removeEventListener("message", onMessage);
      resolve({ status: false, error: "Timed out waiting for GST portal response." });
    }, 20000);

    function onMessage(event) {
      if (event.source !== window) return;
      var data = event.data || {};
      if (data.type !== SEARCHTP_RESPONSE_EVENT || data.requestId !== requestId) return;
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.payload || { status: false, error: "Empty GST portal response." });
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ type: SEARCHTP_REQUEST_EVENT, requestId: requestId, payload: payload || {} }, "*");
  });
}

function fillSearchTpFromHash() {
  try {
    const hash = String(location.hash || "");
    const match = hash.match(/gstin=([^&]+)/i);
    if (!match) return;
    const gstin = decodeURIComponent(match[1] || "").trim().toUpperCase();
    if (!gstin) return;
    let attempts = 0;
    const timer = setInterval(function () {
      attempts += 1;
      const input =
        document.getElementById("for_gstin") ||
        document.querySelector('input[name="for_gstin"]') ||
        document.querySelector('input[placeholder*="GSTIN"]');
      if (input) {
        input.focus();
        input.value = gstin;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        clearInterval(timer);
      } else if (attempts >= 12) {
        clearInterval(timer);
      }
    }, 500);
  } catch (error) {
    log("Unable to fill searchtp GSTIN from hash.");
  }
}

if (!globalThis.__neoGstPortalMessageListenerAdded) {
  function sendMissingUrl(sendResponse) {
    sendResponse({ status: false, error: "Missing URL" });
  }

  function sendPortalHttpResponse(sendResponse, promise) {
    promise.then((resp) => {
      sendResponse({
        status: resp.success,
        statusCode: resp.statusCode,
        response: resp.responseData,
        responseUrl: resp.responseUrl,
      });
    });
  }

  function handlePortalHttpMessage(msg, sendResponse, fallbackUrl, method) {
    const url = msg.url || fallbackUrl;
    if (!url) {
      sendMissingUrl(sendResponse);
      return true;
    }
    sendPortalHttpResponse(sendResponse, method === "POST" ? httpPostAsync(url, "text", null) : httpGetAsync(url, "text"));
    return true;
  }

  function handleAsyncGstinMessage(msg, sendResponse, requestFn, fallbackMessage) {
    const payload = msg.payload || {};
    const gstin = String(payload.gstin || "").trim().toUpperCase();
    if (!gstin) {
      sendResponse({ status: false, error: "Missing GSTIN" });
      return true;
    }
    requestFn(payload).then(function(result) {
      sendResponse(result);
    }).catch(function(error) {
      sendResponse({
        status: false,
        gstin: gstin,
        error: error && error.message ? error.message : fallbackMessage,
      });
    });
    return true;
  }

  browser.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === "gst-fill-searchtp") {
      const payload = msg.payload || {};
      const gstin = String(payload.gstin || "").trim().toUpperCase();
      const fillSearch = function() {
        const inputs = Array.from(document.querySelectorAll("input"));
        const input = inputs.find(function(el) {
          const text = String(el.id || el.name || el.placeholder || el.getAttribute("aria-label") || "").toLowerCase();
          return /gstin|search/.test(text);
        });
        if (input && gstin) {
          input.focus();
          input.value = gstin;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      let attempts = 0;
      const timer = setInterval(function() {
        attempts += 1;
        fillSearch();
        if (attempts >= 10) {
          clearInterval(timer);
        }
      }, 500);
      sendResponse({ status: true });
      return true;
    }
    if (msg.type === "portal-ustatus") {
      return handlePortalHttpMessage(msg, sendResponse, location && location.origin ? `${location.origin}/services/api/ustatus` : null, "GET");
    }
    if (msg.type === "portal-profile-detail") {
      return handlePortalHttpMessage(msg, sendResponse, location && location.origin ? `${location.origin}/services/auth/profile/detail` : null, "POST");
    }
    if (msg.type === "portal-busplaces") {
      return handlePortalHttpMessage(msg, sendResponse, location && location.origin ? `${location.origin}/services/auth/profile/busplaces` : null, "POST");
    }
    if (msg.type === "portal-filing-snapshot") {
      return handlePortalHttpMessage(msg, sendResponse, "https://services.gst.gov.in/returns/auth/api/filingsnapshot", "GET");
    }
    if (msg.type === "searchtp-return-status") {
      return handleAsyncGstinMessage(msg, sendResponse, requestSearchTpViaPage, "searchtp-return-status failed");
    }
    if (msg.type === "searchtp-goodservice") {
      return handleAsyncGstinMessage(msg, sendResponse, requestGoodserviceViaPage, "searchtp-taxpayerDetails failed");
    }
    if (msg.type === "searchtp-template-status") {
      readGoodserviceTemplateStatusViaPage().then(function (result) {
        sendResponse(result);
      });
      return true;
    }
  });
  globalThis.__neoGstPortalMessageListenerAdded = true;
}

/////// Helper functions ///////

async function httpGetAsync(url, responseType, headers) {
  return new Promise(function (resolve, reject) {
    let xhr = new XMLHttpRequest();

    xhr.onreadystatechange = function() {
      if (this.readyState == 4) {
        var success = this.status == 200;  
        log(`Request ${url} ${success? 'completed': 'failed'} with status code ${this.status}`);
  
        resolve({
          success: success,
          statusCode: this.status,
          responseUrl: success? this.responseURL: null,
          responseData: success? this.response: null
        });

        //We never reject our promise
      }
    };

    xhr.open("GET", url, true);
    xhr.withCredentials = true; // ensure auth cookies are sent
    Object.entries(headers || {}).forEach(([key, value]) => {
      try {
        xhr.setRequestHeader(key, value);
      } catch (e) {
        log(`Skipping unsafe request header ${key}`);
      }
    });
    xhr.responseType = responseType;
    //xhr.timeout = 15000;
    xhr.send();
  });
}

async function httpPostAsync(url, responseType, body) {
  return new Promise(function (resolve, reject) {
    let xhr = new XMLHttpRequest();

    xhr.onreadystatechange = function() {
      if (this.readyState == 4) {
        var success = this.status == 200;  
        log(`Request ${url} ${success? 'completed': 'failed'} with status code ${this.status}`);
  
        resolve({
          success: success,
          statusCode: this.status,
          responseUrl: success? this.responseURL: null,
          responseData: success? this.response: null
        });
      }
    };

    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.responseType = responseType;
    if (body && body.contentType) {
      xhr.setRequestHeader("Content-Type", body.contentType);
    }
    xhr.send(body && body.data ? body.data : null);
  });
}

async function httpRequestAsync(options) {
  return new Promise(function (resolve) {
    let xhr = new XMLHttpRequest();

    xhr.onreadystatechange = function() {
      if (this.readyState !== 4) return;
      resolve({
        success: this.status >= 200 && this.status < 300,
        statusCode: this.status,
        responseUrl: this.responseURL || ((options && options.url) || ""),
        responseData: this.responseText || "",
      });
    };

    xhr.onerror = function() {
      resolve({
        success: false,
        statusCode: 0,
        responseUrl: (options && options.url) || "",
        responseData: "",
      });
    };

    xhr.open((options && options.method) || "GET", options.url, true);
    xhr.withCredentials = options && options.withCredentials !== false;
    Object.keys((options && options.headers) || {}).forEach(function(key) {
      if (options.headers[key] != null) {
        xhr.setRequestHeader(key, options.headers[key]);
      }
    });
    xhr.send((options && options.body) || null);
  });
}

function log(msg, obj) {
  if (!obj)
    console.log(new Date().toISOString() + ": " + msg);
  else
    console.log(`${new Date().toISOString()}: ${msg} (${obj.constructor.name}) ${JSON.stringify(obj)}`);
}

async function zipAsync(fileData, fileName) {
  let zip = new JSZip();
  zip.file(fileName, fileData);
  return await zip.generateAsync({type:"blob"});
}

function saveFile(filename, content, contentType) {
  var a = document.createElement('a');
  var blob = new Blob([content], {type : contentType});
  a.href = window.URL.createObjectURL(blob);
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click(); //this is probably the key - simulating a click on a download link
  a.parentNode.removeChild(a);
}

function clickUrl(url, onNewTab) {
  var a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  
  if (onNewTab)
    a.target = '_blank';

  document.body.appendChild(a);
  a.click(); //this is probably the key - simulating a click on a download link
  a.parentNode.removeChild(a);
}

/////// Process functions ///////

function registerProcessors() {
  process = {};
  process['get'] = processGet;
  process['getBlob'] = processGetBlob;
  process['log'] = processLog;
  process['save-json-as-zip'] = processZipAndSave;
  process['download-url'] = processDownloadUrl;
  process['getGstin'] = processGetGstin;
}

async function processGet(msg) {
  let resp = await httpGetAsync(msg.url, "text", msg.headers || null);

  msg.status = resp.success;
  msg.statusCode = resp.statusCode;
  msg.response = resp.responseData;
  msg.responseUrl = resp.responseUrl;

  //log('Sending response: ' + JSON.stringify(msg));
  //log(`Response data length: ${data.length}`);
  //log(`Response data type: ${typeof data}`);

  port.postMessage(msg);
}

async function processGetBlob(msg) {
  let resp = await httpGetAsync(msg.url, "blob", msg.headers || null);
    
  msg.status = resp.success;
  msg.statusCode = resp.statusCode;
  msg.response = null;
  msg.responseUrl = resp.responseUrl;

  if ((resp.responseData) && (resp.responseData.size > 0))
    msg.response = URL.createObjectURL(resp.responseData);

  //log('Sending response: ' + JSON.stringify(msg));
  //log(`Response data length: ${data.size}`);
  
  port.postMessage(msg);  
}

function processLog(msg) {
  msg.status = true;
  msg.statusCode = 200;
  log(msg.text, msg.obj);
  port.postMessage(msg);
}

async function processZipAndSave(msg) {
  let zipData = await zipAsync(msg.jsonData, `${msg.jsonfilename}.json`);
  saveFile(msg.zipfilename+".zip", zipData, "application/zip");
  msg.status = true;
  msg.statusCode = 200;
  port.postMessage(msg);
}

function processDownloadUrl(msg) {
  if (msg && msg.url) {
    clickUrl(msg.url, !!msg.newTab);
    msg.status = true;
    msg.statusCode = 200;
  } else {
    msg.status = false;
    msg.statusCode = 400;
  }
  port.postMessage(msg);
}

function processGetGstin(msg) {
  try {
    const text = document.body ? document.body.innerText || "" : "";
    const match = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d{1}[A-Z0-9]{1}Z[A-Z0-9]{1}\b/);
    msg.status = true;
    msg.statusCode = 200;
    msg.response = match ? match[0] : "";
  } catch (e) {
    msg.status = false;
    msg.statusCode = 500;
    msg.response = "";
  }
  port.postMessage(msg);
}
