"""Unit checks for the privileged updater without contacting GitHub or running Docker."""

import fcntl
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

AGENT = pathlib.Path(__file__).with_name("elise-update-agent.py")
spec = importlib.util.spec_from_file_location("elise_update_agent", AGENT)
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class UpdateAgentTests(unittest.TestCase):
    def test_compares_stable_semver_versions(self):
        self.assertGreater(agent.version_key("v0.1.1"), agent.version_key("v0.1.0"))
        self.assertGreater(agent.version_key("v1.0.0"), agent.version_key("v0.99.99"))

    def test_detects_release_without_leaking_token(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            auth = root / "github-auth"
            status = root / "status.json"
            env = root / "elise.env"
            env.write_text("ELISE_VERSION=v0.1.0\n", encoding="utf-8")
            with patch.object(agent, "AUTH_FILE", auth), patch.object(
                agent, "STATUS_FILE", status
            ), patch.object(agent, "ENV_FILE", env), patch.object(
                agent,
                "latest_release",
                return_value={"tag_name": "v0.1.1", "body": "Fixes", "draft": False, "prerelease": False},
            ):
                agent.write_auth("elise-os-bot", "ghp_secret_value")
                result = agent.check_release()
                self.assertEqual(result["state"], "AVAILABLE")
                self.assertEqual(result["authUsername"], "elise-os-bot")
                self.assertNotIn("ghp_secret_value", str(result))
                self.assertIn("ghp_secret_value", auth.read_text(encoding="utf-8"))

    def test_checks_public_releases_without_account(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            env = root / "elise.env"
            env.write_text("ELISE_VERSION=v0.1.0\n", encoding="utf-8")
            with patch.object(agent, "AUTH_FILE", root / "github-auth"), patch.object(
                agent, "STATUS_FILE", root / "status.json"
            ), patch.object(agent, "ENV_FILE", env), patch.object(
                agent,
                "latest_release",
                return_value={"tag_name": "v0.1.1", "body": "", "draft": False, "prerelease": False},
            ):
                result = agent.check_release()
                self.assertEqual(result["state"], "AVAILABLE")
                self.assertFalse(result["authConfigured"])

    def test_asks_for_account_when_repository_is_private(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(agent, "AUTH_FILE", root / "github-auth"), patch.object(
                agent, "STATUS_FILE", root / "status.json"
            ), patch.object(agent, "latest_release", side_effect=agent.AuthRequired("Dépôt privé")):
                self.assertEqual(agent.check_release()["state"], "UNCONFIGURED")

    def test_replaces_secrets_in_error_messages(self):
        with tempfile.TemporaryDirectory() as folder:
            auth = Path(folder) / "github-auth"
            auth.write_text("username=bot\ntoken=top-secret\n", encoding="utf-8")
            with patch.object(agent, "AUTH_FILE", auth):
                self.assertEqual(agent.redact_error("request top-secret failed"), "request [secret] failed")


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.env = root / "elise.env"
        self.env.write_text("ELISE_VERSION=v0.1.0\n", encoding="utf-8")
        self.status = root / "update" / "status.json"
        self.installer = root / "elise"
        self.patches = [
            patch.object(agent, "AUTH_FILE", root / "github-auth"),
            patch.object(agent, "STATUS_FILE", self.status),
            patch.object(agent, "LOCK_FILE", root / "run" / "update.lock"),
            patch.object(agent, "ENV_FILE", self.env),
            patch.object(agent, "INSTALLER", str(self.installer)),
            patch.object(agent, "runner_active", return_value=False),
        ]
        for item in self.patches:
            item.start()
        self.addCleanup(self.folder.cleanup)
        self.addCleanup(lambda: [item.stop() for item in self.patches])

    def fake_installer(self, script):
        self.installer.write_text("#!/usr/bin/env bash\n" + script, encoding="utf-8")
        os.chmod(self.installer, 0o755)

    def latest(self, tag):
        return patch.object(
            agent, "latest_release", return_value={"tag_name": tag, "draft": False, "prerelease": False}
        )

    def test_installs_only_the_latest_release(self):
        with self.latest("v0.1.2"), patch.object(agent, "launch_runner") as launch:
            with self.assertRaises(ValueError):
                agent.install("v0.1.1")
            launch.assert_not_called()

    def test_refuses_to_reinstall_or_downgrade(self):
        self.env.write_text("ELISE_VERSION=v0.1.2\n", encoding="utf-8")
        with self.latest("v0.1.2"), patch.object(agent, "launch_runner") as launch:
            with self.assertRaises(ValueError):
                agent.install("v0.1.2")
            launch.assert_not_called()

    def test_starts_the_runner_for_a_newer_release(self):
        with self.latest("v0.1.1"), patch.object(agent, "launch_runner") as launch:
            result = agent.install("v0.1.1")
        launch.assert_called_once_with("v0.1.1")
        self.assertEqual(result["state"], "DOWNLOADING")

    def test_refuses_a_second_installation(self):
        with patch.object(agent, "runner_active", return_value=True), self.latest("v0.1.1"):
            with self.assertRaises(RuntimeError):
                agent.install("v0.1.1")

    def test_reports_failure_when_the_runner_cannot_start(self):
        with self.latest("v0.1.1"), patch.object(agent, "launch_runner", side_effect=RuntimeError("non")):
            with self.assertRaises(RuntimeError):
                agent.install("v0.1.1")
        self.assertEqual(agent.load_status()["state"], "FAILED")

    def test_maps_installer_steps_to_states(self):
        self.assertEqual(agent.install_step("→ Démarrage et vérification d’Élise")[0], "VERIFYING")
        self.assertEqual(agent.install_step("→ Téléchargement des composants Élise")[:2], ("DOWNLOADING", 45))
        self.assertIsNone(agent.install_step("Pulling api"))

    def test_apply_records_a_successful_update(self):
        self.fake_installer(
            'echo "→ Téléchargement des composants Élise"\n'
            f'echo ELISE_VERSION=v0.1.1 > "{self.env}"\n'
            'echo "→ Élise est prête"\n'
        )
        with patch.object(agent.subprocess, "run") as systemctl:
            self.assertEqual(agent.apply("v0.1.1"), 0)
        status = json.loads(self.status.read_text(encoding="utf-8"))
        self.assertEqual(status["state"], "SUCCEEDED")
        self.assertEqual(status["currentVersion"], "v0.1.1")
        self.assertFalse(status["updateAvailable"])
        systemctl.assert_called_once()
        self.assertIn("try-restart", systemctl.call_args.args[0])

    def test_apply_records_a_rollback_with_the_installer_error(self):
        self.fake_installer('echo "Erreur : les contrôles de santé ont échoué" >&2\nexit 1\n')
        with patch.object(agent.subprocess, "run"):
            self.assertEqual(agent.apply("v0.1.1"), 1)
        status = json.loads(self.status.read_text(encoding="utf-8"))
        self.assertEqual(status["state"], "ROLLED_BACK")
        self.assertEqual(status["currentVersion"], "v0.1.0")
        self.assertIn("contrôles de santé", status["error"])

    def test_reports_an_interrupted_installation(self):
        agent.save_status({**agent.base_status(), "state": "INSTALLING", "progress": 40})
        self.assertEqual(agent.load_status()["state"], "FAILED")

    def test_running_installation_keeps_its_status(self):
        agent.save_status({**agent.base_status(), "state": "INSTALLING", "progress": 40})
        agent.LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        with agent.LOCK_FILE.open("a+") as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_EX)
            self.assertTrue(agent.install_running())
            with patch.object(agent, "latest_release") as latest:
                self.assertEqual(agent.check_release()["state"], "INSTALLING")
                latest.assert_not_called()

    def test_recent_check_does_not_call_github_again(self):
        with self.latest("v0.1.1") as latest:
            agent.check_release()
            agent.check_release()
            self.assertEqual(latest.call_count, 1)
            agent.check_release(force=True)
            self.assertEqual(latest.call_count, 2)


if __name__ == "__main__":
    unittest.main()
