"""Fake Docker fault controls only; no container, database or native operation."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('public_ci_mongo', Path(__file__).with_name('public_ci_mongo.py'))
mongo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mongo)
ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
       'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper', 'GITHUB_RUN_ID': '123',
       'GITHUB_RUN_ATTEMPT': '2', 'KEEPER_CONTAINER_NAME': 'foreign'}
NAME, TOKEN = mongo.identity(ENV)
OWNER = TOKEN + '|' + mongo.IMAGE + '|true'
TIMEOUT = subprocess.TimeoutExpired('PRIVATE_SENTINEL', 1)


class MongoFaults(unittest.TestCase):
    def exercise(self, phase, answers=(), *, env=ENV, ticks=None):
        answers, calls = iter(answers), []
        def run(args, **kwargs):
            calls.append(args)
            self.assertEqual(args[0], 'docker')
            self.assertGreater(kwargs['timeout'], 0)
            self.assertLessEqual(kwargs['timeout'], 120)
            self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
            value = next(answers)
            if isinstance(value, BaseException):
                raise value
            code, raw = value
            kwargs['stdout'].write(raw if isinstance(raw, bytes) else raw.encode())
            return SimpleNamespace(returncode=code)
        output = io.StringIO()
        clock = patch.object(mongo.time, 'monotonic', side_effect=ticks) if ticks else contextlib.nullcontext()
        with patch.object(mongo.subprocess, 'run', side_effect=run), clock, \
                patch.object(mongo.time, 'sleep'), contextlib.redirect_stdout(output):
            status = mongo.main([phase], env)
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
        value = json.loads(output.getvalue())
        self.assertEqual(value['result'], 'FAIL' if status else 'PASS')
        return status, value, calls

    def test_exact_known_absence_and_owned_removal(self):
        self.assertEqual(self.exercise('cleanup', [(0, '')])[1]['disposition'], 'absent')
        status, value, calls = self.exercise('cleanup', [(0, NAME), (0, OWNER), (0, NAME), (0, '')])
        self.assertEqual(status, 0)
        self.assertEqual(value['disposition'], 'removed')
        self.assertEqual(calls[2], ['docker', 'rm', '--force', '--volumes', NAME])

    def test_stopped_owned_container_can_be_removed(self):
        self.assertEqual(self.exercise('cleanup', [(0, NAME), (0, OWNER.replace('|true', '|false')),
                                                  (0, NAME), (0, '')])[0], 0)

    def test_inventory_query_failure_or_malformed_output_never_means_absent(self):
        for value in [(1, ''), (0, 'different'), (0, ' ' + NAME), (0, NAME + '\n' + NAME),
                      (0, 'x' * 4097), (0, b'\xff'), TIMEOUT, OSError('PRIVATE_SENTINEL')]:
            with self.subTest(value=type(value).__name__):
                status, _, calls = self.exercise('cleanup', [value])
                self.assertEqual(status, 1)
                self.assertEqual(len(calls), 1)

    def test_foreign_label_image_unknown_state_or_failed_inspection_never_removes(self):
        for value in [(0, 'foreign|' + mongo.IMAGE + '|true'), (0, TOKEN + '|other|true'),
                      (0, OWNER + ' '), (0, TOKEN + '|' + mongo.IMAGE + '|unknown'),
                      (1, OWNER), TIMEOUT]:
            with self.subTest(value=type(value).__name__):
                status, _, calls = self.exercise('cleanup', [(0, NAME), value])
                self.assertEqual(status, 1)
                self.assertFalse(any(call[1] == 'rm' for call in calls))

    def test_removal_response_and_final_inventory_both_have_to_confirm(self):
        for tail in [[(1, '')], [TIMEOUT], [(0, 'different')], [(0, NAME), (0, NAME)],
                     [(0, NAME), (1, '')], [(0, NAME), TIMEOUT]]:
            with self.subTest(length=len(tail)):
                self.assertEqual(self.exercise('cleanup', [(0, NAME), (0, OWNER), *tail])[0], 1)

    def test_invalid_host_repository_or_run_context_makes_no_docker_call(self):
        for key, value in [('GITHUB_ACTIONS', 'false'), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                           ('GITHUB_REPOSITORY', 'KeeperCommunity/Relay'),
                           *[(key, value) for key in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT')
                             for value in ('', '0', '01', '-1', '1/2', '1\n', '9' * 21, None, 1)]]:
            with self.subTest(key=key, value=value):
                self.assertEqual(self.exercise('cleanup', env={**ENV, key: value})[2], [])
        self.assertEqual(self.exercise('other')[2], [])

    def test_start_collision_never_starts_or_removes(self):
        status, _, calls = self.exercise('start', [(0, NAME)])
        self.assertEqual(status, 1)
        self.assertEqual(len(calls), 1)

    def test_start_retains_existing_image_replica_port_and_verified_writable_probe(self):
        status, value, calls = self.exercise('start', [(0, ''), (0, 'id'), (0, OWNER), (0, ''), (0, OWNER)])
        self.assertEqual(status, 0)
        self.assertEqual(value['disposition'], 'writable')
        self.assertIn('127.0.0.1:27058:27058', calls[1])
        self.assertIn(mongo.IMAGE, calls[1])
        self.assertIn(mongo.LABEL + '=' + TOKEN, calls[1])
        self.assertNotIn('foreign', calls[1])
        self.assertEqual(calls[3], ['docker', 'exec', NAME, 'mongosh', '--port', '27058', '--quiet', '--eval', mongo.INIT])

    def test_foreign_or_stopped_owned_runtime_never_gets_initialization_probe(self):
        for value in [(0, 'foreign'), (1, OWNER), (0, OWNER.replace('|true', '|false')), TIMEOUT]:
            status, _, calls = self.exercise('start', [(0, ''), (0, 'id'), value])
            self.assertEqual(status, 1)
            self.assertFalse(any(call[1] == 'exec' for call in calls))

    def test_every_probe_and_final_readiness_revalidate_live_ownership(self):
        status, _, calls = self.exercise('start', [(0, ''), (0, 'id'), (0, OWNER), (1, ''),
                                                 (0, OWNER), (0, ''), (0, OWNER)])
        self.assertEqual(status, 0)
        self.assertEqual([call[1] for call in calls], ['container', 'run', 'inspect', 'exec', 'inspect', 'exec', 'inspect'])
        self.assertEqual(self.exercise('start', [(0, ''), (0, 'id'), (0, OWNER), (0, ''), (0, 'foreign')])[0], 1)

    def test_start_commit_with_lost_reply_is_discoverable_by_separate_cleanup(self):
        for value in [(1, ''), TIMEOUT]:
            self.assertEqual(self.exercise('start', [(0, ''), value])[0], 1)
        self.assertEqual(self.exercise('cleanup', [(0, NAME), (0, OWNER), (0, NAME), (0, '')])[0], 0)

    def test_writable_reply_after_deadline_cannot_pass(self):
        self.assertEqual(self.exercise('start', [(0, ''), (0, 'id'), (0, OWNER), (0, '')],
                                       ticks=[0, 0, 0, 61, 61, 61])[0], 1)
        self.assertEqual(self.exercise('start', [(0, ''), (0, 'id')], ticks=[0, 61])[0], 1)


if __name__ == '__main__':
    unittest.main()
