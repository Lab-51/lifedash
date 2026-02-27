// === FILE PURPOSE ===
// Renderer entry bootstrap — sets up global error handlers BEFORE loading
// the React app so import/evaluation errors are visible on the splash screen
// in packaged builds where DevTools are unavailable.

function showSplashError(msg: string) {
  const el = document.getElementById('splash-error');
  if (el) {
    el.style.display = 'block';
    el.textContent = (el.textContent ? el.textContent + '\n' : '') + msg;
  }
  console.error('[LifeDash bootstrap]', msg);
}

window.onerror = (_msg, src, line, _col, err) => {
  showSplashError(`${err?.message ?? _msg} (${src}:${line})`);
};

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  showSplashError(`Unhandled: ${reason?.message ?? reason ?? 'unknown'}`);
});

// Dynamic import so module evaluation errors are caught by the .catch() handler
import('./main').catch((err) => {
  showSplashError(`Failed to load app: ${err?.message ?? err}`);
});
