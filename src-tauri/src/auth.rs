// OIDC login for Impertio Accounts, backed by the shared
// `openaec-accounts-client` crate.
//
// This file used to be a full ~460-line implementation of Authorization Code
// + PKCE. It is now a thin compatibility shim: the command names and their
// return shapes are unchanged, so the frontend needs no rework, but the actual
// work happens in the shared crate that every Impertio desktop app uses.
//
// What the move buys us, beyond one copy instead of two:
//
//   - Tokens live in the OS keyring (Credential Manager / Keychain / Secret
//     Service) instead of a plain `auth.json` on disk. Access AND refresh
//     tokens were previously readable by anything that could read the file.
//   - Refreshes are serialised. The server rotates refresh tokens with reuse
//     detection, so two concurrent refreshes revoke the entire session; this
//     app had no guard against that.
//   - A definitively rejected refresh clears the session, while a network
//     blip leaves it alone.
//   - The stored id_token's expiry is honoured, so a dead session stops
//     presenting as signed in.
//
// `auth_get_access_token` is deliberately GONE from the command surface. It
// handed the raw access token to the webview, which defeats keyring storage —
// any script in the page could read it. Rust callers that genuinely need a
// token (the audio upload to our own AI host) use
// `openaec_accounts_client::client::access_token()`, which is not a command.

use openaec_accounts_client::client as accounts;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
}

impl From<accounts::UserInfo> for UserProfile {
    fn from(u: accounts::UserInfo) -> Self {
        // The crate returns empty strings for absent claims; the frontend
        // expects null, so map them back to None.
        let opt = |s: String| if s.is_empty() { None } else { Some(s) };
        Self {
            sub: u.sub,
            email: opt(u.email),
            name: opt(u.name),
            picture: None, // not carried by the crate's profile
        }
    }
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

// ── Commands ────────────────────────────────────────────────

/// Kept for the frontend's benefit. Configuration is compiled in and
/// overridable by env, so there is nothing left that can be unconfigured.
#[tauri::command]
pub fn auth_is_configured() -> bool {
    true
}

#[tauri::command]
pub async fn auth_login(
    app: tauri::AppHandle,
    page_text: Option<accounts::CallbackPage>,
) -> Result<UserProfile, String> {
    accounts::accounts_sign_in(app, page_text)
        .await
        .map(UserProfile::from)
}

#[tauri::command]
pub fn auth_logout() {
    accounts::accounts_sign_out();
}

#[tauri::command]
pub async fn auth_current_user() -> Option<UserProfile> {
    accounts::accounts_get_user().await.map(UserProfile::from)
}

/// Live profile, subscription and credit balance from the accounts server.
/// Not cached here — the caller controls refresh cadence.
#[tauri::command]
pub async fn auth_userinfo() -> Result<UserInfo, String> {
    let value = accounts::accounts_fetch("/oauth/userinfo".into(), None, None).await?;
    serde_json::from_value(value).map_err(|e| format!("userinfo unreadable: {e}"))
}
