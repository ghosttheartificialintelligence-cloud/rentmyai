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
        "No Decision memos yet. Claim-pass: Fit · Vague · Margin · Capacity · Other. Work skip-post: Need · Alignment · Cost · Value · Spec · Pending · Judge · Market · Other · Timing.";
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

  function dcPostWorkCounts(dc) {
    var mix = (dc && dc.decision_mix) || {};
    var bd = (dc && dc.by_decision) || {};
    var post = mix.post != null ? Number(mix.post) : Number(bd.post || 0);
    var work = mix.work != null ? Number(mix.work) : Number(bd.work || 0);
    if (!Number.isFinite(post)) post = 0;
    if (!Number.isFinite(work)) work = 0;
    var total = post + work;
    var postPct = mix.post_pct != null && Number.isFinite(Number(mix.post_pct))
      ? Number(mix.post_pct)
      : (total ? Math.round((post / total) * 1000) / 10 : null);
    var workPct = mix.work_pct != null && Number.isFinite(Number(mix.work_pct))
      ? Number(mix.work_pct)
      : (total ? Math.round((work / total) * 1000) / 10 : null);
    return { post: post, work: work, total: total, postPct: postPct, workPct: workPct };
  }

  function fmtTok(v) {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    var n = Number(v);
    if (n >= 1000) return Math.round(n).toLocaleString("en-US");
    if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
    return (Math.round(n * 10) / 10).toString();
  }

  function fmtInt(v) {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    return Math.round(Number(v)).toLocaleString("en-US");
  }

  function polarDeg(cx, cy, r, deg) {
    var rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(cx, cy, r, startDeg, endDeg) {
    if (endDeg <= startDeg) endDeg += 360;
    var large = endDeg - startDeg > 180 ? 1 : 0;
    var s = polarDeg(cx, cy, r, startDeg);
    var e = polarDeg(cx, cy, r, endDeg);
    return "M " + s.x + " " + s.y + " A " + r + " " + r + " 0 " + large + " 1 " + e.x + " " + e.y;
  }

  function renderDcAgentsBelow(dc) {
    var byAD = (dc && dc.by_agent_decision) || {};
    var keys = Object.keys(byAD).sort();
    if (!keys.length) return "";
    return (
      '<div class="dc-pw-agents">' +
      keys.map(function (agent) {
        var row = byAD[agent] || {};
        var p = Number(row.post || 0) || 0;
        var w = Number(row.work || 0) || 0;
        var t = p + w;
        var rp = t ? Math.round((p / t) * 100) : 0;
        return (
          '<div class="dc-pw-agent">' +
          '<span class="dc-pw-agent-n">' + agent + "</span>" +
          '<span class="dc-pw-agent-v">post ' + p + " · work " + w +
          (t ? " · " + rp + "% post" : "") +
          "</span></div>"
        );
      }).join("") +
      "</div>"
    );
  }

  /* Decision Gauge — paper layout, live numbers.
     Bezel: 72 ticks (1 EC), long tick every 6 EC. Compass labels are EC first, hours float.
     Purple ring: four steps. Decide (top-left) is the live work/post reason slice.
     Darker teal/coral = more common reason. Sketch 62/38 and sample tok are not used. */
  var DC_BEZEL_EC = 72;
  var DC_LONG_TICK_EC = 6;
  var DC_BLOCKS_PER_EC = 10;
  var WORK_WHY_NOT_POST = [
    "need", "alignment", "cost", "value", "spec",
    "judge", "pending", "market", "timing", "other"
  ];
  var POST_WHY_NOT_WORK = ["fit", "margin", "capacity", "vague", "other"];
  /* Index 0 is darkest. Rank assigns darkest to the most common reason. */
  var TEAL_DARK_TO_LIGHT = [
    "#0e3b30", "#145c48", "#1a7a5c", "#218a68", "#2ea043",
    "#3fb950", "#56d364", "#7ee787", "#a7f3c4", "#d1fae0"
  ];
  var CORAL_DARK_TO_LIGHT = [
    "#9a3412", "#c2410c", "#ea580c", "#f97316", "#fb923c", "#fdba74", "#fed7aa"
  ];
  var STEP_PURPLE = { discover: "#8b7cf6", capability: "#7a68e8", economics: "#6a58d4" };

  function reasonMixSide(dc, key, codes) {
    var rm = (dc && dc.reason_mix && dc.reason_mix[key]) || null;
    var counts = {};
    var shares = {};
    var n = 0;
    codes.forEach(function (c) { counts[c] = 0; shares[c] = null; });
    if (rm && rm.counts && typeof rm.counts === "object") {
      codes.forEach(function (c) {
        var v = Number(rm.counts[c]);
        counts[c] = Number.isFinite(v) && v > 0 ? v : 0;
      });
      n = codes.reduce(function (a, c) { return a + counts[c]; }, 0);
    }
    if (rm && rm.shares_pct && typeof rm.shares_pct === "object" && n > 0) {
      codes.forEach(function (c) {
        var v = rm.shares_pct[c];
        shares[c] = v != null && Number.isFinite(Number(v)) ? Number(v) : (n ? Math.round((counts[c] / n) * 1000) / 10 : null);
      });
    } else if (n > 0) {
      codes.forEach(function (c) {
        shares[c] = Math.round((counts[c] / n) * 1000) / 10;
      });
    }
    return { counts: counts, shares: shares, n: n, label: (rm && rm.label) || key };
  }

  function fmtShare(share, hasData) {
    if (!hasData) return "—";
    if (share == null || !Number.isFinite(Number(share))) return "0%";
    var v = Number(share);
    if (Math.abs(v - Math.round(v)) < 0.05) return Math.round(v) + "%";
    return (Math.round(v * 10) / 10) + "%";
  }

  function titleCaseCode(c) {
    if (!c) return "";
    return String(c).charAt(0).toUpperCase() + String(c).slice(1);
  }

  function dcAvgBlockSeconds(dial, ec) {
    var candidates = [dial && dial.avg_block_seconds, ec && ec.avg_block_seconds];
    for (var i = 0; i < candidates.length; i++) {
      var v = Number(candidates[i]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return null;
  }

  /* Human label for a fixed block count. Minutes under 90, hours under 20, otherwise days.
     720 blocks at ~120s lands on 1 day; faster/slower blocks move only this label. */
  function fmtHumanEst(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
    var mins = seconds / 60;
    if (mins < 90) return "≈ " + Math.round(mins) + " min (est.)";
    var hours = seconds / 3600;
    if (hours < 20) {
      var h = Math.round(hours * 10) / 10;
      var hs = Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : String(h);
      return "≈ " + hs + " h (est.)";
    }
    var days = seconds / 86400;
    var d = Math.round(days * 10) / 10;
    var ds = Math.abs(d - Math.round(d)) < 0.05 ? String(Math.round(d)) : String(d);
    var unit = Math.abs(Number(ds) - 1) < 0.001 ? "day" : "days";
    return "≈ " + ds + " " + unit + " (est.)";
  }

  function fmtBlockSample(avgBlockSeconds) {
    if (avgBlockSeconds == null || !Number.isFinite(avgBlockSeconds) || avgBlockSeconds <= 0) return "—";
    return (Math.round((avgBlockSeconds / 60) * 10) / 10).toFixed(1) + " min / block";
  }

  function fmtCompassHours(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "≈ —";
    var h = Math.round((seconds / 3600) * 10) / 10;
    var hs = Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : String(h);
    return "≈ " + hs + " h";
  }

  /* Darker palette entry = more common. Unused codes stay the lightest swatch. */
  function shadeByCount(codes, counts, palette) {
    var present = codes.filter(function (c) { return (counts[c] || 0) > 0; });
    present.sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0); });
    var map = {};
    var light = palette[palette.length - 1];
    codes.forEach(function (c) { map[c] = light; });
    present.forEach(function (c, i) {
      var idx = present.length === 1 ? 0 : Math.round((i * (palette.length - 1)) / (present.length - 1));
      map[c] = palette[idx];
    });
    return map;
  }

  function dcEcIndex(dial, ec, height) {
    if (dial && dial.current_ec_index != null && Number.isFinite(Number(dial.current_ec_index))) {
      return Number(dial.current_ec_index);
    }
    if (ec && ec.ec_index != null && Number.isFinite(Number(ec.ec_index))) return Number(ec.ec_index);
    if (height != null && Number.isFinite(height)) return Math.floor(height / DC_BLOCKS_PER_EC);
    return null;
  }

  function dcBlockInEc(ec, height) {
    if (ec && ec.block_in_ec != null && Number.isFinite(Number(ec.block_in_ec))) {
      return Number(ec.block_in_ec);
    }
    if (height != null && Number.isFinite(height)) return height % DC_BLOCKS_PER_EC;
    return null;
  }

  /* Progress through the fixed 72-EC turn, including how far the current EC has gone. */
  function bezelPosEc(dial, ec, height) {
    var idx = dcEcIndex(dial, ec, height);
    if (idx == null) return null;
    var blockIn = dcBlockInEc(ec, height);
    var frac = 0;
    if (blockIn != null && Number.isFinite(blockIn)) {
      frac = Math.max(0, Math.min(0.999, blockIn / DC_BLOCKS_PER_EC));
    }
    var pos = (idx % DC_BEZEL_EC) + frac;
    if (pos < 0) pos += DC_BEZEL_EC;
    return pos % DC_BEZEL_EC;
  }

  function renderDcDial(dc, ec) {
    var host = document.getElementById("dc-ring");
    if (!host) return;
    var n = dcSampleN(dc);
    if (!n) {
      host.innerHTML =
        '<div class="dc-empty">' +
        '<div class="dc-empty-ring" aria-hidden="true"></div>' +
        "<p>No Decision Cycle records yet.</p></div>";
      return;
    }

    var pw = dcPostWorkCounts(dc);
    var dial = (dc && dc.dial) || {};
    var height = dial.current_height != null ? Number(dial.current_height)
      : (ec && ec.current_height != null ? Number(ec.current_height) : null);
    var avgBlock = dcAvgBlockSeconds(dial, ec);
    var curPos = bezelPosEc(dial, ec, height);

    var tokDecide = dc.avg_tokens_decision;
    var tokDiscover = dc.avg_tokens_discover;
    var tokEcon = dc.avg_tokens_economics;
    var tokCap = dc.avg_tokens_capability;
    var tokTotal = dc.avg_tokens_cycle;
    if (tokTotal == null) {
      var parts = [tokDecide, tokDiscover, tokEcon, tokCap].filter(function (v) {
        return v != null && Number.isFinite(Number(v));
      });
      if (parts.length) {
        tokTotal = parts.reduce(function (a, b) { return a + Number(b); }, 0);
      }
    }

    var workReasons = reasonMixSide(dc, "work_why_not_post", WORK_WHY_NOT_POST);
    var postReasons = reasonMixSide(dc, "post_why_not_work", POST_WHY_NOT_WORK);

    var size = 520;
    var cx = size / 2;
    var cy = size / 2;
    var bezelR = 156;
    var labelR = 186;
    var ringR = 118;
    var ringStroke = 40;
    var hubR = 96;

    var workShades = shadeByCount(WORK_WHY_NOT_POST, workReasons.counts, TEAL_DARK_TO_LIGHT);
    var postShades = shadeByCount(POST_WHY_NOT_WORK, postReasons.counts, CORAL_DARK_TO_LIGHT);

    function arcStroke(startDeg, endDeg, color, cls, title) {
      if (endDeg - startDeg < 0.25) return "";
      return (
        '<path class="' + cls + '" d="' + describeArc(cx, cy, ringR, startDeg, endDeg) +
        '" fill="none" stroke="' + color + '" stroke-width="' + ringStroke +
        '" stroke-linecap="butt">' +
        (title ? ("<title>" + title + "</title>") : "") +
        "</path>"
      );
    }

    function reasonSpan(startDeg, span, codes, counts, shades, fallback, cls) {
      if (span < 0.25) return "";
      var active = [];
      var sum = 0;
      codes.forEach(function (c) {
        var n = counts[c] || 0;
        if (n > 0) { active.push(c); sum += n; }
      });
      if (!active.length || sum <= 0) return arcStroke(startDeg, startDeg + span, fallback, cls, "");
      var html = "";
      var cursor = startDeg;
      active.forEach(function (c, i) {
        var end = i === active.length - 1 ? startDeg + span : cursor + ((counts[c] / sum) * span);
        html += arcStroke(cursor, end, shades[c], cls + "-" + c, titleCaseCode(c) + " · " + counts[c]);
        cursor = end;
      });
      return html;
    }

    // Quadrants clockwise from 12: Discover, Capability, Economics, Decide (top-left).
    var ringPaths = "";
    ringPaths += arcStroke(0, 90, STEP_PURPLE.discover, "dc-step-discover", "Discover");
    ringPaths += arcStroke(90, 180, STEP_PURPLE.capability, "dc-step-capability", "Capability");
    ringPaths += arcStroke(180, 270, STEP_PURPLE.economics, "dc-step-economics", "Economics");
    var decideStart = 270;
    var decideSpan = 90;
    if (!pw.total) {
      ringPaths += arcStroke(decideStart, decideStart + decideSpan, "#5b4bc4", "dc-step-decide", "Decide");
    } else {
      var workSpan = decideSpan * (pw.work / pw.total);
      var postSpan = decideSpan * (pw.post / pw.total);
      ringPaths += reasonSpan(decideStart, workSpan, WORK_WHY_NOT_POST, workReasons.counts, workShades, "#1a7a5c", "dc-w");
      ringPaths += reasonSpan(decideStart + workSpan, postSpan, POST_WHY_NOT_WORK, postReasons.counts, postShades, "#f97316", "dc-p");
    }

    function stepLabel(name, tok, deg) {
      var p = polarDeg(cx, cy, ringR, deg);
      return (
        '<text class="dc-step-name" x="' + p.x + '" y="' + (p.y - 7) + '" text-anchor="middle">' + name + "</text>" +
        '<text class="dc-step-avg" x="' + p.x + '" y="' + (p.y + 9) + '" text-anchor="middle">avg ' + fmtTok(tok) + "</text>"
      );
    }

    function compassLabel(ecCount, deg) {
      var p = polarDeg(cx, cy, labelR, deg);
      var anchor = deg === 90 ? "start" : deg === 270 ? "end" : "middle";
      var x = p.x + (deg === 90 ? 4 : deg === 270 ? -4 : 0);
      var y = p.y + (deg === 0 ? -2 : deg === 180 ? 2 : 0);
      var hours = avgBlock == null ? "≈ —" : fmtCompassHours(ecCount * DC_BLOCKS_PER_EC * avgBlock);
      return (
        '<text class="dc-compass-ec" x="' + x + '" y="' + (y - 7) + '" text-anchor="' + anchor + '">' + ecCount + " EC</text>" +
        '<text class="dc-compass-h" x="' + x + '" y="' + (y + 8) + '" text-anchor="' + anchor + '">' + hours + "</text>"
      );
    }

    // Fixed bezel: 72 ticks = 72 EC. Long tick every 6 EC. Spacing does not follow block time.
    var ticks = "";
    for (var ti = 0; ti < DC_BEZEL_EC; ti++) {
      var ang = (ti / DC_BEZEL_EC) * 360;
      var isLong = ti % DC_LONG_TICK_EC === 0;
      var outer = polarDeg(cx, cy, bezelR + (isLong ? 6 : 2.5), ang);
      var inner = polarDeg(cx, cy, bezelR - (isLong ? 6 : 2), ang);
      ticks +=
        '<line class="dc-dial-tick' + (isLong ? " dc-dial-tick-long" : "") +
        '" x1="' + inner.x + '" y1="' + inner.y +
        '" x2="' + outer.x + '" y2="' + outer.y + '"/>';
    }

    var curMark = "";
    if (curPos != null) {
      var cang = (curPos / DC_BEZEL_EC) * 360;
      var cp = polarDeg(cx, cy, bezelR, cang);
      curMark =
        '<circle class="dc-dial-current" cx="' + cp.x + '" cy="' + cp.y +
        '" r="6" fill="#0d1117" stroke="#f0883e" stroke-width="2.4"/>';
    }

    var svg =
      '<svg class="dc-dial-svg" viewBox="0 0 ' + size + " " + size +
      '" width="100%" role="img" aria-label="Decision gauge. 72 EC per turn, one tick per EC. Orange ring is the current EC.">' +
      '<circle class="dc-dial-bezel" cx="' + cx + '" cy="' + cy + '" r="' + bezelR +
      '" fill="none" stroke="#3a424c" stroke-width="1.5"/>' +
      ticks +
      compassLabel(72, 0) +
      compassLabel(18, 90) +
      compassLabel(36, 180) +
      compassLabel(54, 270) +
      ringPaths +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + hubR +
      '" fill="#0d1117" stroke="#21262d" stroke-width="1"/>' +
      stepLabel("Discover", tokDiscover, 45) +
      stepLabel("Capability", tokCap, 135) +
      stepLabel("Economics", tokEcon, 225) +
      stepLabel("Decide", tokDecide, 315) +
      '<text class="dc-dial-total" x="' + cx + '" y="' + (cy - 2) +
      '" text-anchor="middle" dominant-baseline="middle">' + fmtTok(tokTotal) + "</text>" +
      '<text class="dc-dial-total-sub" x="' + cx + '" y="' + (cy + 16) +
      '" text-anchor="middle">avg tok / cycle</text>' +
      curMark +
      "</svg>";

    var workHas = workReasons.n > 0;
    var postHas = postReasons.n > 0;
    var workHead = pw.workPct != null ? ("Why not post · " + pw.workPct + "%") : "Why not post";
    var postHead = pw.postPct != null ? ("Why not work · " + pw.postPct + "%") : "Why not work";

    function legendCol(title, codes, shares, shades, hasData, sideClass) {
      return (
        '<div class="dc-reason-col ' + sideClass + '">' +
        '<div class="dc-reason-h">' + title + "</div>" +
        '<ul class="dc-reason-list">' +
        codes.map(function (c) {
          return (
            '<li><i style="background:' + shades[c] + '"></i>' +
            '<span class="dc-reason-n">' + titleCaseCode(c) + "</span>" +
            '<span class="dc-reason-p">' + fmtShare(shares[c], hasData) + "</span></li>"
          );
        }).join("") +
        "</ul></div>"
      );
    }

    var legend =
      '<div class="dc-key" aria-label="Gauge colors">' +
      '<span><i class="dc-key-steps"></i>The 4 steps</span>' +
      '<span><i class="dc-key-work"></i>Chose work</span>' +
      '<span><i class="dc-key-post"></i>Chose post</span>' +
      '<span><i class="dc-key-now"></i>Current EC (now)</span>' +
      "</div>" +
      '<div class="dc-reason-legend" aria-label="Decision reason shares">' +
      legendCol(workHead, WORK_WHY_NOT_POST, workReasons.shares, workShades, workHas, "is-work") +
      legendCol(postHead, POST_WHY_NOT_WORK, postReasons.shares, postShades, postHas, "is-post") +
      "</div>";

    var asOf = height != null && Number.isFinite(height) ? (" As of block " + fmtInt(height) + ".") : "";
    var foot =
      '<p class="dc-dial-note">1 EC = 10 blocks. Long tick every 6 EC. Full turn = 72 EC = 720 blocks. ' +
      "Hours recompute from recent block times (sample: " + fmtBlockSample(avgBlock) + ")." + asOf + "</p>";

    host.innerHTML = '<div class="dc-dial">' + svg + legend + foot + "</div>";
  }

  function renderDcRing(dc, ec) {
    renderDcDial(dc, ec);
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
    // Bryan lock: 1 EC = 10 Monero blocks → AVG EC = avg_ec_seconds or avg_block_seconds * 10.
    if (!ec) return null;
    var secs =
      ec.avg_ec_seconds != null ? Number(ec.avg_ec_seconds) :
      ec.avg_wall_clock_seconds != null ? Number(ec.avg_wall_clock_seconds) :
      ec.wall_clock_seconds != null ? Number(ec.wall_clock_seconds) :
      ec.avg_duration_seconds != null ? Number(ec.avg_duration_seconds) :
      null;
    if (secs == null && ec.avg_block_seconds != null && Number.isFinite(Number(ec.avg_block_seconds))) {
      var blocks = ec.ec_blocks != null && Number(ec.ec_blocks) > 0 ? Number(ec.ec_blocks) : 10;
      secs = Number(ec.avg_block_seconds) * blocks;
    }
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
        '<title id="ec-dial-title">Economic Cycle · 1 EC = 10 Monero blocks (N→N+10); Heartbeat fires each EC</title>' +
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

    // ECs/24h — Bryan lock: 1 EC = 10 Monero blocks.
    // Formula: (86400/avg_block_seconds)/10 == blocks_per_day/10.
    var rateVal =
      ec && ec.ecs_per_day != null ? Number(ec.ecs_per_day) :
      ec && ec.ec_per_day != null ? Number(ec.ec_per_day) :
      null;
    if (rateVal == null && ec && ec.blocks_per_day_est != null && Number.isFinite(Number(ec.blocks_per_day_est))) {
      var ecBlocks = ec.ec_blocks != null && Number(ec.ec_blocks) > 0 ? Number(ec.ec_blocks) : 10;
      rateVal = Number(ec.blocks_per_day_est) / ecBlocks;
    }
    if (rateVal == null && ec && ec.ec_per_time != null) rateVal = Number(ec.ec_per_time);
    if (rateVal == null && ec && ec.ec_per_hour != null) rateVal = Number(ec.ec_per_hour);
    if (rateVal != null && Number.isFinite(rateVal) && rateVal > 0) {
      var rateTxt = (Math.round(rateVal * 10) / 10).toString();
      setText("cycle-ec-rate", rateTxt, false);
    } else {
      setText("cycle-ec-rate", "not measured", true);
    }

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
        ? "1 EC = 10 Monero blocks. AVG EC = 10 × avg block. ECs/24h = (blocks/day)÷10. Heartbeat fires each EC."
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
      renderDcRing({ status: "not_measured" }, {});
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
        var sampleN = dc.token_samples && dc.token_samples.avg_per_step != null
          ? dc.token_samples.avg_per_step
          : (dc.token_samples && dc.token_samples.capability);
        var sampleNote = sampleN != null ? " · samples=" + sampleN : "";
        tokEl.textContent = "(Avg Tokens/step)/cycle · " + tokParts.join(" / ") + sampleNote;
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
        "Purple ring: Discover, Capability, Economics, Decide. The Decide slice is the live work (teal) and post (coral) mix. Orange ring: current EC.";
    }
    var ec = d.economic_cycle || {};
    renderDcRing(dc, ec);
    renderDcBlockers(dc);

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
      ecNote.textContent =
        "1 EC = 10 Monero blocks (N→N+10). Heartbeat fires each EC. ECs/24h from monerod. Position from daemon height.";
    }
    var cap = document.getElementById("cycle-ec-caption");
    if (cap) cap.textContent = "Settle returns to the Economic Cycle clock (next EC / Block N+10).";
    renderEcClock(ec);

    var metabolism = buildMetabolism(d, jobs, events && events.data);
    renderPresence(metabolism.presence);
    renderSettle(metabolism.settle);
  }

  window.RentMyAICycles = { refresh: load };
  load();
  setInterval(load, REFRESH_MS);
})();
