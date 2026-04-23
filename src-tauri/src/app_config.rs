// Runtime service discovery per `Open-Auth/docs/integration-ai-server-2.md`.
//
// Responsibilities:
//   - Fetch GET /v1/app-config from accounts-impertio using the user's OIDC
//     access token.
//   - Cache the response (in-memory + disk via tauri-plugin-store) keyed on
//     the signed-in user's `sub`.
//   - Implement the client cache state machine: fresh (<15m), stale (<7d),
//     hard-fail beyond that.
//   - Provide a singleflight guarantee so concurrent callers share one fetch.
//
// Non-goals:
//   - Automatic access-token refresh inside this module (`crate::auth`
//     already refreshes on demand).
//   - Retry loops (the 60 req/min/user rate cap is easy to trip with naive
//     retries — callers invalidate on 5xx and re-enter via the normal path).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

use crate::auth;

// ── Constants ───────────────────────────────────────────────
const ACCOUNTS_BASE: &str = "https://account.impertio.app";
const APP_CONFIG_PATH: &str = "/v1/app-config";

const STORE_FILE: &str = "app-config.json";
const STORE_KEY: &str = "cached";

const FRESH_WINDOW_SECS: u64 = 15 * 60;
const STALE_WINDOW_SECS: u64 = 7 * 24 * 60 * 60;

// ── Wire types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiServer {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub ai_servers: Vec<AiServer>,
    #[serde(default)]
    pub operations: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedConfig {
    config: AppConfig,
    fetched_at: u64,
}

// ── Process-wide singleflight state ─────────────────────────

static CACHE: OnceLock<Arc<Mutex<Option<CachedConfig>>>> = OnceLock::new();

fn cache() -> &'static Arc<Mutex<Option<CachedConfig>>> {
    CACHE.get_or_init(|| Arc::new(Mutex::new(None)))
}

// ── Public API ──────────────────────────────────────────────

#[tauri::command]
pub async fn get_app_config<R: Runtime>(app: AppHandle<R>) -> Result<AppConfig, String> {
    let cached = resolve(&app).await?;
    Ok(cached.config)
}

#[tauri::command]
pub async fn invalidate_app_config<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let mut guard = cache().lock().await;
    *guard = None;
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(STORE_KEY);
    store.save().map_err(|e| e.to_string())?;
    log::info!("[app_config] cache invalidated");
    Ok(())
}

/// Returns the AI server URL the desktop app should use for AI calls.
/// Called from Rust transcription code paths; see `lib.rs::start_file_job`.
pub async fn get_ai_server_url<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let cached = resolve(app).await?;
    cached
        .config
        .ai_servers
        .first()
        .map(|s| s.url.clone())
        .ok_or_else(|| "app-config has no ai_servers".into())
}

// ── Core resolution ─────────────────────────────────────────

async fn resolve<R: Runtime>(app: &AppHandle<R>) -> Result<CachedConfig, String> {
    // Hydrate memory cache from disk the first time we're called.
    {
        let mut guard = cache().lock().await;
        if guard.is_none() {
            if let Some(from_disk) = load_from_store(app)? {
                *guard = Some(from_disk);
            }
        }
        if let Some(cached) = guard.as_ref() {
            if is_fresh(cached.fetched_at) {
                return Ok(cached.clone());
            }
        }
    }

    // Try a network refresh. The mutex around the fetch itself guarantees
    // singleflight: concurrent callers that reach this branch queue behind
    // the first one and observe the updated cache when they re-check.
    let mut guard = cache().lock().await;
    if let Some(cached) = guard.as_ref() {
        if is_fresh(cached.fetched_at) {
            return Ok(cached.clone());
        }
    }

    match fetch_from_server(app).await {
        Ok(fresh) => {
            let cached = CachedConfig {
                config: fresh,
                fetched_at: now_secs(),
            };
            save_to_store(app, &cached)?;
            *guard = Some(cached.clone());
            Ok(cached)
        }
        Err(e) => {
            // Transient failure — fall back to cached value if still within
            // the 7-day stale window. Outside that window, surface the error.
            if let Some(cached) = guard.as_ref() {
                if is_stale_acceptable(cached.fetched_at) {
                    log::warn!(
                        "[app_config] fetch failed, serving cached (age {}s): {}",
                        now_secs().saturating_sub(cached.fetched_at),
                        e
                    );
                    return Ok(cached.clone());
                }
            }
            Err(e)
        }
    }
}

async fn fetch_from_server<R: Runtime>(app: &AppHandle<R>) -> Result<AppConfig, String> {
    let token = auth::auth_get_access_token(app.clone())
        .await?
        .ok_or_else(|| "not signed in".to_string())?;

    let url = format!("{ACCOUNTS_BASE}{APP_CONFIG_PATH}");
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("reqwest build failed: {e}"))?;

    log::info!("[app_config] fetching {url}");
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("app-config fetch network error: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status.as_u16() == 404 {
        return Err("app not configured on accounts server (404)".into());
    }
    if !status.is_success() {
        return Err(format!("app-config fetch {status}: {body}"));
    }
    let parsed: AppConfig = serde_json::from_str(&body)
        .map_err(|e| format!("app-config parse error: {e}; body={body}"))?;
    log::info!(
        "[app_config] fetched ok; ai_servers={} client_id={:?}",
        parsed.ai_servers.len(),
        parsed.client_id
    );
    Ok(parsed)
}

// ── Store I/O ───────────────────────────────────────────────

fn load_from_store<R: Runtime>(app: &AppHandle<R>) -> Result<Option<CachedConfig>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let Some(val) = store.get(STORE_KEY) else {
        return Ok(None);
    };
    serde_json::from_value::<CachedConfig>(val)
        .map(Some)
        .map_err(|e| e.to_string())
}

fn save_to_store<R: Runtime>(app: &AppHandle<R>, cached: &CachedConfig) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        STORE_KEY,
        serde_json::to_value(cached).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

// ── Helpers ─────────────────────────────────────────────────

fn is_fresh(fetched_at: u64) -> bool {
    now_secs().saturating_sub(fetched_at) < FRESH_WINDOW_SECS
}

fn is_stale_acceptable(fetched_at: u64) -> bool {
    now_secs().saturating_sub(fetched_at) < STALE_WINDOW_SECS
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
