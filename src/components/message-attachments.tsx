"use client";

import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Music2, Paperclip, Play, ExternalLink } from "lucide-react";
import { AttachmentViewer, type ViewableAttachment } from "./attachment-viewer";

type Asset = ViewableAttachment & { asset_kind: string; title: string; filename: string; summary?: string; source_type: string; previewUrl?: string; transcript?: string | null };

function icon(asset: Asset) {
  if (asset.asset_kind === "image") return <ImageIcon size={14} />;
  if (asset.asset_kind === "audio") return <Music2 size={14} />;
  if (asset.mime_type.startsWith("video/")) return <Play size={14} />;
  return <FileText size={14} />;
}

export function MessageAttachments({ messageId, expected = 0 }: { messageId: string; expected?: number }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [notice, setNotice] = useState("");
  const [viewer, setViewer] = useState<Asset | null>(null);
  const [open, setOpen] = useState(expected > 0);

  useEffect(() => {
    if (!open || assets !== null || !messageId) return;
    let active = true;
    void fetch(`/api/vault/assets?messageId=${encodeURIComponent(messageId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { assets?: Asset[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Bilagorna kunde inte läsas.");
        if (active) setAssets(data.assets ?? []);
      })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "Bilagorna kunde inte läsas."); });
    return () => { active = false; };
  }, [assets, messageId, open]);

  if (!expected && !open) return null;
  return <div className="message-attachments">
    <button type="button" className="message-attachment-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <Paperclip size={13} /> {expected ? `${expected} bilaga${expected === 1 ? "" : "or"}` : "Sparade bilagor"}
    </button>
    {open && <div className="message-attachment-list">
      {assets === null && !notice && <small>Hämtar säkra bilagor…</small>}
      {assets?.length === 0 && <small>{expected ? "Bilagan analyseras eller kunde inte hämtas från källan ännu." : "Inga sparade bilagor i denna del av tråden."}</small>}
      {assets?.map((asset) => <div className={`message-attachment ${asset.mime_type.startsWith("image/") ? "image" : ""}`} key={asset.id}>
        {asset.mime_type.startsWith("image/") && asset.previewUrl ? <img src={asset.previewUrl} alt={asset.summary || asset.title || "Bilaga"} /> : icon(asset)}<div><strong>{asset.title || asset.filename}</strong>{asset.mime_type.startsWith("audio/") && asset.previewUrl ? <audio controls preload="metadata" src={asset.previewUrl} /> : null}{asset.mime_type.startsWith("video/") && asset.previewUrl ? <video controls preload="metadata" src={asset.previewUrl}>Din webbläsare kan inte spela upp videon.</video> : null}{asset.transcript ? <details><summary>Transkribering</summary><p>{asset.transcript}</p></details> : asset.summary && <small>{asset.summary}</small>}</div>
        <button type="button" className="icon-button" title="Förhandsvisa säkert" aria-label={`Förhandsvisa ${asset.title || asset.filename}`} onClick={() => setViewer(asset)}><ExternalLink size={13} /></button>
      </div>)}
      {notice && <small className="negative">{notice}</small>}
    </div>}
    {viewer && <AttachmentViewer asset={viewer} onClose={() => setViewer(null)} />}
  </div>;
}
