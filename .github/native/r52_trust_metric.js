// Host Maestro checkpoint. App observer cannot submit UI stages.
const reply = http.post('http://127.0.0.1:8768/metric', {
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: STAGE, token: METRIC_TOKEN }),
});
if (reply.status !== 200) throw new Error('R52_TRUST_UI_CHECKPOINT_REJECTED');
