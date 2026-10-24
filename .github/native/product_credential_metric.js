// Fixed stages only. No credential bytes, identifiers, PINs or screenshots.
const reply = http.post('http://127.0.0.1:8767/metric', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ stage: STAGE }),
});
if (reply.status !== 200) throw new Error('PRODUCT_CREDENTIAL_METRIC_REJECTED');
