"""Recorded original ff inputs for legacy private diagnostics, never HEAD fallback."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TREE = 'ee0c587945901788b4ad62ad28ed660ab656cb6a'
FILES = {
    '.github/workflows/keeper-native-platform.yml': '4c1c6418d25310315bbe05ab218d3729333237cf202551b894eaa7ad562771d1',
    '.github/native/hosted_native.py': 'bfaad2396681be811768b53df85189509830236a61d30d40fb8a4eae7bd2db1c',
    '.github/native/product_measurements.py': '1151ae24618f1c3b0200d298bfa79b71d398069d15ca5f8e7e97537fc4e84c5c',
}


def original_bytes(path):
    if path not in FILES:
        raise AssertionError('Unknown frozen ff input')
    raw = subprocess.check_output(['git', '--no-replace-objects', 'show', TREE + ':' + path], cwd=ROOT,
        env={'PATH': os.environ['PATH'], 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
             'GIT_TERMINAL_PROMPT': '0'}, stderr=subprocess.DEVNULL, timeout=30)
    if hashlib.sha256(raw).hexdigest() != FILES[path]:
        raise AssertionError('Frozen ff bytes do not match recorded digest')
    return raw


def original_module(path, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    value = importlib.util.module_from_spec(spec)
    exec(compile(original_bytes(path), str(ROOT / path), 'exec'), value.__dict__)
    return value
