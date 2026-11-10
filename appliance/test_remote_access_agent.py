"""Unit checks for private Serve operations without contacting Tailscale."""

import importlib.util
import pathlib
import unittest
from unittest.mock import patch

AGENT = pathlib.Path(__file__).with_name("remote-access-agent.py")
spec = importlib.util.spec_from_file_location("elise_remote_access_agent", AGENT)
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class RemoteAccessAgentTests(unittest.TestCase):
    def test_reports_all_connection_states(self):
        node = {"DNSName": "elise.example.ts.net.", "HostName": "elise"}
        cases = (
            ("NeedsLogin", {}, False, "SIGNED_OUT"),
            ("Running", {}, False, "CONFIGURING"),
            ("Running", {"Web": {"elise.example.ts.net:8443": {}}}, False, "DEGRADED"),
            ("Running", {"Web": {"elise.example.ts.net:8443": {}}}, True, "READY"),
        )
        for backend, serve, webrtc, expected in cases:
            with self.subTest(state=expected), patch.object(
                agent, "command_json", side_effect=[{"BackendState": backend, "Self": node}, serve]
            ), patch.object(agent, "webrtc_available", return_value=webrtc):
                self.assertEqual(agent.status()["state"], expected)

        with patch.object(agent, "command_json", side_effect=FileNotFoundError):
            self.assertEqual(agent.status()["state"], "UNAVAILABLE")

        with patch.object(
            agent, "command_json", return_value={"BackendState": "NeedsLogin", "Self": node}
        ), patch.object(agent, "AUTH_PROCESS") as process:
            process.poll.return_value = None
            self.assertEqual(agent.status()["state"], "AUTHORIZING")

    def test_detects_only_private_8443_serve(self):
        self.assertFalse(agent.serve_is_enabled({"TCP": {"443": {"HTTPS": True}}}))
        self.assertTrue(agent.serve_is_enabled({"Web": {"home.ts.net:8443": {}}}))

    def test_enable_does_not_modify_existing_443(self):
        before = {
            "state": "CONFIGURING",
            "hostname": "elise",
            "remoteUrl": None,
        }
        completed = type("Completed", (), {"returncode": 0, "stderr": "", "stdout": ""})()
        with (
            patch.object(agent, "status", side_effect=[before, {**before, "state": "READY"}]),
            patch.object(agent, "run", return_value=completed) as command,
            patch.object(agent, "command_json", return_value={"Self": {"DNSName": "elise.ts.net."}}),
            patch.object(agent, "configure_webrtc"),
        ):
            self.assertEqual(agent.enable()["state"], "READY")
        command.assert_called_once_with(
            "tailscale", "serve", "--bg", "--yes", "--https=8443", "http://127.0.0.1:18080"
        )

    def test_disable_affects_only_elise_port(self):
        completed = type("Completed", (), {"returncode": 0, "stderr": "", "stdout": ""})()
        with patch.object(agent, "run", return_value=completed) as command, patch.object(
            agent, "status", return_value={"state": "CONFIGURING"}
        ):
            agent.disable()
        command.assert_called_once_with("tailscale", "serve", "--https=8443", "off")


if __name__ == "__main__":
    unittest.main()
