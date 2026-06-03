(function () {
  "use strict";

  var browser = globalThis.browser || globalThis.chrome;
  var _cat = "returns";
  var _customDate = false;
  var _selReturn = null;
  var _selLedger = null;
  var _jsonBusy = false;
  var _excelBusy = false;
  var _workspaceVisible = false;

  var CHIPS = {
    returns: [
      { k:"G3B",  l:"GSTR-3B" }, { k:"G1",   l:"GSTR-1"  },
      { k:"G2A",  l:"GSTR-2A" }, { k:"G2B",  l:"GSTR-2B" },
      { k:"G9",   l:"GSTR-9"  }, { k:"G9C",  l:"GSTR-9C" },
      { k:"G4",   l:"GSTR-4"  }, { k:"G4A",  l:"GSTR-4A" },
      { k:"G6A",  l:"GSTR-6A" }, { k:"G7",   l:"GSTR-7"  },
      { k:"G8A",  l:"GSTR-8"  }, { k:"G10",  l:"GSTR-10" },
    ],
    summary: [
      { k:"G1SUM",         l:"GSTR-1 Sum"    },
      { k:"G2ASUM",        l:"GSTR-2A Sum"   },
      { k:"G2BSUM",        l:"GSTR-2B Sum"   },
      { k:"G2AOTHER",      l:"2A Other"      },
      { k:"G3B_VS_G1SUM",  l:"3B vs 1"       },
      { k:"G3B_VS_G2ASUM", l:"3B vs 2A"      },
    ],
    other: [
      { k:"CHALLAN_LIST", l:"Challan"      },
      { k:"IMS_IN",       l:"IMS Inward"   },
      { k:"IMS_OUT",      l:"IMS Outward"  },
    ],
    ledger: [
      { k:"ITC_LED",  l:"ITC Ledger"    },
      { k:"REV_RCLM", l:"E-Credit Rev"  },
      { k:"RCM_LED",  l:"RCM Liability" },
      { k:"LIAB_RET", l:"Liab. (Ret)"   },
      { k:"LIAB_PAY", l:"Liab. (Pay)"   },
      { k:"CASH_LED", l:"Cash Ledger"   },
    ],
  };

  // Dark mode restore
  try {
    var p = JSON.parse(localStorage.getItem("neo_gst_prefs") || "{}");
    if (p.darkMode) document.body.classList.add("dark");
  } catch(e) {}

  // Full View button (section 7)
  document.getElementById("btn-fulltab").addEventListener("click", function () {
    try {
      var _br = (typeof browser !== "undefined" && browser) || (typeof chrome !== "undefined" && chrome);
      if (!_br || !_br.runtime || !_br.runtime.getURL) return;
      var baseUrl = _br.runtime.getURL("ui/index.html");
      // Resolve active GST tab and pass its ID so the full-view page can connect
      _br.tabs.query({}, function (allTabs) {
        var gstTab = (allTabs || []).find(function (t) {
          return t && t.url && /https:\/\/(services|return|payment|gstr2b)\.gst\.gov\.in\//i.test(t.url);
        });
        var finalUrl = baseUrl;
        if (gstTab && gstTab.id) {
          finalUrl = baseUrl + "?tabId=" + gstTab.id;
        }
        _br.tabs.create({ url: finalUrl });
        window.close();
      });
    } catch(e) {}
  });

  // FY dropdown sync
  var visFy = document.getElementById("vis-fy");
  var hidFy = document.getElementById("finYear");

  function syncFyDropdown() {
    if (!hidFy || !visFy) return;
    if (hidFy.options.length && visFy.options.length !== hidFy.options.length) {
      visFy.innerHTML = hidFy.innerHTML;
      visFy.value = hidFy.value;
    }
  }
  visFy.addEventListener("change", function () {
    if (hidFy) {
      hidFy.value = visFy.value;
      hidFy.dispatchEvent(new Event("change"));
    }
  });

  // Custom date toggle
  var btnToggleDate = document.getElementById("btn-toggle-date");
  var dateRangeWrap = document.getElementById("date-range-wrap");
  var visDateFrom   = document.getElementById("vis-date-from");
  var visDateTo     = document.getElementById("vis-date-to");

  btnToggleDate.addEventListener("click", function () {
    _customDate = !_customDate;
    dateRangeWrap.hidden = !_customDate;
    visFy.style.display = _customDate ? "none" : "";
    btnToggleDate.textContent = _customDate ? "By FY" : "Custom dates";
  });
  visDateFrom.addEventListener("change", function () {
    var h = document.getElementById("ledgerDateFrom");
    if (h) h.value = visDateFrom.value;
  });
  visDateTo.addEventListener("change", function () {
    var h = document.getElementById("ledgerDateTo");
    if (h) h.value = visDateTo.value;
  });

  // Category tabs
  document.querySelectorAll(".cattab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      _cat = tab.dataset.cat;
      document.querySelectorAll(".cattab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      var hCat = document.getElementById("gstCategory");
      if (hCat && hCat.querySelector('option[value="' + _cat + '"]')) {
        hCat.value = _cat;
        hCat.dispatchEvent(new Event("change"));
      }
      updateCategoryUI();
    });
  });

  var CAT_LABELS = { returns:"Returns", ledger:"Ledgers", summary:"Summary", other:"Other" };

  function updateCategoryUI() {
    _selReturn = null; // Reset selection on category switch
    document.getElementById("lpanel-hdr").textContent = CAT_LABELS[_cat] || "Returns";
    var chipsGrid   = document.getElementById("chips-grid");
    var ptableWrap  = document.getElementById("ptable-wrap");
    var ledgerPanel = document.getElementById("ledger-panel");
    var ledgerStrip = document.getElementById("ledger-strip");
    var jsonSub     = document.getElementById("vis-json-sub");
    var excelSub    = document.getElementById("vis-excel-sub");

    if (_cat === "ledger") {
      chipsGrid.style.display = "none";
      ptableWrap.hidden = true;
      ledgerPanel.hidden = false;
      ledgerStrip.classList.add("show");
      if (jsonSub)  jsonSub.innerHTML  = "Date<br>range";
      if (excelSub) excelSub.innerHTML = "Date<br>range";
      var retBar = document.getElementById("ret-dl-bar");
      if (retBar) retBar.hidden = true;
      renderLedgerChips();
    } else {
      chipsGrid.style.display = "";
      ledgerPanel.hidden = true;
      ledgerStrip.classList.remove("show");
      if (jsonSub)  jsonSub.innerHTML  = "Full year<br>ZIP";
      if (excelSub) excelSub.innerHTML = "Full year<br>XLSX";
      renderReturnChips();
    }
  }

  function renderReturnChips() {
    var grid = document.getElementById("chips-grid");
    grid.innerHTML = "";
    var list = CHIPS[_cat] || CHIPS.returns;
    if (!_selReturn || !list.find(function(x){ return x.k === _selReturn; })) {
      _selReturn = null; // No auto-select — let user choose
    }
    list.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      var isActive = t.k === _selReturn;
      btn.className = "chip" + (isActive ? " active" : "");
      btn.textContent = t.l;
      if (isActive) {
        // Add a clear/back "×" to deselect
        var clr = document.createElement("span");
        clr.className = "chip-clear";
        clr.textContent = "×";
        clr.title = "Show all";
        clr.addEventListener("click", function (e) {
          e.stopPropagation();
          _selReturn = null;
          renderReturnChips();
          // Hide the per-return bar
          var bar = document.getElementById("ret-dl-bar");
          if (bar) bar.hidden = true;
          var ptWrap = document.getElementById("ptable-wrap");
          if (ptWrap) ptWrap.hidden = true;
        });
        btn.appendChild(clr);
      }
      btn.addEventListener("click", function () {
        _selReturn = t.k;
        renderReturnChips();
        syncReturnTypeNoReset(t.k);
      });
      grid.appendChild(btn);
    });
    // Toggle has-selection class
    if (_selReturn) {
      grid.classList.add("has-selection");
    } else {
      grid.classList.remove("has-selection");
    }
    // Update per-return download bar
    var bar = document.getElementById("ret-dl-bar");
    var barLbl = document.getElementById("ret-dl-bar-lbl");
    if (bar) {
      if (_selReturn) {
        var sel = list.find(function(x){ return x.k === _selReturn; });
        if (barLbl && sel) barLbl.textContent = sel.l;
        bar.hidden = false;
      } else {
        bar.hidden = true;
      }
    }
  }

  function renderLedgerChips() {
    var grid = document.getElementById("ledger-chips");
    grid.innerHTML = "";
    var list = CHIPS.ledger;
    if (!_selLedger) _selLedger = list[0] ? list[0].k : null;
    list.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (t.k === _selLedger ? " active" : "");
      btn.textContent = t.l;
      btn.addEventListener("click", function () {
        _selLedger = t.k;
        renderLedgerChips();
        syncReturnType(t.k);
      });
      grid.appendChild(btn);
    });
  }

  function syncReturnType(key) {
    var h = document.getElementById("gstReturnType");
    if (!h) return;
    if (h.querySelector('option[value="' + key + '"]')) {
      h.value = key;
      h.dispatchEvent(new Event("change"));
    }
  }

  // Like syncReturnType but saves/restores FY to prevent reset
  function syncReturnTypeNoReset(key) {
    var h = document.getElementById("gstReturnType");
    if (!h) return;
    if (h.querySelector('option[value="' + key + '"]')) {
      var savedFyVis = visFy ? visFy.value : null;
      var savedFyHid = hidFy ? hidFy.value : null;
      h.value = key;
      h.dispatchEvent(new Event("change"));
      // Restore FY after a tick so popup.js doesn't override it
      setTimeout(function () {
        if (savedFyVis && visFy && visFy.querySelector('option[value="' + savedFyVis + '"]')) {
          visFy.value = savedFyVis;
        }
        if (savedFyHid && hidFy && hidFy.querySelector('option[value="' + savedFyHid + '"]')) {
          if (hidFy.value !== savedFyHid) {
            hidFy.value = savedFyHid;
            hidFy.dispatchEvent(new Event("change"));
          }
        }
      }, 100);
    }
  }

  // Mirror biz info from session (populated by popup.js)
  function syncBizInfo() {
    try {
      if (typeof session === "undefined") return;
      var gstin  = session.gstin || session.selectedClientGstin;
      var name   = session.businessName || session.selectedClientName;
      var online = session.portalOnline;
      var dot    = document.getElementById("hdr-dot");
      var nameEl = document.getElementById("hdr-name");
      var gstinEl= document.getElementById("hdr-gstin");
      if (dot) dot.className = "hdr-dot" + (online ? " online" : "");
      if (name  && nameEl)  { nameEl.textContent = name; }
      if (gstin && gstinEl) { gstinEl.textContent = gstin; gstinEl.style.display = "block"; }
    } catch(e) {}
  }

  // Mirror period table from hidden returnStatus element
  function mirrorPeriodTable() {
    var src    = document.getElementById("returnStatus");
    var tbody  = document.getElementById("ptable-body");
    var ptWrap = document.getElementById("ptable-wrap");
    if (!src || !tbody || !ptWrap || _cat === "ledger") {
      if (ptWrap) ptWrap.hidden = true;
      return;
    }
    var srcTbl = src.querySelector("table");
    if (!srcTbl) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:14px;color:var(--muted)"><span class="spin"></span></td></tr>';
      ptWrap.hidden = false;
      return;
    }
    var rows = srcTbl.querySelectorAll("tbody tr");
    if (!rows.length) return;
    var html = "";
    rows.forEach(function (srcRow) {
      var cells = srcRow.querySelectorAll("td");
      if (!cells.length) return;
      var period = cells[0] ? cells[0].textContent.trim() : "";
      var statusHtml = "";
      if (cells[1]) {
        statusHtml = cells[1].innerHTML
          .replace(/badge badge-success\b/g, "spill spill-filed")
          .replace(/badge badge-warning\b/g, "spill spill-pending")
          .replace(/badge badge-secondary\b/g, "spill spill-na")
          .replace(/spinner-border[^"]*/g, "spin")
          .replace(/text-primary/g, "");
      }
      var actHtml = "";
      if (cells[2]) {
        actHtml = cells[2].innerHTML
          .replace(/btn btn-success\b[^"]*/g, "act-btn act-dl")
          .replace(/btn btn-warning\b[^"]*/g, "act-btn act-gen")
          .replace(/btn btn-primary\b[^"]*/g, "act-btn act-dl")
          .replace(/btn-group[^"]*/g, "")
          .replace(/role="group"/g, "");
        if (cells[3]) {
          actHtml += " " + cells[3].innerHTML
            .replace(/btn btn-primary\b[^"]*/g, "act-btn act-dl")
            .replace(/btn btn-success\b[^"]*/g, "act-btn act-dl");
        }
      }
      html += "<tr><td>" + period + "</td><td>" + statusHtml + "</td><td>" + actHtml + "</td></tr>";
    });
    if (html) { tbody.innerHTML = html; ptWrap.hidden = false; }
  }

  function syncGenBar() {
    var genBar    = document.getElementById("gen-bar");
    var genBtn    = document.getElementById("btn-gen-all-vis");
    var hidGenBtn = document.getElementById("btn-gen-all");
    if (hidGenBtn && !hidGenBtn.hidden) {
      genBar.hidden = false;
      genBtn.onclick = function () { hidGenBtn.click(); };
    } else {
      genBar.hidden = true;
    }
  }

  // Refresh button
  document.getElementById("ret-btn-refresh").addEventListener("click", function () {
    var hRefresh = document.getElementById("refresh");
    if (hRefresh && !hRefresh.hidden) {
      hRefresh.click();
    } else {
      // Fallback: re-trigger current return type to reload
      if (_selReturn) syncReturnTypeNoReset(_selReturn);
    }
    // Visual spin feedback
    var btn = this;
    btn.style.opacity = "0.5";
    btn.disabled = true;
    setTimeout(function () { btn.style.opacity = ""; btn.disabled = false; }, 1200);
  });

  function showWorkspace() {
    document.getElementById("fybar").hidden     = false;
    document.getElementById("cattabs").hidden   = false;
    document.getElementById("main-grid").hidden = false;
    document.getElementById("full-year-dl-bar").hidden = false;
    document.getElementById("full-year-dl-bar").style.display = "flex";
    document.getElementById("status-line").hidden = true;
    document.getElementById("msg-other-website").hidden  = true;
    document.getElementById("msg-not-dashboard").hidden  = true;
    updateCategoryUI();
  }

  // JSON button: downloads all JSONs for FY as ZIP (no merging)
  function doJsonDownload() {
    if (_jsonBusy) return;
    if (_cat === "ledger") { triggerLedgerDownload("json"); return; }
    _jsonBusy = true;
    var spin = document.getElementById("vis-json-spin");
    if (spin) spin.style.display = "inline-block";
    var b1 = document.getElementById("btn-download-all-json");
    var b2 = document.getElementById("btn-download-all");
    if (b1 && !b1.hidden) b1.click();
    else if (b2 && !b2.hidden) b2.click();
    else { try { downloadAllStructuredReturn("json"); } catch(e) { try { downloadAll(); } catch(e2) {} } }
    setTimeout(function () { _jsonBusy = false; if (spin) spin.style.display = "none"; }, 5000);
  }
  function doExcelDownload() {
    if (_excelBusy) return;
    if (_cat === "ledger") { triggerLedgerDownload("excel"); return; }
    _excelBusy = true;
    var spin = document.getElementById("vis-excel-spin");
    if (spin) spin.style.display = "inline-block";
    var b = document.getElementById("btn-download-all-excel");
    if (b && !b.hidden) b.click();
    else { try { downloadAllStructuredReturn("excel"); } catch(e) { try { downloadAllExcel(); } catch(e2) {} } }
    setTimeout(function () { _excelBusy = false; if (spin) spin.style.display = "none"; }, 5000);
  }

  // Wire hidden btns (kept for compatibility) to new visible ones
  document.getElementById("btn-dl-json").addEventListener("click", doJsonDownload);
  document.getElementById("btn-dl-excel").addEventListener("click", doExcelDownload);
  document.getElementById("vis-btn-dl-json").addEventListener("click", doJsonDownload);
  document.getElementById("vis-btn-dl-excel").addEventListener("click", doExcelDownload);

  // Per-return JSON button
  document.getElementById("ret-btn-json").addEventListener("click", function () {
    var b1 = document.getElementById("btn-download-all-json");
    var b2 = document.getElementById("btn-download-all");
    if (b1 && !b1.hidden) b1.click();
    else if (b2 && !b2.hidden) b2.click();
    else { try { downloadAllStructuredReturn("json"); } catch(e) { try { downloadAll(); } catch(e2) {} } }
  });

  // Per-return Excel button
  document.getElementById("ret-btn-excel").addEventListener("click", function () {
    var b = document.getElementById("btn-download-all-excel");
    if (b && !b.hidden) b.click();
    else { try { downloadAllStructuredReturn("excel"); } catch(e) { try { downloadAllExcel(); } catch(e2) {} } }
  });

  function triggerLedgerDownload(mode) {
    var src = document.getElementById("returnStatus");
    if (src) {
      src.querySelectorAll("button").forEach(function (b) {
        var t = b.textContent.toLowerCase();
        if (!b.hidden && !b.disabled) {
          if (mode === "json"  && (t.includes("json")  || t.includes("download"))) b.click();
          if (mode === "excel" && (t.includes("excel") || t.includes("download"))) b.click();
        }
      });
    }
    var bj = document.getElementById("btn-ledger-json");
    var be = document.getElementById("btn-ledger-excel");
    if (mode === "json"  && bj && !bj.hidden) bj.click();
    if (mode === "excel" && be && !be.hidden) be.click();
  }

  // Polling tick — syncs visible UI from hidden shadow elements
  function tick() {
    syncBizInfo();
    syncFyDropdown();

    var msgOtherHid = document.getElementById("msgOtherWebsite");
    var msgDashHid  = document.getElementById("msgNotOnReturnDashboard");
    var wsHid       = document.getElementById("workspace");
    var stEl        = document.getElementById("statusText");
    var stLine      = document.getElementById("status-line");

    // Always sync businessInfo visibility so name/gstin show up
    var bizHid = document.getElementById("businessInfo");
    if (bizHid && !bizHid.hidden) {
      var nameEl  = document.getElementById("hdr-name");
      var gstinEl = document.getElementById("hdr-gstin");
      var bn = document.getElementById("businessName");
      var bs = document.getElementById("businessSub");
      if (bn && bn.textContent.trim() && nameEl)  nameEl.textContent  = bn.textContent.trim();
      if (bs && bs.textContent.trim() && gstinEl) { gstinEl.textContent = bs.textContent.trim(); gstinEl.style.display = "block"; }
    }

    if (msgOtherHid && !msgOtherHid.hidden) {
      document.getElementById("msg-other-website").hidden = false;
      stLine.hidden = true;
      return;
    }
    if (msgDashHid && !msgDashHid.hidden) {
      document.getElementById("msg-not-dashboard").hidden = false;
      stLine.hidden = true;
      return;
    }

    if (wsHid && !wsHid.hidden && !_workspaceVisible) {
      _workspaceVisible = true;
      stLine.hidden = true;
      showWorkspace();
      var hRet = document.getElementById("gstReturnType");
      if (hRet && hRet.value) {
        // Don't auto-select on load to avoid FY reset
        // _selReturn = hRet.value;
        _selReturn = null;
        renderReturnChips();
      }
    }

    if (_workspaceVisible && _cat !== "ledger") {
      mirrorPeriodTable();
      syncGenBar();
    }

    var hFy = document.getElementById("finYear");
    if (hFy && visFy && hFy.value !== visFy.value && visFy.options.length) {
      visFy.value = hFy.value;
    }

    // Sync status text when not yet in workspace
    if (!_workspaceVisible) {
      if (stEl && stEl.textContent.trim()) {
        stLine.textContent = stEl.textContent.trim();
        stLine.hidden = false;
      }
    }
  }

  setInterval(tick, 350);

  // MutationObserver on returnStatus for instant table refreshes
  var rsEl = document.getElementById("returnStatus");
  if (rsEl && window.MutationObserver) {
    new MutationObserver(function () {
      mirrorPeriodTable();
      syncGenBar();
    }).observe(rsEl, { childList:true, subtree:true, characterData:true });
  }

  // MutationObserver on msgOtherWebsite
  var msgOEl = document.getElementById("msgOtherWebsite");
  if (msgOEl && window.MutationObserver) {
    new MutationObserver(function () {
      if (!msgOEl.hidden) {
        document.getElementById("msg-other-website").hidden = false;
        document.getElementById("status-line").hidden = true;
      }
    }).observe(msgOEl, { attributes: true });
  }

  // MutationObserver on msgNotOnReturnDashboard
  var msgDEl = document.getElementById("msgNotOnReturnDashboard");
  if (msgDEl && window.MutationObserver) {
    new MutationObserver(function () {
      if (!msgDEl.hidden) {
        document.getElementById("msg-not-dashboard").hidden = false;
        document.getElementById("status-line").hidden = true;
      }
    }).observe(msgDEl, { attributes: true });
  }

  // MutationObserver on workspace visibility
  var wsEl = document.getElementById("workspace");
  if (wsEl && window.MutationObserver) {
    new MutationObserver(function () {
      if (!wsEl.hidden && !_workspaceVisible) {
        _workspaceVisible = true;
        showWorkspace();
      }
    }).observe(wsEl, { attributes:true });
  }

})();
