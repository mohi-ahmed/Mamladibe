import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  FileText,
  Flag,
  Gauge,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  adminApi,
  type AdminActor,
  type AdminComment,
  type AdminIdentity,
  type AdminIncident,
  type AdminReport,
  type AdminUser,
  type AuditItem,
  type DashboardData,
} from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import "./admin-console.css";

type Page =
  "dashboard" | "incidents" | "comments" | "reports" | "actors" | "audit" | "users" | "settings";
type AnyRecord = AdminIncident | AdminComment | AdminReport | AdminActor | AuditItem | AdminUser;
const pageTitles: Record<Page, string> = {
  dashboard: "DASHBOARD",
  incidents: "INCIDENTS",
  comments: "COMMENTS",
  reports: "FLAG REPORTS",
  actors: "ANONYMOUS ACTORS",
  audit: "AUDIT LOG",
  users: "ADMIN USERS",
  settings: "SETTINGS",
};
const nav: Array<{ page: Page; label: string; icon: typeof Gauge; superOnly?: boolean }> = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "incidents", label: "Incidents", icon: FileText },
  { page: "comments", label: "Comments", icon: MessageCircle },
  { page: "reports", label: "Flag reports", icon: Flag },
  { page: "actors", label: "Anonymous actors", icon: Users },
  { page: "audit", label: "Audit log", icon: Activity },
  { page: "users", label: "Admin users", icon: ShieldCheck, superOnly: true },
  { page: "settings", label: "Settings", icon: Settings, superOnly: true },
];
const fmt = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("bn-BD", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Dhaka",
      }).format(new Date(value))
    : "—";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "অনুরোধটি সম্পন্ন করা যায়নি।");

