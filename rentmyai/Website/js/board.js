/* Public job board. No Bearer token. Static host only.
   Never invent jobs. On fetch fail: Data unavailable and/or last-known snapshot.
   Category counts (Bryan 2026-09-27): Open / Accepted / Submitted / Paid
   must sum exactly to total jobs ever on /board. */
(function () {
  var CATEGORY_STATUSES = {
    open: { open: 1, pending_stamp: 1 },
    accepted: { in_progress: 1, claimed: 1, work_submitted: 1 },
    submitted: {
      submitted: 1,
      awaiting_settlement: 1,
      settling: 1,
      prize_pending: 1
    },
    paid: {
      paid: 1,
      settled: 1,
      closed: 1,
      cancelled: 1,
      canceled: 1
    }
  };

  var statusToCategory = {};
  Object.keys(CATEGORY_STATUSES).forEach(function (cat) {
    Object.keys(CATEGORY_STATUSES[cat]).forEach(function (st) {
      statusToCategory[st] = cat;
    });
  });

  var statusClasses = {
    open: "status-open",
    pending_stamp: "status-open",
    accepted: "status-accepted",
    in_progress: "status-accepted",
    claimed: "status-accepted",
    work_submitted: "status-accepted",
    submitted: "status-submitted",
    awaiting_settlement: "status-submitted",
    settling: "status-submitted",
    prize_pending: "status-submitted",
    paid: "status-paid",
    settled: "status-paid",
    closed: "status-paid",
    cancelled: "status-paid",
    canceled: "status-paid"
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

  function categorizeStatus(raw) {
    var st = String(raw == null ? "" : raw).toLowerCase().trim();
    return statusToCategory[st] || null;
  }

  /** Partition every job once. Assert: open+accepted+submitted+paid === total. */
  function countCategories(jobs) {
    var counts = { open: 0, accepted: 0, submitted: 0, paid: 0, other: 0, total: 0 };
    var otherStatuses = {};
    if (!Array.isArray(jobs)) return counts;
    counts.total = jobs.length;
    for (var i = 0; i < jobs.length; i++) {
      var cat = categorizeStatus(jobs[i] && jobs[i].status);
      if (cat && Object.prototype.hasOwnProperty.call(counts, cat)) {
        counts[cat] += 1;
      } else {
        counts.other += 1;
        var key = String(jobs[i] && jobs[i].status != null ? jobs[i].status : "(null)");
        otherStatuses[key] = (otherStatuses[key] || 0) + 1;
      }
    }
    counts.sum =
      counts.open + counts.accepted + counts.submitted + counts.paid;
    counts.ok = counts.sum === counts.total && counts.other === 0;
    counts.otherStatuses = otherStatuses;
    return counts;
  }

  function setText(id, text, hold) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (hold) el.classList.add("hold");
    else el.classList.remove("hold");
  }

  function renderCategoryCounts(counts, available) {
    var wrap = document.getElementById("board-counts");
    if (!available || !counts) {
      setText("board-total-ever", "—", true);
      setText("board-count-open", "—", true);
      setText("board-count-accepted", "—", true);
      setText("board-count-submitted", "—", true);
      setText("board-count-paid", "—", true);
      setText("board-count-assert", "", false);
      if (wrap) {
        wrap.classList.add("unavailable");
        wrap.removeAttribute("data-assert-ok");
      }
      return;
    }
    setText("board-total-ever", String(counts.total), false);
    setText("board-count-open", String(counts.open), false);
    setText("board-count-accepted", String(counts.accepted), false);
    setText("board-count-submitted", String(counts.submitted), false);
    setText("board-count-paid", String(counts.paid), false);
    var assertEl = document.getElementById("board-count-assert");
    if (assertEl) {
      if (counts.ok) {
        assertEl.textContent =
          "✓ " + counts.open + "+" + counts.accepted + "+" +
          counts.submitted + "+" + counts.paid + "=" + counts.total;
        assertEl.classList.remove("fail");
        assertEl.classList.add("ok");
      } else {
        assertEl.textContent =
          "assert fail: " + counts.sum + "≠" + counts.total +
          (counts.other ? " · other=" + counts.other : "");
        assertEl.classList.add("fail");
        assertEl.classList.remove("ok");
      }
    }
    if (wrap) {
      wrap.classList.remove("unavailable");
      wrap.setAttribute("data-assert-ok", counts.ok ? "1" : "0");
    }
  }

  function jobRow(job) {
    var raw = job.status || "other";
    var cat = categorizeStatus(raw);
    var sc = statusClasses[raw] || statusClasses[cat] || "status-paid";
    var dotClass = cat || "other";
    var rate = job.rate_max || job.rate_min || job.agreed_rate;
    var buyer = job.buyer_name || job.buyer || "";
    return "<tr>" +
      '<td><span class="status-badge ' + sc + '">' +
        '<span class="dot dot-' + escapeHtml(dotClass) + '"></span>' +
        escapeHtml(raw || "—") +
      "</span></td>" +
      '<td><span class="job-id" title="' + escapeHtml(job.job_id) + '">' +
        escapeHtml(job.job_id) + "</span></td>" +
      '<td><div class="title-text">' + escapeHtml(job.title || "—") + "</div>" +
        '<div class="meta">' + escapeHtml(job.service_type || "") + "</div></td>" +
      '<td class="rate">' + formatXMR(rate) + "</td>" +
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
        "<th>Status</th><th>Job ID</th><th>Title</th><th>Price</th><th>Posted</th><th>Buyer</th>" +
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
      /* Prefer jobs.length for category partition; warn if API total disagrees. */
      var counts = countCategories(jobs);
      if (Number(total) !== counts.total) {
        counts.ok = false;
        counts.apiTotal = Number(total);
      }
      renderTable(jobs);
      renderCategoryCounts(counts, true);
      setMcJobCounts(jobs, true);
      if (updated) {
        var assertBit = counts.ok
          ? " · categories OK"
          : " · category assert fail";
        updated.textContent =
          "live · " + counts.total + " ever · fetched " + fmtClock(result.fetchedAt) +
          " · " + result.source + assertBit;
        updated.classList.toggle("fail", !counts.ok);
        updated.classList.remove("stale");
      }
      publishBoardMeta({
        live: true,
        count: counts.total,
        categories: {
          open: counts.open,
          accepted: counts.accepted,
          submitted: counts.submitted,
          paid: counts.paid,
          sum: counts.sum,
          ok: counts.ok
        },
        source: result.source,
        fetchedAt: result.fetchedAt,
        stale: false
      });
    } else if (lastKnown) {
      var lkJobs = lastKnown.data.jobs || [];
      var lkCounts = countCategories(lkJobs);
      renderTable(lkJobs);
      renderCategoryCounts(lkCounts, true);
      setMcJobCounts(lkJobs, true);
      if (updated) {
        updated.textContent =
          "Data unavailable · showing last-known snapshot (" + lkCounts.total +
          " jobs) from " + fmtClock(lastKnown.fetchedAt) + " · refresh failed";
        updated.classList.add("stale", "fail");
      }
      publishBoardMeta({
        live: false,
        count: lkCounts.total,
        categories: {
          open: lkCounts.open,
          accepted: lkCounts.accepted,
          submitted: lkCounts.submitted,
          paid: lkCounts.paid,
          sum: lkCounts.sum,
          ok: lkCounts.ok
        },
        source: lastKnown.source,
        fetchedAt: lastKnown.fetchedAt,
        stale: true,
        error: "refresh failed"
      });
    } else {
      renderUnavailable("Data unavailable — board could not be loaded. No sample jobs shown.");
      renderCategoryCounts(null, false);
      setMcJobCounts([], false);
      if (updated) {
        updated.textContent = "Data unavailable · " + fmtClock(Date.now());
        updated.classList.add("fail");
        updated.classList.remove("stale");
      }
      publishBoardMeta({
        live: false,
        count: null,
        categories: null,
        source: null,
        fetchedAt: null,
        stale: true,
        error: "unavailable"
      });
    }

    var scroll = document.getElementById("board-scroll");
    if (scroll) startAutoScroll(scroll);
  }

  window.RentMyAIBoard = {
    refresh: load,
    countCategories: countCategories,
    categorizeStatus: categorizeStatus
  };

  load();
  setInterval(load, REFRESH_MS);
})();
