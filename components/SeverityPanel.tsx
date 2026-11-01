"use client";
import { useEffect, useState } from "react";
import { type Complaint, type Lang, urgentSignal } from "@/lib/domain";
import { factorNames, weights, type FactorKey } from "@/lib/severity";
import { demoMode } from "@/lib/supabase";
import { requestSeverity } from "@/lib/repository";
export function SeverityPanel({
  complaint,
  lang,
  onRefresh,
}: {
  complaint: Complaint;
  lang: Lang;
  onRefresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const a = complaint.severity,
    result = a?.result;
  const emergency =
    result?.emergency ||
    complaint.urgent ||
    urgentSignal(`${complaint.description} ${complaint.impact}`);
  const t = (en: string, ta: string) => (lang === "ta" ? ta : en);
  useEffect(() => {
    if (demoMode || !a || !["pending", "processing"].includes(a.status)) return;
    let polls = 0;
    const timer = setInterval(() => {
      if (++polls > 30) {
        clearInterval(timer);
        return;
      }
      void onRefresh().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [complaint.id, a?.status, onRefresh]);
  return (
    <section
      className="severity-panel"
      aria-label={t("Severity assessment", "தீவிர மதிப்பீடு")}
    >
      <h3>{t("Severity assessment", "தீவிர மதிப்பீடு")}</h3>
      {emergency && (
        <div className="safety-note" role="alert">
          <strong>
            {t("Emergency override · P1", "அவசர முன்னுரிமை · P1")}
          </strong>
          <p>
            {t(
              "Reported immediate danger. Contact emergency services directly. This app does not dispatch help. The override is separate from the weighted score.",
              "உடனடி ஆபத்து தெரிவிக்கப்பட்டுள்ளது. அவசர சேவையை நேரடியாகத் தொடர்புகொள்ளவும். இந்தச் செயலி உதவியை அனுப்பாது.",
            )}
          </p>
        </div>
      )}
      <p>
        {t("Priority", "முன்னுரிமை")}:{" "}
        <strong>
          {emergency
            ? "P1"
            : result?.priority ||
              t(
                "Awaiting complete evidence / manual review",
                "முழுமையான ஆதாரம் / மனிதப் பரிசீலனை தேவை",
              )}
        </strong>
      </p>
      <p>
        {t("Assessment status", "மதிப்பீட்டு நிலை")}:{" "}
        {demoMode
          ? t("Unavailable in browser-only demo", "உலாவி மாதிரியில் கிடைக்காது")
          : a?.status || t("Not yet assessed", "இன்னும் மதிப்பிடப்படவில்லை")}
      </p>
      {result && (
        <>
          <p>
            {t("Weighted score", "எடையிட்ட மதிப்பெண்")}:{" "}
            {result.score === null
              ? `${result.score_range[0]}–${result.score_range[1]} / 100 (${t("incomplete range, not a final score", "முழுமையற்ற வரம்பு")})`
              : `${result.score} / 100`}
          </p>
          <p>
            {t("Confidence", "நம்பகத்தன்மை")}:{" "}
            {Math.round(result.confidence * 100)}% ·{" "}
            {t("Known factor weight", "அறியப்பட்ட காரணி எடை")}:{" "}
            {result.coverage}%
          </p>
          <details>
            <summary>
              {t(
                "Factor scores and reasoning",
                "காரணி மதிப்பெண்கள் மற்றும் காரணங்கள்",
              )}
            </summary>
            {(Object.keys(weights) as FactorKey[]).map((key) => (
              <div className="severity-factor" key={key}>
                <strong>
                  {factorNames[key]} ({weights[key]}%)
                </strong>
                <p>
                  {result.factors[key].score === null
                    ? t("Unknown", "தெரியாது")
                    : `${result.factors[key].score}/100`}{" "}
                  · {Math.round(result.factors[key].confidence * 100)}%{" "}
                  {t("confidence", "நம்பகத்தன்மை")}
                </p>
                <p>{result.factors[key].explanation}</p>
              </div>
            ))}
          </details>
          <p className="muted">
            {t("Assessed", "மதிப்பிடப்பட்டது")}:{" "}
            {new Date(result.assessed_at).toLocaleString(
              lang === "ta" ? "ta-IN" : "en-IN",
            )}
          </p>
        </>
      )}
      {a?.error && <p role="status">{a.error}</p>}
      <p className="muted">
        {t(
          "P1 70–100 · P2 45–69 · P3 20–44 · P4 0–19. Advisory assessment; unknown evidence is never counted as zero risk. No response-time promise.",
          "P1 70–100 · P2 45–69 · P3 20–44 · P4 0–19. இது ஆலோசனை மதிப்பீடு. தெரியாத ஆபத்து பூஜ்ஜியமாகக் கருதப்படாது.",
        )}
      </p>
      {!demoMode && (
        <button
          className="btn secondary"
          disabled={
            busy || a?.status === "completed" || (a?.attempts || 0) >= 3
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await requestSeverity(complaint.id);
              await onRefresh();
            } catch {
              setError(
                t(
                  "Assessment unavailable. Your report is safe; request manual review.",
                  "மதிப்பீடு கிடைக்கவில்லை. உங்கள் புகார் பாதுகாப்பாக உள்ளது.",
                ),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? t("Requesting…", "கோரப்படுகிறது…")
            : t("Assess / retry severity", "தீவிர மதிப்பீட்டை முயற்சிக்கவும்")}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
