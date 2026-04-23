"""Idempotent — adds the three signed-out titlebar-prompt keys to every
locale .ts file."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent / "src" / "locales"

KEYS = ["login.promptTitle", "login.promptBody", "login.createAccount"]

EN = {
    "login.promptTitle": "Sign in to Impertio Accounts",
    "login.promptBody": "Clicking Sign in opens your system browser. After you sign in there, this window will pick up the session automatically.",
    "login.createAccount": "Don't have an account? Create one",
}

NATIVE = {
    "nl": (
        "Aanmelden bij Impertio Accounts",
        "Als u op Aanmelden klikt, wordt uw systeembrowser geopend. Nadat u daar bent ingelogd, neemt dit venster de sessie automatisch over.",
        "Nog geen account? Maak er een aan",
    ),
    "en": (EN["login.promptTitle"], EN["login.promptBody"], EN["login.createAccount"]),
    "de": (
        "Bei Impertio Accounts anmelden",
        "Mit einem Klick auf Anmelden öffnet sich Ihr Systembrowser. Sobald Sie dort angemeldet sind, übernimmt dieses Fenster die Sitzung automatisch.",
        "Noch kein Konto? Erstellen Sie eins",
    ),
    "fr": (
        "Se connecter à Impertio Accounts",
        "Cliquer sur Se connecter ouvre votre navigateur système. Une fois connecté, cette fenêtre reprendra automatiquement la session.",
        "Pas encore de compte ? Créez-en un",
    ),
    "es": (
        "Iniciar sesión en Impertio Accounts",
        "Al hacer clic en Iniciar sesión se abrirá su navegador del sistema. Una vez que inicie sesión allí, esta ventana retomará la sesión automáticamente.",
        "¿No tienes cuenta? Crea una",
    ),
    "pt": (
        "Iniciar sessão no Impertio Accounts",
        "Clicar em Iniciar sessão abre o seu navegador do sistema. Depois de iniciar sessão lá, esta janela retomará a sessão automaticamente.",
        "Sem conta? Crie uma",
    ),
    "it": (
        "Accedi a Impertio Accounts",
        "Fare clic su Accedi aprirà il browser di sistema. Una volta effettuato l'accesso, questa finestra riprenderà automaticamente la sessione.",
        "Non hai un account? Creane uno",
    ),
    "pl": (
        "Zaloguj się do Impertio Accounts",
        "Kliknięcie Zaloguj się otworzy przeglądarkę systemową. Po zalogowaniu to okno automatycznie przejmie sesję.",
        "Nie masz konta? Utwórz je",
    ),
    "tr": (
        "Impertio Accounts'a giriş yap",
        "Giriş yap'a tıklamak sistem tarayıcınızı açar. Orada giriş yaptıktan sonra bu pencere oturumu otomatik olarak devralır.",
        "Hesabınız yok mu? Oluşturun",
    ),
    "ru": (
        "Войти в Impertio Accounts",
        "При нажатии Войти откроется системный браузер. После входа это окно автоматически подхватит сессию.",
        "Нет учётной записи? Создайте её",
    ),
    "uk": (
        "Увійти в Impertio Accounts",
        "Натискання Увійти відкриє системний браузер. Після входу це вікно автоматично підхопить сесію.",
        "Немає облікового запису? Створіть",
    ),
    "cs": (
        "Přihlásit se k Impertio Accounts",
        "Kliknutím na Přihlásit se otevřete systémový prohlížeč. Po přihlášení tam toto okno relaci automaticky převezme.",
        "Nemáte účet? Vytvořte si ho",
    ),
    "sk": (
        "Prihlásiť sa k Impertio Accounts",
        "Kliknutím na Prihlásiť sa otvoríte systémový prehliadač. Po prihlásení tam toto okno reláciu automaticky prevezme.",
        "Nemáte účet? Vytvorte si ho",
    ),
    "ro": (
        "Conectare la Impertio Accounts",
        "Făcând clic pe Conectare se va deschide browserul sistemului. După ce vă conectați acolo, această fereastră va prelua automat sesiunea.",
        "Nu aveți cont? Creați unul",
    ),
    "hu": (
        "Bejelentkezés az Impertio Accountsba",
        "A Bejelentkezés gombra kattintva megnyílik a rendszer böngészője. Miután ott bejelentkezett, ez az ablak automatikusan átveszi a munkamenetet.",
        "Nincs fiókja? Hozzon létre egyet",
    ),
    "sv": (
        "Logga in på Impertio Accounts",
        "Om du klickar på Logga in öppnas systemwebbläsaren. När du loggat in där tar det här fönstret automatiskt över sessionen.",
        "Inget konto? Skapa ett",
    ),
    "da": (
        "Log ind på Impertio Accounts",
        "Ved at klikke på Log ind åbnes din systembrowser. Når du er logget ind dér, overtager dette vindue automatisk sessionen.",
        "Ingen konto? Opret en",
    ),
    "no": (
        "Logg inn på Impertio Accounts",
        "Å klikke Logg inn åpner systemnettleseren. Etter at du har logget inn der, tar dette vinduet automatisk over økten.",
        "Ingen konto? Opprett en",
    ),
    "fi": (
        "Kirjaudu Impertio Accountsiin",
        "Napsauttamalla Kirjaudu sisään avaa järjestelmäselaimen. Kun olet kirjautunut siellä, tämä ikkuna ottaa istunnon automaattisesti haltuunsa.",
        "Ei tiliä? Luo yksi",
    ),
    "el": (
        "Σύνδεση στο Impertio Accounts",
        "Κάνοντας κλικ στο Σύνδεση θα ανοίξει το πρόγραμμα περιήγησης του συστήματος. Αφού συνδεθείτε εκεί, αυτό το παράθυρο θα αναλάβει αυτόματα τη συνεδρία.",
        "Δεν έχετε λογαριασμό; Δημιουργήστε έναν",
    ),
    "bg": (
        "Влизане в Impertio Accounts",
        "Кликването върху Влизане отваря системния браузър. След като влезете там, този прозорец автоматично ще поеме сесията.",
        "Нямате акаунт? Създайте го",
    ),
    "hr": (
        "Prijava na Impertio Accounts",
        "Klikom na Prijava otvara se vaš sustav preglednik. Nakon prijave tamo, ovaj prozor automatski preuzima sesiju.",
        "Nemate račun? Stvorite ga",
    ),
    "zh": (
        "登录 Impertio Accounts",
        "点击登录将打开您的系统浏览器。在那里登录后，此窗口将自动接管会话。",
        "没有账户？创建一个",
    ),
    "ja": (
        "Impertio Accounts にサインイン",
        "サインインをクリックするとシステムブラウザが開きます。そこでサインインすると、このウィンドウが自動的にセッションを引き継ぎます。",
        "アカウントをお持ちでない? 作成する",
    ),
    "ko": (
        "Impertio Accounts에 로그인",
        "로그인을 클릭하면 시스템 브라우저가 열립니다. 그곳에서 로그인하면 이 창이 자동으로 세션을 이어받습니다.",
        "계정이 없으신가요? 만들기",
    ),
}


def has_key(content: str, key: str) -> bool:
    return re.search(rf'"{re.escape(key)}"\s*:', content) is not None


def insert_before_export(content: str, lines: list[str]) -> str:
    closer = re.compile(r'(\n)(\};\s*\n\s*export default)', re.MULTILINE)
    block = "\n".join(lines)
    new, n = closer.subn(lambda m: "\n" + block + m.group(1) + m.group(2), content, count=1)
    if n == 0:
        raise RuntimeError("no trailing `};\\nexport default` anchor found")
    return new


def safe(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def apply(locale: str) -> int:
    path = ROOT / f"{locale}.ts"
    if not path.exists():
        return 0
    content = path.read_text(encoding="utf-8")
    strings = NATIVE.get(locale)
    if strings is None:
        strings = tuple(EN[k] for k in KEYS)

    to_insert: list[str] = []
    for key, value in zip(KEYS, strings):
        if not has_key(content, key):
            to_insert.append(f'  "{key}": "{safe(value)}",')
    if not to_insert:
        return 0

    content = insert_before_export(content, to_insert)
    path.write_text(content, encoding="utf-8")
    return len(to_insert)


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
