"""One-shot: inject login.* keys into every locale file. Idempotent."""
import os, re, sys

TRANSLATIONS = {
    "de": {
        "subtitle": "Melde dich mit deinem Impertio-Konto an",
        "signIn": "Anmelden",
        "signUp": "Konto erstellen",
        "loading": "Browser wird geöffnet…",
        "browserHint": "Dein Browser öffnet sich, um die Anmeldung abzuschließen.",
        "notConfigured": "Anmeldung nicht konfiguriert — frage den Betreiber nach der client_id und trage sie in src-tauri/src/auth.rs ein.",
        "signedInAs": "Angemeldet als",
        "signOut": "Abmelden",
    },
    "fr": {
        "subtitle": "Connectez-vous avec votre compte Impertio",
        "signIn": "Se connecter",
        "signUp": "Créer un compte",
        "loading": "Ouverture du navigateur…",
        "browserHint": "Votre navigateur s'ouvrira pour finaliser la connexion.",
        "notConfigured": "Connexion non configurée — demandez le client_id à l'opérateur et renseignez-le dans src-tauri/src/auth.rs.",
        "signedInAs": "Connecté en tant que",
        "signOut": "Se déconnecter",
    },
    "es": {
        "subtitle": "Inicia sesión con tu cuenta de Impertio",
        "signIn": "Iniciar sesión",
        "signUp": "Crear cuenta",
        "loading": "Abriendo el navegador…",
        "browserHint": "Se abrirá tu navegador para completar el inicio de sesión.",
        "notConfigured": "Inicio de sesión no configurado — pide el client_id al operador y escríbelo en src-tauri/src/auth.rs.",
        "signedInAs": "Conectado como",
        "signOut": "Cerrar sesión",
    },
    "pt": {
        "subtitle": "Entre com sua conta Impertio",
        "signIn": "Entrar",
        "signUp": "Criar conta",
        "loading": "Abrindo o navegador…",
        "browserHint": "Seu navegador abrirá para concluir o login.",
        "notConfigured": "Login não configurado — peça o client_id ao operador e coloque em src-tauri/src/auth.rs.",
        "signedInAs": "Conectado como",
        "signOut": "Sair",
    },
    "it": {
        "subtitle": "Accedi con il tuo account Impertio",
        "signIn": "Accedi",
        "signUp": "Crea account",
        "loading": "Apertura del browser…",
        "browserHint": "Il browser si aprirà per completare l'accesso.",
        "notConfigured": "Accesso non configurato — chiedi il client_id all'operatore e inseriscilo in src-tauri/src/auth.rs.",
        "signedInAs": "Accesso effettuato come",
        "signOut": "Esci",
    },
    "pl": {
        "subtitle": "Zaloguj się kontem Impertio",
        "signIn": "Zaloguj się",
        "signUp": "Utwórz konto",
        "loading": "Otwieram przeglądarkę…",
        "browserHint": "Otworzy się przeglądarka, aby dokończyć logowanie.",
        "notConfigured": "Logowanie nie skonfigurowane — poproś operatora o client_id i wpisz go w src-tauri/src/auth.rs.",
        "signedInAs": "Zalogowano jako",
        "signOut": "Wyloguj się",
    },
    "ru": {
        "subtitle": "Войдите с аккаунтом Impertio",
        "signIn": "Войти",
        "signUp": "Создать аккаунт",
        "loading": "Открываем браузер…",
        "browserHint": "Откроется браузер для завершения входа.",
        "notConfigured": "Вход не настроен — запросите client_id у оператора и укажите его в src-tauri/src/auth.rs.",
        "signedInAs": "Вы вошли как",
        "signOut": "Выйти",
    },
    "tr": {
        "subtitle": "Impertio hesabınla oturum aç",
        "signIn": "Oturum aç",
        "signUp": "Hesap oluştur",
        "loading": "Tarayıcı açılıyor…",
        "browserHint": "Oturum açmayı tamamlamak için tarayıcı açılacak.",
        "notConfigured": "Oturum açma yapılandırılmadı — operatörden client_id iste ve src-tauri/src/auth.rs dosyasına gir.",
        "signedInAs": "Oturum açıldı:",
        "signOut": "Çıkış yap",
    },
    "zh": {
        "subtitle": "使用 Impertio 账号登录",
        "signIn": "登录",
        "signUp": "创建账号",
        "loading": "正在打开浏览器…",
        "browserHint": "将打开浏览器以完成登录。",
        "notConfigured": "登录未配置 — 向运营方索取 client_id，并填入 src-tauri/src/auth.rs。",
        "signedInAs": "已登录:",
        "signOut": "退出登录",
    },
    "ja": {
        "subtitle": "Impertio アカウントでサインイン",
        "signIn": "サインイン",
        "signUp": "アカウント作成",
        "loading": "ブラウザを開いています…",
        "browserHint": "サインインを完了するためにブラウザが開きます。",
        "notConfigured": "サインインが未設定です — 運営者から client_id を取得し、src-tauri/src/auth.rs に記入してください。",
        "signedInAs": "サインイン中:",
        "signOut": "サインアウト",
    },
    "ko": {
        "subtitle": "Impertio 계정으로 로그인",
        "signIn": "로그인",
        "signUp": "계정 만들기",
        "loading": "브라우저를 여는 중…",
        "browserHint": "로그인을 완료하려면 브라우저가 열립니다.",
        "notConfigured": "로그인이 설정되지 않았습니다 — 운영자에게 client_id를 받아 src-tauri/src/auth.rs에 입력하세요.",
        "signedInAs": "로그인됨:",
        "signOut": "로그아웃",
    },
    "uk": {
        "subtitle": "Увійдіть в обліковий запис Impertio",
        "signIn": "Увійти",
        "signUp": "Створити обліковий запис",
        "loading": "Відкриваємо браузер…",
        "browserHint": "Відкриється браузер для завершення входу.",
        "notConfigured": "Вхід не налаштовано — запитайте client_id в оператора й додайте його в src-tauri/src/auth.rs.",
        "signedInAs": "Ви увійшли як",
        "signOut": "Вийти",
    },
    "cs": {
        "subtitle": "Přihlaste se účtem Impertio",
        "signIn": "Přihlásit se",
        "signUp": "Vytvořit účet",
        "loading": "Otevírám prohlížeč…",
        "browserHint": "Otevře se prohlížeč pro dokončení přihlášení.",
        "notConfigured": "Přihlášení není nakonfigurováno — vyžádejte client_id od operátora a vyplňte ho v src-tauri/src/auth.rs.",
        "signedInAs": "Přihlášen jako",
        "signOut": "Odhlásit se",
    },
    "ro": {
        "subtitle": "Conectează-te cu contul Impertio",
        "signIn": "Conectare",
        "signUp": "Creează cont",
        "loading": "Se deschide browserul…",
        "browserHint": "Se va deschide browserul pentru a finaliza conectarea.",
        "notConfigured": "Conectarea nu este configurată — cere client_id de la operator și completează-l în src-tauri/src/auth.rs.",
        "signedInAs": "Conectat ca",
        "signOut": "Deconectare",
    },
    "hu": {
        "subtitle": "Jelentkezz be az Impertio fiókoddal",
        "signIn": "Bejelentkezés",
        "signUp": "Fiók létrehozása",
        "loading": "Böngésző megnyitása…",
        "browserHint": "A böngésző megnyílik a bejelentkezés befejezéséhez.",
        "notConfigured": "A bejelentkezés nincs beállítva — kérd a client_id értékét az üzemeltetőtől, és írd be a src-tauri/src/auth.rs fájlba.",
        "signedInAs": "Bejelentkezve mint",
        "signOut": "Kijelentkezés",
    },
    "sv": {
        "subtitle": "Logga in med ditt Impertio-konto",
        "signIn": "Logga in",
        "signUp": "Skapa konto",
        "loading": "Öppnar webbläsaren…",
        "browserHint": "Din webbläsare öppnas för att slutföra inloggningen.",
        "notConfigured": "Inloggning inte konfigurerad — be operatören om client_id och lägg in den i src-tauri/src/auth.rs.",
        "signedInAs": "Inloggad som",
        "signOut": "Logga ut",
    },
    "da": {
        "subtitle": "Log ind med din Impertio-konto",
        "signIn": "Log ind",
        "signUp": "Opret konto",
        "loading": "Åbner browseren…",
        "browserHint": "Din browser åbnes for at fuldføre login.",
        "notConfigured": "Login ikke konfigureret — bed operatøren om client_id og indsæt den i src-tauri/src/auth.rs.",
        "signedInAs": "Logget ind som",
        "signOut": "Log ud",
    },
    "no": {
        "subtitle": "Logg inn med Impertio-kontoen din",
        "signIn": "Logg inn",
        "signUp": "Opprett konto",
        "loading": "Åpner nettleseren…",
        "browserHint": "Nettleseren åpnes for å fullføre innloggingen.",
        "notConfigured": "Innlogging er ikke konfigurert — be operatøren om client_id og legg den inn i src-tauri/src/auth.rs.",
        "signedInAs": "Logget inn som",
        "signOut": "Logg ut",
    },
    "fi": {
        "subtitle": "Kirjaudu Impertio-tilillä",
        "signIn": "Kirjaudu sisään",
        "signUp": "Luo tili",
        "loading": "Avataan selainta…",
        "browserHint": "Selain avautuu kirjautumisen viimeistelemiseksi.",
        "notConfigured": "Kirjautumista ei ole määritetty — pyydä client_id operaattorilta ja lisää se tiedostoon src-tauri/src/auth.rs.",
        "signedInAs": "Kirjautunut käyttäjänä",
        "signOut": "Kirjaudu ulos",
    },
    "el": {
        "subtitle": "Συνδεθείτε με τον λογαριασμό σας Impertio",
        "signIn": "Σύνδεση",
        "signUp": "Δημιουργία λογαριασμού",
        "loading": "Άνοιγμα προγράμματος περιήγησης…",
        "browserHint": "Το πρόγραμμα περιήγησης θα ανοίξει για να ολοκληρωθεί η σύνδεση.",
        "notConfigured": "Η σύνδεση δεν έχει ρυθμιστεί — ζητήστε το client_id από τον διαχειριστή και συμπληρώστε το στο src-tauri/src/auth.rs.",
        "signedInAs": "Συνδεδεμένος ως",
        "signOut": "Αποσύνδεση",
    },
    "bg": {
        "subtitle": "Влезте с вашия акаунт в Impertio",
        "signIn": "Вход",
        "signUp": "Създаване на акаунт",
        "loading": "Отваряне на браузъра…",
        "browserHint": "Браузърът ще се отвори, за да завършите входа.",
        "notConfigured": "Входът не е конфигуриран — поискайте client_id от оператора и го впишете в src-tauri/src/auth.rs.",
        "signedInAs": "Влезли сте като",
        "signOut": "Изход",
    },
    "hr": {
        "subtitle": "Prijavite se računom Impertio",
        "signIn": "Prijava",
        "signUp": "Stvori račun",
        "loading": "Otvaranje preglednika…",
        "browserHint": "Otvorit će se preglednik za dovršetak prijave.",
        "notConfigured": "Prijava nije konfigurirana — zatražite client_id od operatera i unesite ga u src-tauri/src/auth.rs.",
        "signedInAs": "Prijavljeni kao",
        "signOut": "Odjava",
    },
    "sk": {
        "subtitle": "Prihláste sa účtom Impertio",
        "signIn": "Prihlásiť sa",
        "signUp": "Vytvoriť účet",
        "loading": "Otváranie prehliadača…",
        "browserHint": "Otvorí sa prehliadač na dokončenie prihlásenia.",
        "notConfigured": "Prihlásenie nie je nakonfigurované — vyžiadajte si client_id od operátora a vyplňte ho v src-tauri/src/auth.rs.",
        "signedInAs": "Prihlásený ako",
        "signOut": "Odhlásiť sa",
    },
}

