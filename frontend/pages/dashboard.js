import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { fetchSessions } from "@/lib/ociClient";
import styles from "@/styles/dashboard.module.css";

const DEMO_USER = "pt";
const DEMO_PASS = "hacktn2026";

/** Demo fallback when OCI backend is offline */
const DEMO_SESSIONS = [
  {
    patient_id: "demo-patient",
    timestamp: "2026-10-15T14:22:00Z",
    exercise: "squat",
    avg_quality: 0.82,
    top_error: "knee_cave",
    reps_completed: 12,
  },
  {
    patient_id: "demo-patient",
    timestamp: "2026-10-16T10:05:00Z",
    exercise: "squat",
    avg_quality: 0.71,
    top_error: "shallow",
    reps_completed: 10,
  },
  {
    patient_id: "demo-patient",
    timestamp: "2026-10-17T09:40:00Z",
    exercise: "squat",
    avg_quality: 0.88,
    top_error: "back_round",
    reps_completed: 14,
  },
];

export default function DashboardPage() {
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [sessions, setSessions] = useState(DEMO_SESSIONS);
  const [source, setSource] = useState("demo");

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("pt_authed") === "1") {
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchSessions("demo-patient");
        if (!cancelled && data?.sessions?.length) {
          setSessions(normalizeSessions(data.sessions));
          setSource("oci");
        }
      } catch {
        // keep demo data — offline-first for judge demos
        if (!cancelled) setSource("demo");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const stats = useMemo(() => summarize(sessions), [sessions]);

  function handleLogin(e) {
    e.preventDefault();
    if (user === DEMO_USER && pass === DEMO_PASS) {
      sessionStorage.setItem("pt_authed", "1");
      setAuthed(true);
      setLoginError("");
    } else {
      setLoginError("Demo login: pt / hacktn2026");
    }
  }

  if (!authed) {
    return (
      <>
        <Head>
          <title>PT login | PT Form Coach</title>
        </Head>
        <main className={styles.page}>
          <form className={styles.loginBox} onSubmit={handleLogin}>
            <h1>PT Dashboard</h1>
            <p>Clinician login (demo credentials for HackTN).</p>
            <div className={styles.field}>
              <label htmlFor="user">Username</label>
              <input
                id="user"
                autoComplete="username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="pass">Password</label>
              <input
                id="pass"
                type="password"
                autoComplete="current-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </div>
            <button type="submit" className={styles.btn}>
              Sign in
            </button>
            {loginError && <p className={styles.error}>{loginError}</p>}
            <p style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
              <Link href="/" className={styles.linkBack}>
                ← Back to patient home
              </Link>
            </p>
          </form>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
          <title>PT Dashboard | PT Form Coach</title>
      </Head>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>PT Form Coach</div>
            <p className={styles.subtitle}>
              Clinician view · Patient: demo patient · Data: {source}
            </p>
          </div>
          <Link href="/" className={styles.linkBack}>
            ← Patient home
          </Link>
        </header>

        <p className={styles.billing}>
          This data maps to CPT 98985 remote therapeutic monitoring billing.
        </p>

        <div className={styles.grid}>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>Sessions this week</div>
            <div className={styles.metricValue}>{stats.sessionsWeek}</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>Avg rep quality</div>
            <div className={styles.metricValue}>
              {(stats.avgQuality * 100).toFixed(0)}%
            </div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>Top compensation</div>
            <div className={styles.metricValue} style={{ fontSize: "1.25rem" }}>
              {formatError(stats.topError)}
            </div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricLabel}>Last session</div>
            <div className={styles.metricValue} style={{ fontSize: "1.1rem" }}>
              {stats.lastSession}
            </div>
          </div>
        </div>

        <h2 className={styles.sectionTitle}>Rep quality over time</h2>
        <div className={styles.chartRow} aria-hidden="true">
          {sessions.map((s, i) => (
            <div
              key={i}
              className={styles.bar}
              style={{ height: `${Math.max(8, s.avg_quality * 100)}%` }}
              title={`${(s.avg_quality * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <div className={styles.barLabel}>
          <span>Older</span>
          <span>Newer</span>
        </div>

        <h2 className={styles.sectionTitle} style={{ marginTop: "1.75rem" }}>
          Session log
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Exercise</th>
                <th>Reps</th>
                <th>Quality</th>
                <th>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={i}>
                  <td>{formatTime(s.timestamp)}</td>
                  <td>{s.exercise}</td>
                  <td>{s.reps_completed ?? s.reps?.length ?? "none"}</td>
                  <td>{((s.avg_quality ?? 0) * 100).toFixed(0)}%</td>
                  <td>{formatError(s.top_error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function normalizeSessions(raw) {
  return raw.map((s) => {
    const reps = s.reps || [];
    const scores = reps.map((r) => r.score).filter(Boolean);
    const correct = scores.filter((x) => x.quality === "correct").length;
    const avg =
      scores.length > 0
        ? scores.reduce((a, x) => a + (x.confidence || 0) * (x.quality === "correct" ? 1 : 0.5), 0) /
          scores.length
        : s.avg_quality ?? 0.7;
    const errors = scores.filter((x) => x.error_type).map((x) => x.error_type);
    const top = mode(errors) || s.top_error || "none";
    return {
      patient_id: s.patient_id,
      timestamp: s.timestamp,
      exercise: s.exercise || "squat",
      avg_quality: s.avg_quality ?? (scores.length ? correct / scores.length : avg),
      top_error: top,
      reps_completed: reps.length || s.reps_completed,
    };
  });
}

function summarize(sessions) {
  const avgQuality =
    sessions.reduce((a, s) => a + (s.avg_quality || 0), 0) / Math.max(1, sessions.length);
  const errors = sessions.map((s) => s.top_error).filter(Boolean);
  const last = sessions.length
    ? formatTime(sessions[sessions.length - 1].timestamp)
    : "none";
  return {
    sessionsWeek: sessions.length,
    avgQuality,
    topError: mode(errors) || "none",
    lastSession: last,
  };
}

function mode(arr) {
  const c = {};
  arr.forEach((x) => {
    c[x] = (c[x] || 0) + 1;
  });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function formatError(t) {
  const map = {
    knee_cave: "Knee cave",
    back_round: "Back rounding",
    shallow: "Shallow depth",
    asymmetric: "Asymmetry",
  };
  return map[t] || t || "none";
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
