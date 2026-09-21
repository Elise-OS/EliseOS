"""Unit checks for the privileged updater without contacting GitHub or running Docker."""

import importlib.util
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
            env.write_text("MICHEL_VERSION=v0.1.0\n", encoding="utf-8")
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

    def test_replaces_secrets_in_error_messages(self):
        with tempfile.TemporaryDirectory() as folder:
            auth = Path(folder) / "github-auth"
            auth.write_text("username=bot\ntoken=top-secret\n", encoding="utf-8")
            with patch.object(agent, "AUTH_FILE", auth):
                self.assertEqual(agent.redact_error("request top-secret failed"), "request [secret] failed")


if __name__ == "__main__":
    unittest.main()
