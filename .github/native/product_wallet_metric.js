// Optional host-side progress only. Never send app text, wallet data or exceptions.
const walletMarkers = [
  'next_tapped', 'education_visible', 'skip_for_now_tapped',
  'warning_visible', 'skip_backup_tapped',
];
if (typeof MARKER === 'string' && walletMarkers.indexOf(MARKER) >= 0) {
  try {
    http.post('http://127.0.0.1:8765/wallet-progress', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marker: MARKER }),
    });
  } catch (ignored) {
    // Missing progress stays incomplete; existing UI acceptance decides.
  }
}
