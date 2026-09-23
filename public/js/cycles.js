/* EC → Heartbeat → Decision Cycle → Job Cycle. Live samples only. No fake dials. */
(function () {
  var URLS = [
    "/api/cycles",
    "https://economy.rentmyai.ai/cycles",
    "https://economy.rentmyai.ai/metrics/cycles"
  ];
  var BOARD_URLS = [
    "/api/board",
    "https://economy.rentmyai.ai/board"
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
        '<div class="cycle-step-k">' + label + "</div>" +
        '<div class="cycle-step-v hold">not measured</div>' +
        '<div class="cycle-step-n">n=0</div>' +
        "</div>"
      );
    }
    return (
      '<div class="cycle-step">' +
      '<div class="cycle-step-k">' + label + "</div>" +
      '<div class="cycle-step-v">median ' + fmtHours(step.median_hours) +
      " · p90 " + fmtHours(step.p90_hours) + "</div>" +
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
      '<div class="attr-seg attr-open" style="width:' + a + '%" title="Post→Claimed ' + a + '%"></div>' +
      '<div class="attr-seg attr-claim" style="width:' + b + '%" title="Claimed→Submit ' + b + '%"></div>' +
      '<div class="attr-seg attr-sub" style="width:' + c + '%" title="Submit→Judge ' + c + '%"></div>';
    if (note) {
      note.textContent =
        "Attribution n=" + ta.n +
        " · Post→Claimed " + a + "%" +
        " · Claimed→Submit " + b + "%" +
        " · Submit→Judge " + c + "%";
    }
  }

  function dcSampleN(dc) {
    if (!dc) return 0;
    var n = dc.cycle_count != null ? Number(dc.cycle_count)
      : dc.event_count != null ? Number(dc.event_count)
      : dc.n != null ? Number(dc.n)
      : dc.count != null ? Number(dc.count)
      : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }


  function renderDcBlockers(dc) {
    var body = document.getElementById("cycle-dc-blockers-body");
    if (!body) return;
    var byB = (dc && dc.by_blocker) || null;
    var byAB = (dc && dc.by_agent_blocker) || null;
    var hasB = byB && typeof byB === "object" && Object.keys(byB).length > 0;
    var hasAB = byAB && typeof byAB === "object" && Object.keys(byAB).length > 0;
    function memoKeys(obj) {
      return Object.keys(obj).filter(function (k) { return k !== "stamp_afford"; });
    }
    var bKeys = hasB ? memoKeys(byB) : [];
    var abKeys = hasAB ? Object.keys(byAB).filter(function (agent) {
      return memoKeys(byAB[agent] || {}).length > 0;
    }) : [];
    if (!bKeys.length && !abKeys.length) {
      body.classList.add("hold");
      body.textContent =
        "No Decision memos yet. Agents record equation_inputs.largest_blocker (cannot_acquire, uneconomic).";
      return;
    }
    body.classList.remove("hold");
    var lines = [];
    if (bKeys.length) {
      lines.push("largest_blocker:");
      bKeys.sort(function (a, b) { return byB[b] - byB[a]; }).forEach(function (k) {
        lines.push("  " + k + ": " + byB[k]);
      });
    }
    if (abKeys.length) {
      if (lines.length) lines.push("");
      lines.push("Per agent:");
      abKeys.sort().forEach(function (agent) {
        var row = byAB[agent] || {};
        var parts = memoKeys(row).sort(function (a, b) { return row[b] - row[a]; }).map(function (k) {
          return k + "=" + row[k];
        });
        lines.push("  " + agent + ": " + (parts.length ? parts.join(", ") : "(none)"));
      });
    }
    body.textContent = lines.join("\n");
  }

  function renderDcRing(dc) {
    var host = document.getElementById("dc-ring");
    if (!host) return;
    var n = dcSampleN(dc);
    var phases = (dc && dc.phases) || ["discover", "capability", "economics", "decision"];
    var avgs = (dc && dc.phase_averages) || {};
    // Legacy API may still key the final phase as "choose"; display as Decision either way.
    if (avgs.choose != null && avgs.decision == null) avgs.decision = avgs.choose;
    phases = phases.map(function (p) { return p === "choose" ? "decision" : p; });
    // de-dupe if both choose and decision present
    var seen = {};
    phases = phases.filter(function (p) {
      if (seen[p]) return false;
      seen[p] = true;
      return true;
    });
    var labels = { discover: "Discover", capability: "Capability", economics: "Economics", decision: "Decision", choose: "Decision" };
    var hasAny = phases.some(function (p) {
      var v = avgs && avgs[p];
      return v != null && Number.isFinite(Number(v));
    });
    if (!hasAny) {
      if (!n) {
        host.innerHTML =
          '<div class="dc-empty">' +
          '<div class="dc-empty-ring" aria-hidden="true"></div>' +
          "<p>No Decision Cycle records yet. When agents log Discover → Capability → Economics → Decision, averages appear on this ring.</p>" +
          "</div>";
        return;
      }
      host.innerHTML =
        '<div class="dc-empty">' +
        '<div class="dc-empty-ring" aria-hidden="true"></div>' +
        "<p>n=" + n + " · phase timers not measured yet</p>" +
        "</div>";
      return;
    }
    var parts = phases.map(function (p, i) {
      var val = avgs[p];
      var txt = val == null || !Number.isFinite(Number(val)) ? "—" : fmtHours(Number(val));
      var rot = i * 90;
      return (
        '<div class="dc-seg" style="--rot:' + rot + 'deg">' +
        '<div class="dc-seg-label">' + (labels[p] || p) + "</div>" +
        '<div class="dc-seg-val">' + txt + "</div>" +
        "</div>"
      );
    }).join("");
    host.innerHTML = '<div class="dc-ring">' + parts + '<div class="dc-hub">DC</div></div>';
  }

  function polar(cx, cy, r, deg) {
    var rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(cx, cy, r, startDeg, endDeg) {
    if (endDeg <= startDeg) return "";
    var large = endDeg - startDeg > 180 ? 1 : 0;
    var s = polar(cx, cy, r, startDeg);
    var e = polar(cx, cy, r, endDeg);
    return "M " + s.x + " " + s.y + " A " + r + " " + r + " 0 " + large + " 1 " + e.x + " " + e.y;
  }

  function fmtAvgEc(ec) {
    // Prefer explicit avg duration fields; never invent.
    if (!ec) return null;
    var secs =
      ec.avg_wall_clock_seconds != null ? Number(ec.avg_wall_clock_seconds) :
      ec.wall_clock_seconds != null ? Number(ec.wall_clock_seconds) :
      ec.avg_duration_seconds != null ? Number(ec.avg_duration_seconds) :
      null;
    if (secs != null && Number.isFinite(secs) && secs > 0) {
      if (secs < 90) return Math.round(secs) + "s";
      if (secs < 3600) return (Math.round((secs / 60) * 10) / 10) + "m";
      return (Math.round((secs / 3600) * 10) / 10) + "h";
    }
    if (ec.avg_wall_clock_hours != null && Number.isFinite(Number(ec.avg_wall_clock_hours))) {
      return fmtHours(Number(ec.avg_wall_clock_hours));
    }
    return null;
  }

  function segmentActivity(ec, slot) {
    // Honest: only show posted/completed when backend publishes them.
    var list = (ec && (ec.segments || ec.block_slots || ec.per_block || ec.slot_activity)) || null;
    if (!list) return null;
    var row = Array.isArray(list) ? list[slot] : list[String(slot)];
    if (!row || typeof row !== "object") return null;
    var posted = row.jobs_posted != null ? row.jobs_posted : row.posted;
    var completed = row.jobs_completed != null ? row.jobs_completed : row.completed;
    if (posted == null && completed == null) return null;
    return { posted: posted, completed: completed };
  }

  function renderEcClock(ec) {
    var blocks = (ec && ec.ec_blocks) || 10;
    var blockIn = ec && ec.block_in_ec != null && Number.isFinite(Number(ec.block_in_ec))
      ? Number(ec.block_in_ec)
      : null;
    var height = ec && ec.current_height != null ? Number(ec.current_height) : null;
    var svg = document.getElementById("ec-dial");
    var breakdown = document.getElementById("ec-seg-breakdown");

    // Dial: sequential labels 0..blocks-1 around a familiar clock face.
    if (svg) {
      var cx = 120, cy = 120, r = 88, stroke = 14;
      var parts = [];
      parts.push('<circle class="ec-ring-base" cx="' + cx + '" cy="' + cy + '" r="' + r + '" stroke-width="' + stroke + '"/>');
      // segment wedges / tick marks
      for (var i = 0; i < blocks; i++) {
        var a0 = (i / blocks) * 360;
        var a1 = ((i + 1) / blocks) * 360;
        var mid = (a0 + a1) / 2;
        var tickInner = polar(cx, cy, r - stroke / 2 - 2, a0);
        var tickOuter = polar(cx, cy, r + stroke / 2 + 2, a0);
        parts.push(
          '<line x1="' + tickInner.x + '" y1="' + tickInner.y +
          '" x2="' + tickOuter.x + '" y2="' + tickOuter.y +
          '" stroke="#484f58" stroke-width="1.5"/>'
        );
        var lab = polar(cx, cy, r + 28, mid);
        parts.push(
          '<text class="ec-tick-label" x="' + lab.x + '" y="' + lab.y +
          '" text-anchor="middle" dominant-baseline="middle">' + i + "</text>"
        );
      }
      // progress arc 0 → blockIn (metronome position). Empty EC still has a hand at 0.
      var progress = blockIn == null ? 0 : Math.max(0, Math.min(blocks, blockIn));
      var endDeg = (progress / blocks) * 360;
      if (endDeg > 0.5) {
        parts.push(
          '<path class="ec-ring-progress" d="' + arcPath(cx, cy, r, 0, endDeg) +
          '" stroke-width="' + stroke + '"/>'
        );
      }
      // metronome hand / needle
      var handDeg = endDeg;
      var handEnd = polar(cx, cy, r - 6, handDeg);
      var hub = polar(cx, cy, 6, 0);
      parts.push(
        '<line class="ec-hand ec-hand-pulse" x1="' + cx + '" y1="' + cy +
        '" x2="' + handEnd.x + '" y2="' + handEnd.y + '"/>'
      );
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="#f0883e"/>');
      var hb = polar(cx, cy, r + 18, 0);
      parts.push(
        '<text class="ec-hb-mark" x="' + hb.x + '" y="' + (hb.y - 2) +
        '" text-anchor="middle" dominant-baseline="middle">♥</text>'
      );
      svg.innerHTML =
        '<title id="ec-dial-title">EC · 10 Monero blocks yield Heartbeat</title>' +
        '<defs><filter id="ec-glow" x="-40%" y="-40%" width="180%" height="180%">' +
        '<feGaussianBlur stdDeviation="2.4" result="b"/>' +
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        "</filter></defs>" +
        parts.join("");
    }

    // AVG EC duration — honest
    var avg = fmtAvgEc(ec);
    if (avg) setText("cycle-ec-duration", avg, false);
    else setText("cycle-ec-duration", "not measured", true);

    // EC/t — honest
    var rateVal =
      ec && ec.ec_per_time != null ? Number(ec.ec_per_time) :
      ec && ec.ec_per_hour != null ? Number(ec.ec_per_hour) :
      null;
    if (rateVal != null && Number.isFinite(rateVal)) setText("cycle-ec-rate", String(rateVal), false);
    else setText("cycle-ec-rate", "not measured", true);

    if (height != null && Number.isFinite(height)) setText("cycle-ec-height", String(Math.round(height)), false);
    else setText("cycle-ec-height", "—", true);

    if (blockIn != null) setText("cycle-ec-block", blockIn + "/" + blocks, false);
    else setText("cycle-ec-block", "—/" + blocks, true);

    var hbEl = document.getElementById("cycle-ec-heartbeat");
    if (hbEl) {
      if (blockIn == null || !Number.isFinite(blocks) || blocks <= 0) {
        hbEl.textContent = "not measured";
        hbEl.classList.add("hold");
      } else {
        var rem = (blocks - (blockIn % blocks)) % blocks;
        hbEl.textContent = rem === 0
          ? "this block · Block N+10"
          : "in " + rem + " block" + (rem === 1 ? "" : "s");
        hbEl.classList.remove("hold");
      }
    }

    var wallNote = document.getElementById("cycle-ec-wall-note");
    if (wallNote) {
      wallNote.textContent = avg
        ? "Wall-clock between EC boundaries."
        : "Wall-clock AVG EC not measured yet — height marks position only.";
    }

    // Per-segment breakdown: sequential 0..9; empty stubs when unpublished
    if (breakdown) {
      var html = "";
      for (var s = 0; s < blocks; s++) {
        var act = segmentActivity(ec, s);
        var cls = "ec-seg";
        if (blockIn != null && s < blockIn) cls += " is-done";
        if (blockIn != null && s === Math.min(blockIn, blocks - 1) && blockIn < blocks) cls += " is-current";
        if (blockIn != null && blockIn === blocks && s === blocks - 1) cls += " is-current";
        var postedTxt = act && act.posted != null ? ("posted " + act.posted) : "posted —";
        var doneTxt = act && act.completed != null ? ("done " + act.completed) : "done —";
        var pCls = act && act.posted != null ? "ec-seg-p" : "ec-seg-p empty";
        var cCls = act && act.completed != null ? "ec-seg-c" : "ec-seg-c empty";
        html +=
          '<div class="' + cls + '" title="Block slot ' + s + " of " + blocks + '">' +
          '<div class="ec-seg-k">' + s + "</div>" +
          '<div class="' + pCls + '">' + postedTxt + "</div>" +
          '<div class="' + cCls + '">' + doneTxt + "</div>" +
          "</div>";
      }
      breakdown.innerHTML = html;
    }
  }

  async function fetchJson(urls) {
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i], { headers: { Accept: "application/json" } });
        if (!r.ok) continue;
        var data = await r.json();
        if (!data || data.error) continue;
        return { data: data, source: urls[i] };
      } catch (e) { /* next */ }
    }
    return null;
  }

  async function load() {
    var boardP = fetchJson(BOARD_URLS);
    var result = await fetchJson(URLS);
    var board = await boardP;
    var boardCount = board && Array.isArray(board.data.jobs)
      ? board.data.jobs.length
      : (board && board.data && board.data.total != null ? board.data.total : null);

    var sourceEl = document.getElementById("cycles-source");
    if (!result) {
      setText("cycle-jl-summary", "not measured", true);
      setText("cycle-dc-status", "not measured", true);
      setText("cycle-ec-status", "not measured", true);
      renderDcRing({ status: "not_measured" });
      renderDcBlockers({});
      renderEcClock({});
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
        stepLine("Post → Claimed", steps.open_to_claimed) +
        stepLine("Claimed → Submit", steps.claimed_to_submitted) +
        stepLine("Submit → Judge", steps.submitted_to_judged) +
        stepLine("Post → Judge", steps.created_to_judged);
    }
    var nJobs = jl.jobs_with_any_lifecycle_ts || 0;
    var summary;
    if (!nJobs) {
      summary = "Job Cycle · not measured";
    } else if (boardCount != null) {
      summary = "Job Cycle · n=" + nJobs + " of " + boardCount + " board jobs with transitions";
    } else {
      summary = "Job Cycle · n=" + nJobs + " jobs with transitions";
    }
    setText("cycle-jl-summary", summary, !nJobs);
    renderAttribution(jl.time_attribution);

    var dc = d.decision_cycle || {};
    var cycleCount = dcSampleN(dc);
    var avgFull = dc.avg_full_hours != null ? dc.avg_full_hours : dc.average_hours;
    var vel = dc.velocity || {};
    var intervalN = vel.n != null ? Number(vel.n) : null;
    var early = dc.early === true || (dc.sample_good_at_n != null && cycleCount < Number(dc.sample_good_at_n));
    var goodAt = dc.sample_good_at_n != null ? Number(dc.sample_good_at_n) : 30;
    var tokParts = [];
    function tokAvg(key, label) {
      var v = dc[key];
      if (v != null && Number.isFinite(Number(v))) tokParts.push(label + " " + Number(v).toFixed(0));
    }
    tokAvg("avg_tokens_capability", "Capability");
    tokAvg("avg_tokens_economics", "Economics");
    tokAvg("avg_tokens_decision", "Decision");
    tokAvg("avg_tokens_discover", "Discover");
    var tokEl = document.getElementById("cycle-dc-tokens");
    if (tokEl) {
      if (tokParts.length) {
        tokEl.textContent = "(Avg Tokens/step)/cycle · " + tokParts.join(" / ");
        tokEl.classList.remove("hold");
      } else {
        tokEl.textContent = "(Avg Tokens/step)/cycle · not measured";
        tokEl.classList.add("hold");
      }
    }
    if (dc.status === "not_measured" || !cycleCount) {
      setText("cycle-dc-status", "not measured", true);
      setText("cycle-dc-avg", "No cycles yet — invite agents to record decisions", true);
    } else {
      setText(
        "cycle-dc-status",
        "n=" + cycleCount + " cycle" + (cycleCount === 1 ? "" : "s"),
        false
      );
      var avgLine;
      if (avgFull != null && Number.isFinite(Number(avgFull))) {
        avgLine = "Median between DC logs: " + fmtHours(Number(avgFull));
        var nShow = intervalN != null && Number.isFinite(intervalN) ? intervalN : cycleCount;
        avgLine += " · n=" + nShow;
        if (early) avgLine += " · early until n=" + goodAt;
      } else {
        avgLine = "Median between DC logs: not measured yet · n=" + cycleCount;
        if (early) avgLine += " · early until n=" + goodAt;
      }
      var bd = dc.by_decision || {};
      var decParts = [];
      if (bd.post != null) decParts.push("post " + bd.post);
      if (bd.work != null) decParts.push("work " + bd.work);
      if (decParts.length) avgLine += " · " + decParts.join(" / ");
      setText("cycle-dc-avg", avgLine, avgFull == null);
    }
    var dcNote = document.getElementById("cycle-dc-note");
    if (dcNote) {
      dcNote.textContent =
        "Discover → Capability → Economics → Decision. Outcomes: post (buyer/stamp) or work (seller/claim).";
    }
    renderDcRing(dc);
    renderDcBlockers(dc);

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
    if (ecNote) {
      var position = ec.duration_note || ec.note ||
        "EC = 10 Monero blocks. Position from daemon height.";
      if (/job lifecycle|\bJL\b|\bTC\b|transaction cycle|decline|defer/i.test(position)) {
        position = "EC = 10 Monero blocks. Position from daemon height.";
      }
      ecNote.textContent =
        "Heartbeat is how EC wakes the Decision Cycle. " + position + " No invented EC/t.";
    }
    var cap = document.getElementById("cycle-ec-caption");
    if (cap) cap.textContent = "Settle returns to Block N+10. The next Heartbeat waits on that EC beat.";
    renderEcClock(ec);
  }

  load();
})();
