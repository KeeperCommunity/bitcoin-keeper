// Host-side Maestro script. Send fixed stage labels only, never hierarchy/app data.
const reply = http.post('http://127.0.0.1:8765/metric', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ stage: STAGE }),
});
if (reply.status !== 200) throw new Error('PRODUCT_METRIC_REJECTED');
