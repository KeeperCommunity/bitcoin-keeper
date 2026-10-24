// Fixed host-side receipts only. Never send names, fingerprints or app data.
const reply = http.post('http://127.0.0.1:8769/metric', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ stage: STAGE }),
});
if (reply.status !== 200) throw new Error('PRODUCT_VAULT_METRIC_REJECTED');