export function AdminConsole() {
  const [auth, setAuth] = useState<"checking" | "login" | "totp" | "ready">("checking");
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [setup, setSetup] = useState<{ qrDataUrl: string; manualKey: string } | null>(null);
  const [page, setPage] = useState<Page>("dashboard");
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<unknown>(null);
  const [loadedPage, setLoadedPage] = useState<Page | null>(null);
  const [openFlagCount, setOpenFlagCount] = useState(0);
  const loadSequence = useRef(0);
  const [selected, setSelected] = useState<AnyRecord | null>(null);
  const [create, setCreate] = useState<"incident" | "user" | null>(null);
  const [modal, setModal] = useState<{
    title: string;
    help: string;
    run: (reason: string) => Promise<void>;
    extra?: ReactNode;
  } | null>(null);
  useEffect(() => {
    adminApi
      .me()
      .then((v) => {
        setAdmin(v.admin);
        setAuth("ready");
      })
      .catch(() => setAuth("login"));
  }, []);
  const load = useCallback(async () => {
    if (auth !== "ready") return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      let v: unknown;
      if (page === "dashboard") {
        v = await adminApi.dashboard();
        setOpenFlagCount((v as DashboardData).counts.openFlags);
      } else if (page === "incidents") v = await adminApi.incidents({ limit: 50 });
      else if (page === "comments") v = await adminApi.comments({ limit: 50 });
      else if (page === "reports")
        v = await adminApi.reports({ status: "open", sort: "most_flagged", limit: 50 });
      else if (page === "actors") v = await adminApi.actors({ limit: 50 });
      else if (page === "audit") v = await adminApi.audit({ limit: 50 });
      else if (page === "users") v = await adminApi.users();
      else v = await adminApi.settings();
      if (sequence !== loadSequence.current) return;
      setData(v);
      setLoadedPage(page);
      if (page !== "dashboard") {
        void adminApi
          .dashboard()
          .then((summary) => setOpenFlagCount(summary.counts.openFlags))
          .catch(() => undefined);
      }
    } catch (e) {
      if (sequence !== loadSequence.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setAuth("login");
        setAdmin(null);
      } else setError(errMsg(e));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [auth, page]);
  useEffect(() => {
    void load();
  }, [load]);
  if (auth === "checking")
    return (
      <div className="adm-auth">
        <div className="adm-loader">
          <span />
          <span />
          <span />
        </div>
        <p>নিরাপদ Admin Session যাচাই হচ্ছে</p>
      </div>
    );
  if (auth !== "ready")
    return (
      <AdminLogin
        stage={auth}
        setup={setup}
        onPassword={(s) => {
          setSetup(s);
          setAuth("totp");
        }}
        onReady={(a) => {
          setAdmin(a);
          setAuth("ready");
        }}
      />
    );
  const isSuper = admin?.role === "super";
  return (
    <div className="adm-shell">
      <aside className={`adm-side ${mobile ? "open" : ""}`}>
        <div className="adm-brand">
          <div className="adm-mark">A</div>
          <div>
            <b>mamladibe.</b>
            <small>CONTROL CENTER</small>
          </div>
        </div>
        <div className="adm-label">WORKSPACE</div>
        <nav>
          {nav
            .filter((x) => !x.superOnly || isSuper)
            .map((x) => (
              <button
                key={x.page}
                className={page === x.page ? "active" : ""}
                onClick={() => {
                  if (x.page === page) return;
                  setLoadedPage(null);
                  setLoading(true);
                  setPage(x.page);
                  setSelected(null);
                  setSearch("");
                  setMobile(false);
                }}
              >
                <x.icon size={17} />
                <span>{x.label}</span>
                {x.page === "reports" && <i>{openFlagCount}</i>}
              </button>
            ))}
        </nav>
        <div className="adm-side-foot">
          <div className="adm-status">
            <small>CONTROL STATUS</small>
            <p>
              <span /> Admin Console · Live
              <br />
              Connected to protected backend.
            </p>
            <em>PRIVATE AREA</em>
          </div>
          <p>
            © 2026 TEAM EPSILON
            <br />
            MAMLADIBE ADMIN
          </p>
        </div>
      </aside>
      {mobile && (
        <button className="adm-overlay" onClick={() => setMobile(false)} aria-label="Close menu" />
      )}
      <section className="adm-main">
        <header className="adm-top">
          <div>
            <button className="adm-menu" onClick={() => setMobile(true)}>
              <Menu />
            </button>
            <span>WORKSPACE</span>
            <b>/</b>
            <span>ADMIN</span>
            <b>/</b>
            <strong>{pageTitles[page]}</strong>
          </div>
          <div className="adm-top-actions">
            <label>
              <Search size={14} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search active page..."
              />
            </label>
            <div className="adm-role">
              <small>SIGNED IN AS</small>
              <b>{isSuper ? "SUPER ADMIN" : "MODERATOR"}</b>
            </div>
            <div className="adm-avatar">{admin?.email[0]?.toUpperCase()}</div>
            <button
              className="adm-logout"
              title="Logout from Admin Console"
              aria-label="Logout from Admin Console"
              onClick={async () => {
                try {
                  await adminApi.logout();
                  setAuth("login");
                  setAdmin(null);
                } catch (caught) {
                  toast.error(errMsg(caught));
                }
              }}
            >
              <LogOut size={17} />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <main className="adm-view">
          {loading || loadedPage !== page ? (
            <Loading />
          ) : error ? (
            <ErrorState message={error} retry={load} />
          ) : (
            <PageView
              page={page}
              data={data}
              search={search}
              isSuper={isSuper}
              open={setSelected}
              refresh={load}
              confirm={setModal}
              openCreate={setCreate}
            />
          )}
        </main>
      </section>
      {selected && (
        <DetailDrawer
          item={selected}
          isSuper={isSuper}
          close={() => setSelected(null)}
          refresh={async () => {
            setSelected(null);
            await load();
          }}
          confirm={setModal}
        />
      )}
      {modal && <ReasonModal {...modal} close={() => setModal(null)} />}
      {create === "incident" && (
        <CreateIncidentModal
          close={() => setCreate(null)}
          done={async () => {
            setCreate(null);
            await load();
          }}
        />
      )}
      {create === "user" && (
        <CreateAdminModal
          close={() => setCreate(null)}
          done={async () => {
            setCreate(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AdminLogin({
  stage,
  setup,
  onPassword,
  onReady,
}: {
  stage: string;
  setup: { qrDataUrl: string; manualKey: string } | null;
  onPassword: (s: { qrDataUrl: string; manualKey: string } | null) => void;
  onReady: (a: AdminIdentity) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (stage === "login") {
        const r = await adminApi.login(email, password);
        onPassword(r.totpSetup ?? null);
      } else {
        const r = await adminApi.verify2fa(code);
        onReady(r.admin);
      }
    } catch (x) {
      setError(errMsg(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="adm-login">
      <section className="adm-login-art">
        <div className="adm-login-brand">
          <div className="adm-mark">A</div>
          <b>MAMLADIBE · ACCESS CONTROL</b>
        </div>
        <div>
          <span>PRIVATE OPERATIONS</span>
          <h1>
            সংবেদনশীল রিপোর্ট।
            <br />
            <em>নিরাপদ প্রবেশ।</em>
          </h1>
          <p>Moderator ও Super Admin-এর জন্য password, TOTP এবং short secure session.</p>
        </div>
        <small>Public ব্যবহারকারীদের কোনো account বা login প্রয়োজন নেই।</small>
      </section>
      <form onSubmit={submit} className="adm-login-form">
        <div className="adm-step">STEP {stage === "login" ? "1" : "2"} OF 2</div>
        <h2>{stage === "login" ? "Sign in to console" : "Two-factor verification"}</h2>
        <p>
          {stage === "login"
            ? "আপনার অনুমোদিত admin account ব্যবহার করুন।"
            : "Authenticator app-এর 6-digit code দিন।"}
        </p>
        {stage === "login" ? (
          <>
            <label>EMAIL ADDRESS</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
            <label>PASSWORD</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </>
        ) : (
          <>
            {setup && (
              <div className="adm-setup">
                <b>প্রথমবার 2FA setup</b>
                <img src={setup.qrDataUrl} alt="TOTP QR code" />
                <code>{setup.manualKey}</code>
              </div>
            )}
            <label>6-DIGIT TOTP CODE</label>
            <input
              className="adm-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoComplete="one-time-code"
            />
          </>
        )}
        {error && (
          <div className="adm-form-error">
            <AlertTriangle size={15} />
            {error}
          </div>
        )}
        <button disabled={busy} className="adm-primary">
          {busy ? "Please wait..." : stage === "login" ? "Continue to 2FA" : "Enter control center"}
          <ChevronRight size={16} />
        </button>
      </form>
    </div>
  );
}

function PageView({
  page,
  data,
  search,
  isSuper,
  open,
  refresh,
  confirm,
  openCreate,
}: {
  page: Page;
  data: unknown;
  search: string;
  isSuper: boolean;
  open: (x: AnyRecord) => void;
  refresh: () => Promise<void>;
  confirm: (x: {
    title: string;
    help: string;
    run: (r: string) => Promise<void>;
    extra?: ReactNode;
  }) => void;
  openCreate: (kind: "incident" | "user") => void;
}) {
  if (page === "dashboard") return <Dashboard data={data as DashboardData} />;
  if (page === "settings")
    return (
      <SettingsPage
        data={data as { freeze_posting: boolean; freeze_comments: boolean }}
        refresh={refresh}
        confirm={confirm}
      />
    );
  const items = ((data as { items?: AnyRecord[] })?.items ?? []).filter(
    (x) => !search || JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
  );
  const [eyebrow, title, sub] = {
    incidents: [
      "MODERATION / 02",
      "Incident reports",
      "Public ও team-posted incident review করুন।",
    ],
    comments: [
      "COMMUNITY / 03",
      "Comment moderation",
      "Comment visibility, redaction ও removal workflow.",
    ],
    reports: [
      "TRIAGE / 04",
      "Flag report queue",
      "Flag মানেই verdict নয়; প্রতিটি report মানুষ review করবে।",
    ],
    actors: [
      "TRUST / 05",
      "Anonymous actor intelligence",
      "Browser-based pseudonymous activity, কোনো real identity নয়।",
    ],
    audit: [
      "ACCOUNTABILITY / 06",
      "Immutable audit log",
      "Admin action, target, reason ও timestamp.",
    ],
    users: ["ACCESS / 07", "Admin accounts", "Super Admin managed access এবং 2FA state."],
  }[page] as [string, string, string];
  return (
    <>
      <SectionHead
        eyebrow={eyebrow}
        title={title}
        sub={sub}
        action={
          page === "incidents" || page === "users" ? (
            <button
              className="adm-head-action"
              onClick={() => openCreate(page === "incidents" ? "incident" : "user")}
            >
              <Plus size={15} /> {page === "incidents" ? "Team incident" : "Add admin"}
            </button>
          ) : undefined
        }
      />
      <DemoBar text="Live backend data · Protected by HttpOnly session, TOTP, RBAC and CSRF" />
      {page === "users" && (
        <div className="adm-setup-guide">
          <ShieldCheck size={18} />
          <div>
            <b>“Setup required” কীভাবে enabled হবে?</b>
            <span>
              Account owner-কে তার email ও initial password দিয়ে /admin-এ sign in করতে হবে। প্রথম
              login-এ QR scan করে valid 6-digit code দিলেই 2FA automatically enabled হবে। Super
              Admin অন্য কারও TOTP নিজে enable করতে পারবেন না।
            </span>
          </div>
        </div>
      )}
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>{title}</h3>
          <span>{items.length} records</span>
        </div>
        {items.length === 0 ? (
          <Empty />
        ) : (
          <div className="adm-table-wrap">
            <table>
              <thead>
                <tr>
                  {columns(page).map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <Row
                    key={(item as { id?: string }).id ?? i}
                    page={page}
                    item={item}
                    isSuper={isSuper}
                    open={open}
                    confirm={confirm}
                    refresh={refresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function columns(page: Page) {
  return page === "incidents"
    ? ["Incident", "Category", "Location", "Status", "Created", "Action"]
    : page === "comments"
      ? ["Comment", "Incident", "Actor", "Status", "Created", "Action"]
      : page === "reports"
        ? ["Concern", "Target", "Flags", "Status", "Created", "Action"]
        : page === "actors"
          ? ["Actor", "Last seen", "History", "Restriction", "Action"]
          : page === "audit"
            ? ["Action", "Admin", "Target", "Reason", "When"]
            : ["Admin account", "Role", "2FA", "Status", "Last session", "Action"];
}
function Row({
  page,
  item,
  open,
  confirm,
  refresh,
}: {
  page: Page;
  item: AnyRecord;
  isSuper: boolean;
  open: (x: AnyRecord) => void;
  confirm: (x: { title: string; help: string; run: (r: string) => Promise<void> }) => void;
  refresh: () => Promise<void>;
}) {
  if (page === "incidents") {
    const x = item as AdminIncident;
    return (
      <tr>
        <td>
          <b>{x.title}</b>
          <small>{x.trackingId}</small>
        </td>
        <td>{x.category}</td>
        <td>{x.areaName ?? x.district ?? "—"}</td>
        <td>
          <Status value={x.status} />
        </td>
        <td>{fmt(x.createdAt)}</td>
        <td>
          <button onClick={() => open(x)}>Review</button>
        </td>
      </tr>
    );
  }
  if (page === "comments") {
    const x = item as AdminComment;
    return (
      <tr>
        <td>
          <b>{x.body ?? "[Removed]"}</b>
          <small>{x.type}</small>
        </td>
        <td>{x.trackingId ?? "—"}</td>
        <td>
          <code>{x.actorIdShort}…</code>
        </td>
        <td>
          <Status value={x.status} />
        </td>
        <td>{fmt(x.createdAt)}</td>
        <td>
          <button onClick={() => open(x)}>Review</button>
        </td>
      </tr>
    );
  }
  if (page === "reports") {
    const x = item as AdminReport;
    return (
      <tr>
        <td>
          <b>{x.reason}</b>
          <small>{x.note ?? "No reporter note"}</small>
        </td>
        <td>{x.targetType}</td>
        <td>{x.totalFlagsOnTarget}</td>
        <td>
          <Status value={x.status} />
        </td>
        <td>{fmt(x.createdAt)}</td>
        <td>
          <button onClick={() => open(x)}>Review</button>
        </td>
      </tr>
    );
  }
  if (page === "actors") {
    const x = item as AdminActor;
    return (
      <tr>
        <td>
          <b>
            <code>{x.actorIdShort}…</code>
          </b>
          <small>{x.notes ?? "No internal notes"}</small>
        </td>
        <td>{fmt(x.lastSeenAt)}</td>
        <td>{x.restrictionHistoryCount}</td>
        <td>
          <Status value={x.restriction ? "restricted" : "active"} />
        </td>
        <td>
          <button onClick={() => open(x)}>Inspect</button>
        </td>
      </tr>
    );
  }
  if (page === "audit") {
    const x = item as AuditItem;
    return (
      <tr>
        <td>
          <b>{x.action}</b>
        </td>
        <td>{x.adminEmail ?? x.adminId.slice(0, 8)}</td>
        <td>
          <code>
            {x.targetType ?? "—"} {x.targetId?.slice(0, 8) ?? ""}
          </code>
        </td>
        <td>{x.reason ?? "—"}</td>
        <td>{fmt(x.createdAt)}</td>
      </tr>
    );
  }
  const x = item as AdminUser;
  return (
    <tr>
      <td>
        <b>{x.email}</b>
        <small>{x.id.slice(0, 8)}</small>
      </td>
      <td>{x.role}</td>
      <td>
        <Status value={x.totpEnabled ? "enabled" : "setup required"} />
      </td>
      <td>
        <Status value={x.active ? "active" : "inactive"} />
      </td>
      <td>{fmt(x.lastLoginAt)}</td>
      <td>
        <button
          onClick={() =>
            confirm({
              title: x.totpEnabled ? "Reset 2FA" : "Regenerate 2FA setup",
              help: x.totpEnabled
                ? "বর্তমান session revoke হবে এবং নতুন TOTP setup প্রয়োজন হবে।"
                : "নতুন TOTP secret তৈরি হবে। এরপর account owner-কে initial password দিয়ে login করে নতুন QR scan করতে হবে।",
              run: async (reason) => {
                await adminApi.reset2fa(x.id, reason);
                toast.success(x.totpEnabled ? "2FA reset হয়েছে" : "2FA setup regenerated");
                await refresh();
              },
            })
          }
        >
          {x.totpEnabled ? "Reset 2FA" : "Regenerate setup"}
        </button>
      </td>
    </tr>
  );
}

function Dashboard({ data }: { data: DashboardData }) {
  const c = data?.counts ?? {
    newIncidentsToday: 0,
    openFlags: 0,
    hiddenIncidents: 0,
    activeRestrictions: 0,
    commentsToday: 0,
  };
  const k = [
    ["New incidents today", c.newIncidentsToday, FileText],
    ["Open flag reports", c.openFlags, Flag],
    ["Hidden content", c.hiddenIncidents, AlertTriangle],
    ["Active restrictions", c.activeRestrictions, Shield],
  ] as const;
  return (
    <>
      <SectionHead
        eyebrow="OPERATIONS / 01"
        title="সড়কের রিপোর্ট, দায়িত্বশীল সিদ্ধান্ত।"
        sub="এক জায়গায় Report, Moderation, Risk ও Audit পর্যবেক্ষণ।"
      />
      <DemoBar text="LIVE MODE · Backend-connected administrative operations" />
      <div className="adm-kpis">
        {k.map(([label, value, Icon]) => (
          <article key={label}>
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{value}</strong>
            <small>Current backend state</small>
          </article>
        ))}
      </div>
      <div className="adm-split">
        <section className="adm-panel">
          <div className="adm-panel-head">
            <h3>Recent audit trail</h3>
            <span>Latest actions</span>
          </div>
          <div className="adm-activity">
            {data?.recentAudit?.map((x) => (
              <div key={x.id}>
                <i />
                <p>
                  <b>{x.action}</b>
                  <small>{x.reason ?? x.targetType ?? "System action"}</small>
                </p>
                <time>{fmt(x.createdAt)}</time>
              </div>
            )) || <Empty />}
          </div>
        </section>
        <section className="adm-panel adm-chart">
          <div className="adm-panel-head">
            <h3>Platform activity</h3>
            <span>Today</span>
          </div>
          <div className="adm-bars">
            {[35, 56, 42, 78, 50, 68, 61].map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="adm-human">
            <ShieldCheck size={18} />
            <p>
              <b>Human moderation only</b>
              <small>Support বা Dispute সত্য-মিথ্যা নির্ধারণ করে না।</small>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

function DetailDrawer({
  item,
  isSuper,
  close,
  refresh,
  confirm,
}: {
  item: AnyRecord;
  isSuper: boolean;
  close: () => void;
  refresh: () => Promise<void>;
  confirm: (x: {
    title: string;
    help: string;
    run: (r: string) => Promise<void>;
    extra?: ReactNode;
  }) => void;
}) {
  const kind =
    "trackingId" in item
      ? "incident"
      : "incidentId" in item
        ? "comment"
        : "targetType" in item
          ? "report"
          : "restrictionHistoryCount" in item
            ? "actor"
            : "other";
  const action = (title: string, help: string, run: (r: string) => Promise<unknown>) =>
    confirm({
      title,
      help,
      run: async (r) => {
        await run(r);
        toast.success("Action recorded");
        await refresh();
      },
    });
  return (
    <div
      className="adm-drawer-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside className="adm-drawer">
        <header>
          <b>{kind.toUpperCase()} / DETAIL</b>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div className="adm-drawer-body">
          <code>{(item as { id: string }).id}</code>
          <h2>
            {kind === "incident"
              ? (item as AdminIncident).title
              : kind === "comment"
                ? "Comment moderation"
                : kind === "report"
                  ? `${(item as AdminReport).reason} concern`
                  : kind === "actor"
                    ? `Anonymous ${(item as AdminActor).actorIdShort}…`
                    : "Details"}
          </h2>
          {"status" in item && <Status value={String(item.status)} />}
          <pre>{JSON.stringify(item, null, 2)}</pre>
        </div>
        <footer>
          {kind === "incident" && (
            <>
              <button
                onClick={() =>
                  action("Hide incident", "Public view থেকে incident hide হবে।", (r) =>
                    adminApi.incidentAction((item as AdminIncident).id, "hide", r),
                  )
                }
              >
                Hide
              </button>
              <button
                onClick={() =>
                  action(
                    "Soft delete incident",
                    "Retention window পর্যন্ত recoverable থাকবে।",
                    (r) => adminApi.incidentAction((item as AdminIncident).id, "delete", r),
                  )
                }
              >
                Soft delete
              </button>
              {isSuper && (
                <button
                  className="danger"
                  onClick={() =>
                    action("Permanent delete", "এটি production-এ ফেরানো যাবে না।", (r) =>
                      adminApi.incidentAction((item as AdminIncident).id, "permanent", r),
                    )
                  }
                >
                  Permanent delete
                </button>
              )}
            </>
          )}
          {kind === "comment" && (
            <>
              <button
                onClick={() =>
                  action("Hide comment", "Comment public view থেকে hide হবে।", (r) =>
                    adminApi.commentAction((item as AdminComment).id, "hide", r),
                  )
                }
              >
                Hide
              </button>
              <button
                className="danger"
                onClick={() =>
                  action(
                    "Soft delete comment",
                    "Comment retention window পর্যন্ত recoverable থাকবে।",
                    (r) => adminApi.commentAction((item as AdminComment).id, "delete", r),
                  )
                }
              >
                Soft delete
              </button>
            </>
          )}
          {kind === "report" && (item as AdminReport).status === "open" && (
            <>
              <button
                onClick={() =>
                  action("Dismiss report", "Report review শেষে dismissed হবে।", (r) =>
                    adminApi.resolveReport((item as AdminReport).id, "dismissed", r),
                  )
                }
              >
                Dismiss
              </button>
              <button
                className="primary"
                onClick={() =>
                  action("Mark actioned", "Report review শেষে actioned হবে।", (r) =>
                    adminApi.resolveReport((item as AdminReport).id, "actioned", r),
                  )
                }
              >
                Mark actioned
              </button>
            </>
          )}
          {kind === "actor" &&
            ((item as AdminActor).restriction ? (
              <button
                onClick={() =>
                  action("Unrestrict actor", "Active restriction তুলে নেওয়া হবে।", (r) =>
                    adminApi.unrestrictActor((item as AdminActor).id, r),
                  )
                }
              >
                Unrestrict
              </button>
            ) : (
              <button
                className="danger"
                onClick={() =>
                  action("Restrict actor", "সাত দিনের জন্য public actions বন্ধ হবে।", (r) =>
                    adminApi.restrictActor(
                      (item as AdminActor).id,
                      "all",
                      new Date(Date.now() + 7 * 864e5).toISOString(),
                      r,
                    ),
                  )
                }
              >
                Restrict 7 days
              </button>
            ))}
        </footer>
      </aside>
    </div>
  );
}

function SettingsPage({
  data,
  refresh,
  confirm,
}: {
  data: { freeze_posting: boolean; freeze_comments: boolean };
  refresh: () => Promise<void>;
  confirm: (x: { title: string; help: string; run: (r: string) => Promise<void> }) => void;
}) {
  return (
    <>
      <SectionHead
        eyebrow="SYSTEM / 08"
        title="Platform controls"
        sub="High-impact safety switches শুধু Super Admin পরিবর্তন করতে পারবেন।"
      />
      <DemoBar text="Every settings change requires a reason and creates an audit entry" />
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>Safety switches</h3>
          <Status value="super admin only" />
        </div>
        {(
          [
            ["freeze_posting", "Freeze incident posting", data.freeze_posting],
            ["freeze_comments", "Freeze comments", data.freeze_comments],
          ] as const
        ).map(([key, label, on]) => (
          <div className="adm-setting" key={key}>
            <Shield size={20} />
            <div>
              <b>{label}</b>
              <small>{on ? "Public action currently paused" : "Public action is available"}</small>
            </div>
            <button
              className={`adm-toggle ${on ? "on" : ""}`}
              onClick={() =>
                confirm({
                  title: `${on ? "Disable" : "Enable"} ${label}`,
                  help: "এই পরিবর্তন public platform-এর behaviour প্রভাবিত করবে।",
                  run: async (reason) => {
                    await adminApi.updateSettings({ [key]: !on, reason });
                    toast.success("Platform setting updated");
                    await refresh();
                  },
                })
              }
            >
              <i />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function CreateIncidentModal({ close, done }: { close: () => void; done: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<
    | "road_accident"
    | "traffic_violation"
    | "police_misconduct"
    | "infrastructure"
    | "public_safety"
    | "other"
  >("road_accident");
  const [areaName, setAreaName] = useState("");
  const [roadName, setRoadName] = useState("");
  const [lat, setLat] = useState("23.8103");
  const [lng, setLng] = useState("90.4125");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminApi.createIncident({
        title,
        description,
        category,
        incidentAt: new Date().toISOString(),
        location: { lat: Number(lat), lng: Number(lng) },
        areaName,
        district: "Dhaka",
        roadName,
        reason,
      });
      toast.success("Team incident published");
      await done();
    } catch (caught) {
      setError(errMsg(caught));
      setBusy(false);
    }
  }
  return (
    <div className="adm-modal-wrap">
      <form className="adm-modal adm-create-modal" onSubmit={submit}>
        <h2>Create team incident</h2>
        <p>এটি স্পষ্টভাবে Mamladibe team-posted incident হিসেবে প্রকাশ হবে।</p>
        <label>INCIDENT TITLE</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} minLength={5} required />
        <label>CATEGORY</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          <option value="road_accident">Road accident</option>
          <option value="traffic_violation">Traffic violation</option>
          <option value="police_misconduct">Police misconduct</option>
          <option value="infrastructure">Infrastructure</option>
          <option value="public_safety">Public safety</option>
          <option value="other">Other</option>
        </select>
        <label>DESCRIPTION</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          minLength={15}
          rows={3}
          required
        />
        <div className="adm-field-grid">
          <div>
            <label>AREA</label>
            <input value={areaName} onChange={(e) => setAreaName(e.target.value)} required />
          </div>
          <div>
            <label>ROAD</label>
            <input value={roadName} onChange={(e) => setRoadName(e.target.value)} />
          </div>
          <div>
            <label>LATITUDE</label>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              required
            />
          </div>
          <div>
            <label>LONGITUDE</label>
            <input
              type="number"
              step="any"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              required
            />
          </div>
        </div>
        <label>REASON / SOURCE NOTE</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required />
        {error && <div className="adm-form-error">{error}</div>}
        <div>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="adm-primary" disabled={busy}>
            {busy ? "Publishing..." : "Publish team incident"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateAdminModal({ close, done }: { close: () => void; done: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"moderator" | "super">("moderator");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminApi.createUser(email, password, role, reason);
      toast.success("Admin account created; 2FA setup is required at first login");
      await done();
    } catch (caught) {
      setError(errMsg(caught));
      setBusy(false);
    }
  }
  return (
    <div className="adm-modal-wrap">
      <form className="adm-modal adm-create-modal" onSubmit={submit}>
        <h2>Add admin account</h2>
        <p>প্রথম login-এ নতুন admin-কে TOTP setup করতে হবে।</p>
        <label>ADMIN EMAIL</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>INITIAL PASSWORD</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
          autoComplete="new-password"
          required
        />
        <label>ROLE</label>
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="moderator">Moderator</option>
          <option value="super">Super Admin</option>
        </select>
        <label>REASON</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required />
        {error && <div className="adm-form-error">{error}</div>}
        <div>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="adm-primary" disabled={busy}>
            {busy ? "Creating..." : "Create admin"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReasonModal({
  title,
  help,
  run,
  close,
  extra,
}: {
  title: string;
  help: string;
  run: (reason: string) => Promise<void>;
  close: () => void;
  extra?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 6) {
      setError("ন্যূনতম ৬ অক্ষরে কারণ লিখুন।");
      return;
    }
    setBusy(true);
    try {
      await run(reason.trim());
      close();
    } catch (caught) {
      setError(errMsg(caught));
      setBusy(false);
    }
  }
  return (
    <div className="adm-modal-wrap">
      <form className="adm-modal" onSubmit={submit}>
        <h2>{title}</h2>
        <p>{help}</p>
        {extra}
        <label>REASON / REVIEW NOTE</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} autoFocus />
        {error && <div className="adm-form-error">{error}</div>}
        <div>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="adm-primary" disabled={busy}>
            {busy ? "Working..." : "Confirm action"}
          </button>
        </div>
      </form>
    </div>
  );
}
function SectionHead({
  eyebrow,
  title,
  sub,
  action,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  action?: ReactNode;
}) {
  return (
    <div className="adm-heading">
      <span>{eyebrow}</span>
      <div>
        <div>
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
        {action ?? (
          <em>
            <i /> LIVE OPERATIONS
          </em>
        )}
      </div>
    </div>
  );
}
function DemoBar({ text }: { text: string }) {
  return (
    <div className="adm-demo">
      <b>{text}</b>
      <span>
        <LockKeyhole size={14} /> PRIVACY FIRST
      </span>
    </div>
  );
}
function Status({ value }: { value?: string | null }) {
  const safeValue = typeof value === "string" && value.trim() ? value.trim() : "unknown";
  return (
    <span className={`adm-badge ${safeValue.replace(/\s/g, "-").toLowerCase()}`}>{safeValue}</span>
  );
}
function Loading() {
  return (
    <div className="adm-skeleton">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
function Empty() {
  return (
    <div className="adm-empty">
      <ClipboardList size={28} />
      <b>কোনো record পাওয়া যায়নি</b>
      <span>Filter বা backend data পরিবর্তন করে আবার চেষ্টা করুন।</span>
    </div>
  );
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="adm-empty">
      <AlertTriangle size={30} />
      <b>Admin data load হয়নি</b>
      <span>{message}</span>
      <button onClick={retry}>Try again</button>
    </div>
  );
}
