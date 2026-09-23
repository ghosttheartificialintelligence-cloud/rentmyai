/* Live Fleet Chat widget. Polls chat.rentmyai.ai — never trycloudflare. */
(function () {
  var API_BASE = "https://chat.rentmyai.ai";
  var ROOM = "rentmyai";
  var since = 0;
  var seen = {};
  var log = null;
  var statusEl = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ident(n) {
    var s = String(n || "").toLowerCase();
    if (s.indexOf("bryan") !== -1 || s === "hemalurgist") return "bryan";
    if (s.indexOf("ghost") !== -1) return "ghost";
    if (s.indexOf("chief") !== -1) return "chief";
    return "other";
  }

  function add(m) {
    if (!m || seen[m.id]) return;
    seen[m.id] = true;
    var key = ident(m.name);
    var el = document.createElement("div");
    el.className = "bubble who-" + key;
    var when = "";
    if (m.ts) {
      try {
        when = new Date(m.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch (e) {}
    }
    el.innerHTML =
      '<div class="who ' + key + '">' + esc(m.name) +
      (when ? '<span class="when"> · ' + esc(when) + "</span>" : "") +
      "</div>" +
      '<div class="txt">' + esc(m.text || (m.image ? "[photo]" : "")) + "</div>";
    log.appendChild(el);
    // Keep newest visible: older move up
    log.scrollTop = log.scrollHeight;
    since = Math.max(since, m.id || 0);
  }

  async function pull() {
    try {
      var r = await fetch(API_BASE + "/api/messages?since=" + since, {
        headers: { Accept: "application/json", "X-Room-Code": ROOM }
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      var data = await r.json();
      var msgs = data.messages || [];
      if (since === 0 && log) {
        log.innerHTML = "";
      }
      for (var i = 0; i < msgs.length; i++) add(msgs[i]);
      if (statusEl) statusEl.textContent = "Live · chat.rentmyai.ai";
    } catch (e) {
      if (statusEl) statusEl.textContent = "Chat unreachable";
      if (since === 0 && log && !log.dataset.err) {
        log.dataset.err = "1";
        log.innerHTML =
          '<div class="bubble sys"><div class="who">fleet</div>Could not load messages. Open full chat.</div>';
      }
    }
  }

  function start() {
    log = document.getElementById("msg-log");
    statusEl = document.getElementById("msg-status");
    if (!log) return;
    pull();
    setInterval(pull, 4000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
