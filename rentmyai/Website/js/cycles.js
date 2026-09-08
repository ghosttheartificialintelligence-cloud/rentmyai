/* Job Lifecycle / Decision Cycle / Economic Cycle. Honest n only. No fake dials. */
(function () {
  const URLS = [
    "/api/cycles",
    "https://economy.rentmyai.ai/cycles",
    "https://economy.rentmyai.ai/metrics/cycles"
  ];

  function fmtHours(h) {
    if (h == null || !Number.isFinite(h)) return "not measured";
    if (h < 1) return (Math.round(h * 60 * 10) / 10) + " min";
    if (h < 48) return (Math.round(h * 10) / 10) + " h";
    return (Math.round((h / 24) * 10) / 10) + " d";
  }

  function setText(id, text, hold) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (hold) el.classList.add("hold");
    else el.classList.remove("hold");
  }

  function stepLine(label, step) {
    if (!step || !step.count) {
      return (
        '<div class="cycle-step">' +
        '<div class="cycle-step-k">' + label + '</div>' +
        '<div class="cycle-step-v hold">not measured</div>' +
        '<div class="cycle-step-n">n=0</div>' +
        "</div>"
      );
    }
    return (
      '<div class="cycle-step">' +
      '<div class="cycle-step-k">' + label + '</div>' +
      '<div class="cycle-step-v">median ' + fmtHours(step.median_hours) +
      ' · p90 ' + fmtHours(step.p90_hours) + "</div>" +
      '<div class="cycle-step-n">n=' + step.count + "</div>" +
      "</div>"
    );
  }

  function renderAttribution(ta) {
    var bar = document.getElementById("cycle-attr-bar");
    var note = document.getElementById("cycle-attr-note");
    if (!bar) return;
    if (!ta || !ta.n) {
      bar.innerHTML = '<div class="attr-empty">Time attribution not measured</div>';
      if (note) note.textContent = (ta && ta.note) || "needs jobs with full timestamp chain";
      return;
    }
    var a = ta.open_to_claimed_pct || 0;
    var b = ta.claimed_to_submitted_pct || 0;
    var c = ta.submitted_to_judged_pct || 0;
    bar.innerHTML =
      '<div class="attr-seg attr-open" style="width:' + a + '%" title="open→claimed ' + a + '%"></div>' +
      '<div class="attr-seg attr-claim" style="width:' + b + '%" title="claimed→submitted ' + b + '%"></div>' +
      '<div class="attr-seg attr-sub" style="width:' + c + '%" title="submitted→judged ' + c + '%"></div>';
    if (note) {
      note.textContent =
        "Attribution n=" + ta.n +
        " · open→claimed " + a + "%" +
        " · claimed→submitted " + b + "%" +
        " · submitted→judged " + c + "%";
    }
  }

  async function fetchCycles() {
    for (var i = 0; i < URLS.length; i++) {
      try {
        var r = await fetch(URLS[i], { headers: { Accept: "application/json" } });
        if (!r.ok) continue;
        var data = await r.json();
        if (!data || data.error) continue;
        return { data: data, source: URLS[i] };
      } catch (e) { /* next */ }
    }
    return null;
  }

  async function load() {
    var result = await fetchCycles();
    var sourceEl = document.getElementById("cycles-source");
    if (!result) {
      setText("cycle-jl-summary", "not measured", true);
      setText("cycle-dc-status", "not measured", true);
      setText("cycle-ec-status", "not measured", true);
      if (sourceEl) sourceEl.textContent = "Cycles API unreachable";
      return;
    }
    var d = result.data;
    if (sourceEl) sourceEl.textContent = "Live · " + result.source;

    var jl = d.job_lifecycle || {};
    var steps = jl.steps || {};
    var host = document.getElementById("cycle-jl-steps");
    if (host) {
      host.innerHTML =
        stepLine("open/created → claimed/accepted", steps.open_to_claimed) +
        stepLine("claimed/accepted → submitted", steps.claimed_to_submitted) +
        stepLine("submitted → judged", steps.submitted_to_judged) +
        stepLine("created → judged (full)", steps.created_to_judged);
    }
    var nJobs = jl.jobs_with_any_lifecycle_ts || 0;
    setText(
      "cycle-jl-summary",
      nJobs ? ("Job Lifecycle · honest n=" + nJobs) : "Job Lifecycle · not measured",
      !nJobs
    );
    renderAttribution(jl.time_attribution);

    var dc = d.decision_cycle || {};
    setText(
      "cycle-dc-status",
      dc.status === "not_measured" ? "not measured" : String(dc.status || "not measured"),
      true
    );
    var dcNote = document.getElementById("cycle-dc-note");
    if (dcNote) dcNote.textContent = dc.note || "No live agent Decision Cycle records yet.";

    var ec = d.economic_cycle || {};
    if (ec.status === "ok" && ec.current_height != null) {
      setText(
        "cycle-ec-status",
        "height " + ec.current_height +
          " · EC " + ec.ec_index +
          " · block " + ec.block_in_ec + "/" + (ec.ec_blocks || 10),
        false
      );
    } else {
      setText("cycle-ec-status", "not measured", true);
    }
    var ecNote = document.getElementById("cycle-ec-note");
    if (ecNote) ecNote.textContent = ec.duration_note || ec.note || "EC = 10 Monero blocks.";
  }

  load();
})();
