/* Auth gate for Mission Control.
   No login yet => MC stays hidden (prefer hide thermometer when signed out).
   When signed in but no agent selected => thermometer stays hidden; income = not measured.
   Never show hardcoded 0.000 XMR as personal income. */
(function () {
  function isSignedIn() {
    try {
      if (window.RentMyAIAuth && typeof window.RentMyAIAuth.isSignedIn === "function") {
        return !!window.RentMyAIAuth.isSignedIn();
      }
      var tok = localStorage.getItem("rentmyai_session");
      return !!(tok && tok.length > 8);
    } catch (e) {
      return false;
    }
  }

  function selectedAgentId() {
    try {
      if (window.RentMyAIAuth && typeof window.RentMyAIAuth.selectedAgentId === "function") {
        return window.RentMyAIAuth.selectedAgentId() || null;
      }
      var id = localStorage.getItem("rentmyai_agent_id");
      return id && id.length > 0 ? id : null;
    } catch (e) {
      return null;
    }
  }

  function setText(id, text, hold) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (hold) el.classList.add("hold");
    else el.classList.remove("hold");
  }

  function applyThermo(signed, agentId) {
    var panel = document.getElementById("thermo-panel");
    var thermo = document.getElementById("thermo");
    var tube = document.getElementById("thermo-tube");
    if (!panel) return;

    /* Prefer hide until an agent is selected (and always hide when signed out). */
    var show = !!(signed && agentId);
    if (show) {
      panel.hidden = false;
      panel.removeAttribute("hidden");
      if (thermo) thermo.classList.remove("thermo-empty");
      /* Still not measured until real income arrives — no demo fill. */
      if (tube) {
        tube.style.setProperty("--fill", "0%");
        tube.classList.add("empty");
      }
      setText("thermo-goal", "not measured", true);
      setText("thermo-current", "not measured", true);
      var tag = document.getElementById("thermo-tag");
      if (tag) tag.textContent = "awaiting measured income for selected agent";
    } else {
      panel.hidden = true;
      panel.setAttribute("hidden", "");
      if (tube) {
        tube.style.setProperty("--fill", "0%");
        tube.classList.add("empty");
      }
      if (thermo) thermo.classList.add("thermo-empty");
    }
  }

  function applyIncomeLabels(signed, agentId) {
    if (!signed) {
      setText("mc-monthly", "not signed in", true);
      setText("mc-daily", "not signed in", true);
      setText("mc-name", "not signed in", true);
      setText("mc-trust", "not measured", true);
      setText("mc-primary", "not measured", true);
      setText("mc-secondary", "not measured", true);
      setText("mc-capital", "not measured", true);
      return;
    }
    if (!agentId) {
      setText("mc-monthly", "not measured", true);
      setText("mc-daily", "not measured", true);
      setText("mc-name", "no agent selected", true);
      setText("mc-trust", "not measured", true);
      setText("mc-primary", "not measured", true);
      setText("mc-secondary", "not measured", true);
      setText("mc-capital", "not measured", true);
      return;
    }
    /* Signed in with agent: leave placeholders until a real feed sets them.
       Do not write 0.000 — keep "not measured" until evidence arrives. */
    setText("mc-monthly", "not measured", true);
    setText("mc-daily", "not measured", true);
  }

  function apply() {
    var signed = isSignedIn();
    var agentId = selectedAgentId();

    document.querySelectorAll(".mc-only").forEach(function (el) {
      if (signed) {
        el.hidden = false;
        el.removeAttribute("hidden");
      } else {
        el.hidden = true;
        el.setAttribute("hidden", "");
      }
    });

    applyThermo(signed, agentId);
    applyIncomeLabels(signed, agentId);

    document.documentElement.dataset.auth = signed ? "in" : "out";
    document.documentElement.dataset.agent = agentId ? "selected" : "none";
  }

  function wireSignIn() {
    var btn = document.getElementById("signin-btn");
    var toast = document.getElementById("signin-toast");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (isSignedIn()) {
        apply();
        return;
      }
      if (toast) {
        toast.hidden = false;
        toast.textContent = "Coming soon";
        clearTimeout(btn._toastTimer);
        btn._toastTimer = setTimeout(function () {
          toast.hidden = true;
        }, 3200);
      } else {
        alert("Coming soon");
      }
    });
  }

  apply();
  wireSignIn();
  window.RentMyAIAuthUI = {
    refresh: apply,
    isSignedIn: isSignedIn,
    selectedAgentId: selectedAgentId
  };
})();
