"""
One-shot script to add v2 i18n keys (login account menu + app-config discovery
hint/placeholder) to all locale files.

Idempotent: keys that already exist are left untouched; missing ones are
inserted immediately after a well-known anchor key so the file stays
grouped by section.
"""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent / "src" / "locales"

# ── Translations ─────────────────────────────────────────────

# Each locale → dict of new key → value. Same shape for all locales.
DATA = {
    "nl": {
        "settings.remoteServerUrlPlaceholder": "Automatisch detecteren (leeg laten)",
        "settings.remoteServerUrlHint": "Laat leeg om automatisch te detecteren via uw ingelogde account. Vul alleen een URL in voor zelf-gehoste of ontwikkelservers.",
        "login.plan": "Abonnement",
        "login.planFree": "Gratis",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "credits",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Reset op {date}",
        "login.upgrade": "Upgraden",
        "login.manageAccount": "Account beheren",
    },
    "de": {
        "settings.remoteServerUrlPlaceholder": "Automatisch erkennen (leer lassen)",
        "settings.remoteServerUrlHint": "Leer lassen, um über Ihr angemeldetes Konto automatisch zu erkennen. Nur für selbst gehostete oder Entwicklungsserver eine URL angeben.",
        "login.plan": "Tarif",
        "login.planFree": "Kostenlos",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "Credits",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Zurückgesetzt am {date}",
        "login.upgrade": "Upgrade",
        "login.manageAccount": "Konto verwalten",
    },
    "fr": {
        "settings.remoteServerUrlPlaceholder": "Découverte auto (laisser vide)",
        "settings.remoteServerUrlHint": "Laissez vide pour une découverte automatique via votre compte connecté. Définissez une URL uniquement pour les serveurs auto-hébergés ou de développement.",
        "login.plan": "Forfait",
        "login.planFree": "Gratuit",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "crédits",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Réinitialisation le {date}",
        "login.upgrade": "Passer à supérieur",
        "login.manageAccount": "Gérer le compte",
    },
    "es": {
        "settings.remoteServerUrlPlaceholder": "Detección automática (dejar vacío)",
        "settings.remoteServerUrlHint": "Déjelo vacío para detectar automáticamente a través de su cuenta conectada. Establezca una URL solo para servidores auto-alojados o de desarrollo.",
        "login.plan": "Plan",
        "login.planFree": "Gratis",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "créditos",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Se reinicia el {date}",
        "login.upgrade": "Mejorar",
        "login.manageAccount": "Gestionar cuenta",
    },
    "pt": {
        "settings.remoteServerUrlPlaceholder": "Detecção automática (deixar vazio)",
        "settings.remoteServerUrlHint": "Deixe vazio para detecção automática através da sua conta. Defina um URL apenas para servidores auto-hospedados ou de desenvolvimento.",
        "login.plan": "Plano",
        "login.planFree": "Grátis",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "créditos",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Reinicia em {date}",
        "login.upgrade": "Fazer upgrade",
        "login.manageAccount": "Gerir conta",
    },
    "it": {
        "settings.remoteServerUrlPlaceholder": "Rilevamento automatico (lascia vuoto)",
        "settings.remoteServerUrlHint": "Lascia vuoto per il rilevamento automatico tramite il tuo account. Imposta un URL solo per server self-hosted o di sviluppo.",
        "login.plan": "Piano",
        "login.planFree": "Gratuito",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "crediti",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Azzeramento il {date}",
        "login.upgrade": "Aggiorna",
        "login.manageAccount": "Gestisci account",
    },
    "pl": {
        "settings.remoteServerUrlPlaceholder": "Automatyczne wykrywanie (zostaw puste)",
        "settings.remoteServerUrlHint": "Zostaw puste, aby automatycznie wykryć przez zalogowane konto. Ustaw URL tylko dla serwerów samodzielnie hostowanych lub deweloperskich.",
        "login.plan": "Plan",
        "login.planFree": "Darmowy",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "kredyty",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Reset {date}",
        "login.upgrade": "Ulepsz",
        "login.manageAccount": "Zarządzaj kontem",
    },
    "tr": {
        "settings.remoteServerUrlPlaceholder": "Otomatik keşif (boş bırakın)",
        "settings.remoteServerUrlHint": "Giriş yaptığınız hesap üzerinden otomatik keşif için boş bırakın. URL'yi yalnızca kendi barandırdığınız veya geliştirme sunucuları için belirtin.",
        "login.plan": "Plan",
        "login.planFree": "Ücretsiz",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "kredi",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Sıfırlanma: {date}",
        "login.upgrade": "Yükselt",
        "login.manageAccount": "Hesabı yönet",
    },
    "ru": {
        "settings.remoteServerUrlPlaceholder": "Автообнаружение (оставьте пустым)",
        "settings.remoteServerUrlHint": "Оставьте пустым для автообнаружения через вашу учётную запись. Указывайте URL только для самостоятельно размещённых или разработческих серверов.",
        "login.plan": "Тариф",
        "login.planFree": "Бесплатный",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "кредиты",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Обновление {date}",
        "login.upgrade": "Улучшить",
        "login.manageAccount": "Управление аккаунтом",
    },
    "uk": {
        "settings.remoteServerUrlPlaceholder": "Автовиявлення (залиште порожнім)",
        "settings.remoteServerUrlHint": "Залиште порожнім для автовиявлення через ваш обліковий запис. URL вказуйте лише для самостійно розміщених або розробницьких серверів.",
        "login.plan": "Тариф",
        "login.planFree": "Безкоштовний",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "кредити",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Оновлення {date}",
        "login.upgrade": "Оновити",
        "login.manageAccount": "Керувати обліковим записом",
    },
    "cs": {
        "settings.remoteServerUrlPlaceholder": "Automaticky zjistit (ponechat prázdné)",
        "settings.remoteServerUrlHint": "Ponechte prázdné pro automatické zjištění prostřednictvím vašeho přihlášeného účtu. URL nastavte pouze pro vlastní nebo vývojové servery.",
        "login.plan": "Plán",
        "login.planFree": "Zdarma",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "kredity",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Obnovení {date}",
        "login.upgrade": "Upgradovat",
        "login.manageAccount": "Spravovat účet",
    },
    "sk": {
        "settings.remoteServerUrlPlaceholder": "Automaticky zistiť (ponechať prázdne)",
        "settings.remoteServerUrlHint": "Ponechajte prázdne pre automatické zistenie prostredníctvom vášho prihláseného účtu. URL nastavte iba pre vlastné alebo vývojové servery.",
        "login.plan": "Plán",
        "login.planFree": "Zdarma",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "kredity",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Obnovenie {date}",
        "login.upgrade": "Vylepšiť",
        "login.manageAccount": "Spravovať účet",
    },
    "ro": {
        "settings.remoteServerUrlPlaceholder": "Detectare automată (lăsați gol)",
        "settings.remoteServerUrlHint": "Lăsați gol pentru detectare automată prin contul conectat. Setați o adresă URL doar pentru servere găzduite personal sau de dezvoltare.",
        "login.plan": "Plan",
        "login.planFree": "Gratuit",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "credite",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Resetare {date}",
        "login.upgrade": "Actualizează",
        "login.manageAccount": "Gestionează contul",
    },
    "hu": {
        "settings.remoteServerUrlPlaceholder": "Automatikus felismerés (hagyja üresen)",
        "settings.remoteServerUrlHint": "Hagyja üresen a bejelentkezett fiókon keresztüli automatikus felismeréshez. URL-t csak saját üzemeltetésű vagy fejlesztői szerverekhez adjon meg.",
        "login.plan": "Csomag",
        "login.planFree": "Ingyenes",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "kreditek",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Visszaállítás: {date}",
        "login.upgrade": "Frissítés",
        "login.manageAccount": "Fiók kezelése",
    },
    "sv": {
        "settings.remoteServerUrlPlaceholder": "Automatisk upptäckt (lämna tomt)",
        "settings.remoteServerUrlHint": "Lämna tomt för automatisk upptäckt via ditt inloggade konto. Ange endast en URL för självhostade eller utvecklingsservrar.",
        "login.plan": "Plan",
        "login.planFree": "Gratis",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "krediter",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Återställs {date}",
        "login.upgrade": "Uppgradera",
        "login.manageAccount": "Hantera konto",
    },
    "da": {
        "settings.remoteServerUrlPlaceholder": "Automatisk opdagelse (lad stå tomt)",
        "settings.remoteServerUrlHint": "Lad stå tomt for automatisk opdagelse via din tilknyttede konto. Angiv kun en URL for selv-hostede eller udviklingsservere.",
        "login.plan": "Abonnement",
        "login.planFree": "Gratis",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "kreditter",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Nulstilles {date}",
        "login.upgrade": "Opgrader",
        "login.manageAccount": "Administrer konto",
    },
    "no": {
        "settings.remoteServerUrlPlaceholder": "Automatisk oppdagelse (la stå tom)",
        "settings.remoteServerUrlHint": "La stå tom for automatisk oppdagelse via din påloggede konto. Angi kun en URL for selvhostede eller utviklingsservere.",
        "login.plan": "Abonnement",
        "login.planFree": "Gratis",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "kreditter",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Tilbakestilles {date}",
        "login.upgrade": "Oppgrader",
        "login.manageAccount": "Administrer konto",
    },
    "fi": {
        "settings.remoteServerUrlPlaceholder": "Automaattinen tunnistus (jätä tyhjäksi)",
        "settings.remoteServerUrlHint": "Jätä tyhjäksi automaattiseen tunnistukseen kirjautuneen tilisi kautta. Aseta URL vain itse isännöimille tai kehityspalvelimille.",
        "login.plan": "Tilaus",
        "login.planFree": "Ilmainen",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "krediittejä",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Nollautuu {date}",
        "login.upgrade": "Päivitä",
        "login.manageAccount": "Hallitse tiliä",
    },
    "el": {
        "settings.remoteServerUrlPlaceholder": "Αυτόματη ανακάλυψη (αφήστε κενό)",
        "settings.remoteServerUrlHint": "Αφήστε κενό για αυτόματη ανακάλυψη μέσω του συνδεδεμένου λογαριασμού σας. Ορίστε URL μόνο για αυτο-φιλοξενούμενους ή διακομιστές ανάπτυξης.",
        "login.plan": "Πλάνο",
        "login.planFree": "Δωρεάν",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "πιστώσεις",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Επαναφορά {date}",
        "login.upgrade": "Αναβάθμιση",
        "login.manageAccount": "Διαχείριση λογαριασμού",
    },
    "bg": {
        "settings.remoteServerUrlPlaceholder": "Автоматично откриване (оставете празно)",
        "settings.remoteServerUrlHint": "Оставете празно за автоматично откриване чрез влезлия ви акаунт. Задайте URL само за самостоятелно хостнати или сървъри за разработка.",
        "login.plan": "План",
        "login.planFree": "Безплатен",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "кредити",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Нулиране {date}",
        "login.upgrade": "Надстройте",
        "login.manageAccount": "Управление на акаунта",
    },
    "hr": {
        "settings.remoteServerUrlPlaceholder": "Automatsko otkrivanje (ostavite prazno)",
        "settings.remoteServerUrlHint": "Ostavite prazno za automatsko otkrivanje putem vašeg prijavljenog računa. URL postavite samo za vlastito hostane ili razvojne poslužitelje.",
        "login.plan": "Plan",
        "login.planFree": "Besplatan",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "krediti",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "Resetira se {date}",
        "login.upgrade": "Nadogradi",
        "login.manageAccount": "Upravljaj računom",
    },
    "zh": {
        "settings.remoteServerUrlPlaceholder": "自动发现（留空）",
        "settings.remoteServerUrlHint": "留空以通过已登录账户自动发现。仅为自托管或开发服务器设置 URL。",
        "login.plan": "方案",
        "login.planFree": "免费",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "积分",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "{date} 重置",
        "login.upgrade": "升级",
        "login.manageAccount": "管理账户",
    },
    "ja": {
        "settings.remoteServerUrlPlaceholder": "自動検出（空のまま）",
        "settings.remoteServerUrlHint": "サインインしているアカウント経由で自動検出するには空のままにしてください。セルフホストまたは開発サーバーの場合のみ URL を設定してください。",
        "login.plan": "プラン",
        "login.planFree": "無料",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "クレジット",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "{date} にリセット",
        "login.upgrade": "アップグレード",
        "login.manageAccount": "アカウント管理",
    },
    "ko": {
        "settings.remoteServerUrlPlaceholder": "자동 검색 (비워 두기)",
        "settings.remoteServerUrlHint": "로그인한 계정을 통해 자동으로 검색하려면 비워 두세요. 자체 호스팅 또는 개발 서버에만 URL을 설정하세요.",
        "login.plan": "요금제",
        "login.planFree": "무료",
        "login.planPro": "Pro",
        "login.planStudio": "Studio",
        "login.credits": "크레딧",
        "login.creditsValue": "{n}",
        "login.creditsResetsAt": "{date}에 재설정",
        "login.upgrade": "업그레이드",
        "login.manageAccount": "계정 관리",
    },
}


