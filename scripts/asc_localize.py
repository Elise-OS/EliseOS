#!/usr/bin/env python3
"""Synchronise App Store Connect texts and screenshots for Elise OS locales.

Usage:
  set -a; . ~/.hermes/secrets/asc.env; set +a
  python3 scripts/asc_localize.py [--dry-run | --verify-only] pt-PT

The script only updates localisations on the version in PREPARE_FOR_SUBMISSION.
It never submits the app for review.
"""

import argparse
import glob
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import jwt


APP = os.environ.get("ASC_APP_ID", "6817813414")
REPO = Path(__file__).resolve().parents[1]
META = Path(os.environ.get("ASC_META_DIR", REPO / "apps/mobile/fastlane/metadata"))
SHOTS = Path(
    os.environ.get(
        "ASC_SHOTS_DIR",
        Path.home() / ".hermes/data/elise_shots/app-store-screenshots",
    )
)
APP_NAME = os.environ.get("ASC_APP_NAME", "Elise OS - Companion")
SUPPORTED_LOCALES = {
    "fr-FR": "fr-FR",
    "en-US": "en-US",
    "es-ES": "es-ES",
    "it": "it",
    "pt-PT": "pt-PT",
}
SCREENSHOT_FALLBACK = {"pt-PT": "en-US"}
SCREENSHOT_SETS = (
    ("iphone", "APP_IPHONE_67"),
    ("ipad", "APP_IPAD_PRO_3GEN_129"),
)


def token():
    key_path = os.environ.get("ASC_KEY_PATH")
    if not key_path:
        raise RuntimeError("ASC_KEY_PATH is not set; source ~/.hermes/secrets/asc.env")
    key = Path(key_path).read_text(encoding="utf-8")
    return jwt.encode(
        {
            "iss": os.environ["ASC_ISSUER_ID"],
            "exp": int(time.time()) + 1100,
            "aud": "appstoreconnect-v1",
        },
        key,
        algorithm="ES256",
        headers={"kid": os.environ["ASC_KEY_ID"]},
    )


def api(path, method="GET", body=None):
    request = urllib.request.Request(
        "https://api.appstoreconnect.apple.com" + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Bearer " + token(),
            "Content-Type": "application/json",
        },
    )
    try:
        payload = urllib.request.urlopen(request).read()
        return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1600]
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc


def metadata(locale, name, required=True):
    path = META / SUPPORTED_LOCALES[locale] / f"{name}.txt"
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return None
    return path.read_text(encoding="utf-8").strip()


def text_attributes(locale):
    info = {
        "name": APP_NAME,
        "subtitle": metadata(locale, "subtitle"),
        "privacyPolicyUrl": metadata(locale, "privacy_url"),
    }
    version = {
        "description": metadata(locale, "description"),
        "keywords": metadata(locale, "keywords"),
        "marketingUrl": metadata(locale, "marketing_url", required=False),
        "promotionalText": metadata(locale, "promotional_text", required=False),
        "supportUrl": metadata(locale, "support_url"),
    }
    version = {key: value for key, value in version.items() if value}
    limits = {"name": 30, "subtitle": 30, "keywords": 100, "promotionalText": 170}
    for field, limit in limits.items():
        value = info.get(field) or version.get(field)
        if value and len(value) > limit:
            raise ValueError(f"{locale} {field}: {len(value)}>{limit}")
    return info, version


def screenshot_files(locale):
    source = locale
    if not list((SHOTS / source).glob("*.png")):
        source = SCREENSHOT_FALLBACK.get(locale, locale)
    result = {
        display_type: sorted(glob.glob(str(SHOTS / source / f"{prefix}-*.png")))
        for prefix, display_type in SCREENSHOT_SETS
    }
    if any(not files for files in result.values()):
        counts = {display_type: len(files) for display_type, files in result.items()}
        raise ValueError(f"Incomplete App Store screenshots for {locale}: {counts}")
    return source, result


