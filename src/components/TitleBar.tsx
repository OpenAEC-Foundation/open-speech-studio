import { createSignal, onMount, Show } from "solid-js";
import { useI18n } from "../lib/i18n";
import { auth, type UserInfo, type UserProfile } from "../lib/api";
import { authUser, setAuthUser, initAuth } from "../lib/authStore";
import appIcon from "../assets/icon.png";

const isTauri = !!(window as any).__TAURI_INTERNALS__;
const isMac = navigator.platform?.startsWith("Mac");

/// Minimum gap between consecutive /userinfo calls. Server caps us at 120
/// req/min/IP; 5 s is plenty of headroom and avoids refetching on rapid
/// menu open/close.
const USERINFO_DEBOUNCE_MS = 5000;

export default function TitleBar() {
  const { t } = useI18n();
  // Auth lives in the shared authStore so other components (SettingsPanel,
  // etc.) react to login/logout without their own refresh plumbing.
  const user = authUser;
  const setUser = setAuthUser;
  const [info, setInfo] = createSignal<UserInfo | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [loginError, setLoginError] = createSignal<string | null>(null);
  let lastInfoFetch = 0;

  const refreshUserInfo = async () => {
    if (!isTauri || !user()) return;
    const now = Date.now();
    if (now - lastInfoFetch < USERINFO_DEBOUNCE_MS) return;
    lastInfoFetch = now;
    try {
      const i = await auth.userInfo();
      setInfo(i);
      // /userinfo is the source of truth for name/picture between sessions;
      // patch the lightweight profile so the avatar reflects any change.
      const u = user();
      if (u) setUser({ ...u, name: i.name ?? u.name, picture: i.picture ?? u.picture });
    } catch (e) {
      console.warn("[auth] userinfo fetch failed:", e);
    }
  };

  onMount(async () => {
    if (!isTauri) return;
    await initAuth();
    if (user()) refreshUserInfo();
  });

  const login = async () => {
    if (busy()) return;
    setLoginError(null);
    setBusy(true);
    try {
      const u = await auth.login();
      console.info("[auth] login succeeded", u);
      setUser(u);
      refreshUserInfo();
    } catch (e) {
      console.error("[auth] login failed:", e);
      setLoginError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setMenuOpen(false);
    try {
      await auth.logout();
      setUser(null);
      setInfo(null);
    } catch (_) {}
  };

  const openMenu = () => {
    const next = !menuOpen();
    setMenuOpen(next);
    if (next) refreshUserInfo();
  };

  const planLabel = () => {
    const tier = info()?.subscription?.tier;
    if (!tier) return null;
    switch (tier) {
      case "pro": return t("login.planPro");
      case "studio": return t("login.planStudio");
      default: return t("login.planFree");
    }
  };

  const resetsLabel = () => {
    const iso = info()?.credits?.resets_at;
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return t("login.creditsResetsAt", { date: d.toLocaleDateString() });
  };

  const dismissError = () => setLoginError(null);

  const minimize = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  };

  const close = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  };

  const displayName = () => {
    const u = user();
    if (!u) return "";
    return u.name || u.email || u.sub.slice(0, 8);
  };

  const initial = () => {
    const u = user();
    if (!u) return "?";
    const source = u.name || u.email || u.sub;
    const ch = source.trim().charAt(0);
    return (ch || "?").toUpperCase();
  };

  const tooltip = () => {
    const u = user();
    if (!u) return "";
    return u.name ? `${u.name} (${u.email ?? ""})`.trim() : (u.email ?? "");
  };

  return (
    <div class={`titlebar ${isMac ? "titlebar-mac" : ""}`} data-tauri-drag-region>
      {isMac && <div class="titlebar-mac-spacer" data-tauri-drag-region />}
      <img class="titlebar-icon" src={appIcon} alt="" width="16" height="16" data-tauri-drag-region />
      <div class="titlebar-title" data-tauri-drag-region>
        Open Speech Studio <span class="titlebar-version">v0.10.0</span>
      </div>
      <div class="titlebar-buttons">
        <div class="titlebar-auth-wrap">
          <button
            class="titlebar-avatar"
            classList={{ "titlebar-avatar-signed-out": !user() }}
            onClick={openMenu}
            disabled={busy()}
            title={user() ? tooltip() : t("login.signIn")}
            aria-label={user() ? displayName() : t("login.signIn")}
          >
            <Show
              when={user()}
              fallback={
                // Signed-out: same button shape, user-silhouette icon.
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              }
            >
              <Show
                when={user()?.picture}
                fallback={<span class="titlebar-avatar-initial">{initial()}</span>}
              >
                <img
                  class="titlebar-avatar-img"
                  src={user()!.picture!}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              </Show>
            </Show>
          </button>

          {/* Signed-OUT dropdown: explain what a click on Sign in does
              (opens system browser) before firing the OIDC flow, so the
              user isn't surprised by a sudden browser window. */}
          <Show when={!user() && menuOpen()}>
            <div class="titlebar-auth-menu titlebar-auth-menu-signedout" onMouseLeave={() => setMenuOpen(false)}>
              <div class="titlebar-auth-menu-signedout-title">{t("login.promptTitle")}</div>
              <div class="titlebar-auth-menu-signedout-body">{t("login.promptBody")}</div>
              <button
                class="titlebar-auth-menu-signin-btn"
                disabled={busy()}
                onClick={async () => {
                  setMenuOpen(false);
                  await login();
                }}
              >
                {busy() ? t("login.loading") : t("login.signIn")}
              </button>
              <a
                class="titlebar-auth-menu-createacct"
                href="https://account.impertio.app/signup"
                target="_blank"
                rel="noopener"
                onClick={() => setMenuOpen(false)}
              >
                {t("login.createAccount")}
              </a>
              <Show when={loginError()}>
                <div class="titlebar-auth-menu-error" onClick={dismissError}>
                  {loginError()}
                </div>
              </Show>
            </div>
          </Show>

          <Show when={user()}>
            <Show when={menuOpen()}>
              <div class="titlebar-auth-menu" onMouseLeave={() => setMenuOpen(false)}>
                <div class="titlebar-auth-menu-header">
                  <div class="titlebar-auth-menu-avatar">
                    <Show
                      when={user()?.picture}
                      fallback={<span>{initial()}</span>}
                    >
                      <img src={user()!.picture!} alt="" referrerPolicy="no-referrer" />
                    </Show>
                  </div>
                  <div class="titlebar-auth-menu-ident">
                    <div class="titlebar-auth-menu-name">{displayName()}</div>
                    <Show when={user()?.email && user()!.email !== displayName()}>
                      <div class="titlebar-auth-menu-email">{user()!.email}</div>
                    </Show>
                  </div>
                </div>
                <Show when={info()?.credits || info()?.subscription}>
                  <div class="titlebar-auth-menu-stats">
                    <Show when={info()?.credits}>
                      <div class="titlebar-auth-menu-credits">
                        <span class="titlebar-auth-menu-credits-n">{info()!.credits!.total}</span>
                        <span class="titlebar-auth-menu-credits-label">{t("login.credits")}</span>
                      </div>
                      <Show when={resetsLabel()}>
                        <div class="titlebar-auth-menu-resets">{resetsLabel()}</div>
                      </Show>
                    </Show>
                    <Show when={planLabel()}>
                      <div class="titlebar-auth-menu-plan-row">
                        <span
                          class="titlebar-auth-menu-plan"
                          data-tier={info()?.subscription?.tier ?? "free"}
                        >
                          {planLabel()}
                        </span>
                        <Show when={info()?.subscription?.tier === "free"}>
                          <a
                            class="titlebar-auth-menu-upgrade"
                            href="https://account.impertio.app/pricing"
                            target="_blank"
                            rel="noopener"
                          >
                            {t("login.upgrade")}
                          </a>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
                <div class="titlebar-auth-menu-actions">
                  <a
                    class="titlebar-auth-menu-item"
                    href="https://account.impertio.app/billing"
                    target="_blank"
                    rel="noopener"
                    onClick={() => setMenuOpen(false)}
                  >
                    {t("login.manageAccount")}
                  </a>
                  <button class="titlebar-auth-menu-item" onClick={logout}>
                    {t("login.signOut")}
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </div>
        <a
          class="titlebar-feedback"
          href="https://github.com/OpenAEC-Foundation/open-speech-studio/issues"
          target="_blank"
          rel="noopener"
        >
          {t("sidebar.feedback")}
        </a>
        {!isMac && (
          <button class="titlebar-btn" onClick={minimize} aria-label={t("titlebar.minimize")}>
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>
        )}
        {!isMac && (
          <button class="titlebar-btn titlebar-btn-close" onClick={close} aria-label={t("titlebar.close")}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1.7.3a1 1 0 00-1.4 1.4L3.6 5 .3 8.3a1 1 0 001.4 1.4L5 6.4l3.3 3.3a1 1 0 001.4-1.4L6.4 5l3.3-3.3A1 1 0 008.3.3L5 3.6 1.7.3z" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
