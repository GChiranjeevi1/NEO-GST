"use strict";

const runtimeApi =
  typeof browser !== "undefined"
    ? browser
    : typeof chrome !== "undefined"
      ? chrome
      : null;
const actionApi = runtimeApi.action || runtimeApi.browserAction;

function injectScripts(tabId, files, callback) {
  if (runtimeApi.scripting && runtimeApi.scripting.executeScript) {
    runtimeApi.scripting.executeScript(
      {
        target: { tabId },
        files,
      },
      () => {
        if (typeof callback === "function") callback();
      },
    );
    return;
  }

  const queue = Array.isArray(files) ? files.slice() : [];
  const runNext = () => {
    const file = queue.shift();
    if (!file) {
      if (typeof callback === "function") callback();
      return;
    }
    runtimeApi.tabs.executeScript(tabId, { file }, runNext);
  };
  runNext();
}

const openAssistantTab = (tab) => {
  const baseUrl = runtimeApi.runtime.getURL("ui/index.html");
  const tabId = tab && typeof tab.id === "number" ? tab.id : null;
  const url = tabId ? `${baseUrl}?tabId=${tabId}` : baseUrl;
  runtimeApi.tabs.create({ url });
};

actionApi.onClicked.addListener(openAssistantTab);

const pendingLoginByTab = new Map();
const pendingSearchByTab = new Map();
let lastGstTabId = null;
let pendingSearchTpTabCallbacks = [];
const isGstUrl = (url) =>
  typeof url === "string" &&
  /https:\/\/(services|return|payment|gstr2b)\.gst\.gov\.in\//i.test(url);

function getExistingTab(tabId, callback) {
  if (typeof tabId !== "number") {
    callback(null);
    return;
  }
  runtimeApi.tabs.get(tabId, (tab) => {
    if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
      callback(null);
      return;
    }
    callback(tab || null);
  });
}

function resolveActiveGstTabId(callback) {
  const finish = (tabId) => callback(typeof tabId === "number" ? tabId : null);
  if (typeof lastGstTabId === "number") {
    getExistingTab(lastGstTabId, (tab) => {
      if (tab && isGstUrl(tab.url)) {
        finish(tab.id);
        return;
      }
      lastGstTabId = null;
      runtimeApi.tabs.query({}, (tabs) => {
        const gstTab = (tabs || []).find((item) => item && typeof item.id === "number" && isGstUrl(item.url));
        if (gstTab) lastGstTabId = gstTab.id;
        finish(gstTab ? gstTab.id : null);
      });
    });
    return;
  }
  runtimeApi.tabs.query({}, (tabs) => {
    const gstTab = (tabs || []).find((item) => item && typeof item.id === "number" && isGstUrl(item.url));
    if (gstTab) lastGstTabId = gstTab.id;
    finish(gstTab ? gstTab.id : null);
  });
}

function sendMessageToTabWithContentScript(tabId, message, sendResponse) {
  const respond = (resp) => {
    if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
      sendResponse({ status: false, error: runtimeApi.runtime.lastError.message });
      return;
    }
    sendResponse(resp);
  };

  const send = () => {
    runtimeApi.tabs.sendMessage(tabId, message, respond);
  };

  injectScripts(tabId, ["contentscript.js"], () => {
    if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
      send();
      return;
    }
    send();
  });
}

function sendMissingTabId(sendResponse) {
  sendResponse({ status: false, error: "Missing tabId" });
}

function forwardToTab(tabId, message, sendResponse) {
  const candidateTabId = typeof tabId === "number" ? tabId : null;
  const sendToResolvedTab = (resolvedTabId) => {
    if (!resolvedTabId) {
      sendMissingTabId(sendResponse);
      return;
    }
    sendMessageToTabWithContentScript(resolvedTabId, message, sendResponse);
  };
  if (candidateTabId) {
    getExistingTab(candidateTabId, (tab) => {
      if (tab && isGstUrl(tab.url)) {
        lastGstTabId = tab.id;
        sendToResolvedTab(tab.id);
        return;
      }
      resolveActiveGstTabId(sendToResolvedTab);
    });
    return true;
  }
  resolveActiveGstTabId(sendToResolvedTab);
  return true;
}

function createGstTab(url, pendingMap, payload, sendResponse) {
  runtimeApi.tabs.create({ url }, (tab) => {
    if (!tab || typeof tab.id !== "number") return;
    if (pendingMap) pendingMap.set(tab.id, payload || {});
    sendResponse({ status: true, tabId: tab.id });
  });
}

runtimeApi.tabs.onActivated.addListener((activeInfo) => {
  if (!activeInfo || typeof activeInfo.tabId !== "number") return;
  runtimeApi.tabs.get(activeInfo.tabId, (tab) => {
  if (tab && isGstUrl(tab.url)) {
      lastGstTabId = tab.id;
    }
  });
});

runtimeApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (tab && isGstUrl(tab.url)) {
    lastGstTabId = tabId;
  }
});