def has_key(content: str, key: str) -> bool:
    # Match the exact key on a line with an opening quote and colon.
    return re.search(rf'"{re.escape(key)}"\s*:', content) is not None


def insert_after_key(content: str, anchor_key: str, new_lines: list[str]) -> str:
    """Insert `new_lines` right after the line containing `"anchor_key": "..."`."""
    pattern = rf'("{re.escape(anchor_key)}"\s*:\s*"[^"]*"\s*,)'
    replacement = r'\1' + "\n" + "\n".join(new_lines)
    new_content, n = re.subn(pattern, replacement, content, count=1)
    if n == 0:
        raise RuntimeError(f"anchor key {anchor_key!r} not found")
    return new_content


def format_entry(key: str, value: str) -> str:
    # Escape any embedded double quotes and backslashes
    safe = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'  "{key}": "{safe}",'


def apply(locale: str, entries: dict[str, str]) -> None:
    path = ROOT / f"{locale}.ts"
    content = path.read_text(encoding="utf-8")

    # Split into login.* vs settings.* and bucket to be inserted after their
    # respective anchor keys, preserving insertion order.
    login_entries = [(k, v) for k, v in entries.items() if k.startswith("login.") and not has_key(content, k)]
    settings_entries = [(k, v) for k, v in entries.items() if k.startswith("settings.") and not has_key(content, k)]

    if settings_entries and has_key(content, "settings.remoteServerUrl"):
        content = insert_after_key(
            content,
            "settings.remoteServerUrl",
            [format_entry(k, v) for k, v in settings_entries],
        )
    elif settings_entries:
        # This locale doesn't translate the remoteServer* group at all —
        # let the i18n English fallback handle it for now.
        print(f"  (skipping settings.* inserts — anchor not present)")

    if login_entries:
        content = insert_after_key(
            content,
            "login.signOut",
            [format_entry(k, v) for k, v in login_entries],
        )

    path.write_text(content, encoding="utf-8")
    added = len(login_entries) + len(settings_entries)
    print(f"{locale}: +{added} keys")


def main() -> None:
    for locale, entries in DATA.items():
        apply(locale, entries)


if __name__ == "__main__":
    main()
