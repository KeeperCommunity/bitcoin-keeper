"""Fault controls only: fake Docker responses, no container or database calls."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('proof_mongo', Path(__file__).with_name('r5_combined_proof_mongo.py'))
mongo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mongo)
ENV = {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2', 'KEEPER_CONTAINER_NAME': 'foreign'}
NAME, TOKEN = mongo.identity(ENV)
TIMEOUT = subprocess.TimeoutExpired('PRIVATE_SENTINEL', 1)


class MongoControlTests(unittest.TestCase):
    def exercise(self, phase, answers=(), env=ENV, ticks=None):
        answers = iter(answers)
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            self.assertGreater(kwargs['timeout'], 0)
            self.assertLessEqual(kwargs['timeout'], 120)
            self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
            answer = next(answers)
            if isinstance(answer, BaseException):
                raise answer
            code, value = answer
            kwargs['stdout'].write(value.encode())
            return SimpleNamespace(returncode=code)

        output = io.StringIO()
        clock = patch.object(mongo.time, 'monotonic', side_effect=ticks) if ticks else contextlib.nullcontext()
        with patch.object(mongo.subprocess, 'run', side_effect=run), clock, \
                patch.object(mongo.time, 'sleep'), contextlib.redirect_stdout(output):
            status = mongo.main([phase], env)
        receipt = json.loads(output.getvalue())
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
        self.assertEqual(receipt['result'], 'FAIL' if status else 'PASS')
        return status, receipt, calls

    def test_known_absence_and_owned_removal(self):
        self.assertEqual(self.exercise('cleanup', [(0, '')])[1]['disposition'], 'absent')
        status, receipt, calls = self.exercise('cleanup', [(0, NAME), (0, TOKEN), (0, NAME), (0, '')])
        self.assertEqual(status, 0)
        self.assertEqual(receipt['disposition'], 'removed')
        self.assertEqual(calls[2], ['docker', 'rm', '--force', '--volumes', NAME])

    def test_lookup_unknown_never_means_absent(self):
        for answer in [(1, ''), (0, 'different'), (0, ' ' + NAME),
                       (0, NAME + '\n' + NAME), TIMEOUT, OSError('PRIVATE_SENTINEL')]:
            with self.subTest(answer=type(answer).__name__):
                status, _, calls = self.exercise('cleanup', [answer])
                self.assertEqual(status, 1)
                self.assertEqual(len(calls), 1)

    def test_foreign_or_unknown_ownership_never_removes(self):
        for answer in [(0, 'foreign'), (0, ' ' + TOKEN + ' '), (0, ''), (1, TOKEN), TIMEOUT]:
            with self.subTest(answer=type(answer).__name__):
                status, _, calls = self.exercise('cleanup', [(0, NAME), answer])
                self.assertEqual(status, 1)
                self.assertFalse(any(call[1] == 'rm' for call in calls))

    def test_removal_and_post_removal_fail_closed(self):
        for tail in [[(1, '')], [TIMEOUT], [(0, 'different')], [(0, NAME), (0, NAME)],
                     [(0, NAME), (1, '')], [(0, NAME), TIMEOUT]]:
            with self.subTest(tail=len(tail)):
                self.assertEqual(self.exercise('cleanup', [(0, NAME), (0, TOKEN), *tail])[0], 1)

    def test_invalid_context_runs_no_docker(self):
        for value in ['', '0', '01', '-1', '1/2', '1\n', '9' * 21, None, 1]:
            for key in ENV.keys() - {'KEEPER_CONTAINER_NAME'}:
                with self.subTest(key=key, value=value):
                    self.assertEqual(self.exercise('cleanup', env={**ENV, key: value})[2], [])
        self.assertEqual(self.exercise('other')[2], [])

    def test_start_collision_never_removes_or_starts(self):
        status, _, calls = self.exercise('start', [(0, NAME)])
        self.assertEqual(status, 1)
        self.assertEqual(len(calls), 1)

    def test_start_has_fixed_identity_image_loopback_and_real_writable_check(self):
        status, receipt, calls = self.exercise('start', [(0, ''), (0, 'id'), (0, '')])
        self.assertEqual(status, 0)
        self.assertEqual(receipt['disposition'], 'writable')
        self.assertIn(mongo.IMAGE, calls[1])
        self.assertIn('127.0.0.1:27038:27038', calls[1])
        self.assertIn(mongo.LABEL + '=' + TOKEN, calls[1])
        self.assertIn(NAME, calls[1])
        self.assertNotIn('foreign', calls[1])
        self.assertEqual(calls[2][-1], mongo.INIT)

    def test_readiness_retries_and_never_accepts_after_deadline(self):
        self.assertEqual(self.exercise('start', [(0, ''), (0, 'id'), (1, ''), (0, '')],
                                       ticks=[0, 0, 1, 2, 3])[0], 0)
        self.assertEqual(self.exercise('start', [(0, ''), (0, 'id'), (0, '')],
                                       ticks=[0, 0, 61])[0], 1)

    def test_start_failure_and_separate_cleanup(self):
        for answer in [(1, ''), TIMEOUT]:
            self.assertEqual(self.exercise('start', [(0, ''), answer])[0], 1)
        self.assertEqual(self.exercise('start', [(0, ''), (0, 'id'), TIMEOUT])[0], 1)
        self.assertEqual(self.exercise('start', [(0, ''), (0, 'id')], ticks=[0, 61])[0], 1)
        self.assertEqual(self.exercise('cleanup', [(0, NAME), (0, TOKEN), (0, NAME), (0, '')])[0], 0)

    def test_oversized_output_is_unknown(self):
        self.assertEqual(self.exercise('cleanup', [(0, 'x' * 4097)])[0], 1)


if __name__ == '__main__':
    unittest.main()
