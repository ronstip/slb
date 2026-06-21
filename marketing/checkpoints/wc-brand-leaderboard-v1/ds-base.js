// Scolto Design System base loader for templates.
// One file, one line for a consumer to point at the design system.
(() => {
  const base = '../..';
  for (const p of ['colors_and_type.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = base + '/' + p;
    document.head.appendChild(l);
  }
  const s = document.createElement('script');
  s.src = base + '/_ds_bundle.js';
  s.onerror = () => {}; // tolerate a not-yet-compiled bundle
  document.head.appendChild(s);
})();
