# Privacy and data lifecycle

Michel stores only normalized sensor facts needed for reassurance. It does not ingest audio, video, free-form Home Assistant attributes, network traffic, or advertising identifiers.

- Detailed observations: 90 days.
- Completed delivery jobs and technical operational records: 30 days.
- Journal summaries: up to two years by default.
- Account and audit records: until account or household deletion, subject to integrity requirements.

All processing is local. Remote family access in V0 is provided by a family-managed VPN. Webhooks are disabled unless explicitly configured. Exports should be encrypted before leaving the hub.

This engineering policy supports privacy by design but is not legal advice or a certification of GDPR compliance.
