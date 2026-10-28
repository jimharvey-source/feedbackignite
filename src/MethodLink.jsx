import { useEffect, useRef, useState } from "react";

// "The method": the thinking behind this tool, in a panel over the page.
// One source of truth: the method page in the user guide at
// app.management-ignition.com/guide/<slug>, shown here in embed mode.
// This file is identical in all five tools.
const GUIDE = "https://app.management-ignition.com/guide/";

export default function MethodLink({ slug, label = "The method", className, style }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} style={style}>{label}</button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="The method behind this tool"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(27,42,74,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ background: "#f6f8fb", borderRadius: 16, width: "100%", maxWidth: 820, height: "min(88vh, 900px)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(27,42,74,0.5)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 8px 4px 20px", borderBottom: "1px solid #e2e7ee", background: "#ffffff" }}>
              <a href={GUIDE + slug} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: "#2a3d63", textUnderlineOffset: 4 }}>Open in a new tab</a>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ minWidth: 44, minHeight: 44, background: "none", border: "none", fontSize: 26, lineHeight: 1, color: "#1b2a4a", cursor: "pointer" }}>×</button>
            </div>
            <iframe title="The method behind this tool" src={`${GUIDE}${slug}?embed=1`} style={{ flex: 1, width: "100%", border: 0, background: "#f6f8fb" }} />
          </div>
        </div>
      )}
    </>
  );
}