LOCALES_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "locales")

def block_for(keys):
    def q(s): return s.replace("\\", "\\\\").replace('"', '\\"')
    lines = [
        "",
        "  // ── Login ───────────────────────────────",
        f'  "login.subtitle": "{q(keys["subtitle"])}",',
        f'  "login.signIn": "{q(keys["signIn"])}",',
        f'  "login.signUp": "{q(keys["signUp"])}",',
        f'  "login.loading": "{q(keys["loading"])}",',
        f'  "login.browserHint": "{q(keys["browserHint"])}",',
        f'  "login.notConfigured": "{q(keys["notConfigured"])}",',
        f'  "login.signedInAs": "{q(keys["signedInAs"])}",',
        f'  "login.signOut": "{q(keys["signOut"])}",',
    ]
    return "\n".join(lines) + "\n"

def process(locale, keys):
    path = os.path.join(LOCALES_DIR, f"{locale}.ts")
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    if '"login.signIn"' in src:
        return "skipped (already present)"
    # Insert before the `};` that closes the object literal.
    m = re.search(r"\n\};\s*\n\s*export default " + locale + r";\s*\n?$", src)
    if not m:
        return "no closing pattern found"
    new_src = src[:m.start()] + "\n" + block_for(keys) + "};\n\nexport default " + locale + ";\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    return "ok"

def main():
    results = []
    for locale, keys in TRANSLATIONS.items():
        try:
            r = process(locale, keys)
        except Exception as e:
            r = f"ERROR: {e}"
        results.append((locale, r))
    for loc, r in results:
        print(f"{loc}: {r}")

if __name__ == "__main__":
    main()
