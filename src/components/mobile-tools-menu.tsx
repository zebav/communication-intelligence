"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, Home, Settings, Wrench, X } from "lucide-react";

export function MobileToolsMenu() {
  const [open, setOpen] = useState(false);
  return <div className="mobile-tools">
    {open && <div className="mobile-tools-sheet" role="dialog" aria-label="More tools">
      <div className="mobile-tools-head"><strong>More</strong><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close more menu"><X size={18} /></button></div>
      <Link href="/" onClick={() => setOpen(false)}><Home size={17} /><span><strong>Workspace</strong><small>Today, inbox, contacts and connections</small></span></Link>
      <Link href="/diagnostics/channels" onClick={() => setOpen(false)}><Activity size={17} /><span><strong>System & diagnostics</strong><small>WhatsApp delivery, Instagram and contact repair</small></span></Link>
      <Link href="/diagnostics/channels#whatsapp" onClick={() => setOpen(false)}><Wrench size={17} /><span><strong>Troubleshoot WhatsApp</strong><small>Check callback, live delivery and message ingestion</small></span></Link>
      <Link href="/" onClick={() => setOpen(false)}><Settings size={17} /><span><strong>Settings</strong><small>Open the workspace and choose Settings</small></span></Link>
    </div>}
    <button className="mobile-tools-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Open more tools"><Wrench size={17} /><span>Tools</span></button>
    {open && <button className="mobile-tools-backdrop" aria-label="Close more menu" onClick={() => setOpen(false)} />}
  </div>;
}
