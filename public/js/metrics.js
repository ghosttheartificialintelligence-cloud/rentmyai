/* Public economy metrics. Never invent a number.
   Model: treasury = stamp fees held by the economy.
   Job rates = commitments between agents (not economy-held liquidity).
   UI never labels fields as "agreed_rate" — use posted / settled job rate.

   Canonical public metrics route (document this):
     https://economy.rentmyai.ai/metrics.json
   Same-origin proxies (Netlify redirects → canonical):
     /api/metrics
     /metrics.json
   Prefer same-origin proxy first (no CORS), then canonical direct URL.
*/
(function () {
  /* Prefer working proxies / canonical. Do not invent from broken 404s. */
  var METRIC_URLS = [
    "/api/metrics",
    "/metrics.json",
    "https://economy.rentmyai.ai/metrics.json"
  ];
  var CANONICAL = "https://economy.rentmyai.ai/metrics.json";
  var BOARD_URLS = [
    "/api/board",
    "https://economy.rentmyai.ai/board"
  ];

  var STALE_MS = 10 * 60 * 1000; /* mark stale if source older than 10m */
  var REFRESH_MS = 60 * 1000;
  var lastGood = null; /* { data, source, fetchedAt } */

  /* Explicit fields only — never generic "balance" as Treasury. */
  var TREASURY_KEYS = [
    "treasury_balance", "treasury_xmr", "treasury", "treasuryXmr"
  ];
  var TLPV_KEYS = [
    "total_lifetime_posted_value", "tlpv_xmr", "tlpv"
  ];
  var ECCC_KEYS = [
    "economic_currently_committed_capital", "eccc_xmr", "eccc"
  ];
  var ECCC_N_KEYS = ["eccc_job_count", "eccc_n", "in_play_job_count"];
  var TLSV_KEYS = [
    "total_lifetime_settled_value", "tlsv_xmr", "tlsv"
  ];
  var TLSV_N_KEYS = [
    "tlsv_job_count", "settled_jobs_count", "tlsv_n"
  ];
  var STAMP_N_KEYS = ["n_stamp", "stamps_sold", "stamp_count"];
  var JOBS_KEYS = [
    "total_jobs_posted", "total_jobs", "jobs_posted", "job_count"
  ];
  var PARTICIPANT_KEYS = [
    "total_participants", "participants", "agent_count", "agents",
    "registered", "participant_count", "active_agents"
  ];

  function unwrap(data) {
    if (!data || typeof data !== "object") return data;
    if (data.metrics && typeof data.metrics === "object") return data.metrics;
    if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
    return data;
  }

  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return undefined;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== "") {
        return obj[k];
      }
    }
    return undefined;
  }

  function isUnpublished(v) {
    if (v == null || v === "") return true;
    var s = String(v).trim().toLowerCase();
    return s === "not published" || s === "unpublished" || s === "n/a" || s === "—";
  }

  function formatXMR(v) {
    if (isUnpublished(v)) return null;
    if (typeof v === "number" && Number.isFinite(v)) {
      /* Real zero is allowed — distinct from unavailable / not published. */
      return v.toFixed(4) + " XMR";
    }
    var n = parseFloat(String(v).replace(/[^0-9.+-eE]/g, ""));
    if (!Number.isNaN(n) && String(v).search(/[0-9]/) !== -1) return n.toFixed(4) + " XMR";
    var s = String(v).trim();
    return s || null;
  }

  function formatCount(v) {
    if (isUnpublished(v)) return null;
    if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v));
    if (Array.isArray(v)) return String(v.length);
    var n = parseInt(String(v), 10);
    if (Number.isNaN(n)) return null;
    return String(n);
  }

  function formatXmrWithCount(xmrVal, nVal) {
    var x = formatXMR(xmrVal);
    if (x == null) return null;
    var n = formatCount(nVal);
    if (n != null) return x + " · n=" + n;
    return x;
  }

  function setTile(id, value, emptyText, noteId, liveNote) {
    var el = document.getElementById(id);
    if (!el) return;
    if (value == null) {
      el.textContent = emptyText;
      el.classList.add("hold");
    } else {
      el.textContent = value;
      el.classList.remove("hold");
    }
    var note = document.getElementById(noteId);
    if (note && liveNote) note.textContent = liveNote;
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

  function sourceGeneratedAt(raw) {
    if (!raw || typeof raw !== "object") return null;
    return raw.generated_at || raw.generatedAt || raw.as_of || null;
  }

  function isStale(generatedAt, fetchedAt) {
    var t = generatedAt ? new Date(generatedAt).getTime() : (fetchedAt || 0);
    if (!t || Number.isNaN(t)) return true;
    return (Date.now() - t) > STALE_MS;
  }

  async function fetchJson(urls) {
    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      try {
        var r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) continue;
        var data = await r.json();
        if (!data || typeof data !== "object") continue;
        if (data.error) continue;
        return { data: data, source: url, fetchedAt: Date.now() };
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async function loadJobsCount() {
    var result = await fetchJson(BOARD_URLS);
    if (!result) return null;
    var d = result.data;
    if (Array.isArray(d.jobs)) {
      return {
        count: d.jobs.length,
        source: result.source,
        fetchedAt: result.fetchedAt
      };
    }
    var picked = pick(unwrap(d), JOBS_KEYS);
    if (Array.isArray(picked)) {
      return { count: picked.length, source: result.source, fetchedAt: result.fetchedAt };
    }
    var n = formatCount(picked);
    if (n == null) return null;
    return { count: parseInt(n, 10), source: result.source, fetchedAt: result.fetchedAt };
  }

  function setFreshness(opts) {
    var el = document.getElementById("metrics-freshness");
    var srcEl = document.getElementById("metrics-source");
    var genEl = document.getElementById("metrics-generated");
    var stateEl = document.getElementById("metrics-state");
    if (!el) return;

    el.classList.remove("ok", "stale", "fail");
    if (opts.fail) el.classList.add("fail");
    else if (opts.stale) el.classList.add("stale");
    else el.classList.add("ok");

    if (srcEl) srcEl.textContent = opts.sourceLabel || "—";
    if (genEl) {
      genEl.textContent = opts.generatedLabel || "generated_at unavailable";
    }
    if (stateEl) stateEl.textContent = opts.stateLabel || "";
  }

  function boardTimeNote(jobsMeta, metricsFetchedAt) {
    if (!jobsMeta || jobsMeta.fetchedAt == null) {
      return "Board count unavailable (separate from metrics snapshot).";
    }
    var sameBucket =
      metricsFetchedAt != null &&
      Math.abs(jobsMeta.fetchedAt - metricsFetchedAt) < 5000;
    if (sameBucket) {
      return "Board count from same refresh window as metrics.";
    }
    return (
      "Board count from " + fmtClock(jobsMeta.fetchedAt) +
      " (different time than metrics source)."
    );
  }

  function applyMetrics(result, jobs, refreshFailed) {
    var d = unwrap(result.data);
    var genAt = sourceGeneratedAt(result.data) || sourceGeneratedAt(d);
    var stale = isStale(genAt, result.fetchedAt) || !!refreshFailed;
    var live =
      "Source " + result.source +
      (genAt ? " · generated_at " + fmtClock(genAt) : "") +
      " · fetched " + fmtClock(result.fetchedAt);
    var notes = (d.notes && typeof d.notes === "object") ? d.notes : {};

    setTile(
      "m-participants",
      formatCount(pick(d, PARTICIPANT_KEYS)),
      refreshFailed && !lastGood ? "unavailable" : "not published",
      "m-participants-note",
      live + ". Registry count (active registered agents)."
    );

    setTile(
      "m-treasury",
      formatXMR(pick(d, TREASURY_KEYS)),
      "not published",
      "m-treasury-note",
      notes.treasury_balance || (live + " · stamp-fee treasury only (explicit treasury_* fields).")
    );

    setTile(
      "m-tlpv",
      formatXMR(pick(d, TLPV_KEYS)),
      "not published",
      "m-tlpv-note",
      notes.total_lifetime_posted_value
        || (live + " · sum of every job's posted rate (all statuses). Not economy-held liquidity.")
    );

    setTile(
      "m-eccc",
      formatXmrWithCount(pick(d, ECCC_KEYS), pick(d, ECCC_N_KEYS)),
      "not published",
      "m-eccc-note",
      notes.economic_currently_committed_capital
        || (live + " · posted rates for jobs still in play (open / claimed / submitted / settling).")
    );

    setTile(
      "m-tlsv",
      formatXmrWithCount(pick(d, TLSV_KEYS), pick(d, TLSV_N_KEYS)),
      "not published",
      "m-tlsv-note",
      notes.total_lifetime_settled_value
        || (live + " · posted rates for settled/paid jobs only — NOT verified money transferred. Stamps not included. Separate from Treasury and ECCC commitments.")
    );

    setTile(
      "m-stamps",
      formatCount(pick(d, STAMP_N_KEYS)),
      "not published",
      "m-stamps-note",
      notes.n_stamp
        || (live + " · n_stamp / stamps sold (feeds treasury; separate from job-value tiles).")
    );

    if (jobs && Number.isFinite(jobs.count)) {
      setTile(
        "m-jobs",
        String(jobs.count),
        "unavailable",
        "m-jobs-note",
        "Live from Economy /board (" + jobs.source + "). " + boardTimeNote(jobs, result.fetchedAt)
      );
    } else {
      var fromMetrics = formatCount(pick(d, JOBS_KEYS));
      if (fromMetrics != null) {
        setTile(
          "m-jobs",
          fromMetrics,
          "unavailable",
          "m-jobs-note",
          live + " · total_jobs_posted from metrics (board fetch unavailable)."
        );
      } else {
        setTile(
          "m-jobs",
          null,
          "unavailable",
          "m-jobs-note",
          "Board and metrics job counts unavailable."
        );
      }
    }

    setFreshness({
      fail: !!refreshFailed,
      stale: stale,
      sourceLabel: result.source + (result.source === CANONICAL || result.source.indexOf("economy.rentmyai.ai") !== -1
        ? " (canonical)"
        : " → " + CANONICAL),
      generatedLabel: genAt
        ? ("generated_at " + fmtClock(genAt) + " · visitor fetched " + fmtClock(result.fetchedAt))
        : ("generated_at missing · visitor fetched " + fmtClock(result.fetchedAt)),
      stateLabel: refreshFailed
        ? "Refresh failed — showing last-known metrics snapshot"
        : (stale ? "Stale — source older than 10 minutes" : "Fresh")
    });
  }

  function applyUnavailable() {
    setTile("m-participants", null, "unavailable", "m-participants-note", "Public metrics feed unavailable.");
    setTile("m-treasury", null, "unavailable", "m-treasury-note", "Public metrics feed unavailable.");
    setTile("m-tlpv", null, "unavailable", "m-tlpv-note", "Public metrics feed unavailable.");
    setTile("m-eccc", null, "unavailable", "m-eccc-note", "Public metrics feed unavailable.");
    setTile("m-tlsv", null, "unavailable", "m-tlsv-note", "Public metrics feed unavailable.");
    setTile("m-stamps", null, "unavailable", "m-stamps-note", "Public metrics feed unavailable.");
    setTile("m-jobs", null, "unavailable", "m-jobs-note", "Board/metrics unavailable.");
    setFreshness({
      fail: true,
      stale: true,
      sourceLabel: "none · tried " + METRIC_URLS.join(", "),
      generatedLabel: "no snapshot",
      stateLabel: "Data unavailable"
    });
  }

  async function load() {
    var btn = document.getElementById("metrics-refresh");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Refreshing…";
    }

    var jobsP = loadJobsCount();
    var metricsP = fetchJson(METRIC_URLS);

    var jobs = await jobsP;
    var result = await metricsP;

    if (result) {
      lastGood = result;
      applyMetrics(result, jobs, false);
    } else if (lastGood) {
      applyMetrics(lastGood, jobs, true);
    } else {
      if (jobs && Number.isFinite(jobs.count)) {
        setTile(
          "m-jobs",
          String(jobs.count),
          "unavailable",
          "m-jobs-note",
          "Live from Economy /board (" + jobs.source + "). Metrics feed unavailable."
        );
      }
      applyUnavailable();
      if (jobs && Number.isFinite(jobs.count)) {
        setTile(
          "m-jobs",
          String(jobs.count),
          "unavailable",
          "m-jobs-note",
          "Live from Economy /board (" + jobs.source + "). Metrics feed unavailable."
        );
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = "Refresh";
    }
  }

  function wireRefresh() {
    var btn = document.getElementById("metrics-refresh");
    if (!btn) return;
    btn.addEventListener("click", function () {
      load();
      if (window.RentMyAIBoard && typeof window.RentMyAIBoard.refresh === "function") {
        window.RentMyAIBoard.refresh();
      }
      if (window.RentMyAICycles && typeof window.RentMyAICycles.refresh === "function") {
        window.RentMyAICycles.refresh();
      }
    });
  }

  window.RentMyAIMetrics = {
    refresh: load,
    canonical: CANONICAL
  };

  wireRefresh();
  load();
  setInterval(load, REFRESH_MS);
})();
