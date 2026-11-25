// Apply the saved theme before the first paint (no flash). A file, not inline: the CSP forbids inline scripts.
try {
  var t = JSON.parse(localStorage.getItem("bab:theme") || '"system"');
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
