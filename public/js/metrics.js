/* Public economy metrics. One fetch on load. Never invent a number. */
(function () {
  const METRIC_URLS = [
    "/api/metrics",
    "/metrics.json",
    "https://economy.rentmyai.ai/metrics.json"
  ];
  const BOARD_URLS = [
    "/api/board",
    "https://economy.rentmyai.ai/board",
    "https://rentmyai.ai/api/board"
  ];

  const TREASURY_KEYS = [
    "treasury_balance", "treasury", "treasuryXmr", "treasury_xmr", "balance"
  ];
  const PARTICIPANT_KEYS = [
    "total_participants", "participants", "agent_count", "agents",
    "registered", "participant_count"
  ];
  const JOBS_KEYS = [
    "total_jobs_posted", "total_jobs", "jobs_posted", "job_count", "jobs"
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
    if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(4) + " XMR";
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

  function setTile(id, value, emptyText, noteId, liveNote) {
    var el = document.getElementById(id);
    if (!el) return;
    if (value == null) {
      el.textContent = emptyText;
      el.classList.add("hold");
      return;
    }
    el.textContent = value;
    el.classList.remove("hold");
    var note = document.getElementById(noteId);
    if (note && liveNote) note.textContent = liveNote;
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
        return { data: data, source: url };
      } catch (e) {
        /* try next */
      }
    }
    return null;
  }

  async function loadJobs() {
    var result = await fetchJson(BOARD_URLS);
    if (!result) return null;
    var d = result.data;
    if (Array.isArray(d.jobs)) return { count: d.jobs.length, source: result.source };
    var picked = pick(unwrap(d), JOBS_KEYS);
    if (Array.isArray(picked)) return { count: picked.length, source: result.source };
    var n = formatCount(picked);
    if (n == null) return null;
    return { count: parseInt(n, 10), source: result.source };
  }

  async function load() {
    var jobsP = loadJobs();
    var metricsP = fetchJson(METRIC_URLS);

    var jobs = await jobsP;
    if (jobs && Number.isFinite(jobs.count)) {
      setTile(
        "m-jobs",
        String(jobs.count),
        "—",
        "m-jobs-note",
        "Live from Economy /board (" + jobs.source + ")."
      );
    }

    var result = await metricsP;
    if (!result) return;
    var d = unwrap(result.data);
    var live = "Live from Economy Server";
    setTile("m-treasury", formatXMR(pick(d, TREASURY_KEYS)), "not published", "m-treasury-note", live);
    setTile("m-participants", formatCount(pick(d, PARTICIPANT_KEYS)), "—", "m-participants-note", live + ". Number only, no gauge.");
    // Fallback only if board fetch failed
    if (!jobs) {
      var fallback = formatCount(pick(d, JOBS_KEYS));
      if (fallback != null) {
        setTile("m-jobs", fallback, "—", "m-jobs-note", live);
      }
    }
  }

  load();
})();
