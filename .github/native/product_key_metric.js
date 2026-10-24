// Maestro runs this on the host. Export fixed stage names only, never app data.
const reply = http.post('http://127.0.0.1:8766/metric', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ stage: STAGE }),
});
if (reply.status !== 200) throw new Error('PRODUCT_KEY_METRIC_REJECTED');
