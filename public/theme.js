// Put back the theme chosen with the header's toggle before the page paints, so a dark choice
// never flashes light. Without a choice the system's scheme stands. Kept in sync with web/ThemeToggle.tsx.
try {
  var theme = localStorage.getItem("vinyl-value-vault.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (e) {
  // Storage refused: the system's scheme it is.
}
