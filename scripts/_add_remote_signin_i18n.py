"""Idempotent — adds `settings.remoteServerSignInHint` and
`settings.remoteServerSignInBtn` keys to every locale .ts file.

Keys land after the existing `settings.remoteServerEnabledHint` line so
the related strings stay grouped.
"""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent / "src" / "locales"

HINT = "settings.remoteServerSignInHint"
BTN = "settings.remoteServerSignInBtn"

EN_HINT = "Sign in to enable cloud transcription."
EN_BTN = "Sign in"

NATIVE = {
    # nl/en already updated by hand — keep for idempotence
    "nl": ("Meld u aan om cloudtranscriptie in te schakelen.", "Aanmelden"),
    "en": (EN_HINT, EN_BTN),
    "de": ("Melden Sie sich an, um Cloud-Transkription zu aktivieren.", "Anmelden"),
    "fr": ("Connectez-vous pour activer la transcription dans le cloud.", "Se connecter"),
    "es": ("Inicia sesión para habilitar la transcripción en la nube.", "Iniciar sesión"),
    "pt": ("Inicie sessão para ativar a transcrição na nuvem.", "Iniciar sessão"),
    "it": ("Accedi per abilitare la trascrizione cloud.", "Accedi"),
    "pl": ("Zaloguj się, aby włączyć transkrypcję w chmurze.", "Zaloguj się"),
    "tr": ("Bulut transkripsiyonunu etkinleştirmek için giriş yapın.", "Giriş yap"),
    "ru": ("Войдите, чтобы включить облачную транскрипцию.", "Войти"),
    "uk": ("Увійдіть, щоб увімкнути хмарну транскрипцію.", "Увійти"),
    "cs": ("Přihlaste se pro povolení cloudové transkripce.", "Přihlásit se"),
    "sk": ("Prihláste sa pre povolenie cloudovej transkripcie.", "Prihlásiť sa"),
    "ro": ("Conectați-vă pentru a activa transcrierea în cloud.", "Conectare"),
    "hu": ("Jelentkezzen be a felhő-átírás engedélyezéséhez.", "Bejelentkezés"),
    "sv": ("Logga in för att aktivera molntranskribering.", "Logga in"),
    "da": ("Log ind for at aktivere cloud-transskribering.", "Log ind"),
    "no": ("Logg inn for å aktivere sky-transkribering.", "Logg inn"),
    "fi": ("Kirjaudu sisään ottaaksesi käyttöön pilvitranskription.", "Kirjaudu sisään"),
    "el": ("Συνδεθείτε για να ενεργοποιήσετε τη μεταγραφή στο cloud.", "Σύνδεση"),
    "bg": ("Влезте, за да активирате облачна транскрипция.", "Влизане"),
    "hr": ("Prijavite se za omogućavanje transkripcije u oblaku.", "Prijavi se"),
    "zh": ("登录以启用云端转录。", "登录"),
    "ja": ("クラウド文字起こしを有効にするにはサインインしてください。", "サインイン"),
    "ko": ("클라우드 전사를 활성화하려면 로그인하세요.", "로그인"),
}


def has_key(content: str, key: str) -> bool:
    return re.search(rf'"{re.escape(key)}"\s*:', content) is not None


def insert_keys(content: str, hint: str, btn: str) -> str:
    """Insert after `settings.remoteServerEnabledHint` if present (en/nl only);
    otherwise insert immediately before the closing `};` of the locale file."""
    safe_hint = hint.replace("\\", "\\\\").replace('"', '\\"')
    safe_btn = btn.replace("\\", "\\\\").replace('"', '\\"')
    block = f'  "{HINT}": "{safe_hint}",\n  "{BTN}": "{safe_btn}",'

    anchor = re.compile(r'("settings\.remoteServerEnabledHint"\s*:\s*"[^"]*"\s*,)')
    if anchor.search(content):
        return anchor.sub(lambda m: m.group(1) + "\n" + block, content, count=1)

    # Fall back: insert before the `};` that closes the locale object.
    # Locale files look like:
    #     const bg: Record<string, string> = {
    #       "key": "value",
    #       ...
    #     };
    #     export default bg;
    # We match the `};` that's followed by `export default <name>;`.
    closer = re.compile(r'(\n)(\};\s*\n\s*export default)', re.MULTILINE)
    new, n = closer.subn(lambda m: "\n" + block + m.group(1) + m.group(2), content, count=1)
    if n == 0:
        raise RuntimeError("could not find closing `};` before `export default`")
    return new


def apply(locale: str) -> int:
    path = ROOT / f"{locale}.ts"
    if not path.exists():
        return 0
    content = path.read_text(encoding="utf-8")
    if has_key(content, HINT):
        return 0
    hint, btn = NATIVE.get(locale, (EN_HINT, EN_BTN))
    content = insert_keys(content, hint, btn)
    path.write_text(content, encoding="utf-8")
    return 2


def main() -> None:
    total = 0
    for p in sorted(ROOT.glob("*.ts")):
        n = apply(p.stem)
        if n:
            total += n
            print(f"{p.stem}: +{n}")
    print(f"total keys added: {total}")


if __name__ == "__main__":
    main()
