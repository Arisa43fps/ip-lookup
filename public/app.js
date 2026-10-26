const THEME_KEY = "ip-lookup-theme";

const form = document.querySelector("#lookup-form");
const input = document.querySelector("#ip-input");
const lookupButton = document.querySelector("#lookup-button");
const useMyIp = document.querySelector("#use-my-ip");
const result = document.querySelector("#result");
const resultLabel = document.querySelector("#result-label");
const ipValue = document.querySelector("#ip-value");
const ipMeta = document.querySelector("#ip-meta");
const countryBadge = document.querySelector("#country-badge");
const copyButton = document.querySelector("#copy-button");
const badgeRow = document.querySelector("#badges");
const errorBox = document.querySelector("#error");
const errorMessage = document.querySelector("#error-message");
const themeToggle = document.querySelector("#theme-toggle");
const themeColor = document.querySelector("#theme-color");

const statCountry = document.querySelector("#stat-country");
const statContinent = document.querySelector("#stat-continent");
const statAsn = document.querySelector("#stat-asn");
const statOrg = document.querySelector("#stat-org");
const statDomain = document.querySelector("#stat-domain");
const statVersion = document.querySelector("#stat-version");

const state = {
  currentIp: null,
  controller: null,
};

function setLoading(loading) {
  form.classList.toggle("is-loading", loading);
  result.setAttribute("aria-busy", String(loading));
  lookupButton.disabled = loading;
}

function setText(element, value) {
  element.textContent =
    typeof value === "string" && value.trim() ? value : "—";
}

function renderCountryBadge(data) {
  const code =
    typeof data.country_code === "string" ? data.country_code.trim() : "";

  countryBadge.setAttribute(
    "aria-label",
    data.country
      ? `${data.country}${code ? ` (${code.toUpperCase()})` : ""}`
      : "Country unknown",
  );

  if (!/^[a-z]{2}$/i.test(code)) {
    countryBadge.replaceChildren(document.createTextNode("—"));
    return;
  }

  const key = code.toLowerCase();
  const image = document.createElement("img");
  image.className = "country-flag";
  // The wrapper carries the accessible label, so the image stays decorative.
  image.alt = "";
  image.decoding = "async";
  image.addEventListener("error", () => {
    // A missing flag file should not leave an empty frame.
    countryBadge.replaceChildren(document.createTextNode(key.toUpperCase()));
  });
  image.src = `/flags/${key}.svg`;

  countryBadge.replaceChildren(image);
}

function renderBadges(data) {
  const badges = [];

  if (data.bogon) badges.push({ label: "Bogon", tone: "warn" });
  if (data.anycast) badges.push({ label: "Anycast", tone: "accent" });

  badgeRow.replaceChildren(
    ...badges.map(({ label, tone }) => {
      const badge = document.createElement("span");
      badge.className = `badge badge-${tone}`;
      badge.textContent = label;
      return badge;
    }),
  );
  badgeRow.hidden = badges.length === 0;
}

function render(data, { own }) {
  state.currentIp = data.ip;

  ipValue.textContent = data.ip;
  copyButton.hidden = false;
  resultLabel.textContent = own
    ? "Your public IP"
    : data.hostname
      ? `Resolved from ${data.hostname}`
      : "Looked up IP";

  const details = [data.country, data.as_name].filter(Boolean);
  ipMeta.textContent = details.length
    ? details.join(" · ")
    : "No country or network data available.";

  renderCountryBadge(data);

  setText(statCountry, data.country);
  setText(statContinent, data.continent);
  setText(statAsn, data.asn);
  setText(statOrg, data.as_name);
  setText(statDomain, data.as_domain);
  statVersion.textContent = data.ip.includes(":") ? "IPv6" : "IPv4";

  renderBadges(data);
  errorBox.hidden = true;
  useMyIp.hidden = own;

  document.title = `${data.ip} · IP Lookup`;
  updateUrl(own ? null : data.hostname || data.ip);
}

function showError(message) {
  errorBox.hidden = false;
  errorMessage.textContent = message;

  if (!state.currentIp) {
    ipValue.textContent = "—";
    ipMeta.textContent = "Lookup failed";
    resultLabel.textContent = "IP lookup";
  }
}

function updateUrl(ip) {
  const url = new URL(window.location.href);
  if (ip) {
    url.searchParams.set("ip", ip);
  } else {
    url.searchParams.delete("ip");
  }
  window.history.replaceState(null, "", url);
}

async function lookup(ip) {
  if (state.controller) state.controller.abort();

  const controller = new AbortController();
  state.controller = controller;
  setLoading(true);
  errorBox.hidden = true;

  try {
    const query = ip ? `?ip=${encodeURIComponent(ip)}` : "";
    const response = await fetch(`/api/ip${query}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        body && typeof body.error === "string"
          ? body.error
          : `Lookup failed (${response.status}).`;
      throw new Error(message);
    }

    if (!body || typeof body.ip !== "string") {
      throw new Error("The lookup returned an unexpected response.");
    }

    render(body, { own: !ip });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return;
    showError(
      error instanceof Error
        ? error.message
        : "Something went wrong. Try again.",
    );
  } finally {
    if (state.controller === controller) {
      state.controller = null;
      setLoading(false);
    }
  }
}

async function copyIp() {
  const ip = state.currentIp;
  if (!ip) return;

  let copied = false;
  try {
    await navigator.clipboard.writeText(ip);
    copied = true;
  } catch {
    // Fall back for browsers without the async clipboard API.
  }

  if (!copied) {
    const textarea = document.createElement("textarea");
    textarea.value = ip;
    textarea.setAttribute("readonly", "");
    textarea.className = "copy-fallback";
    document.body.append(textarea);
    textarea.select();

    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    textarea.remove();
  }

  if (!copied) {
    showError("Could not copy the IP address.");
    return;
  }

  copyButton.classList.add("is-copied");
  copyButton.setAttribute("aria-label", "Copied");

  window.setTimeout(() => {
    copyButton.classList.remove("is-copied");
    copyButton.setAttribute("aria-label", "Copy IP address");
  }, 1600);
}

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
  );

  if (themeColor) {
    themeColor.setAttribute(
      "content",
      theme === "dark" ? "#070b14" : "#f6f8fc",
    );
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage failures; the theme still applies for this page.
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = input.value.trim();
  lookup(value || null);
});

useMyIp.addEventListener("click", () => {
  input.value = "";
  lookup(null);
  input.focus();
});

copyButton.addEventListener("click", copyIp);

themeToggle.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next, true);
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      // Ignore storage failures.
    }

    if (stored !== "light" && stored !== "dark") {
      applyTheme(event.matches ? "dark" : "light", false);
    }
  });

applyTheme(
  document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  false,
);

const initialIp = new URLSearchParams(window.location.search).get("ip")?.trim();
if (initialIp) input.value = initialIp;
lookup(initialIp || null);
