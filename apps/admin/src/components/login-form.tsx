"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearSessionToken,
  fetchAdminTickets,
  loginAdmin,
  readSessionToken,
  saveSessionToken,
} from "@/lib/ticket-api";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = readSessionToken();
    if (!saved) {
      setChecking(false);
      return;
    }
    let active = true;
    fetchAdminTickets(saved)
      .then(() => {
        if (active) router.replace("/tickets");
      })
      .catch(() => {
        clearSessionToken();
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("请填写账号和密码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const sessionToken = await loginAdmin(username, password);
      saveSessionToken(sessionToken);
      router.replace("/tickets");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return <p className="login-card__hint">检查登录状态…</p>;
  }

  return (
    <form className="login-card__form" onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">账号</span>
        <input
          className="field__input"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">密码</span>
        <input
          className="field__input"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "登录中…" : "登录"}
      </button>
    </form>
  );
}