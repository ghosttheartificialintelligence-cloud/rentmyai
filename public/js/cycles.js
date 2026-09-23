/* Block Cycle → Heartbeat → Decision Cycle → Job Cycle → Settle.
   Live samples only. No fake dials.
   Presence and Block Cycles Per Settle refresh from /cycles, /board,
   and /events/dc when that feed is public. See buildMetabolism. */
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
  var DC_EVENT_URLS = [
    "/api/events/dc",
    "https://economy.rentmyai.ai/events/dc"
  ];
  /* Monero target block time. Public feeds publish daemon height, not a
     historical height index, so post/settle timestamps are placed on the
     Block Cycle clock from the live height anchor. */
  var BLOCK_SECONDS = 120;
  var PRESENCE_WINDOWS = 10;
  var REFRESH_MS = 60 * 1000;
  var KNOWN_AGENTS = [
    { key: "hera", label: "Hera" },
    { key: "zeus", label: "Zeus" },
    { key: "athena", label: "Athena" },
    { key: "cos", label: "Chief of Staff" }
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
        "No Decision memos yet. Pass reasons: Fit, Margin, Capacity, Value, or other.";
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
        '<title id="ec-dial-title">Block Cycle · Monero Block N to Block N+10 yields one Heartbeat</title>' +
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
        ? "Wall-clock between Block Cycle boundaries."
        : "Wall-clock Block Cycle length not measured yet — height marks position only.";
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

  function canonAgent(name) {
    var s = String(name || "").trim().toLowerCase().replace(/[_-]+/g, " ");
    if (s === "hera") return "hera";
    if (s === "zeus") return "zeus";
    if (s === "athena") return "athena";
    if (s === "cos" || s === "chief of staff" || s === "chiefofstaff") return "cos";
    return null;
  }

  function extractEventList(payload) {
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload)) return payload;
    var keys = ["events", "dc_events", "items", "records"];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(payload[keys[i]])) return payload[keys[i]];
    }
    if (payload.decision_cycle && Array.isArray(payload.decision_cycle.events)) {
      return payload.decision_cycle.events;
    }
    if (Array.isArray(payload.data)) return payload.data;
    return [];
  }

  function anchorFromEc(ec, generatedAt) {
    if (!ec || ec.current_height == null) return null;
    var height = Number(ec.current_height);
    var blocks = Number(ec.ec_blocks || 10);
    if (!Number.isFinite(height) || !Number.isFinite(blocks) || blocks <= 0) return null;
    var genMs = generatedAt ? new Date(generatedAt).getTime() : Date.now();
    if (!Number.isFinite(genMs)) genMs = Date.now();
    var index = ec.ec_index != null && Number.isFinite(Number(ec.ec_index))
      ? Number(ec.ec_index)
      : Math.floor(height / blocks);
    return { height: height, blocks: blocks, generatedMs: genMs, ecIndex: index };
  }

  function heightAt(ts, anchor) {
    var ms = new Date(ts).getTime();
    if (!Number.isFinite(ms)) return null;
    return anchor.height - (anchor.generatedMs - ms) / 1000 / BLOCK_SECONDS;
  }

  function ecIndexAt(ts, anchor) {
    var h = heightAt(ts, anchor);
    if (h == null || !Number.isFinite(h)) return null;
    return Math.floor(h / anchor.blocks);
  }

  function idNameMap(jobs) {
    var map = {};
    (jobs || []).forEach(function (j) {
      if (j.buyer && j.buyer_name) map[String(j.buyer)] = j.buyer_name;
      if (j.seller && j.seller_name) map[String(j.seller)] = j.seller_name;
    });
    return map;
  }

  function isHeartbeatSource(ev) {
    var s = ev && (ev.source != null ? ev.source : ev.origin);
    return String(s || "").trim().toLowerCase() === "heartbeat";
  }

  function eventIndex(ev, anchor) {
    if (!ev) return null;
    if (ev.ec_index != null && Number.isFinite(Number(ev.ec_index))) return Number(ev.ec_index);
    if (ev.height != null && Number.isFinite(Number(ev.height)) && anchor) {
      return Math.floor(Number(ev.height) / anchor.blocks);
    }
    var ts = ev.ts || ev.timestamp || ev.created_at || ev.time || null;
    if (ts && anchor) return ecIndexAt(ts, anchor);
    return null;
  }

  function eventAgentKey(ev, names) {
    var raw = ev.agent_name || ev.name || ev.agent || ev.who || ev.actor || ev.participant || "";
    if (names[String(raw)]) raw = names[String(raw)];
    return canonAgent(raw);
  }

  function agentsPresent(dc, jobs, events, names) {
    var seen = {};
    var by = (dc && dc.by_agent_decision) || {};
    Object.keys(by).forEach(function (k) {
      var c = canonAgent(k);
      if (c) seen[c] = true;
    });
    (jobs || []).forEach(function (j) {
      var b = canonAgent(j.buyer_name);
      var s = canonAgent(j.seller_name);
      if (b) seen[b] = true;
      if (s) seen[s] = true;
    });
    (events || []).forEach(function (ev) {
      var k = eventAgentKey(ev, names);
      if (k) seen[k] = true;
    });
    return KNOWN_AGENTS.filter(function (a) { return seen[a.key]; });
  }

  function mean(nums) {
    if (!nums.length) return null;
    var s = 0;
    for (var i = 0; i < nums.length; i++) s += nums[i];
    return s / nums.length;
  }

  function fmtCycleCount(n) {
    if (n == null || !Number.isFinite(n)) return null;
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  /* Presence: last 10 Block Cycles, hit if the agent posted a Heartbeat DC
     event in that window. When /events/dc is not public, a hit is Decision=post
     (buyer on a job whose created_at falls in the window). Claim time is not
     on the public board, so Decision=work cannot be placed.
     Block Cycles Per Settle: (height(paid_at) - height(created_at)) / 10.
     Start is the public post (Heartbeat Decision that opened the job).
     End is paid_at, Settle. Fleet mean is per job. */
  function buildMetabolism(d, jobs, eventPayload) {
    var ec = (d && d.economic_cycle) || {};
    var dc = (d && d.decision_cycle) || {};
    var generatedAt = d && (d.generated_at || d.generatedAt);
    var anchor = anchorFromEc(ec, generatedAt);
    var names = idNameMap(jobs);
    var events = extractEventList(d).concat(extractEventList(dc)).concat(extractEventList(eventPayload));
    var heartbeat = events.filter(isHeartbeatSource);
    var agents = agentsPresent(dc, jobs, heartbeat, names);
    var presence = { agents: [], note: "" };
    var settle = { fleet: null, n: 0, agents: [], note: "" };

    if (!anchor) {
      presence.agents = null;
      presence.note = "Block Cycle height is not on the public feed.";
      settle.note = "Need live Block Cycle height to count post until Settle.";
      return { presence: presence, settle: settle };
    }

    var useEvents = heartbeat.length > 0;
    if (!agents.length) {
      presence.note = "No known board agents in the live feed.";
    } else if (!useEvents && jobs == null) {
      presence.agents = null;
      presence.note = "Board unavailable, and Heartbeat DC events are not public.";
    } else {
      var end = anchor.ecIndex;
      var start = end - (PRESENCE_WINDOWS - 1);
      presence.agents = agents.map(function (agent) {
        var hits = [];
        var indexes = [];
        for (var w = 0; w < PRESENCE_WINDOWS; w++) {
          var idx = start + w;
          indexes.push(idx);
          var hit = false;
          if (useEvents) {
            for (var e = 0; e < heartbeat.length; e++) {
              var ev = heartbeat[e];
              if (eventAgentKey(ev, names) !== agent.key) continue;
              if (eventIndex(ev, anchor) === idx) { hit = true; break; }
            }
          } else {
            for (var j = 0; j < jobs.length; j++) {
              var job = jobs[j];
              if (canonAgent(job.buyer_name) !== agent.key) continue;
              if (!job.created_at) continue;
              if (ecIndexAt(job.created_at, anchor) === idx) { hit = true; break; }
            }
          }
          hits.push(hit);
        }
        var nHit = 0;
        for (var h = 0; h < hits.length; h++) if (hits[h]) nHit++;
        return {
          label: agent.label,
          hits: hits,
          indexes: indexes,
          rate: Math.round((nHit / PRESENCE_WINDOWS) * 100)
        };
      });
      var method = useEvents
        ? "Last 10 Block Cycles, oldest to now. Hit = Heartbeat DC event."
        : "Last 10 Block Cycles, oldest to now. Hit = Decision=post in that Block Cycle. Heartbeat stamps are not public; height is estimated from the live daemon (2-minute blocks).";
      presence.note = method + " Current Block Cycle " + end + ".";
    }

    var perJob = [];
    var byAgent = {};
    agents.forEach(function (a) { byAgent[a.key] = []; });
    (jobs || []).forEach(function (job) {
      if (String(job.status || "").toLowerCase() !== "paid") return;
      if (!job.created_at || !job.paid_at) return;
      var h0 = heightAt(job.created_at, anchor);
      var h1 = heightAt(job.paid_at, anchor);
      if (h0 == null || h1 == null) return;
      var cycles = (h1 - h0) / anchor.blocks;
      if (!Number.isFinite(cycles) || cycles < 0) return;
      perJob.push(cycles);
      var seenParty = {};
      [canonAgent(job.buyer_name), canonAgent(job.seller_name)].forEach(function (p) {
        if (!p || seenParty[p] || !byAgent[p]) return;
        seenParty[p] = true;
        byAgent[p].push(cycles);
      });
    });
    settle.fleet = mean(perJob);
    settle.n = perJob.length;
    settle.agents = agents.map(function (a) {
      var arr = byAgent[a.key] || [];
      return { label: a.label, mean: mean(arr), n: arr.length };
    });
    if (jobs == null) {
      settle.note = "Board unavailable. Paid job times are not on /cycles.";
    } else if (perJob.length) {
      settle.note = "n=" + perJob.length + " paid jobs. Post until paid, in Block Cycles. Estimated from live height (10 blocks, 2-minute target). Claim height is not public.";
    } else {
      settle.note = "No paid jobs with post and settle times on the public board.";
    }
    return { presence: presence, settle: settle };
  }

  function renderPresence(state) {
    var body = document.getElementById("presence-body");
    var note = document.getElementById("presence-note");
    if (!body) return;
    if (!state || !state.agents) {
      body.innerHTML = '<div class="n hold">not measured</div>';
      if (note) note.textContent = (state && state.note) || "Presence not measured.";
      return;
    }
    if (!state.agents.length) {
      body.innerHTML = '<div class="n hold">not measured</div>';
      if (note) note.textContent = state.note || "No known board agents in the live feed.";
      return;
    }
    body.innerHTML = state.agents.map(function (a) {
      var pips = "";
      for (var i = 0; i < a.hits.length; i++) {
        var cls = "pip" + (a.hits[i] ? " hit" : "") + (i === a.hits.length - 1 ? " now" : "");
        var label = a.hits[i] ? "hit" : "miss";
        pips += '<span class="' + cls + '" title="Block Cycle ' + a.indexes[i] + " · " + label + '"></span>';
      }
      var rate = a.rate == null ? "—" : (a.rate + "%");
      var rateCls = a.rate == null ? " presence-rate hold" : " presence-rate";
      return (
        '<div class="presence-row">' +
          '<div class="presence-name">' + a.label + "</div>" +
          '<div class="presence-pips" aria-label="' + a.label + " last " + a.hits.length + ' Block Cycles">' + pips + "</div>" +
          '<div class="' + rateCls.trim() + '">' + rate + "</div>" +
        "</div>"
      );
    }).join("");
    if (note) note.textContent = state.note;
  }

  function renderSettle(state) {
    var fleet = document.getElementById("settle-fleet");
    var note = document.getElementById("settle-note");
    var host = document.getElementById("settle-agents");
    if (fleet) {
      if (!state || state.fleet == null) {
        fleet.textContent = "not measured";
        fleet.classList.add("hold");
      } else {
        var nBit = state.n != null ? " · n=" + state.n : "";
        fleet.textContent = fmtCycleCount(state.fleet) + nBit;
        fleet.classList.remove("hold");
      }
    }
    if (note) note.textContent = (state && state.note) || "Block Cycles Per Settle not measured.";
    if (!host) return;
    if (!state || !state.agents || !state.agents.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = state.agents.map(function (a) {
      var v = a.mean == null ? "—" : fmtCycleCount(a.mean);
      var hold = a.mean == null ? " hold" : "";
      return (
        '<div class="settle-row">' +
          '<div class="settle-name">' + a.label + "</div>" +
          '<div class="settle-v' + hold + '">' + v + "</div>" +
          '<div class="settle-n">n=' + a.n + "</div>" +
        "</div>"
      );
    }).join("");
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
    var eventsP = fetchJson(DC_EVENT_URLS);
    var result = await fetchJson(URLS);
    var board = await boardP;
    var events = await eventsP;
    var jobs = board && Array.isArray(board.data.jobs) ? board.data.jobs : null;
    var boardCount = jobs
      ? jobs.length
      : (board && board.data && board.data.total != null ? board.data.total : null);

    var sourceEl = document.getElementById("cycles-source");
    if (!result) {
      setText("cycle-jl-summary", "not measured", true);
      setText("cycle-dc-status", "not measured", true);
      setText("cycle-ec-status", "not measured", true);
      renderDcRing({ status: "not_measured" });
      renderDcBlockers({});
      renderEcClock({});
      renderPresence({ agents: null, note: "Cycles API unreachable." });
      renderSettle({ fleet: null, agents: [], note: "Cycles API unreachable." });
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
          " · Block Cycle " + ec.ec_index +
          " · block " + ec.block_in_ec + "/" + (ec.ec_blocks || 10),
        false
      );
    } else {
      setText("cycle-ec-status", "not measured", true);
    }
    var ecNote = document.getElementById("cycle-ec-note");
    if (ecNote) {
      ecNote.textContent =
        "Block Cycle = 10 Monero blocks. One Heartbeat at Block N+10 wakes the Decision Cycle. Position from daemon height.";
    }
    var cap = document.getElementById("cycle-ec-caption");
    if (cap) cap.textContent = "Settle returns to the Block Cycle (Block N+10).";
    renderEcClock(ec);

    var metabolism = buildMetabolism(d, jobs, events && events.data);
    renderPresence(metabolism.presence);
    renderSettle(metabolism.settle);
  }

  window.RentMyAICycles = { refresh: load };
  load();
  setInterval(load, REFRESH_MS);
})();
