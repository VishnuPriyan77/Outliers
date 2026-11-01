"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  Globe2,
  LayoutDashboard,
  Leaf,
  MapPin,
  MessageSquareText,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  Category,
  Complaint,
  Department,
  Draft,
  Evidence,
  Lang,
  Status,
  allowedActions,
  categories,
  categoryNames,
  classify,
  departments,
  draftSchema,
  route,
  statusNames,
  urgentSignal,
  validateFile,
} from "@/lib/domain";
import { demoMode, supabase } from "@/lib/supabase";
import * as repo from "@/lib/repository";
type View = "overview" | "report" | "track" | "official";
const initial = { description: "", location: "", duration: "", impact: "" };
function when(t: string, lang: Lang) {
  return new Date(t).toLocaleString(lang === "ta" ? "ta-IN" : "en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
export default function CivicLens() {
  const [lang, setLang] = useState<Lang>("en"),
    [view, setView] = useState<View>("overview"),
    [cases, setCases] = useState<Complaint[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [user, setUser] = useState<string | null>(null),
    [userId, setUserId] = useState<string | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [officer, setOfficer] = useState<Department | null>(null),
    [demoDepartment, setDemoDepartment] = useState<Department>("roads");
  const [step, setStep] = useState(0),
    [answers, setAnswers] = useState(initial),
    [input, setInput] = useState(""),
    [category, setCategory] = useState<Category>("other"),
    [urgent, setUrgent] = useState(false),
    [chennai, setChennai] = useState(true),
    [ownership, setOwnership] = useState<"municipal" | "unknown">("unknown"),
    [consent, setConsent] = useState(false),
    [pendingFiles, setPendingFiles] = useState<File[]>([]),
    [aiQuestion, setAiQuestion] = useState(""),
    [source, setSource] = useState("guided");
  const [filter, setFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState("all"),
    [note, setNote] = useState(""),
    [assignTo, setAssignTo] = useState<Department>("review");
  const fileRef = useRef<HTMLInputElement>(null),
    messageRef = useRef<HTMLTextAreaElement>(null);
  const t = (en: string, ta: string) => (lang === "en" ? en : ta);
  async function refresh() {
    const values = await repo.listComplaints();
    setCases(values);
    return values;
  }
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (demoMode) {
      refresh()
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      return;
    }
    if (!supabase) {
      setError(
        "Supabase is not configured. Add the environment variables and redeploy.",
      );
      setLoading(false);
      return;
    }
    const sync = async () => {
      try {
        const {
          data: { session },
        } = await supabase!.auth.getSession();
        setUser(session?.user.email || null);
        setUserId(session?.user.id || null);
        if (session) {
          const { data, error } = await supabase!
            .from("officials")
            .select("department")
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (error) throw error;
          setOfficer(data?.department || null);
          await refresh();
        } else {
          setOfficer(null);
          setCases([]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load account.");
      } finally {
        setLoading(false);
      }
    };
    void sync();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => void sync(), 0);
    });
    return () => subscription.unsubscribe();
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const activeDepartment = demoMode ? demoDepartment : officer;
  const c = cases.find((c) => c.id === selected);
  const isOfficial = view === "official";
  const role = isOfficial ? "officer" : "citizen";
  const ownsCase = demoMode || c?.citizen_id === userId;
  const questions = [
    t(
      "What would you like to report?",
      "எந்தப் பிரச்சினையைப் புகாரளிக்க விரும்புகிறீர்கள்?",
    ),
    aiQuestion ||
      t(
        "Where is this happening? Include the street, area and a nearby landmark.",
        "இது எங்கு நடக்கிறது? தெரு, பகுதி மற்றும் அருகிலுள்ள அடையாளத்தைச் சொல்லுங்கள்.",
      ),
    t("How long has this been happening?", "இது எவ்வளவு காலமாக நடக்கிறது?"),
    t(
      "Who is affected, and how? Is anyone in immediate danger?",
      "யார் பாதிக்கப்படுகிறார்கள்? எப்படி? உடனடி ஆபத்து உள்ளதா?",
    ),
  ];
  const keys = Object.keys(initial) as (keyof typeof initial)[];
  async function answer() {
    await run(async () => {
      const text = input.trim();
      const min = step === 0 ? 10 : step === 1 ? 5 : step === 3 ? 3 : 1;
      if (
        text.length < min ||
        text.length >
          (step === 0 ? 3000 : step === 1 ? 500 : step === 2 ? 200 : 1000)
      )
        throw new Error(
          t(
            `Please enter ${min} or more characters within the field limit.`,
            `குறைந்தது ${min} எழுத்துகள் உள்ளிடவும்.`,
          ),
        );
      setAnswers((v) => ({ ...v, [keys[step]]: text }));
      if (step === 0) {
        setCategory(classify(text));
        setUrgent(urgentSignal(text));
        if (!demoMode) {
          try {
            const result = await repo.interview(text, lang);
            setCategory(result.category);
            setUrgent(result.urgent);
            setAiQuestion(result.question);
            setSource(result.source);
            if (result.notice) setNotice(result.notice);
          } catch {
            setNotice(
              t(
                "AI is unavailable. You can continue with guided intake.",
                "AI கிடைக்கவில்லை. வழிகாட்டப்பட்ட பதிவைத் தொடரலாம்.",
              ),
            );
          }
        }
      }
      if (step === 3) setUrgent((v) => v || urgentSignal(text));
      setInput("");
      setStep((v) => v + 1);
      setTimeout(() => messageRef.current?.focus(), 0);
    });
  }
  async function confirm() {
    await run(async () => {
      const d = draftSchema.parse({
        ...answers,
        category,
        language: lang,
        chennai,
        ownership,
        urgent,
        consent,
      });
      const created = await repo.submit(d);
      setSelected(created.id);
      setView("track");
      setStep(0);
      setAnswers(initial);
      setConsent(false);
      let failed = 0;
      for (const file of pendingFiles) {
        try {
          await repo.uploadEvidence(created, file, "report");
        } catch {
          failed++;
        }
      }
      setPendingFiles([]);
      await refresh();
      setNotice(
        failed
          ? t(
              `Report saved. ${failed} attachment(s) failed; please upload them again below.`,
              `புகார் சேமிக்கப்பட்டது. ${failed} கோப்புகளை மீண்டும் பதிவேற்றவும்.`,
            )
          : t(
              "Your report is registered. Every update will appear in its timeline.",
              "உங்கள் புகார் பதிவாகியுள்ளது. காலவரிசையில் புதுப்பிப்புகளைக் காணலாம்.",
            ),
      );
    });
  }
  async function filesPicked(files: FileList | null, existing?: Complaint) {
    if (!files) return;
    await run(async () => {
      if (existing) {
        for (const file of Array.from(files))
          await repo.uploadEvidence(
            existing,
            file,
            isOfficial ? "resolution" : "report",
          );
        await refresh();
        setNotice(
          t(
            "Evidence saved. Authenticity remains unverified.",
            "ஆதாரம் சேமிக்கப்பட்டது. உண்மைத்தன்மை சரிபார்க்கப்படவில்லை.",
          ),
        );
      } else {
        const list = Array.from(files);
        if (list.length + pendingFiles.length > 10)
          throw new Error("Ten attachments maximum.");
        for (const file of list)
          validateFile(new Uint8Array(await file.arrayBuffer()), file.size);
        setPendingFiles((v) => [...v, ...list]);
      }
    });
    if (fileRef.current) fileRef.current.value = "";
  }
  function openCase(id: string) {
    setSelected(id);
    setNote("");
    setError("");
    setNotice("");
  }
  function nav(v: View) {
    setView(v);
    setSelected(null);
    setError("");
    setNotice("");
    setNote("");
  }
  const filtered = cases.filter(
    (v) =>
      (isOfficial
        ? v.department === activeDepartment
        : demoMode || v.citizen_id === userId) &&
      `${v.reference} ${v.description} ${v.location}`
        .toLowerCase()
        .includes(filter.toLowerCase()) &&
      (statusFilter === "all" || v.status === statusFilter),
  );
  const active = cases.filter(
    (c) => !["closed", "resolved"].includes(c.status),
  ).length;
  const resolved = cases.filter((c) =>
    ["resolved", "closed"].includes(c.status),
  ).length;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="CivicLens home">
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          Civic<span>Lens</span>
          <span className="brand-dot" />
        </a>
        <div className="city">
          <MapPin size={15} /> Chennai, Tamil Nadu <span className="live-dot" />
        </div>
        <p className="nav-label">
          {t("YOUR CITY, CONNECTED", "உங்கள் நகரம், இணைந்தது")}
        </p>
        <nav>
          <button
            onClick={() => nav("overview")}
            className={view === "overview" ? "nav active" : "nav"}
          >
            <LayoutDashboard size={19} />
            {t("Overview", "மேலோட்டம்")}
          </button>
          <button
            onClick={() => nav("report")}
            className={view === "report" ? "nav active" : "nav"}
          >
            <MessageSquareText size={19} />
            {t("Report an issue", "புகாரளிக்கவும்")}
            <Plus size={16} className="nav-end" />
          </button>
          <button
            onClick={() => nav("track")}
            className={view === "track" ? "nav active" : "nav"}
          >
            <FileCheck2 size={19} />
            {t("My reports", "என் புகார்கள்")}
            <span className="nav-count">{cases.length}</span>
          </button>
        </nav>
        <p className="nav-label authority-label">
          {t("AUTHORITY WORKSPACE", "அதிகாரி பணியிடம்")}
        </p>
        <button
          onClick={() => nav("official")}
          className={view === "official" ? "nav active" : "nav"}
        >
          <Building2 size={19} />
          {t("Official dashboard", "அதிகாரி பலகை")}
        </button>
        <div className="sidebar-bottom">
          <div className="trust-card">
            <ShieldCheck size={25} />
            <strong>
              {t(
                "Your voice. Real visibility.",
                "உங்கள் குரல். வெளிப்படைத்தன்மை.",
              )}
            </strong>
            <p>
              {t(
                "Every report has an owner. Every action leaves a trail.",
                "ஒவ்வொரு புகாருக்கும் பொறுப்பு. ஒவ்வொரு செயலுக்கும் பதிவு.",
              )}
            </p>
            <span>
              {t("Built for a better Chennai", "சிறந்த சென்னைக்காக")} ↗
            </span>
          </div>
          <div className="profile">
            <span className="avatar">
              {(user || "Chennai Citizen").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>
                {demoMode
                  ? t("Chennai citizen", "சென்னை குடிமகன்")
                  : user || t("Welcome, citizen", "வரவேற்கிறோம்")}
              </strong>
              <small>
                {demoMode
                  ? t("Demo workspace", "மாதிரி பணியிடம்")
                  : t("Connected workspace", "இணைக்கப்பட்ட பணியிடம்")}
              </small>
            </div>
            {user && (
              <button
                className="icon-btn"
                aria-label="Sign out"
                onClick={() => void supabase?.auth.signOut()}
              >
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            CivicLens <ChevronRight size={14} />
            <span>{t("Citizen workspace", "குடிமக்கள் பணியிடம்")}</span>
          </div>
          <div className="top-actions">
            <span className="simulation">
              <span className="live-dot" />
              {demoMode
                ? t("Interactive demo", "செயல்படும் மாதிரி")
                : t("Simulated authority network", "மாதிரி அதிகாரி வலையமைப்பு")}
            </span>
            <button
              className="language"
              onClick={() => setLang(lang === "en" ? "ta" : "en")}
            >
              <Globe2 size={15} />
              {lang === "en" ? "தமிழ்" : "English"}
            </button>
          </div>
        </header>
        <main>
          <div className="mode-banner">
            {demoMode
              ? t(
                  "DEMO MODE · Sample reports and new submissions stay in this browser. No government agency is contacted.",
                  "மாதிரி முறை · புகார்கள் இந்த உலாவியில் மட்டுமே சேமிக்கப்படும். அரசு அமைப்பைத் தொடர்புகொள்ளாது.",
                )
              : t(
                  "SIMULATION · Reports are saved securely in CivicLens. Department accounts are fictional; no government agency is contacted.",
                  "மாதிரி · புகார்கள் CivicLens-இல் சேமிக்கப்படும். அதிகாரி கணக்குகள் கற்பனையானவை; அரசு அமைப்பைத் தொடர்புகொள்ளாது.",
                )}
          </div>
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!demoMode && !user ? (
            <section className="auth card">
              <span className="eyebrow">CIVICLENS / CHENNAI</span>
              <h1>
                {t("Your city. Your voice.", "உங்கள் நகரம். உங்கள் குரல்.")}
              </h1>
              <p>
                {t(
                  "Sign in to submit a report and follow its progress.",
                  "புகாரளிக்கவும் அதன் முன்னேற்றத்தைப் பார்க்கவும் உள்நுழையவும்.",
                )}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (!supabase)
                      throw new Error("Supabase is not configured.");
                    const { error } = await supabase.auth.signInWithPassword({
                      email,
                      password,
                    });
                    if (error) throw error;
                  });
                }}
              >
                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button className="btn primary" disabled={busy || loading}>
                  Sign in <ArrowRight size={16} />
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy || !email || password.length < 8}
                  onClick={() =>
                    void run(async () => {
                      if (!supabase)
                        throw new Error("Supabase is not configured.");
                      const { error } = await supabase.auth.signUp({
                        email,
                        password,
                      });
                      if (error) throw error;
                      setNotice(
                        "Account created. Check your email to confirm it, then sign in.",
                      );
                    })
                  }
                >
                  Create citizen account
                </button>
              </form>
              <small>
                Officer access is provisioned by the project administrator.
              </small>
            </section>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <div className="page-title">
                    <div>
                      <span className="eyebrow">
                        {t(
                          "SMALL ACTIONS. BETTER NEIGHBOURHOODS.",
                          "சிறிய செயல்கள். சிறந்த சுற்றுப்புறம்.",
                        )}
                      </span>
                      <h1>
                        {t(
                          "A better city starts with you.",
                          "சிறந்த நகரம் உங்களிடமிருந்து.",
                        )}
                      </h1>
                      <p>
                        {t(
                          "Spot an issue. Speak up. See what happens next.",
                          "பிரச்சினையைக் கண்டறியுங்கள். குரல் கொடுங்கள். முன்னேற்றத்தைக் காணுங்கள்.",
                        )}
                      </p>
                    </div>
                    <span className="location-tag">
                      <MapPin size={14} /> Chennai
                    </span>
                  </div>
                  <section className="hero">
                    <div className="hero-copy">
                      <span className="hero-kicker">
                        <span className="live-dot" />
                        {t(
                          "YOUR NEIGHBOURHOOD MATTERS",
                          "உங்கள் சுற்றுப்புறம் முக்கியம்",
                        )}
                      </span>
                      <h2>
                        {t("See something?", "பிரச்சினையைக் கண்டீர்களா?")}
                        <br />
                        <em>
                          {t("Let’s make it better.", "அதைச் சரி செய்வோம்.")}
                        </em>
                      </h2>
                      <p>
                        {t(
                          "From a broken streetlight to a leaking pipe, tell us in your own words. We’ll help it reach the right desk.",
                          "பழுதான தெருவிளக்கு முதல் உடைந்த குழாய் வரை, உங்கள் சொற்களில் சொல்லுங்கள். சரியான துறைக்கு வழிகாட்டுவோம்.",
                        )}
                      </p>
                      <button
                        className="btn white"
                        onClick={() => nav("report")}
                      >
                        <Plus size={19} />
                        {t("Report an issue", "புகாரளிக்கவும்")}
                        <ArrowRight size={17} />
                      </button>
                      <span className="hero-foot">
                        <MessageSquareText size={14} />
                        {t(
                          "English or Tamil. One conversation.",
                          "ஆங்கிலம் அல்லது தமிழ். ஒரே உரையாடல்.",
                        )}
                      </span>
                    </div>
                    <CityIllustration />
                    <div className="hero-note">
                      <span className="check-icon">
                        <Check size={15} />
                      </span>
                      <div>
                        <strong>
                          {t(
                            "Every action, accounted for.",
                            "ஒவ்வொரு செயலும் பதிவாகும்.",
                          )}
                        </strong>
                        <small>
                          {t(
                            "A clear trail from report to resolution",
                            "புகார் முதல் தீர்வு வரை தெளிவான பதிவு",
                          )}
                        </small>
                      </div>
                    </div>
                  </section>
                  <div className="stats">
                    <Stat
                      icon={<FileCheck2 size={21} />}
                      value={cases.length}
                      label={t(
                        "Reports in your workspace",
                        "உங்கள் பணியிடப் புகார்கள்",
                      )}
                      foot={t(
                        demoMode
                          ? "Includes illustrative reports"
                          : "Your accessible reports",
                        demoMode
                          ? "மாதிரி புகார்கள் உட்பட"
                          : "உங்கள் அணுகலுள்ள புகார்கள்",
                      )}
                    />
                    <Stat
                      icon={<Clock3 size={21} />}
                      value={active}
                      label={t("Awaiting action", "செயலுக்காகக் காத்திருப்பு")}
                      foot={t(
                        "Visible, accountable progress",
                        "வெளிப்படையான முன்னேற்றம்",
                      )}
                    />
                    <Stat
                      icon={<CheckCircle2 size={21} />}
                      value={resolved}
                      label={t(
                        "Resolution submitted",
                        "தீர்வு சமர்ப்பிக்கப்பட்டது",
                      )}
                      foot={t(
                        "Citizen verification comes next",
                        "அடுத்து குடிமக்கள் சரிபார்ப்பு",
                      )}
                    />
                  </div>
                  <section className="how">
                    <div className="section-head">
                      <h2>
                        {t(
                          "From your street to the right desk",
                          "உங்கள் தெருவிலிருந்து சரியான துறைக்கு",
                        )}
                      </h2>
                      <span>
                        {t(
                          "A simpler way to be heard",
                          "உங்கள் குரலுக்கான எளிய வழி",
                        )}
                      </span>
                    </div>
                    <div className="how-grid">
                      {[
                        [
                          MessageSquareText,
                          t(
                            "Tell us what’s wrong",
                            "பிரச்சினையைச் சொல்லுங்கள்",
                          ),
                          t(
                            "A guided conversation, in your language.",
                            "உங்கள் மொழியில் வழிகாட்டப்பட்ட உரையாடல்.",
                          ),
                        ],
                        [
                          Building2,
                          t("Reach the right team", "சரியான குழுவை அணுகுங்கள்"),
                          t(
                            "Confirm the issue. We route it transparently.",
                            "பிரச்சினையை உறுதிசெய்து வெளிப்படையாக வழிமாற்றுங்கள்.",
                          ),
                        ],
                        [
                          ShieldCheck,
                          t(
                            "Follow every step",
                            "ஒவ்வொரு படியையும் தொடருங்கள்",
                          ),
                          t(
                            "Updates, evidence and a clear action history.",
                            "புதுப்பிப்புகள், ஆதாரங்கள், தெளிவான செயல் பதிவு.",
                          ),
                        ],
                      ].map(([Icon, title, desc], i) => {
                        const I = Icon as typeof Building2;
                        return (
                          <div className="how-item" key={i}>
                            <div className="step-icon">
                              <I size={22} />
                              <span>0{i + 1}</span>
                            </div>
                            <h3>{title as string}</h3>
                            <p>{desc as string}</p>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  <div className="section-head reports-heading">
                    <h2>{t("Recent reports", "சமீபத்திய புகார்கள்")}</h2>
                    <button className="text-btn" onClick={() => nav("track")}>
                      {t("View all reports", "அனைத்து புகார்களும்")}{" "}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  {loading ? (
                    <p role="status">Loading reports…</p>
                  ) : (
                    <ReportList
                      cases={cases.slice(0, 3)}
                      lang={lang}
                      onOpen={(id) => {
                        setView("track");
                        openCase(id);
                      }}
                    />
                  )}
                </>
              )}
              {view === "report" && (
                <>
                  <div className="page-title">
                    <div>
                      <span className="eyebrow">
                        {t(
                          "LET’S START A CONVERSATION",
                          "உரையாடலைத் தொடங்குவோம்",
                        )}
                      </span>
                      <h1>
                        {t(
                          "What needs a little attention?",
                          "எதற்குக் கவனம் தேவை?",
                        )}
                      </h1>
                      <p>
                        {t(
                          "We’ll help turn your concern into a clear, trackable report.",
                          "உங்கள் பிரச்சினையைத் தெளிவான, கண்காணிக்கக்கூடிய புகாராக மாற்றுவோம்.",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="intake-layout">
                    <section className="card chat">
                      <div className="chat-header">
                        <span className="assistant-icon">
                          <Sparkles size={20} />
                        </span>
                        <div>
                          <strong>
                            {t("CivicLens assistant", "CivicLens உதவியாளர்")}
                          </strong>
                          <small>
                            <span className="live-dot" />
                            {source === "openrouter" ? "OpenRouter · " : ""}
                            {t(
                              "Guided grievance intake",
                              "வழிகாட்டப்பட்ட புகார் பதிவு",
                            )}
                          </small>
                        </div>
                        <span className="step-label">
                          {Math.min(step + 1, 5)} / 5
                        </span>
                      </div>
                      <div className="progress">
                        <span style={{ width: `${(step + 1) * 20}%` }} />
                      </div>
                      <div className="messages">
                        <div className="message assistant">
                          {t(
                            "Hello! A safer, cleaner Chennai starts with a conversation. Tell me what you’ve noticed, in English or Tamil.",
                            "வணக்கம்! பாதுகாப்பான, தூய்மையான சென்னை ஒரு உரையாடலில் தொடங்குகிறது. நீங்கள் கண்ட பிரச்சினையைத் தமிழ் அல்லது ஆங்கிலத்தில் சொல்லுங்கள்.",
                          )}
                        </div>
                        {keys.slice(0, step).map((key, i) => (
                          <div key={key}>
                            <div className="message assistant question">
                              {questions[i]}
                            </div>
                            <div className="message citizen">
                              {answers[key]}
                            </div>
                          </div>
                        ))}
                        {step < 4 && (
                          <div className="message assistant question">
                            {questions[step]}
                          </div>
                        )}
                      </div>
                      {step < 4 ? (
                        <form
                          className="composer"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void answer();
                          }}
                        >
                          <label htmlFor="answer" className="sr-only">
                            {questions[step]}
                          </label>
                          <textarea
                            ref={messageRef}
                            id="answer"
                            value={input}
                            disabled={busy}
                            maxLength={
                              step === 0
                                ? 3000
                                : step === 1
                                  ? 500
                                  : step === 2
                                    ? 200
                                    : 1000
                            }
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={t(
                              step === 0
                                ? "e.g. There is a large pothole near the Velachery bus stop…"
                                : "Type your answer…",
                              step === 0
                                ? "எ.கா. வேளச்சேரி பேருந்து நிறுத்தம் அருகே சாலையில் பெரிய குழி உள்ளது…"
                                : "உங்கள் பதிலை உள்ளிடவும்…",
                            )}
                          />
                          <div className="composer-bottom">
                            <small>
                              {t(
                                "Share only the details needed for this report.",
                                "இந்தப் புகாருக்குத் தேவையான விவரங்களை மட்டும் பகிரவும்.",
                              )}
                            </small>
                            <button
                              className="btn primary"
                              disabled={busy || !input.trim()}
                              type="submit"
                            >
                              {busy
                                ? t("Working…", "செயல்படுகிறது…")
                                : t("Continue", "தொடரவும்")}
                              <Send size={15} />
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="review">
                          <div className="review-title">
                            <FileCheck2 size={22} />
                            <div>
                              <h2>
                                {t(
                                  "Review your report",
                                  "உங்கள் புகாரைச் சரிபார்க்கவும்",
                                )}
                              </h2>
                              <p>
                                {t(
                                  "Correct anything before you confirm.",
                                  "உறுதிசெய்வதற்கு முன் திருத்திக்கொள்ளுங்கள்.",
                                )}
                              </p>
                            </div>
                          </div>
                          {keys.map((key) => (
                            <label key={key}>
                              {
                                {
                                  description: t(
                                    "Issue description",
                                    "பிரச்சினை விவரம்",
                                  ),
                                  location: t("Location", "இடம்"),
                                  duration: t("Duration", "கால அளவு"),
                                  impact: t("Impact", "பாதிப்பு"),
                                }[key]
                              }
                              <textarea
                                value={answers[key]}
                                maxLength={
                                  key === "description"
                                    ? 3000
                                    : key === "location"
                                      ? 500
                                      : key === "duration"
                                        ? 200
                                        : 1000
                                }
                                onChange={(e) =>
                                  setAnswers((a) => ({
                                    ...a,
                                    [key]: e.target.value,
                                  }))
                                }
                              />
                            </label>
                          ))}
                          <div className="form-row">
                            <label>
                              {t(
                                "Confirm issue category",
                                "பிரச்சினை வகையை உறுதிசெய்யவும்",
                              )}
                              <select
                                value={category}
                                onChange={(e) =>
                                  setCategory(e.target.value as Category)
                                }
                              >
                                {categories.map((v) => (
                                  <option key={v} value={v}>
                                    {categoryNames[v][lang === "en" ? 0 : 1]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {t("Road ownership", "சாலையின் பொறுப்பு")}
                              <select
                                value={ownership}
                                onChange={(e) =>
                                  setOwnership(
                                    e.target.value as "municipal" | "unknown",
                                  )
                                }
                              >
                                <option value="unknown">
                                  {t(
                                    "Unknown / needs verification",
                                    "தெரியாது / சரிபார்க்க வேண்டும்",
                                  )}
                                </option>
                                <option value="municipal">
                                  {t(
                                    "Municipal road (citizen-reported)",
                                    "மாநகராட்சி சாலை (குடிமக்கள் தகவல்)",
                                  )}
                                </option>
                              </select>
                            </label>
                          </div>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={chennai}
                              onChange={(e) => setChennai(e.target.checked)}
                            />
                            {t(
                              "The reported location is within Chennai.",
                              "புகாரளிக்கப்பட்ட இடம் சென்னைக்குள் உள்ளது.",
                            )}
                          </label>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={urgent}
                              onChange={(e) => setUrgent(e.target.checked)}
                            />
                            {t(
                              "There is an immediate safety risk (priority review).",
                              "உடனடி பாதுகாப்பு ஆபத்து உள்ளது (முன்னுரிமைப் பரிசீலனை).",
                            )}
                          </label>
                          <div className="routing-preview">
                            <Building2 size={20} />
                            <div>
                              <small>
                                {t(
                                  "SIMULATED ROUTING PREVIEW",
                                  "மாதிரி வழிமாற்ற முன்னோட்டம்",
                                )}
                              </small>
                              <strong>
                                {
                                  departments[
                                    route({ category, chennai, ownership })
                                  ]
                                }
                              </strong>
                              <p>
                                {route({ category, chennai, ownership }) ===
                                "review"
                                  ? t(
                                      "Jurisdiction or category needs human verification.",
                                      "அதிகார வரம்பு அல்லது வகையை மனிதர் சரிபார்க்க வேண்டும்.",
                                    )
                                  : t(
                                      "Based on your confirmed category and reported jurisdiction.",
                                      "உறுதிசெய்யப்பட்ட வகை மற்றும் அதிகார வரம்பின் அடிப்படையில்.",
                                    )}
                              </p>
                            </div>
                          </div>
                          <label className="upload-zone">
                            <Upload size={21} />
                            <strong>
                              {t(
                                "Add photo, audio or video evidence",
                                "படம், ஒலி அல்லது காணொளி ஆதாரத்தைச் சேர்க்கவும்",
                              )}
                            </strong>
                            <span>
                              JPEG, PNG, WebP, MP3, WAV, MP4 · 4 MB / file
                            </span>
                            <input
                              ref={fileRef}
                              aria-label="Add report evidence"
                              type="file"
                              multiple
                              accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,video/mp4"
                              disabled={busy}
                              onChange={(e) => void filesPicked(e.target.files)}
                            />
                          </label>
                          {pendingFiles.map((f, i) => (
                            <div className="pending" key={i}>
                              <span>
                                {f.name} · {(f.size / 1024).toFixed(0)} KB
                              </span>
                              <button
                                aria-label={`Remove ${f.name}`}
                                onClick={() =>
                                  setPendingFiles((v) =>
                                    v.filter((_, n) => n !== i),
                                  )
                                }
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                          <p className="muted">
                            {t(
                              "Files are private. Integrity and exact duplicates are checked; relevance, provenance and authenticity require manual review.",
                              "கோப்புகள் தனிப்பட்டவை. கோப்பின் ஒருமைப்பாடும் நகல்களும் சரிபார்க்கப்படும்; தொடர்புத்தன்மை, தோற்றம், உண்மைத்தன்மைக்கு மனிதப் பரிசீலனை தேவை.",
                            )}
                          </p>
                          <label className="checkbox consent">
                            <input
                              type="checkbox"
                              checked={consent}
                              onChange={(e) => setConsent(e.target.checked)}
                            />
                            {t(
                              "I confirm this report is accurate to my knowledge and consent to sharing its details and evidence with assigned CivicLens demo officers. AI suggestions have been reviewed.",
                              "எனக்குத் தெரிந்தவரை இந்தப் புகார் சரியானது. விவரங்களையும் ஆதாரங்களையும் நியமிக்கப்பட்ட CivicLens மாதிரி அதிகாரிகளுடன் பகிர ஒப்புக்கொள்கிறேன். AI பரிந்துரைகளைச் சரிபார்த்தேன்.",
                            )}
                          </label>
                          <button
                            className="btn primary wide"
                            disabled={busy || !consent}
                            onClick={() => void confirm()}
                          >
                            {busy
                              ? t("Saving report…", "புகார் சேமிக்கப்படுகிறது…")
                              : t(
                                  "Confirm & submit report",
                                  "உறுதிசெய்து புகாரைச் சமர்ப்பிக்கவும்",
                                )}
                            <ArrowRight size={17} />
                          </button>
                        </div>
                      )}
                    </section>
                    <aside className="intake-aside">
                      <div className="card">
                        <ShieldCheck size={24} />
                        <h3>
                          {t(
                            "Clear. Private. Accountable.",
                            "தெளிவு. தனியுரிமை. பொறுப்பு.",
                          )}
                        </h3>
                        <p>
                          {t(
                            "You confirm the report before it is submitted. Your evidence is shared only with you and assigned demo officers.",
                            "சமர்ப்பிப்பதற்கு முன் புகாரை உறுதிசெய்கிறீர்கள். ஆதாரங்களை நீங்களும் நியமிக்கப்பட்ட மாதிரி அதிகாரிகளும் மட்டுமே காணலாம்.",
                          )}
                        </p>
                        <hr />
                        <h4>{t("What happens next?", "அடுத்து என்ன?")}</h4>
                        <ol>
                          <li>
                            {t(
                              "Confirm the issue and location",
                              "பிரச்சினை, இடத்தை உறுதிசெய்யவும்",
                            )}
                          </li>
                          <li>
                            {t(
                              "Get a permanent tracking ID",
                              "நிரந்தர கண்காணிப்பு எண்ணைப் பெறவும்",
                            )}
                          </li>
                          <li>
                            {t(
                              "Follow the action timeline",
                              "செயல் காலவரிசையைப் பின்தொடரவும்",
                            )}
                          </li>
                          <li>
                            {t(
                              "Verify the resolution or appeal once",
                              "தீர்வைச் சரிபார்க்கவும் அல்லது ஒருமுறை மேல்முறையீடு செய்யவும்",
                            )}
                          </li>
                        </ol>
                      </div>
                      <div className="safety-note">
                        <strong>
                          {t("Immediate danger?", "உடனடி ஆபத்தா?")}
                        </strong>
                        <p>
                          {t(
                            "Do not wait for this report. Move to safety and contact local emergency services directly. CivicLens does not dispatch emergency help.",
                            "இந்தப் புகாருக்காகக் காத்திருக்க வேண்டாம். பாதுகாப்பான இடத்திற்குச் சென்று உள்ளூர் அவசர சேவைகளை நேரடியாகத் தொடர்புகொள்ளுங்கள். CivicLens அவசர உதவியை அனுப்பாது.",
                          )}
                        </p>
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {(view === "track" || view === "official") && (
                <>
                  <div className="page-title">
                    <div>
                      <span className="eyebrow">
                        {isOfficial
                          ? t(
                              "SIMULATED AUTHORITY WORKSPACE",
                              "மாதிரி அதிகாரி பணியிடம்",
                            )
                          : t(
                              "EVERY REPORT HAS A STORY",
                              "ஒவ்வொரு புகாருக்கும் ஒரு பயணம்",
                            )}
                      </span>
                      <h1>
                        {isOfficial
                          ? t(
                              "The next step is yours.",
                              "அடுத்த படி உங்களுடையது.",
                            )
                          : t(
                              "Your reports, in the open.",
                              "உங்கள் புகார்கள், வெளிப்படையாக.",
                            )}
                      </h1>
                      <p>
                        {isOfficial
                          ? t(
                              "Acknowledge, act and document the outcome.",
                              "ஏற்றுக்கொள்ளுங்கள், செயல்படுங்கள், முடிவைப் பதிவு செய்யுங்கள்.",
                            )
                          : t(
                              "See who’s responsible and what’s happening next.",
                              "யார் பொறுப்பு, அடுத்து என்ன நடக்கிறது என்பதைப் பாருங்கள்.",
                            )}
                      </p>
                    </div>
                    <button
                      className="btn primary"
                      onClick={() => nav("report")}
                    >
                      <Plus size={17} />
                      {t("New report", "புதிய புகார்")}
                    </button>
                  </div>
                  {isOfficial && (
                    <div className="card official-bar">
                      <Building2 size={22} />
                      <div>
                        <strong>
                          {demoMode
                            ? repo.demoOfficers[demoDepartment]
                            : activeDepartment
                              ? departments[activeDepartment]
                              : t(
                                  "Officer account required",
                                  "அதிகாரி கணக்கு தேவை",
                                )}
                        </strong>
                        <p>
                          {demoMode
                            ? t(
                                "Switch fictional departments to test the full workflow.",
                                "முழுப் பயணத்தையும் சோதிக்க கற்பனைத் துறைகளை மாற்றவும்.",
                              )
                            : t(
                                "Department access is assigned by the administrator.",
                                "துறை அணுகலை நிர்வாகி வழங்குவார்.",
                              )}
                        </p>
                      </div>
                      {demoMode && (
                        <select
                          aria-label="Demo department"
                          value={demoDepartment}
                          onChange={(e) => {
                            setDemoDepartment(e.target.value as Department);
                            setSelected(null);
                          }}
                        >
                          {Object.entries(departments).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {c && (!isOfficial || c.department === activeDepartment) ? (
                    <>
                      <button
                        className="text-btn back"
                        onClick={() => setSelected(null)}
                      >
                        <ArrowLeft size={16} />
                        {t("All reports", "அனைத்து புகார்கள்")}
                      </button>
                      <div className="detail-grid">
                        <section className="card case-detail">
                          <div className="section-head">
                            <span className="reference">{c.reference}</span>
                            <Badge status={c.status} lang={lang} />
                          </div>
                          <h2>
                            {categoryNames[c.category][lang === "en" ? 0 : 1]}
                          </h2>
                          <p className="case-description">{c.description}</p>
                          <div className="case-meta">
                            <span>
                              <MapPin size={16} />
                              {c.location}
                            </span>
                            <span>
                              <Clock3 size={16} />
                              {c.duration}
                            </span>
                          </div>
                          <div className="detail-fields">
                            <div>
                              <small>{t("IMPACT", "பாதிப்பு")}</small>
                              <p>{c.impact}</p>
                            </div>
                            <div>
                              <small>
                                {t(
                                  "RESPONSIBLE DESK · SIMULATED",
                                  "பொறுப்புள்ள துறை · மாதிரி",
                                )}
                              </small>
                              <p>{departments[c.department]}</p>
                            </div>
                            <div>
                              <small>
                                {t("CIVICLENS TARGET", "CIVICLENS இலக்கு")}
                              </small>
                              <p>
                                {when(c.due_at, lang)}{" "}
                                {new Date(c.due_at) < new Date() &&
                                  !["closed", "resolved"].includes(
                                    c.status,
                                  ) && (
                                    <span className="overdue">
                                      {t("Overdue", "காலக்கெடு கடந்தது")}
                                    </span>
                                  )}
                              </p>
                              <small>
                                {t(
                                  "Internal target, not an official agency commitment. Expiry never closes a report.",
                                  "உள் இலக்கு; அதிகாரப்பூர்வ வாக்குறுதி அல்ல. காலக்கெடு முடிவதால் புகார் மூடப்படாது.",
                                )}
                              </small>
                            </div>
                          </div>
                          {c.urgent && (
                            <div className="safety-note">
                              {t(
                                "Priority safety review requested. Contact emergency services directly for immediate danger.",
                                "முன்னுரிமைப் பாதுகாப்புப் பரிசீலனை கோரப்பட்டது. உடனடி ஆபத்துக்கு அவசர சேவைகளை நேரடியாகத் தொடர்புகொள்ளவும்.",
                              )}
                            </div>
                          )}
                          <div className="section-head">
                            <h3>{t("Evidence", "ஆதாரங்கள்")}</h3>
                            <span className="count">
                              {c.evidence.length} / 10
                            </span>
                          </div>
                          {!c.evidence.length && (
                            <p className="muted">
                              {t(
                                "No attachments yet. A clear, recent photo can help reviewers.",
                                "இன்னும் ஆதாரங்கள் இல்லை. தெளிவான சமீபத்திய படம் உதவும்.",
                              )}
                            </p>
                          )}
                          {c.evidence.map((e) => (
                            <div className="evidence" key={e.id}>
                              <FileCheck2 size={21} />
                              <div>
                                <strong>{e.name}</strong>
                                <small>
                                  {e.purpose === "resolution"
                                    ? t("Resolution proof", "தீர்வு ஆதாரம்")
                                    : t(
                                        "Citizen evidence",
                                        "குடிமக்கள் ஆதாரம்",
                                      )}{" "}
                                  · {(e.size / 1024).toFixed(0)} KB · {e.mime}
                                </small>
                                <code title={e.sha256}>
                                  SHA-256 {e.sha256.slice(0, 16)}…
                                </code>
                                <small>
                                  {e.duplicate
                                    ? t(
                                        "Exact duplicate in this report.",
                                        "இந்தப் புகாரில் அதே கோப்பு உள்ளது.",
                                      )
                                    : t(
                                        "No exact duplicate in this report.",
                                        "இந்தப் புகாரில் அதே கோப்பு இல்லை.",
                                      )}{" "}
                                  {t(
                                    "Authenticity unverified.",
                                    "உண்மைத்தன்மை சரிபார்க்கப்படவில்லை.",
                                  )}
                                </small>
                              </div>
                              <button
                                className="text-btn"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const url = await repo.evidenceUrl(e);
                                    const anchor = document.createElement("a");
                                    anchor.href = url;
                                    anchor.target = "_blank";
                                    anchor.rel = "noopener noreferrer";
                                    anchor.download = e.name;
                                    anchor.click();
                                    if (url.startsWith("blob:"))
                                      setTimeout(
                                        () => URL.revokeObjectURL(url),
                                        60000,
                                      );
                                  })
                                }
                              >
                                {t("Open", "திறக்கவும்")} ↗
                              </button>
                            </div>
                          ))}
                          {((!isOfficial &&
                            ownsCase &&
                            [
                              "submitted",
                              "acknowledged",
                              "in_progress",
                              "appealed",
                            ].includes(c.status)) ||
                            (isOfficial && c.status === "in_progress")) && (
                            <label className="upload-zone compact">
                              <Upload size={18} />
                              <strong>
                                {isOfficial
                                  ? t(
                                      "Upload resolution proof",
                                      "தீர்வு ஆதாரத்தைப் பதிவேற்றவும்",
                                    )
                                  : t(
                                      "Add supporting evidence",
                                      "ஆதாரங்களைச் சேர்க்கவும்",
                                    )}
                              </strong>
                              <span>
                                4 MB / file · JPEG, PNG, WebP, MP3, WAV, MP4
                              </span>
                              <input
                                aria-label={
                                  isOfficial
                                    ? "Upload resolution evidence"
                                    : "Upload supporting evidence"
                                }
                                type="file"
                                disabled={busy}
                                accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,video/mp4"
                                onChange={(e) => {
                                  void filesPicked(e.target.files, c);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          )}
                          <div className="case-actions">
                            <button
                              className="btn secondary"
                              onClick={() => {
                                const blob = new Blob(
                                  [JSON.stringify(c, null, 2)],
                                  { type: "application/json" },
                                );
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `${c.reference}.json`;
                                a.click();
                                setTimeout(
                                  () => URL.revokeObjectURL(url),
                                  1000,
                                );
                              }}
                            >
                              <ArrowDownToLine size={16} />
                              {t("Download report", "புகாரைப் பதிவிறக்கவும்")}
                            </button>
                            <button
                              className="text-btn"
                              onClick={() => window.print()}
                            >
                              {t(
                                "Print report / save PDF",
                                "அச்சிடவும் / PDF சேமிக்கவும்",
                              )}
                            </button>
                          </div>
                          {(isOfficial || ownsCase) &&
                            allowedActions(c, role).length > 0 && (
                              <div className="workflow">
                                <h3>
                                  {isOfficial
                                    ? t(
                                        "Record the next action",
                                        "அடுத்த செயலைப் பதிவு செய்யவும்",
                                      )
                                    : t(
                                        "Does the resolution address your concern?",
                                        "தீர்வு உங்கள் பிரச்சினையைச் சரிசெய்கிறதா?",
                                      )}
                                </h3>
                                <label>
                                  {t(
                                    "Add a clear update or reason (required)",
                                    "தெளிவான புதுப்பிப்பு அல்லது காரணம் (கட்டாயம்)",
                                  )}
                                  <textarea
                                    maxLength={2000}
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder={t(
                                      "Describe the action taken or why you are appealing…",
                                      "எடுத்த நடவடிக்கை அல்லது மேல்முறையீட்டுக் காரணத்தை விவரிக்கவும்…",
                                    )}
                                  />
                                </label>
                                <div className="button-row">
                                  {allowedActions(c, role).map((next) => (
                                    <button
                                      key={next}
                                      className={`btn ${next === "appealed" ? "secondary" : "primary"}`}
                                      disabled={busy || note.trim().length < 5}
                                      onClick={() =>
                                        void run(async () => {
                                          await repo.updateStatus(
                                            c,
                                            next,
                                            role,
                                            note,
                                          );
                                          await refresh();
                                          setNote("");
                                          setNotice(
                                            t(
                                              "Update recorded in the audit trail.",
                                              "புதுப்பிப்பு செயல் பதிவில் சேமிக்கப்பட்டது.",
                                            ),
                                          );
                                        })
                                      }
                                    >
                                      {
                                        {
                                          acknowledged: t(
                                            "Acknowledge report",
                                            "புகாரை ஏற்கவும்",
                                          ),
                                          in_progress: t(
                                            "Start / assign work",
                                            "பணியைத் தொடங்கவும்",
                                          ),
                                          resolved: t(
                                            "Submit resolution",
                                            "தீர்வைச் சமர்ப்பிக்கவும்",
                                          ),
                                          closed: t(
                                            "Confirm & close",
                                            "உறுதிசெய்து முடிக்கவும்",
                                          ),
                                          appealed: t(
                                            "Appeal once",
                                            "ஒருமுறை மேல்முறையீடு",
                                          ),
                                          submitted: "",
                                        }[next]
                                      }
                                    </button>
                                  ))}
                                </div>
                                {c.status === "resolved" && (
                                  <p className="muted">
                                    {c.appealed
                                      ? t(
                                          "Your one appeal has been used. You may confirm closure after review.",
                                          "ஒரு மேல்முறையீடு பயன்படுத்தப்பட்டது. பரிசீலனைக்குப் பிறகு முடிவை உறுதிசெய்யலாம்.",
                                        )
                                      : t(
                                          "You may appeal once if the issue remains unresolved.",
                                          "பிரச்சினை தீரவில்லை என்றால் ஒருமுறை மேல்முறையீடு செய்யலாம்.",
                                        )}
                                  </p>
                                )}
                              </div>
                            )}
                          {isOfficial &&
                            !["resolved", "closed"].includes(c.status) && (
                              <details className="assignment">
                                <summary>
                                  {t(
                                    "Forward to another department",
                                    "வேறு துறைக்கு அனுப்பவும்",
                                  )}
                                </summary>
                                <label>
                                  {t("Department", "துறை")}
                                  <select
                                    value={assignTo}
                                    onChange={(e) =>
                                      setAssignTo(e.target.value as Department)
                                    }
                                  >
                                    {Object.entries(departments).map(
                                      ([k, v]) => (
                                        <option key={k} value={k}>
                                          {v}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                </label>
                                <label>
                                  {t(
                                    "Assignment reason",
                                    "மாற்றுவதற்கான காரணம்",
                                  )}
                                  <textarea
                                    value={note}
                                    maxLength={2000}
                                    onChange={(e) => setNote(e.target.value)}
                                  />
                                </label>
                                <button
                                  className="btn secondary"
                                  disabled={
                                    busy ||
                                    assignTo === c.department ||
                                    note.trim().length < 5
                                  }
                                  onClick={() =>
                                    void run(async () => {
                                      await repo.reassign(c, assignTo, note);
                                      await refresh();
                                      setSelected(null);
                                      setNote("");
                                      setNotice(
                                        "Department assignment recorded.",
                                      );
                                    })
                                  }
                                >
                                  {t(
                                    "Forward & record",
                                    "அனுப்பிப் பதிவு செய்யவும்",
                                  )}
                                </button>
                              </details>
                            )}
                        </section>
                        <aside className="card timeline">
                          <h3>
                            {t(
                              "The accountability trail",
                              "பொறுப்புக்கூறல் காலவரிசை",
                            )}
                          </h3>
                          <p>
                            {t(
                              "Every action. A permanent record.",
                              "ஒவ்வொரு செயலும். நிரந்தரப் பதிவு.",
                            )}
                          </p>
                          <ol>
                            {c.events.map((e) => (
                              <li key={e.id}>
                                <span className="timeline-dot">
                                  <Check size={12} />
                                </span>
                                <strong>
                                  {e.action in statusNames
                                    ? statusNames[e.action as Status][
                                        lang === "en" ? 0 : 1
                                      ]
                                    : e.action === "evidence_added"
                                      ? t(
                                          "Evidence added",
                                          "ஆதாரம் சேர்க்கப்பட்டது",
                                        )
                                      : t(
                                          "Department reassigned",
                                          "துறை மாற்றப்பட்டது",
                                        )}
                                </strong>
                                <small>
                                  {when(e.created_at, lang)} · {e.actor}
                                </small>
                                <p>{e.note}</p>
                              </li>
                            ))}
                          </ol>
                        </aside>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="filters">
                        <input
                          aria-label="Search reports"
                          placeholder={t(
                            "Search by issue, location or tracking ID…",
                            "பிரச்சினை, இடம் அல்லது புகார் எண்ணைத் தேடவும்…",
                          )}
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                        <select
                          aria-label="Filter status"
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                        >
                          <option value="all">
                            {t("All statuses", "அனைத்து நிலைகளும்")}
                          </option>
                          {Object.entries(statusNames).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v[lang === "en" ? 0 : 1]}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await refresh();
                            })
                          }
                        >
                          {t("Refresh", "புதுப்பிக்கவும்")}
                        </button>
                      </div>
                      {loading ? (
                        <p role="status">Loading reports…</p>
                      ) : (
                        <ReportList
                          cases={filtered}
                          lang={lang}
                          onOpen={openCase}
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
          <footer>
            <span>
              <Leaf size={13} /> CivicLens{" "}
              <span className="footer-divider">/</span>
              {t(
                "Built for the city we call home.",
                "நம் நகரத்திற்காக உருவாக்கப்பட்டது.",
              )}
            </span>
            <span>
              {t(
                "Chennai pilot · Buildathon MVP",
                "சென்னை முன்னோட்டம் · Buildathon MVP",
              )}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Badge({ status, lang }: { status: Status; lang: Lang }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {statusNames[status][lang === "en" ? 0 : 1]}
    </span>
  );
}
function Stat({
  icon,
  value,
  label,
  foot,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  foot: string;
}) {
  return (
    <div className="stat card">
      <div className="stat-top">
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{String(value).padStart(2, "0")}</strong>
      <small>{foot}</small>
    </div>
  );
}
function ReportList({
  cases,
  lang,
  onOpen,
}: {
  cases: Complaint[];
  lang: Lang;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="card report-list">
      {!cases.length ? (
        <div className="empty">
          <FileCheck2 size={30} />
          <h3>
            {lang === "en" ? "No reports here yet" : "இன்னும் புகார்கள் இல்லை"}
          </h3>
          <p>
            {lang === "en"
              ? "New reports will appear here. Try another filter or start a report."
              : "புதிய புகார்கள் இங்கு தோன்றும். வேறு வடிப்பானை முயற்சிக்கவும் அல்லது புகாரைத் தொடங்கவும்."}
          </p>
        </div>
      ) : (
        cases.map((c) => (
          <button
            className="report-row"
            key={c.id}
            onClick={() => onOpen(c.id)}
          >
            <span className={`category-icon ${c.category}`}>
              {c.category === "road" ? (
                "↝"
              ) : c.category === "water" ? (
                "≈"
              ) : c.category === "waste" ? (
                <Leaf size={21} />
              ) : c.category === "lighting" ? (
                "☼"
              ) : (
                "?"
              )}
            </span>
            <span className="report-text">
              <span className="report-title">{c.description}</span>
              <small>
                <MapPin size={12} />
                {c.location}
                <span className="row-separator">·</span>
                {c.reference}
              </small>
            </span>
            <Badge status={c.status} lang={lang} />
            <ChevronRight size={17} className="row-chevron" />
          </button>
        ))
      )}
    </div>
  );
}
function CityIllustration() {
  return (
    <svg
      className="city-art"
      viewBox="0 0 500 330"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="park"
          x1="240"
          y1="90"
          x2="240"
          y2="320"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#b9e2c1" />
          <stop offset="1" stopColor="#679d86" />
        </linearGradient>
      </defs>
      <circle cx="282" cy="152" r="135" fill="#447c68" opacity=".4" />
      <circle
        cx="282"
        cy="152"
        r="105"
        stroke="#a0c5ad"
        strokeDasharray="3 7"
        opacity=".25"
      />
      <path d="M42 238L259 123L482 233L270 345Z" fill="#245b49" />
      <path d="M63 225L263 121L460 223L264 326Z" fill="url(#park)" />
      <path d="M77 218L265 316L451 219" stroke="#d7ead5" strokeWidth="15" />
      <path
        d="M178 165L371 262M163 264L353 166"
        stroke="#e0e5d0"
        strokeWidth="27"
      />
      <path
        d="M178 165L371 262M163 264L353 166"
        stroke="#517763"
        strokeWidth="18"
      />
      <path
        d="M178 165L371 262M163 264L353 166"
        stroke="#c8d6b9"
        strokeWidth="1.5"
        strokeDasharray="9 7"
      />
      <g>
        <path d="M103 151L153 125L198 148L147 176Z" fill="#f6e9c9" />
        <path d="M103 151V214L147 238V176Z" fill="#d8caa8" />
        <path d="M147 176V238L198 211V148Z" fill="#efdfba" />
        <path
          d="M117 173V187L129 193V179Z M117 198V212L129 218V204Z"
          fill="#668f81"
        />
        <path
          d="M159 181V195L172 188V174Z M178 171V185L189 179V165Z M159 205V219L172 212V198Z M178 196V210L189 204V190Z"
          fill="#4c7a69"
        />
        <path d="M109 151L152 129L192 149L149 172Z" fill="#afc6aa" />
      </g>
      <g>
        <path d="M278 94L320 72L360 94L318 118Z" fill="#e6eddf" />
        <path d="M278 94V173L318 195V118Z" fill="#bbcdb6" />
        <path d="M318 118V195L360 173V94Z" fill="#d7e1c9" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <path
              d={`M287 ${111 + i * 20}v10l10 6v-10Z M305 ${121 + i * 20}v10l7 4v-10Z`}
              fill="#4e7a68"
            />
            <path
              d={`M327 ${125 + i * 20}v11l10-6v-11Z M344 ${115 + i * 20}v11l9-5v-11Z`}
              fill="#5d8a75"
            />
          </g>
        ))}
      </g>
      <g>
        <path d="M337 181L378 161L416 180L375 203Z" fill="#f6dfb0" />
        <path d="M337 181V220L375 241V203Z" fill="#e0c695" />
        <path d="M375 203V241L416 219V180Z" fill="#edd9aa" />
        <path d="M332 182L375 150L422 181L376 207Z" fill="#54816a" />
        <path
          d="M349 207V220L362 227V214Z M386 210V227L402 219V202Z"
          fill="#54816a"
        />
      </g>
      <g fill="#43815e">
        <ellipse cx="226" cy="145" rx="20" ry="11" opacity=".4" />
        <path d="M226 112v34" stroke="#8a8360" strokeWidth="5" />
        <ellipse cx="226" cy="108" rx="18" ry="23" fill="#2e6a4e" />
        <ellipse cx="218" cy="102" rx="12" ry="16" fill="#4c9867" />
        <path d="M295 266v32" stroke="#887c54" strokeWidth="5" />
        <ellipse cx="295" cy="257" rx="19" ry="26" fill="#3e8057" />
        <ellipse cx="287" cy="250" rx="11" ry="17" fill="#67a16e" />
        <path d="M113 237v23" stroke="#887c54" strokeWidth="4" />
        <ellipse cx="113" cy="227" rx="16" ry="23" fill="#407e56" />
      </g>
      <path d="M224 230v-48l17-8" stroke="#254f40" strokeWidth="3" />
      <path
        d="M236 174h12"
        stroke="#ffe5a6"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <g transform="translate(240 25)">
        <path
          d="M0 28a29 29 0 1 1 58 0c0 22-29 49-29 49S0 50 0 28"
          fill="#f6d88b"
        />
        <circle cx="29" cy="28" r="15" fill="#3d745d" />
        <path
          d="M21 28l6 6 11-12"
          stroke="#fff6d8"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <path d="M193 235l10-5 16 8-10 5Z" fill="#f5cd7d" />
      <path d="M193 235v7l16 8v-7l10-5v-7" fill="#c6a465" />
      <circle cx="198" cy="245" r="3" fill="#315947" />
      <circle cx="213" cy="245" r="3" fill="#315947" />
    </svg>
  );
}
