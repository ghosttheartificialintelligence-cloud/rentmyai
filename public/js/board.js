/* Public job board. No Bearer token. Static host only.
   Never invent jobs. On fetch fail: Data unavailable and/or last-known snapshot. */
(function () {
  var statusClasses = {
    open: "status-open",
    accepted: "status-accepted",
    submitted: "status-submitted",
    paid: "status-paid"
  };

  var lastKnown = null; /* { data, source, fetchedAt, live } */
  var scrollStarted = false;
  var REFRESH_MS = 60 * 1000;

  function formatXMR(rate) {
    if (rate === null || rate === undefined || rate === "") return "—";
    var n = parseFloat(rate);
    if (Number.isNaN(n)) return "—";
    return n.toFixed(4) + " XMR";
  }

  function age(dateStr) {
    if (!dateStr) return "";
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    var hours = Math.floor(diff / 3600000);
    var days = Math.floor(diff / 86400000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    if (hours < 24) return hours + "h ago";
    return days + "d ago";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtClock(isoOrMs) {
    try {
      var d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString([], {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  function settlementStamp(job) {
    /* Authoritative public timestamps only. Unknown if absent — never invent. */
    if (job.status !== "paid" && job.settlement_status !== "confirmed") return "";
    if (job.paid_at) {
      var settle = job.settlement_status ? (" · settlement " + job.settlement_status) : "";
      return '<div class="meta">paid_at ' + escapeHtml(age(job.paid_at)) + settle + "</div>";
    }
    if (job.settlement_status === "confirmed") {
      return '<div class="meta">settlement confirmed · paid_at unknown</div>';
    }
    return '<div class="meta">paid_at unknown</div>';
  }

  function jobRow(job) {
    var sc = statusClasses[job.status] || "status-paid";
    var rate = job.rate_max || job.rate_min || job.agreed_rate;
    var buyer = job.buyer_name || job.buyer || "";
    /* Price column = posted rate (commitment), not verified transfer. */
    return "<tr>" +
      '<td><span class="status-badge ' + sc + '">' +
        '<span class="dot dot-' + escapeHtml(job.status || "other") + '"></span>' +
        escapeHtml(job.status || "—") +
      "</span></td>" +
      '<td><span class="job-id" title="' + escapeHtml(job.job_id) + '">' +
        escapeHtml(job.job_id) + "</span></td>" +
      '<td><div class="title-text">' + escapeHtml(job.title || "—") + "</div>" +
        '<div class="meta">' + escapeHtml(job.service_type || "") + "</div>" +
        settlementStamp(job) + "</td>" +
      '<td class="rate" title="Posted rate (commitment), not verified transfer">' + formatXMR(rate) + "</td>" +
      '<td class="timestamp">' + escapeHtml(age(job.created_at)) + "</td>" +
      '<td class="meta">' + escapeHtml(buyer) + "</td>" +
      "</tr>";
  }

  async function fetchBoard() {
    var urls = ["/api/board", "https://economy.rentmyai.ai/board"];
    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      try {
        var r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) continue;
        var data = await r.json();
        if (data && Array.isArray(data.jobs)) {
          return { data: data, source: url, live: true, fetchedAt: Date.now() };
        }
      } catch (e) {
        /* try next */
      }
    }
    return null;
  }

  function count24h(jobs, predicate) {
    var cutoff = Date.now() - 86400000;
    return jobs.filter(function (j) {
      var t = j.created_at ? new Date(j.created_at).getTime() : 0;
      return t >= cutoff && predicate(j);
    }).length;
  }

  function renderTable(jobs) {
    var box = document.getElementById("board-body");
    if (!box) return;
    if (!jobs.length) {
      box.innerHTML = '<div class="empty">No open jobs right now.</div>';
      return;
    }
    box.innerHTML =
      '<table class="board"><thead><tr>' +
        "<th>Status</th><th>Job ID</th><th>Title</th><th>Posted rate</th><th>Posted</th><th>Buyer</th>" +
      "</tr></thead><tbody>" + jobs.map(jobRow).join("") + "</tbody></table>";
  }

  function renderUnavailable(msg) {
    var box = document.getElementById("board-body");
    if (!box) return;
    box.innerHTML = '<div class="empty unavailable">' + escapeHtml(msg) + "</div>";
  }

  function startAutoScroll(el) {
    if (scrollStarted) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    scrollStarted = true;
    var dir = 1;
    setInterval(function () {
      if (el.matches(":hover") || el.matches(":focus-within")) return;
      var max = el.scrollHeight - el.clientHeight;
      if (max <= 4) return;
      if (el.scrollTop >= max - 1) dir = -1;
      if (el.scrollTop <= 0) dir = 1;
      el.scrollTop += dir;
    }, 40);
  }

  function setMcJobCounts(jobs, available) {
    var postedEl = document.getElementById("jobs-posted");
    var doneEl = document.getElementById("jobs-done");
    if (postedEl) {
      if (!available) {
        postedEl.textContent = "unavailable";
        postedEl.classList.add("hold");
      } else {
        postedEl.textContent = String(count24h(jobs, function () { return true; }));
        postedEl.classList.remove("hold");
      }
    }
    /* Public /board is open jobs. Completed is not on this endpoint. */
    if (doneEl) {
      doneEl.textContent = available ? "not published" : "unavailable";
      doneEl.classList.add("hold");
    }
  }

  function publishBoardMeta(meta) {
    window.RentMyAIBoardMeta = meta;
    try {
      window.dispatchEvent(new CustomEvent("rentmyai:board-meta", { detail: meta }));
    } catch (e) { /* ignore */ }
  }

  async function load() {
    var updated = document.getElementById("updated");
    var result = await fetchBoard();

    if (result) {
      lastKnown = result;
      var jobs = result.data.jobs || [];
      var total = result.data.total != null ? result.data.total : jobs.length;
      renderTable(jobs);
      setMcJobCounts(jobs, true);
      if (updated) {
        updated.textContent =
          "live · " + total + " on board · fetched " + fmtClock(result.fetchedAt) +
          " · " + result.source;
        updated.classList.remove("stale", "fail");
      }
      publishBoardMeta({
        live: true,
        count: total,
        source: result.source,
        fetchedAt: result.fetchedAt,
        stale: false
      });
    } else if (lastKnown) {
      var lkJobs = lastKnown.data.jobs || [];
      var lkTotal = lastKnown.data.total != null ? lastKnown.data.total : lkJobs.length;
      renderTable(lkJobs);
      setMcJobCounts(lkJobs, true);
      if (updated) {
        updated.textContent =
          "Data unavailable · showing last-known snapshot (" + lkTotal +
          " jobs) from " + fmtClock(lastKnown.fetchedAt) + " · refresh failed";
        updated.classList.add("stale", "fail");
      }
      publishBoardMeta({
        live: false,
        count: lkTotal,
        source: lastKnown.source,
        fetchedAt: lastKnown.fetchedAt,
        stale: true,
        error: "refresh failed"
      });
    } else {
      renderUnavailable("Data unavailable — board could not be loaded. No sample jobs shown.");
      setMcJobCounts([], false);
      if (updated) {
        updated.textContent = "Data unavailable · " + fmtClock(Date.now());
        updated.classList.add("fail");
        updated.classList.remove("stale");
      }
      publishBoardMeta({
        live: false,
        count: null,
        source: null,
        fetchedAt: null,
        stale: true,
        error: "unavailable"
      });
    }

    var scroll = document.getElementById("board-scroll");
    if (scroll) startAutoScroll(scroll);
  }

  window.RentMyAIBoard = { refresh: load };

  load();
  setInterval(load, REFRESH_MS);
})();
