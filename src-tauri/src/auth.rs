// OIDC login (Authorization Code + PKCE) for Impertio Accounts.
//
// Operator values you must fill in below (search for "// OPERATOR:"):
//   - CLIENT_ID: registered public client id for this desktop app
//   - REDIRECT_URI port must be registered with the operator exactly.
//
// Tokens persist in tauri-plugin-store under "auth.json".

use base64::Engine as _;
use oauth2::basic::BasicClient;
use oauth2::{AuthUrl, ClientId, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope, TokenUrl};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex as AsyncMutex;

// ── Operator-supplied config ────────────────────────────────
const ISSUER: &str = "https://account.impertio.app";
const DISCOVERY_URL: &str = "https://account.impertio.app/.well-known/openid-configuration";
const AUTH_ENDPOINT: &str = "https://account.impertio.app/oauth/authorize";
const TOKEN_ENDPOINT: &str = "https://account.impertio.app/oauth/token";

// Public client id registered for this desktop app on the Impertio Accounts
// platform. Not a secret.
const CLIENT_ID: &str = "impertio_1jUhRbtdb-OA";

// OPERATOR: this exact URL must be registered as an allowed redirect URI.
const REDIRECT_PORT: u16 = 53682;
const REDIRECT_PATH: &str = "/oauth/callback";

const SCOPES: &[&str] = &["openid", "email", "profile", "offline_access"];

const STORE_FILE: &str = "auth.json";
const STORE_KEY_TOKENS: &str = "tokens";

// ── Stored token bundle ─────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTokens {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_at: u64, // unix seconds
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
}

// ── Public API ──────────────────────────────────────────────

#[tauri::command]
pub fn auth_is_configured() -> bool {
    !CLIENT_ID.starts_with("__REPLACE")
}

#[tauri::command]
pub async fn auth_login<R: Runtime>(app: AppHandle<R>) -> Result<UserProfile, String> {
    log::info!("[auth] login start");
    if !auth_is_configured() {
        return Err("client_id not configured — edit src-tauri/src/auth.rs".into());
    }

    let client = oauth_client()?;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let mut auth_builder = client
        .authorize_url(CsrfToken::new_random)
        .set_pkce_challenge(pkce_challenge);
    for s in SCOPES {
        auth_builder = auth_builder.add_scope(Scope::new((*s).to_string()));
    }
    let (authorize_url, csrf_token) = auth_builder.url();
    log::info!("[auth] authorize_url: {}", authorize_url);

    let (code, state) = spawn_loopback_and_open(app.clone(), authorize_url.as_str())?;
    log::info!("[auth] loopback received code (len={}) state-matches={}", code.len(), state.secret() == csrf_token.secret());
    if state.secret() != csrf_token.secret() {
        return Err("csrf state mismatch".into());
    }

    log::info!("[auth] exchanging code for tokens");
    let raw = post_token_request(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri()),
        ("client_id", CLIENT_ID),
        ("code_verifier", pkce_verifier.secret()),
    ])
    .await?;

    log::info!("[auth] token exchange succeeded; saving tokens");
    let stored = raw.into_stored();
    save_tokens(&app, &stored)?;
    let profile = extract_profile(&stored);
    match &profile {
        Ok(p) => log::info!(
            "[auth] profile extracted sub={} email={:?} name={:?} picture={:?}",
            p.sub, p.email, p.name, p.picture
        ),
        Err(e) => log::error!("[auth] profile extraction failed: {e}"),
    }
    profile
}

