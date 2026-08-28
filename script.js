(function () {
  "use strict";

  /* ============================================================
     Percentage → GPA conversion.
     Approximate GPA = Average Percentage ÷ PERCENT_TO_GPA_DIVISOR.
     This is a common estimate; institutions vary.
     ============================================================ */
  const PERCENT_TO_GPA_DIVISOR = 9.5;
  const MAX_APPROX_GPA = 100 / PERCENT_TO_GPA_DIVISOR;

  /* ============================================================
     Utilities
     ============================================================ */

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Formats a number to at most 2 decimal places, trimming trailing zeros
  // (e.g. 82.6 -> "82.6", 9 -> "9", 8.69 -> "8.69").
  function formatTrim(n) {
    return round2(n).toFixed(2).replace(/\.?0+$/, "");
  }

  function isValidNumber(value) {
    return value !== "" && value !== null && !Number.isNaN(Number(value)) && Number.isFinite(Number(value));
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
  }

  function hideError(el) {
    el.hidden = true;
    el.textContent = "";
  }

  /* ============================================================
     Theme toggle (light / dark, persisted, respects system pref)
     ============================================================ */

  (function initTheme() {
    const root = document.documentElement;
    const toggle = document.getElementById("themeToggle");
    const stored = localStorage.getItem("cgpa-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    function applyTheme(isDark) {
      root.classList.toggle("dark", isDark);
      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    }

    applyTheme(stored ? stored === "dark" : prefersDark);

    toggle.addEventListener("click", function () {
      const isDark = !root.classList.contains("dark");
      applyTheme(isDark);
      localStorage.setItem("cgpa-theme", isDark ? "dark" : "light");
    });
  })();

  /* ============================================================
     Mobile nav toggle
     ============================================================ */

  (function initNav() {
    const navToggle = document.getElementById("navToggle");
    const nav = document.querySelector(".main-nav");
    nav.id = "main-nav";

    navToggle.addEventListener("click", function () {
      const isOpen = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
      navToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.setAttribute("aria-label", "Open menu");
      });
    });
  })();

  /* ============================================================
     GPA Calculator — subject rows
     ============================================================ */

  const subjectList = document.getElementById("subjectList");
  const addSubjectBtn = document.getElementById("addSubjectBtn");
  const gpaForm = document.getElementById("gpaForm");
  const gpaError = document.getElementById("gpaError");
  const gpaResultPanel = document.getElementById("gpaResultPanel");
  const gpaSeal = document.getElementById("gpaSeal");
  const gpaValue = document.getElementById("gpaValue");
  const avgPercentageEl = document.getElementById("avgPercentage");
  const subjectCountEl = document.getElementById("subjectCount");
  const resetGpaBtn = document.getElementById("resetGpaBtn");

  let subjectIdCounter = 0;

  function createSubjectRow(prefill) {
    subjectIdCounter += 1;
    const rowId = "subj-" + subjectIdCounter;
    const row = document.createElement("div");
    row.className = "subject-row";
    row.dataset.rowId = rowId;

    row.innerHTML =
      '<div class="field-row">' +
      '<div class="field-input-wrap">' +
      '<label class="sr-only" for="' + rowId + '-name">Subject name</label>' +
      '<input type="text" id="' + rowId + '-name" class="field-input subj-name" placeholder="e.g. Mathematics" autocomplete="off" />' +
      "</div>" +
      '<div class="field-input-wrap">' +
      '<label class="sr-only" for="' + rowId + '-pct">Percentage</label>' +
      '<div class="input-suffix">' +
      '<input type="number" id="' + rowId + '-pct" class="field-input subj-pct" placeholder="e.g. 85" min="0" max="100" step="0.01" inputmode="decimal" />' +
      '<span class="suffix">%</span>' +
      "</div>" +
      "</div>" +
      '<button type="button" class="remove-subject" aria-label="Remove this subject">&times;</button>' +
      "</div>";

    if (prefill && prefill.name) {
      row.querySelector(".subj-name").value = prefill.name;
    }
    if (prefill && prefill.percentage !== undefined) {
      row.querySelector(".subj-pct").value = prefill.percentage;
    }

    row.querySelector(".remove-subject").addEventListener("click", function () {
      row.remove();
      updateRemoveButtonsState();
    });

    return row;
  }

  function updateRemoveButtonsState() {
    const rows = subjectList.querySelectorAll(".subject-row");
    const disable = rows.length <= 1;
    rows.forEach(function (row) {
      const btn = row.querySelector(".remove-subject");
      if (btn) btn.disabled = disable;
    });
  }

  function addSubject(prefill) {
    const row = createSubjectRow(prefill);
    subjectList.appendChild(row);
    updateRemoveButtonsState();
    return row;
  }

  addSubjectBtn.addEventListener("click", function () {
    addSubject();
    const rows = subjectList.querySelectorAll(".subject-row");
    const last = rows[rows.length - 1];
    const nameInput = last.querySelector(".subj-name");
    if (nameInput) nameInput.focus();
  });

  // Seed with two example rows to start
  addSubject({ name: "", percentage: "" });
  addSubject({ name: "", percentage: "" });

  function setSeal(value, maxValue) {
    const clamped = Math.max(0, Math.min(value, maxValue));
    const circumference = 339.3;
    const offset = circumference - (clamped / maxValue) * circumference;
    gpaSeal.style.setProperty("--seal-offset", offset.toFixed(1));
    gpaSeal.classList.remove("is-filled");
    // Force reflow so the transition replays each calculation
    void gpaSeal.offsetWidth;
    requestAnimationFrame(function () {
      gpaSeal.classList.add("is-filled");
    });
  }

  gpaForm.addEventListener("submit", function (e) {
    e.preventDefault();
    hideError(gpaError);

    const rows = Array.from(subjectList.querySelectorAll(".subject-row"));
    let totalPercentage = 0;
    let countedSubjects = 0;
    let hasAnyInput = false;

    for (const row of rows) {
      const nameInput = row.querySelector(".subj-name");
      const pctInputEl = row.querySelector(".subj-pct");

      const name = nameInput.value.trim();
      const pctRaw = pctInputEl.value.trim();

      if (name === "" && pctRaw === "") {
        continue; // fully empty row, skip silently
      }

      hasAnyInput = true;

      if (!isValidNumber(pctRaw)) {
        showError(gpaError, 'Please enter a valid percentage for "' + (name || "an unnamed subject") + '".');
        pctInputEl.focus();
        gpaResultPanel.hidden = true;
        return;
      }

      const pct = Number(pctRaw);

      if (pct < 0 || pct > 100) {
        showError(gpaError, 'Percentage for "' + (name || "an unnamed subject") + '" should be between 0 and 100.');
        pctInputEl.focus();
        gpaResultPanel.hidden = true;
        return;
      }

      totalPercentage += pct;
      countedSubjects += 1;
    }

    if (!hasAnyInput || countedSubjects === 0) {
      showError(gpaError, "Add at least one subject with its percentage to calculate your GPA.");
      gpaResultPanel.hidden = true;
      return;
    }

    const avgPercentage = totalPercentage / countedSubjects;
    const approxGpa = round2(avgPercentage / PERCENT_TO_GPA_DIVISOR);

    gpaValue.textContent = approxGpa.toFixed(2);
    avgPercentageEl.textContent = formatTrim(avgPercentage) + "%";
    subjectCountEl.textContent = String(countedSubjects);
    gpaResultPanel.hidden = false;
    setSeal(approxGpa, MAX_APPROX_GPA);

    // Bring the result into view only if it isn't already visible (keeps the
    // page still when the compact card already fits on screen), then move
    // focus to it so assistive tech announces the new result.
    gpaResultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    gpaResultPanel.focus({ preventScroll: true });
  });

  resetGpaBtn.addEventListener("click", function () {
    subjectList.innerHTML = "";
    addSubject({ name: "", percentage: "" });
    addSubject({ name: "", percentage: "" });
    hideError(gpaError);
    gpaResultPanel.hidden = true;
    gpaSeal.classList.remove("is-filled");
  });

  /* ============================================================
     Percentage Calculator (marks obtained / total)
     ============================================================ */

  const pctForm = document.getElementById("pctForm");
  const marksObtained = document.getElementById("marksObtained");
  const marksTotal = document.getElementById("marksTotal");
  const pctFormError = document.getElementById("pctFormError");
  const pctFormResult = document.getElementById("pctFormResult");
  const pctFormValue = document.getElementById("pctFormValue");
  const pctFormSub = document.getElementById("pctFormSub");

  pctForm.addEventListener("submit", function (e) {
    e.preventDefault();
    hideError(pctFormError);

    const obtainedRaw = marksObtained.value.trim();
    const totalRaw = marksTotal.value.trim();

    if (!isValidNumber(obtainedRaw) || !isValidNumber(totalRaw)) {
      showError(pctFormError, "Please enter valid numbers for both marks obtained and total marks.");
      pctFormResult.hidden = true;
      return;
    }

    const obtained = Number(obtainedRaw);
    const total = Number(totalRaw);

    if (total <= 0) {
      showError(pctFormError, "Total marks must be greater than 0.");
      pctFormResult.hidden = true;
      marksTotal.focus();
      return;
    }

    if (obtained < 0) {
      showError(pctFormError, "Marks obtained can't be negative.");
      pctFormResult.hidden = true;
      marksObtained.focus();
      return;
    }

    if (obtained > total) {
      showError(pctFormError, "Marks obtained can't be greater than total marks.");
      pctFormResult.hidden = true;
      marksObtained.focus();
      return;
    }

    const pct = round2((obtained / total) * 100);
    pctFormValue.textContent = formatTrim(pct) + "%";
    pctFormSub.textContent = obtained + " out of " + total + " marks";
    pctFormResult.hidden = false;
  });
})();