function ensureSearchTpTab(callback) {
  const targetUrl = "https://services.gst.gov.in/services/searchtp";
  if (lastGstTabId) {
    runtimeApi.tabs.get(lastGstTabId, (tab) => {
      if (tab && typeof tab.id === "number" && /^https:\/\/services\.gst\.gov\.in\//i.test(tab.url || "")) {
        callback(tab.id);
        return;
      }
      lastGstTabId = null;
      ensureSearchTpTab(callback);
    });
    return;
  }
  if (pendingSearchTpTabCallbacks.length) {
    pendingSearchTpTabCallbacks.push(callback);
    return;
  }
  pendingSearchTpTabCallbacks.push(callback);
  runtimeApi.tabs.query({ url: "https://services.gst.gov.in/*" }, (tabs) => {
    const existing = (tabs || []).find((tab) => tab && typeof tab.id === "number");
    if (existing) {
      lastGstTabId = existing.id;
      const callbacks = pendingSearchTpTabCallbacks.splice(0, pendingSearchTpTabCallbacks.length);
      callbacks.forEach((fn) => fn(existing.id));
      return;
    }
    runtimeApi.tabs.create({ url: targetUrl, active: true }, (tab) => {
      if (!tab || typeof tab.id !== "number") {
        const callbacks = pendingSearchTpTabCallbacks.splice(0, pendingSearchTpTabCallbacks.length);
        callbacks.forEach((fn) => fn(null));
        return;
      }
      const tabId = tab.id;
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
        runtimeApi.tabs.onUpdated.removeListener(listener);
        lastGstTabId = tabId;
        const callbacks = pendingSearchTpTabCallbacks.splice(0, pendingSearchTpTabCallbacks.length);
        callbacks.forEach((fn) => fn(tabId));
      };
      runtimeApi.tabs.onUpdated.addListener(listener);
    });
  });
}

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "open-portal-login") return;
  createGstTab("https://services.gst.gov.in/services/login", pendingLoginByTab, msg.payload || {}, sendResponse);
  return true;
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "open-gst-searchtp") return;
  createGstTab("https://services.gst.gov.in/services/searchtp", pendingSearchByTab, msg.payload || {}, sendResponse);
  return true;
});

runtimeApi.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "open-download-popup") return;
  const payload = msg.payload || {};
  const baseUrl = runtimeApi.runtime.getURL("popup.html");
  const params = new URLSearchParams();
  if (payload.tabId) params.set("tabId", String(payload.tabId));
  if (payload.category) params.set("category", payload.category);
  if (payload.returnType) params.set("returnType", payload.returnType);
  const url = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
  runtimeApi.tabs.create({ url });
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "portal-ustatus") return;
  return forwardToTab(msg.tabId, { type: "portal-ustatus" }, sendResponse);
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "get-active-gst-tab") return;
  resolveActiveGstTabId((tabId) => {
    if (tabId) {
      sendResponse({ status: true, tabId });
      return;
    }
    sendResponse({ status: false, error: "No GST tab found" });
  });
  return true;
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "portal-profile-detail") return;
  return forwardToTab(msg.tabId, { type: "portal-profile-detail" }, sendResponse);
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "portal-busplaces") return;
  return forwardToTab(msg.tabId, { type: "portal-busplaces" }, sendResponse);
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "portal-filing-snapshot") return;
  return forwardToTab(msg.tabId, { type: "portal-filing-snapshot" }, sendResponse);
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "searchtp-return-status") return;
  const tabId = msg.tabId;
  if (tabId) {
    return forwardToTab(tabId, { type: "searchtp-return-status", payload: msg.payload || {} }, sendResponse);
  }
  ensureSearchTpTab((gstTabId) => {
    if (!gstTabId) {
      sendResponse({
        status: false,
        gstin: String((msg.payload && msg.payload.gstin) || "").trim().toUpperCase(),
        error: "Unable to open GST portal tab.",
      });
      return;
    }
    forwardToTab(gstTabId, { type: "searchtp-return-status", payload: msg.payload || {} }, sendResponse);
  });
  return true;
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "searchtp-goodservice") return;
  const tabId = msg.tabId;
  if (tabId) {
    return forwardToTab(tabId, { type: "searchtp-goodservice", payload: msg.payload || {} }, sendResponse);
  }
  const gstin = String((msg.payload && msg.payload.gstin) || "").trim().toUpperCase();
  if (!gstin) {
    sendResponse({ status: false, error: "Missing GSTIN" });
    return;
  }
  xhrRequest(
    {
      method: "POST",
      url: "https://services.gst.gov.in/services/api/search/taxpayerDetails",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      body: JSON.stringify({ gstin }),
    },
    (resp) => {
      sendResponse({
        status: !!(resp && resp.ok),
        gstin,
        response: resp ? resp.responseText : "",
        responseUrl: resp ? resp.finalUrl : "",
        error: resp && !resp.ok ? resp.error || `taxpayerDetails failed (${resp.status})` : "",
      });
    },
  );
  return true;
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "public-client-details") return;
  const gstin = String((msg.payload && msg.payload.gstin) || "").trim().toUpperCase();
  if (!gstin) {
    sendResponse({ status: false, error: "Missing GSTIN" });
    return;
  }
  ensureSearchTpTab((gstTabId) => {
    if (!gstTabId) {
      sendResponse({ status: false, gstin, error: "Unable to open GST portal tab." });
      return;
    }
    sendMessageToTabWithContentScript(
      gstTabId,
      { type: "searchtp-goodservice", payload: { gstin } },
      (resp) => {
        sendResponse(
          resp || {
            status: false,
            gstin,
            error: "GST portal tab did not return a response.",
          },
        );
      },
    );
  });
  return true;
});

runtimeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "searchtp-template-status") return;
  ensureSearchTpTab((gstTabId) => {
    if (!gstTabId) {
      sendResponse({ status: false, error: "Unable to open GST portal tab." });
      return;
    }
    sendMessageToTabWithContentScript(
      gstTabId,
      { type: "searchtp-template-status" },
      (resp) => {
        sendResponse(
          resp || {
            status: false,
            error: "GST portal tab did not return template status.",
          },
        );
      },
    );
  });
  return true;
});

function xhrRequest(options, callback) {
  const request = options || {};
  const method = request.method || "GET";
  const headers = new Headers();
  Object.entries(request.headers || {}).forEach(([key, value]) => {
    if (value != null) headers.set(key, value);
  });

  let body = request.body || null;
  if (request.bodyBase64) {
    const decoded = atob(request.bodyBase64);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    body = bytes.buffer;
  }

  fetch(request.url, {
    method,
    headers,
    body,
    credentials: request.withCredentials === false ? "omit" : "include",
  })
    .then(async (response) => {
      let responseText = "";
      let responseBase64 = "";
      if (request.responseType === "arraybuffer") {
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
        }
        responseBase64 = btoa(binary);
      } else {
        responseText = await response.text();
      }

      const headerText = Array.from(response.headers.entries())
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n");

      callback({
        ok: response.ok,
        status: response.status,
        responseText,
        responseBase64,
        finalUrl: response.url || request.url,
        headers: headerText,
      });
    })
    .catch((error) => {
      callback({
        ok: false,
        status: 0,
        error: error && error.message ? error.message : "Background request failed.",
        finalUrl: request.url || "",
        responseText: "",
        responseBase64: "",
        headers: "",
      });
    });
}

function xhrRequestAsync(options) {
  return new Promise((resolve) => {
    xhrRequest(options, (resp) => resolve(resp));
  });
}

async function fetchGstSearchReturnStatus(payload) {
  const gstin = String((payload && payload.gstin) || "").trim().toUpperCase();
  let year = String((payload && payload.year) || "").trim();
  let fy = String((payload && payload.fy) || "").trim();
  if (!gstin) {
    return { status: false, error: "Missing GSTIN" };
  }

  if (!year) {
    year = String(new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear());
  }
  if (!fy) fy = year;

  const detailsUrl = "https://services.gst.gov.in/services/api/search/taxpayerDetails";
  const returnUrl = "https://services.gst.gov.in/services/api/search/taxpayerReturnDetails";
  const jsonHeaders = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=utf-8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const [taxpayerDetails] = await Promise.all([
    xhrRequestAsync({
      method: "POST",
      url: detailsUrl,
      headers: jsonHeaders,
      body: JSON.stringify({ gstin }),
    }),
  ]);

  const taxpayerReturnDetails = await xhrRequestAsync({
    method: "POST",
    url: returnUrl,
    headers: jsonHeaders,
    body: JSON.stringify({ gstin, fy: fy || year }),
  });

  return {
    status: !!(taxpayerReturnDetails && taxpayerReturnDetails.ok),
    gstin,
    year,
    fy: fy || year,
    taxpayerDetails: taxpayerDetails ? taxpayerDetails.responseText : null,
    taxpayerReturnDetails: taxpayerReturnDetails ? taxpayerReturnDetails.responseText : null,
    error:
      taxpayerReturnDetails && !taxpayerReturnDetails.ok
        ? taxpayerReturnDetails.error || `taxpayerReturnDetails failed (${taxpayerReturnDetails.status})`
        : "",
  };
}

runtimeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  if (!pendingLoginByTab.has(tabId)) return;
  const payload = pendingLoginByTab.get(tabId);
  pendingLoginByTab.delete(tabId);
  const sendFill = (attempt) => {
    runtimeApi.tabs.sendMessage(tabId, { type: "gst-autofill-login", payload }, () => {
      if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
        if (attempt < 5) {
          setTimeout(() => sendFill(attempt + 1), 500 * attempt);
        }
      }
    });
  };
  sendFill(1);
});

runtimeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  if (!pendingSearchByTab.has(tabId)) return;
  const payload = pendingSearchByTab.get(tabId);
  pendingSearchByTab.delete(tabId);
  const sendFill = (attempt) => {
    runtimeApi.tabs.sendMessage(tabId, { type: "gst-fill-searchtp", payload }, () => {
      if (runtimeApi.runtime && runtimeApi.runtime.lastError) {
        if (attempt < 5) {
          setTimeout(() => sendFill(attempt + 1), 500 * attempt);
        }
      }
    });
  };
  sendFill(1);
});
