"""Real producer output at fake host boundaries; never native acceptance."""
import importlib.util
import json
from pathlib import Path

directory = Path(__file__).resolve().parents[1]
receipts, switches = {}, ['product']
for name in ['credential', 'history', 'vault']:
    path = directory / ('test_product_' + name + '_acceptance.py')
    spec = importlib.util.spec_from_file_location('public_fixture_' + name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    case = module.RunnerTests()
    try:
        output = case.exercise()
        value = output[0]
        assert isinstance(value, dict) and value['status'] == 'PASS'
        receipts[name] = value
        if name == 'credential':
            switches.extend(output[2]['switches'])
        if name == 'history':
            switches.extend(output[3])
    finally:
        case.doCleanups()
print(json.dumps({'receipts': receipts, 'switches': switches}))
