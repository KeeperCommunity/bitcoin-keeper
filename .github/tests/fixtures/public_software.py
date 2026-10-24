"""Actual receipt producers at fake boundaries; no native or network work."""
import importlib.util
import json
from pathlib import Path


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


directory = Path(__file__).resolve().parents[1]
product = load('software_product', directory.parent / 'native/product_measurements.py')
receipt, samples = product.Receipt(), []
for sample in range(1, 6):
    receipt.reset(sample)
    assert receipt.create_attempt()
    for stage in product.STAGES:
        assert receipt.mark(stage)
    samples.append(receipt.snapshot(passed=True))
receipt.reset(6, retry=True)
assert receipt.mark(product.RETRY_STAGES[0])
assert not receipt.create_attempt()
for stage in product.RETRY_STAGES[1:3]:
    assert receipt.mark(stage)
assert receipt.create_attempt()
for stage in product.RETRY_STAGES[3:]:
    assert receipt.mark(stage)
case = load('software_key', directory / 'test_product_key_acceptance.py').RunnerTests()
try:
    key = case.exercise()[0]
    assert isinstance(key, dict) and key['status'] == 'PASS'
    print(json.dumps({'samples': samples, 'retry': receipt.snapshot(passed=True), 'key': key}))
finally:
    case.doCleanups()
