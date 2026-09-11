# Privacy and data lifecycle

Michel stores only normalized sensor facts needed for reassurance. Optional cameras are isolated in a separate media plane: video and audio are never ingested into observations or AI features. A camera contributes only the normalized fact `person_presence`.

- Detailed observations: 90 days.
- Completed delivery jobs and technical operational records: 30 days.
- Journal summaries: up to two years by default.
- Account and audit records: until account or household deletion, subject to integrity requirements.
- Alert snapshots: 24 hours, stored locally and excluded from normal backups.

Live video is relayed on demand with a five-minute signed session. Audio is available only while the user deliberately holds the push-to-talk control and is never recorded by Michel. Camera stream credentials are encrypted at rest. Viewing a live stream or alert image, using push-to-talk, changing privacy mode and granting camera consent are audit events.

OWNER, ADMINISTRATOR and CAREGIVER memberships may view configured cameras. Only OWNER and ADMINISTRATOR memberships may add or reconfigure them. Bedrooms and bathrooms require an explicit, recorded consent confirmation. Michel cannot itself verify that consent is legally sufficient or that a third-party camera has stopped recording when an app-only privacy mode is used; a mapped hardware privacy entity is preferred.

All processing is local. Remote family access in V0 is provided by a family-managed VPN. Webhooks are disabled unless explicitly configured. Exports should be encrypted before leaving the hub.

This engineering policy supports privacy by design but is not legal advice or a certification of GDPR compliance.
