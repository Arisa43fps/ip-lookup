(() => {
  const key = "ip-lookup-theme";
  let stored = null;

  try {
    stored = localStorage.getItem(key);
  } catch {
    // Storage can be unavailable in private modes; fall back to the system theme.
  }

  const theme =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

  document.documentElement.dataset.theme = theme;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute("content", theme === "dark" ? "#070b14" : "#f6f8fc");
  }
})();