def context():
    app_info = api(f"/v1/apps/{APP}/appInfos?limit=10")["data"][0]["id"]
    versions = api(f"/v1/apps/{APP}/appStoreVersions?limit=50")["data"]
    version = next(
        item["id"]
        for item in versions
        if item["attributes"]["appStoreState"] == "PREPARE_FOR_SUBMISSION"
    )
    return app_info, version


def upsert_localisations(locale, app_info, version, info_attrs, version_attrs):
    infos = {
        item["attributes"]["locale"]: item["id"]
        for item in api(f"/v1/appInfos/{app_info}/appInfoLocalizations?limit=50")[
            "data"
        ]
    }
    if locale in infos:
        api(
            f"/v1/appInfoLocalizations/{infos[locale]}",
            "PATCH",
            {
                "data": {
                    "type": "appInfoLocalizations",
                    "id": infos[locale],
                    "attributes": info_attrs,
                }
            },
        )
    else:
        api(
            "/v1/appInfoLocalizations",
            "POST",
            {
                "data": {
                    "type": "appInfoLocalizations",
                    "attributes": {"locale": locale, **info_attrs},
                    "relationships": {
                        "appInfo": {"data": {"type": "appInfos", "id": app_info}}
                    },
                }
            },
        )

    versions = {
        item["attributes"]["locale"]: item["id"]
        for item in api(
            f"/v1/appStoreVersions/{version}/appStoreVersionLocalizations?limit=50"
        )["data"]
    }
    if locale in versions:
        version_localisation = versions[locale]
        api(
            f"/v1/appStoreVersionLocalizations/{version_localisation}",
            "PATCH",
            {
                "data": {
                    "type": "appStoreVersionLocalizations",
                    "id": version_localisation,
                    "attributes": version_attrs,
                }
            },
        )
    else:
        version_localisation = api(
            "/v1/appStoreVersionLocalizations",
            "POST",
            {
                "data": {
                    "type": "appStoreVersionLocalizations",
                    "attributes": {"locale": locale, **version_attrs},
                    "relationships": {
                        "appStoreVersion": {
                            "data": {"type": "appStoreVersions", "id": version}
                        }
                    },
                }
            },
        )["data"]["id"]
    return version_localisation


def upload_screenshots(version_localisation, files_by_type):
    sets = {
        item["attributes"]["screenshotDisplayType"]: item["id"]
        for item in api(
            f"/v1/appStoreVersionLocalizations/{version_localisation}/appScreenshotSets?limit=50"
        )["data"]
    }
    uploaded_sets = []
    for display_type, files in files_by_type.items():
        if display_type in sets:
            screenshot_set = sets[display_type]
            current = api(
                f"/v1/appScreenshotSets/{screenshot_set}/appScreenshots?limit=50"
            )["data"]
            for old in current:
                api(f"/v1/appScreenshots/{old['id']}", "DELETE")
        else:
            screenshot_set = api(
                "/v1/appScreenshotSets",
                "POST",
                {
                    "data": {
                        "type": "appScreenshotSets",
                        "attributes": {"screenshotDisplayType": display_type},
                        "relationships": {
                            "appStoreVersionLocalization": {
                                "data": {
                                    "type": "appStoreVersionLocalizations",
                                    "id": version_localisation,
                                }
                            }
                        },
                    }
                },
            )["data"]["id"]
        uploaded_sets.append(screenshot_set)
        for filename in files:
            path = Path(filename)
            data = path.read_bytes()
            screenshot = api(
                "/v1/appScreenshots",
                "POST",
                {
                    "data": {
                        "type": "appScreenshots",
                        "attributes": {
                            "fileName": path.name,
                            "fileSize": len(data),
                        },
                        "relationships": {
                            "appScreenshotSet": {
                                "data": {
                                    "type": "appScreenshotSets",
                                    "id": screenshot_set,
                                }
                            }
                        },
                    }
                },
            )["data"]
            for operation in screenshot["attributes"]["uploadOperations"]:
                request = urllib.request.Request(
                    operation["url"],
                    data=data[
                        operation["offset"] : operation["offset"]
                        + operation["length"]
                    ],
                    method=operation["method"],
                    headers={
                        header["name"]: header["value"]
                        for header in operation["requestHeaders"]
                    },
                )
                urllib.request.urlopen(request).read()
            api(
                f"/v1/appScreenshots/{screenshot['id']}",
                "PATCH",
                {
                    "data": {
                        "type": "appScreenshots",
                        "id": screenshot["id"],
                        "attributes": {
                            "uploaded": True,
                            "sourceFileChecksum": hashlib.md5(data).hexdigest(),
                        },
                    }
                },
            )
        print(display_type, len(files), "uploaded")

    for _ in range(60):
        states = [
            item["attributes"]["assetDeliveryState"]["state"]
            for screenshot_set in uploaded_sets
            for item in api(
                f"/v1/appScreenshotSets/{screenshot_set}/appScreenshots?limit=50"
            )["data"]
        ]
        if states and (all(state == "COMPLETE" for state in states) or "FAILED" in states):
            break
        time.sleep(10)
    print("screenshot states", {state: states.count(state) for state in set(states)})
    if not states or not all(state == "COMPLETE" for state in states):
        raise RuntimeError(f"App Store screenshots did not complete: {states}")


