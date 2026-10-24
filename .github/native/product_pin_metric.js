// Optional host-side progress only. Never send PINs, app text or exceptions.
const pinMarkers = [
  'confirm_passcode_visible', 'confirmation_digits_tapped', 'create_tapped',
  'continue_visible', 'continue_tapped', 'cancel_visible', 'cancel_tapped',
  'skip_visible', 'skip_tapped', 'start_new_visible',
];
if (typeof MARKER === 'string' && pinMarkers.indexOf(MARKER) >= 0) {
  try {
    http.post('http://127.0.0.1:8765/pin-progress', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marker: MARKER }),
    });
  } catch (ignored) {
    // Missing progress is retained as incomplete; existing UI acceptance decides.
  }
}
