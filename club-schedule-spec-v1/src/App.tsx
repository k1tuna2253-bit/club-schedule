import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  CalendarBlank,
  CaretDown,
  Check,
  GearSix,
  Monitor,
  Moon,
  Sun,
  SignOut,
  UserCircle,
} from "@phosphor-icons/react";
import { CalendarApp } from "./CalendarApp";
import { ChoiceGroup } from "./ChoiceGroup";
import type { WeekStart } from "./week-start";

type User = {
  id: string;
  display_name: string;
  grade: number;
  registration_year: number;
  primary_campus_id: string;
};
type Session = { user: User; termsRequired: boolean; setupRequired: boolean };
type Terms = { version: string; body: string; accepted: boolean };
type Theme = "system" | "light" | "dark";
const themeOptions = [
  { value: "system", label: "システム", Icon: Monitor },
  { value: "light", label: "ライト", Icon: Sun },
  { value: "dark", label: "ダーク", Icon: Moon },
] as const;

async function api<T>(path: string, method = "GET", data?: object): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = (await response.json()) as {
    data: T;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(result.error?.message ?? "処理できませんでした。");
  return result.data as T;
}

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = (next: string) => {
    history.pushState(null, "", next);
    setPath(next);
  };
  return { path, go };
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, setTheme };
}

