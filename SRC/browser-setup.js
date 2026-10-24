const button = document.getElementById('copy');
const status = document.getElementById('copy-status');
button.addEventListener('click', async () => {
  try {
    const response = await fetch('browser-monitor.js');
    if (!response.ok) throw new Error('Script could not be loaded.');
    const script = await response.text();
    await navigator.clipboard.writeText(script);
    status.textContent = 'Copied. Go to your signed-in Walmart tab → DevTools → Console, review the script, then paste and run it. Click Start in the panel.';
    button.textContent = 'Script copied ✓';
  } catch {
    status.textContent = 'Clipboard access is unavailable. Download browser-monitor.js, open it in a text editor, and copy its entire contents instead.';
  }
});