#[tauri::command]
pub fn auth_logout<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(STORE_KEY_TOKENS);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn auth_current_user<R: Runtime>(app: AppHandle<R>) -> Result<Option<UserProfile>, String> {
    match load_tokens(&app)? {
        Some(t) => Ok(Some(extract_profile(&t)?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn auth_get_access_token<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let Some(mut t) = load_tokens(&app)? else {
        return Ok(None);
    };
    if now_secs() + 30 < t.expires_at {
        return Ok(Some(t.access_token));
    }
    // Expiring soon → refresh if we can.
    let Some(refresh) = t.refresh_token.clone() else {
        return Ok(None);
    };
    let raw = post_token_request(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", CLIENT_ID),
    ])
    .await
    .map_err(|e| format!("refresh failed: {e}"))?;
    t = raw.into_stored();
    save_tokens(&app, &t)?;
    Ok(Some(t.access_token))
}

// ── /userinfo (plan + credits) ──────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    #[serde(default)]
    pub tier: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credits {
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub monthly: u64,
    #[serde(default)]
    pub topup: u64,
    #[serde(default)]
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub sub: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub email_verified: Option<bool>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub picture: Option<String>,
    #[serde(default)]
    pub subscription: Option<Subscription>,
    #[serde(default)]
    pub credits: Option<Credits>,
}

/// Fetch live user info, subscription and credit balance from the OIDC server.
/// Not cached here — the caller controls refresh cadence.
#[tauri::command]
pub async fn auth_userinfo<R: Runtime>(app: AppHandle<R>) -> Result<UserInfo, String> {
    let token = auth_get_access_token(app)
        .await?
        .ok_or_else(|| "not signed in".to_string())?;
    let endpoint = userinfo_endpoint().await?;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("reqwest build failed: {e}"))?;
    let resp = client
        .get(&endpoint)
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("userinfo network error: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        log::error!("[auth] userinfo {status}: {body}");
        return Err(format!("userinfo {status}: {body}"));
    }
    serde_json::from_str::<UserInfo>(&body)
        .map_err(|e| format!("userinfo parse error: {e}; body={body}"))
}

// ── Helpers ─────────────────────────────────────────────────

/// OIDC discovery document is cached for the lifetime of the process. The
/// server AI explicitly asked us not to hardcode the userinfo URL.
static DISCOVERY_CACHE: OnceLock<AsyncMutex<Option<String>>> = OnceLock::new();

async fn userinfo_endpoint() -> Result<String, String> {
    let cell = DISCOVERY_CACHE.get_or_init(|| AsyncMutex::new(None));
    let mut guard = cell.lock().await;
    if let Some(url) = guard.as_ref() {
        return Ok(url.clone());
    }
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("reqwest build failed: {e}"))?;
    let resp = client
        .get(DISCOVERY_URL)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("discovery fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("discovery returned {}", resp.status()));
    }
    let doc: Value = resp
        .json()
        .await
        .map_err(|e| format!("discovery parse error: {e}"))?;
    let url = doc
        .get("userinfo_endpoint")
        .and_then(|v| v.as_str())
        .ok_or("discovery doc missing userinfo_endpoint")?
        .to_string();
    *guard = Some(url.clone());
    Ok(url)
}

fn oauth_client() -> Result<BasicClient, String> {
    let redirect = format!("http://127.0.0.1:{}{}", REDIRECT_PORT, REDIRECT_PATH);
    Ok(BasicClient::new(
        ClientId::new(CLIENT_ID.to_string()),
        None,
        AuthUrl::new(AUTH_ENDPOINT.to_string()).map_err(|e| e.to_string())?,
        Some(TokenUrl::new(TOKEN_ENDPOINT.to_string()).map_err(|e| e.to_string())?),
    )
    .set_redirect_uri(RedirectUrl::new(redirect).map_err(|e| e.to_string())?))
}

/// Launch the system browser at `auth_url`, run a loopback HTTP server on
/// REDIRECT_PORT, and block until we receive `?code=...&state=...`.
fn spawn_loopback_and_open<R: Runtime>(
    app: AppHandle<R>,
    auth_url: &str,
) -> Result<(String, CsrfToken), String> {
    let addr: SocketAddr = format!("127.0.0.1:{}", REDIRECT_PORT)
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    let server = tiny_http::Server::http(addr).map_err(|e| {
        log::error!("[auth] failed to bind loopback server on {addr}: {e}");
        format!("loopback bind failed on {addr}: {e} — another process may be holding this port")
    })?;
    log::info!("[auth] loopback server listening on {addr}");

    // Open the browser via tauri-plugin-shell (don't block the main thread on this).
    if let Err(e) = open_in_browser(app, auth_url) {
        log::error!("[auth] open_in_browser failed: {e}");
    }

    // Wait up to 5 minutes for the user to complete consent.
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    loop {
        let remaining = deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or("login timed out")?;
        let req = match server.recv_timeout(remaining).map_err(|e| e.to_string())? {
            Some(r) => r,
            None => return Err("login timed out".into()),
        };
        // Parse ?code & ?state from the request URL.
        log::info!("[auth] loopback request: {} {}", req.method(), req.url());
        let url_str = format!("http://{}{}", addr, req.url());
        let parsed = url::Url::parse(&url_str).map_err(|e| e.to_string())?;
        let mut code: Option<String> = None;
        let mut state: Option<String> = None;
        let mut err: Option<String> = None;
        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => state = Some(v.into_owned()),
                "error" => err = Some(v.into_owned()),
                _ => {}
            }
        }
        let (body, status) = if let Some(e) = err.as_ref() {
            (callback_html(false, &format!("Login failed: {e}")), 400u16)
        } else if code.is_some() && state.is_some() {
            (callback_html(true, "You can close this tab."), 200u16)
        } else {
            // Ignore favicon etc.
            let _ = req.respond(tiny_http::Response::from_string("").with_status_code(204));
            continue;
        };
        let _ = req.respond(
            tiny_http::Response::from_string(body)
                .with_header(
                    "Content-Type: text/html; charset=utf-8"
                        .parse::<tiny_http::Header>()
                        .unwrap(),
                )
                .with_status_code(status),
        );
        if let Some(e) = err {
            return Err(e);
        }
        return Ok((code.unwrap(), CsrfToken::new(state.unwrap())));
    }
}

