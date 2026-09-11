# Cameras in Élise OS

## Supported layers

Camera support stays manufacturer-neutral:

1. Home Assistant inventory discovers camera, person-detection and privacy entities.
2. Selecting a person entity maps it to `person_presence` with the bounded `ON_OFF` transform.
3. go2rtc receives the encrypted RTSP source over the private Docker network and serves ticketed WebRTC.
4. The worker requests one JPEG from the camera assigned to the alert room. It expires after 24 hours.

Detection-only cameras need only a Home Assistant binary sensor. Live viewing additionally requires RTSP. Push-to-talk and hardware privacy are enabled only after they work on the exact model and firmware.

## Reolink E1 Zoom pilot

Start with two cameras, in the entrance and living room, before buying more.

1. Initialize each camera with the Reolink application, install current firmware and create a dedicated local user.
2. Enable HTTP/HTTPS, RTSP and ONVIF in the camera network settings.
3. Add the Reolink integration to the internal Home Assistant instance.
4. Reserve the camera address through router DHCP. Do not configure a static address inside the camera.
5. Refresh the Élise equipment inventory, open **Caméras**, and select the camera stream, person sensor and privacy switch.
6. Enter the local RTSP H.264 substream URL. Élise encrypts it before database storage.
7. Confirm consent, then validate direct video, privacy mode, person events, an alert snapshot and push-to-talk.
8. Only after the pilot passes, block camera internet access and repeat the validation from LAN and Tailscale.

Do not install microSD cards for this release: continuous recording is intentionally disabled. If a camera exposes no functional talk backchannel through go2rtc, mark talk unsupported instead of silently falling back to a vendor cloud.

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
