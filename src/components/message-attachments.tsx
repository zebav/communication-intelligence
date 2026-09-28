"use client";

import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Music2, Paperclip, Play, ExternalLink } from "lucide-react";

type Asset = { id: string; asset_kind: string; title: string; filename: string; mime_type: string; summary?: string; source_type: string };

function icon(asset: Asset) {
  if (asset.asset_kind === "image") return <ImageIcon size={14} />;
  if (asset.asset_kind === "audio") return <Music2 size={14} />;
  if (asset.mime_type.startsWith("video/")) return <Play size={14} />;
  return <FileText size={14} />;
}

export function MessageAttachments({ messageId, expected = 0 }: { messageId: string; expected?: number }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);

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

  async function openAsset(id: string) {
    const response = await fetch(`/api/vault/assets?assetId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json() as { url?: string; error?: string };
    if (!response.ok || !data.url) { setNotice(data.error ?? "Filen kunde inte öppnas."); return; }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  if (!expected && !open) return null;
  return <div className="message-attachments">
    <button type="button" className="message-attachment-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <Paperclip size={13} /> {expected ? `${expected} bilaga${expected === 1 ? "" : "or"}` : "Sparade bilagor"}
    </button>
    {open && <div className="message-attachment-list">
      {assets === null && !notice && <small>Hämtar säkra bilagor…</small>}
      {assets?.length === 0 && <small>{expected ? "Bilagan analyseras eller kunde inte hämtas från källan ännu." : "Inga sparade bilagor i denna del av tråden."}</small>}
      {assets?.map((asset) => <div className="message-attachment" key={asset.id}>
        {icon(asset)}<div><strong>{asset.title || asset.filename}</strong>{asset.summary && <small>{asset.summary}</small>}</div>
        <button type="button" className="icon-button" title="Öppna säkert" aria-label={`Öppna ${asset.title || asset.filename}`} onClick={() => void openAsset(asset.id)}><ExternalLink size={13} /></button>
      </div>)}
      {notice && <small className="negative">{notice}</small>}
    </div>}
  </div>;
}