fn callback_html(success: bool, msg: &str) -> String {
    let color = if success { "#D97706" } else { "#b91c1c" };
    format!(
        "<!doctype html><meta charset=utf-8><title>Open Speech Studio</title>\
         <style>body{{background:#3E3636;color:#F5F0EB;font-family:system-ui,Arial,sans-serif;\
         display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}\
         .c{{text-align:center}}h1{{color:{color};margin:0 0 8px}}p{{opacity:.85;margin:0}}</style>\
         <div class=c><h1>{}</h1><p>{}</p></div>",
        if success { "Signed in" } else { "Sign-in failed" },
        msg
    )
}

fn open_in_browser<R: Runtime>(app: AppHandle<R>, url: &str) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(url.to_string(), None)
        .map_err(|e| e.to_string())
}

fn redirect_uri() -> String {
    format!("http://127.0.0.1:{}{}", REDIRECT_PORT, REDIRECT_PATH)
}

#[derive(Debug, Deserialize)]
struct RawTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

impl RawTokenResponse {
    fn into_stored(self) -> StoredTokens {
        StoredTokens {
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            id_token: self.id_token,
            expires_at: now_secs() + self.expires_in.unwrap_or(3600),
        }
    }
}

/// POST to the token endpoint with application/x-www-form-urlencoded body.
/// Logs the raw response body on parse failure so we aren't guessing at
/// provider-specific response shapes.
async fn post_token_request(params: &[(&str, &str)]) -> Result<RawTokenResponse, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("reqwest build failed: {e}"))?;
    let resp = client
        .post(TOKEN_ENDPOINT)
        .header("Accept", "application/json")
        .form(params)
        .send()
        .await
        .map_err(|e| {
            log::error!("[auth] token endpoint request failed: {e}");
            format!("token endpoint request failed: {e}")
        })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        log::error!("[auth] token endpoint returned {status}: {body}");
        return Err(format!("token endpoint returned {status}: {body}"));
    }
    match serde_json::from_str::<RawTokenResponse>(&body) {
        Ok(parsed) => Ok(parsed),
        Err(e) => {
            log::error!("[auth] failed to parse token response: {e}; body={body}");
            Err(format!("failed to parse token response: {e}"))
        }
    }
}

fn save_tokens<R: Runtime>(app: &AppHandle<R>, t: &StoredTokens) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        STORE_KEY_TOKENS,
        serde_json::to_value(t).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

fn load_tokens<R: Runtime>(app: &AppHandle<R>) -> Result<Option<StoredTokens>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let Some(val) = store.get(STORE_KEY_TOKENS) else {
        return Ok(None);
    };
    let t: StoredTokens = serde_json::from_value(val).map_err(|e| e.to_string())?;
    Ok(Some(t))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn extract_profile(t: &StoredTokens) -> Result<UserProfile, String> {
    // Try id_token first, fall back to access_token (since Impertio JWTs are RS256 JWTs).
    let jwt = t.id_token.as_deref().unwrap_or(&t.access_token);
    let mut parts = jwt.split('.');
    let _h = parts.next();
    let payload = parts.next().ok_or("malformed jwt")?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|e| e.to_string())?;
    #[derive(Deserialize)]
    struct Claims {
        sub: String,
        email: Option<String>,
        name: Option<String>,
        picture: Option<String>,
    }
    let c: Claims = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    Ok(UserProfile {
        sub: c.sub,
        email: c.email,
        name: c.name,
        picture: c.picture,
    })
}
