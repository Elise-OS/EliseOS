"""Synchronise Google Play texts and images for Elise OS locales.

Usage: python3 scripts/play_localize.py [--dry-run] fr-FR en-US es-ES it-IT
Env overrides: PLAY_KEY_PATH, PLAY_META_DIR, PLAY_ASSETS_DIR, PLAY_PACKAGE.
Never changes production/beta/tracks and never submits the app for review.
"""
import argparse, glob, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
import jwt

PACKAGE = os.environ.get('PLAY_PACKAGE', 'org.michel.mobile')
KEY = os.environ.get('PLAY_KEY_PATH', '/home/drsam/.hermes/secrets/play-service-account.json')
REPO = Path(__file__).resolve().parents[1]
META = Path(os.environ.get('PLAY_META_DIR', REPO / 'apps/mobile/fastlane/metadata'))
ASSETS = Path(os.environ.get('PLAY_ASSETS_DIR', '/home/drsam/.hermes/data/elise_play/work/assets'))
BASE = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}'
UPLOAD = f'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}'
SOURCE_LOCALE = {'fr-FR': 'fr-FR', 'en-US': 'en-US', 'es-ES': 'es-ES', 'it-IT': 'it'}
SHORT = {
    'fr-FR': "Le quotidien d’un proche, ses alertes et ses aidants, en toute simplicité.",
    'en-US': "A loved one’s daily routine, alerts and caregivers, simply brought together.",
    'es-ES': "El día a día, los avisos y los cuidadores de un familiar, en un solo lugar.",
    'it-IT': "Quotidianità, avvisi e caregiver di un familiare, riuniti con semplicità.",
}

def token():
    with open(KEY, encoding='utf-8') as f: sa = json.load(f)
    now = int(time.time())
    assertion = jwt.encode({'iss': sa['client_email'], 'scope': 'https://www.googleapis.com/auth/androidpublisher',
                            'aud': sa['token_uri'], 'iat': now, 'exp': now + 3600},
                           sa['private_key'], algorithm='RS256')
    req = urllib.request.Request(sa['token_uri'], method='POST', data=urllib.parse.urlencode({
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}).encode())
    return json.load(urllib.request.urlopen(req))['access_token']

TOK = None
def api(path, method='GET', body=None, raw=None, content_type='application/json'):
    global TOK
    if TOK is None: TOK = token()
    url = (UPLOAD if raw is not None else BASE) + path
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    for attempt in range(5):
        req = urllib.request.Request(url, method=method, data=data, headers={
            'Authorization': 'Bearer ' + TOK, 'Content-Type': content_type})
        try:
            payload = urllib.request.urlopen(req).read()
            return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors='replace')[:1600]
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise RuntimeError(f'{method} {url} -> {exc.code}: {detail}') from exc
            delay = 2 ** attempt
            print(f'transient HTTP {exc.code}; retrying in {delay}s', file=sys.stderr)
            time.sleep(delay)

def full_description(locale):
    src = SOURCE_LOCALE[locale]
    text = (META / src / 'description.txt').read_text(encoding='utf-8').strip()
    substitutions = {
        'fr-FR': [('l’application iPhone', 'l’application Android'), ('sur son iPhone', 'sur son téléphone Android')],
        'en-US': [('the iPhone app', 'the Android app'), ('on iPhone', 'on an Android phone')],
        'es-ES': [('la aplicación para iPhone', 'la aplicación para Android')],
        'it-IT': [("l’app per iPhone", "l’app per Android")],
    }
    for old, new in substitutions[locale]: text = text.replace(old, new)
    return text

def listing(locale):
    result = {'language': locale, 'title': 'Elise OS : Companion',
              'shortDescription': SHORT[locale], 'fullDescription': full_description(locale)}
    limits = {'title': 30, 'shortDescription': 80, 'fullDescription': 4000}
    for field, limit in limits.items():
        if len(result[field]) > limit: raise ValueError(f'{locale} {field}: {len(result[field])}>{limit}')
    return result

def image_plan(locale):
    root = ASSETS / locale
    phone = sorted(glob.glob(str(root / 'phone-*.png')))
    tablet = sorted(glob.glob(str(root / 'tablet-*.png')))
    plan = {'featureGraphic': [str(root / 'featureGraphic.png')], 'phoneScreenshots': phone,
            'sevenInchScreenshots': tablet, 'tenInchScreenshots': tablet}
    if not (4 <= len(phone) <= 8) or not tablet or not Path(plan['featureGraphic'][0]).exists():
        raise ValueError(f'Incomplete assets for {locale}: phone={len(phone)}, tablet={len(tablet)}')
    return plan

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--edit-id', help='resume an existing uncommitted edit')
    p.add_argument('locales', nargs='+', choices=SOURCE_LOCALE)
    args = p.parse_args()
    plans = {loc: (listing(loc), image_plan(loc)) for loc in args.locales}
    for loc, (texts, images) in plans.items():
        print(loc, {k: len(v) for k, v in texts.items() if k != 'language'},
              {kind: len(files) for kind, files in images.items()})
    if args.dry_run:
        print('dry-run: no edit created, no remote changes')
        return
    edit = args.edit_id or api('/edits', 'POST', {})['id']
    print('edit', edit)
    try:
        for loc, (texts, images) in plans.items():
            api(f'/edits/{edit}/listings/{loc}', 'PUT', texts)
            for kind, files in images.items():
                api(f'/edits/{edit}/listings/{loc}/{kind}', 'DELETE')
                for filename in files:
                    data = Path(filename).read_bytes()
                    api(f'/edits/{edit}/listings/{loc}/{kind}?uploadType=media', 'POST', raw=data,
                        content_type='image/png')
                print(loc, kind, len(files), 'uploaded')
        api(f'/edits/{edit}:validate', 'POST', {})
        print('validated', edit)
        try:
            api(f'/edits/{edit}:commit', 'POST', {})
        except RuntimeError as exc:
            if 'changesNotSentForReview' not in str(exc): raise
            api(f'/edits/{edit}:commit?changesNotSentForReview=true', 'POST', {})
        print('committed', edit)
    except Exception:
        print('edit left uncommitted for diagnosis:', edit, file=sys.stderr)
        raise

if __name__ == '__main__': main()
