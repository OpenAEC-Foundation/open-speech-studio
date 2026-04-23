// Single source of truth for the signed-in user so every component
// (TitleBar, SettingsPanel, any future account-gated surface) sees the
// same state and reacts when it changes. Backed by `tauri-plugin-store`
// on disk via the Rust commands in src-tauri/src/auth.rs.

import { createSignal } from "solid-js";
import { auth, type UserProfile } from "./api";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

const [user, setUserInternal] = createSignal<UserProfile | null>(null);

let _initialized = false;
let _initPromise: Promise<void> | null = null;

/** Hydrate the signed-in user from the Rust store once per app lifetime. */
export function initAuth(): Promise<void> {
  if (_initialized) return Promise.resolve();
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    _initialized = true;
    if (!isTauri) return;
    try {
      const u = await auth.currentUser();
      setUserInternal(u);
    } catch {
      // ignore — probably not signed in
    }
  })();
  return _initPromise;
}

/** Update after a successful login, logout, or profile refresh. */
export function setAuthUser(u: UserProfile | null) {
  setUserInternal(u);
}

export const authUser = user;
export const isAuthenticated = () => !!user();
