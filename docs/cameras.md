# Cameras in Élise OS

## Add a camera

Camera setup is a network flow, separate from Zigbee pairing. Start it from **Mon logement → select a room → Types de capteurs → Caméra**. The sidebar **Caméras** page is for viewing live streams and event recordings.

1. Élise scans the configured private network range and sends an RTSP `OPTIONS` request to confirm each camera service. It ignores unrelated open ports and collapses duplicate IP addresses that share a device-specific RTSP authentication realm. It does not start a Zigbee pairing session or rely on Home Assistant discovery.
2. If one camera is found, Élise selects it automatically. The username starts as `admin`; the local camera password is requested only when the stream requires authentication. The room is fixed to the room where setup started. The browser never asks for a manufacturer or RTSP path.
3. After the form is submitted, Élise queries ONVIF for the camera's video profiles and stream addresses. If the camera does not expose ONVIF profiles, Élise tries common RTSP paths automatically. go2rtc must return a frame before Élise saves the camera; the RTSP URL and local credentials are encrypted before database storage.

Use the camera's local streaming account, not the Imou Life cloud account unless the camera uses the same credential. For Imou cameras the username is often `admin`; use the device password configured during setup. A password-protected RTSP stream cannot be opened without that password. Credentials are submitted only through this setup form; do not send them in chat or support logs. ONVIF or RTSP must be enabled in the camera settings.

The API discovery range defaults to `192.168.1.0/24`, which matches the NAS network used for the Imou camera. Override `MICHEL_CAMERA_DISCOVERY_CIDRS` with comma-separated private IPv4 CIDRs when the cameras use another LAN. Each range must contain at most 256 addresses (`/24` through `/32`).

Only the live stream and event recording are supported by this flow. Push-to-talk, PTZ, hardware privacy, and person recognition remain disabled unless they are implemented and validated for that camera. Continuous recording stays disabled.

## Imou camera on the NAS

ONVIF discovery on the NAS identified an Imou/Lechange camera at the time of discovery. The camera's RTSP endpoint requires authentication. Once its local camera username and device password are entered, Élise tries to retrieve the stream profile through ONVIF and tests for a frame before registering it. Network detection by itself does not prove that the camera is configured or streaming.

## Tailscale and HTTPS

Browser microphone access requires a secure origin. On the Raspberry host, publish the local dashboard privately through Tailscale Serve:

```bash
sudo tailscale serve --bg localhost:8080
tailscale serve status
```

Use the resulting `https://…ts.net` address. Do not use Tailscale Funnel: camera access must remain inside the tailnet. The WebRTC port `8555/tcp` and `8555/udp` is published by Compose; restrict it at the host firewall to the LAN and Tailscale interfaces.

Set `MICHEL_WEBRTC_CANDIDATE` in `.env` to the Raspberry Pi's Tailscale MagicDNS hostname (without `https://` or a port), for example `elise-pi.example-tailnet.ts.net`. An IPv4 LAN or Tailscale address also works. This explicit candidate is required because go2rtc deliberately excludes Docker bridge addresses from WebRTC discovery. Recreate `bootstrap` and `go2rtc` after changing it:

```bash
docker compose up -d --force-recreate bootstrap go2rtc api worker dashboard
```

## Privacy and failure behaviour

- App privacy mode immediately removes the go2rtc stream and blocks new sessions and snapshots.
- When a Home Assistant privacy switch is mapped, Élise also asks the camera to activate its hardware privacy mode.
- A camera outage degrades video only; PIR and mmWave coverage remains valid.
- A negative or missing camera event never means that the resident is absent.
- Snapshot failure never blocks the alert. The outbox retries transient media failures.
- Camera media is excluded from `scripts/backup.sh`; expired files are removed every 15 minutes while the API is running.

See the official [Home Assistant Reolink integration](https://www.home-assistant.io/integrations/reolink), [go2rtc documentation](https://github.com/AlexxIT/go2rtc) and [Tailscale Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve).