function ThemeMenu({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (value: Theme) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = themeOptions.findIndex(
    (option) => option.value === theme,
  );
  const selected = themeOptions[selectedIndex];

  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const openAt = (index: number) => {
    setFocusIndex(index);
    setOpen(true);
  };
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(
        event.key === "ArrowDown" ? selectedIndex : themeOptions.length - 1,
      );
    }
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? themeOptions.length - 1
            : (focusIndex +
                (event.key === "ArrowDown" ? 1 : -1) +
                themeOptions.length) %
              themeOptions.length;
      setFocusIndex(next);
    }
  };

  return (
    <div className="theme-menu-container" ref={containerRef}>
      <button
        type="button"
        className="theme-trigger"
        ref={triggerRef}
        aria-label={`表示テーマ: ${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "theme-menu" : undefined}
        onClick={() => (open ? close(false) : openAt(selectedIndex))}
        onKeyDown={onTriggerKeyDown}
      >
        <selected.Icon size={18} aria-hidden="true" />
        <span>{selected.label}</span>
        <CaretDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id="theme-menu"
          className="theme-menu"
          role="menu"
          aria-label="表示テーマ"
          onKeyDown={onMenuKeyDown}
        >
          {themeOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.value}
              tabIndex={-1}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              onClick={() => {
                setTheme(option.value);
                close(true);
              }}
            >
              <option.Icon size={18} aria-hidden="true" />
              <span>{option.label}</span>
              {theme === option.value && (
                <Check size={17} weight="bold" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({
  children,
  user,
  go,
  theme,
  setTheme,
}: {
  children: ReactNode;
  user?: User;
  go: (path: string) => void;
  theme: Theme;
  setTheme: (value: Theme) => void;
}) {
  return (
    <div className={user ? "shell has-nav" : "shell"}>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => go("/app")}
          aria-label="ホームへ"
        >
          <CalendarBlank size={24} weight="regular" aria-hidden="true" />
          <span>クラブ予定</span>
        </button>
        <div className="top-actions">
          <ThemeMenu theme={theme} setTheme={setTheme} />
          {user && (
            <button
              className="icon-button"
              onClick={() => go("/app/profile")}
              aria-label="プロフィール"
            >
              <UserCircle size={24} />
            </button>
          )}
        </div>
      </header>
      <main id="main" className="main">
        {children}
      </main>
      {user && (
        <nav className="bottom-nav" aria-label="メインナビゲーション">
          <button onClick={() => go("/app")}>
            <CalendarBlank size={23} aria-hidden="true" />
            <span>ホーム</span>
          </button>
          <button onClick={() => go("/app/profile")}>
            <UserCircle size={23} aria-hidden="true" />
            <span>プロフィール</span>
          </button>
        </nav>
      )}
    </div>
  );
}

export function App() {
  const { path, go } = usePath();
  const { theme, setTheme } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Session>("/api/auth/session")
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);
  const logout = async () => {
    try {
      await api("/api/auth/logout", "POST");
      setSession(null);
      go("/login");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (loading) return;
    if (!session && path !== "/login") go("/login");
    else if (session?.setupRequired && path !== "/setup") go("/setup");
    else if (
      session?.termsRequired &&
      !session.setupRequired &&
      path !== "/terms"
    )
      go("/terms");
    else if (
      session &&
      !session.termsRequired &&
      (path === "/login" ||
        path === "/terms" ||
        path === "/setup" ||
        path === "/")
    )
      go("/app");
  }, [session, loading, path]);

  return (
    <Shell
      user={
        session?.termsRequired || session?.setupRequired
          ? undefined
          : session?.user
      }
      go={go}
      theme={theme}
      setTheme={setTheme}
    >
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">読み込み中…</p>
      ) : !session ? (
        <Login onLogin={setSession} />
      ) : session.setupRequired ? (
        <section className="card narrow">
          <h1>準備中</h1>
          <p>
            利用規約がまだ設定されていません。管理者にお問い合わせください。
          </p>
          <button onClick={logout}>ログアウト</button>
        </section>
      ) : session.termsRequired ? (
        <TermsScreen
          onAccepted={() => setSession({ ...session, termsRequired: false })}
          onDecline={logout}
        />
      ) : path === "/app/profile" ? (
        <Profile
          user={session.user}
          onUser={(user) => setSession({ ...session, user })}
          onLogout={logout}
        />
      ) : (
        <CalendarApp user={session.user} />
      )}
    </Shell>
  );
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<Session>("/api/auth/login", "POST", {
          display_name: name,
          password,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card narrow">
      <p className="eyebrow">アカウント</p>
      <h1>ログイン</h1>
      <p className="muted">登録済みの表示名とパスワードを入力してください。</p>
      <form onSubmit={submit}>
        <label>
          表示名
          <input
            autoComplete="username"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "確認中…" : "ログイン"}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

function TermsScreen({
  onAccepted,
  onDecline,
}: {
  onAccepted: () => void;
  onDecline: () => void;
}) {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Terms>("/api/terms/current")
      .then(setTerms)
      .catch((e) => setError(e.message));
  }, []);
  const accept = async () => {
    if (!terms) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/terms/accept", "POST", {
        version: terms.version,
        agree: true,
      });
      onAccepted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card narrow">
      <p className="eyebrow">はじめに</p>
      <h1>利用規約</h1>
      {terms ? (
        <>
          <p>バージョン {terms.version}</p>
          <div className="terms-body">{terms.body}</div>
          <div className="button-row">
            <button className="primary" onClick={accept} disabled={busy}>
              同意する
            </button>
            <button onClick={onDecline}>同意しない</button>
          </div>
        </>
      ) : (
        <p role="status">読み込み中…</p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

function Profile({
  user,
  onUser,
  onLogout,
}: {
  user: User;
  onUser: (user: User) => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(user.display_name);
  const [grade, setGrade] = useState(user.grade);
  const [campus, setCampus] = useState(user.primary_campus_id);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [weekStart, setWeekStart] = useState<WeekStart>("sunday");
  useEffect(() => {
    api<{ week_start: WeekStart }>("/api/me/display-preferences")
      .then((data) => setWeekStart(data.week_start))
      .catch((e: Error) => setError(e.message));
  }, []);
  const saveWeekStart = async (value: WeekStart) => {
    setError("");
    try {
      const result = await api<{ week_start: WeekStart }>(
        "/api/me/display-preferences",
        "PATCH",
        { week_start: value },
      );
      setWeekStart(result.week_start);
      setMessage("表示設定を保存しました。");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const data = await api<{ user: User }>("/api/me", "PATCH", {
        display_name: name,
        grade,
        primary_campus_id: campus,
      });
      onUser(data.user);
      setMessage("保存しました。");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (next !== confirmation) {
      setPasswordError("新しいパスワードが一致しません。");
      return;
    }
    setPasswordError("");
    try {
      await api("/api/auth/password", "POST", {
        current_password: current,
        new_password: next,
      });
      setCurrent("");
      setNext("");
      setConfirmation("");
      setMessage("パスワードを変更しました。");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">アカウント</p>
        <h1>プロフィール</h1>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      <div className="profile-grid">
        <section className="card">
          <h2>表示設定</h2>
          <ChoiceGroup
            label="週の始まり"
            value={weekStart}
            onChange={saveWeekStart}
            options={[
              { value: "sunday", label: "日曜日" },
              { value: "monday", label: "月曜日" },
            ]}
          />
        </section>
        <section className="card">
          <h2>基本情報</h2>
          <form onSubmit={save}>
            <label>
              表示名
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </label>
            <label>
              学年
              <input
                type="number"
                min="1"
                value={grade}
                onChange={(e) => setGrade(Number(e.target.value))}
                required
              />
            </label>
            <ChoiceGroup
              label="主なキャンパス"
              value={campus}
              onChange={setCampus}
              options={[
                { value: "omiya", label: "大宮" },
                { value: "hirakata", label: "枚方" },
              ]}
            />
            <button className="primary" type="submit">
              変更を保存
            </button>
          </form>
        </section>
        <section className="card">
          <h2>
            <GearSix size={22} aria-hidden="true" /> パスワード
          </h2>
          <form onSubmit={changePassword}>
            <label>
              現在のパスワード
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </label>
            <label>
              新しいパスワード
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setPasswordError("");
                }}
                required
              />
            </label>
            <label>
              新しいパスワード（確認）
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmation}
                onChange={(e) => {
                  setConfirmation(e.target.value);
                  setPasswordError("");
                }}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={
                  passwordError ? "password-confirmation-error" : undefined
                }
                required
              />
            </label>
            {passwordError && (
              <p
                id="password-confirmation-error"
                role="alert"
                className="form-error"
              >
                {passwordError}
              </p>
            )}
            <button type="submit">パスワードを変更</button>
          </form>
        </section>
      </div>
      <section
        className="card account-actions"
        aria-labelledby="account-actions-heading"
      >
        <h2 id="account-actions-heading">アカウント操作</h2>
        <button type="button" onClick={onLogout}>
          <SignOut size={20} aria-hidden="true" />
          ログアウト
        </button>
      </section>
    </>
  );
}