def verify(locale, app_info, version):
    infos = api(f"/v1/appInfos/{app_info}/appInfoLocalizations?limit=50")["data"]
    versions = api(
        f"/v1/appStoreVersions/{version}/appStoreVersionLocalizations?limit=50"
    )["data"]
    info = next(item for item in infos if item["attributes"]["locale"] == locale)
    version_item = next(
        item for item in versions if item["attributes"]["locale"] == locale
    )
    version_id = version_item["id"]
    sets = api(
        f"/v1/appStoreVersionLocalizations/{version_id}/appScreenshotSets?limit=50"
    )["data"]
    screenshots = {}
    for screenshot_set in sets:
        display_type = screenshot_set["attributes"]["screenshotDisplayType"]
        screenshots[display_type] = len(
            api(
                f"/v1/appScreenshotSets/{screenshot_set['id']}/appScreenshots?limit=50"
            )["data"]
        )
    attrs = version_item["attributes"]
    result = {
        "locale": locale,
        "name": info["attributes"].get("name"),
        "subtitle": info["attributes"].get("subtitle"),
        "descriptionLength": len(attrs.get("description") or ""),
        "keywordsLength": len(attrs.get("keywords") or ""),
        "screenshots": screenshots,
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--verify-only", action="store_true")
    parser.add_argument("locales", nargs="+", choices=SUPPORTED_LOCALES)
    args = parser.parse_args()

    plans = {}
    for locale in args.locales:
        info_attrs, version_attrs = text_attributes(locale)
        screenshot_source, files_by_type = screenshot_files(locale)
        plans[locale] = (info_attrs, version_attrs, screenshot_source, files_by_type)
        counts = {kind: len(files) for kind, files in files_by_type.items()}
        print(
            locale,
            {"subtitle": len(info_attrs["subtitle"]), "keywords": len(version_attrs["keywords"])},
            "screenshots",
            screenshot_source,
            counts,
        )
    if args.dry_run:
        print("dry-run: no App Store Connect changes")
        return

    app_info, version = context()
    for locale, (info_attrs, version_attrs, _, files_by_type) in plans.items():
        if not args.verify_only:
            version_localisation = upsert_localisations(
                locale, app_info, version, info_attrs, version_attrs
            )
            upload_screenshots(version_localisation, files_by_type)
        verify(locale, app_info, version)


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, KeyError, RuntimeError, ValueError) as exc:
        sys.exit(str(exc))
