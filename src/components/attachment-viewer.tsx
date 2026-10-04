"use client";

import { useEffect, useState } from "react";
import { Download, FileText, LoaderCircle, X } from "lucide-react";

export type ViewableAttachment = {
  id: string;
  title?: string | null;
  filename?: string | null;
  mime_type: string;
  summary?: string | null;
  transcript?: string | null;
};

function titleOf(asset: ViewableAttachment) { return asset.title || asset.filename || "Bilaga"; }
function isText(mime: string) { return mime === "text/plain" || mime === "text/csv" || mime === "application/json"; }

function TextPreview({ asset }: { asset: ViewableAttachment }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/vault/assets/${asset.id}/preview`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Filen kunde inte läsas.");
        const value = await response.text();
        if (asset.mime_type === "application/json") {
          try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
        }
        return value;
      })
      .then(value => setContent(value.slice(0, 250_000)))
      .catch(() => { if (!controller.signal.aborted) setError("Förhandsvisningen kunde inte läsas. Du kan fortfarande hämta originalet säkert."); });
    return () => controller.abort();
  }, [asset.id, asset.mime_type]);
  if (error) return <p className="attachment-viewer-notice">{error}</p>;
  if (content === null) return <p className="attachment-viewer-notice"><LoaderCircle className="spin" size={16} /> Hämtar förhandsvisning…</p>;
  if (asset.mime_type === "text/csv") {
    const rows = content.split(/\r?\n/).filter(Boolean).slice(0, 100).map(line => line.split(",").slice(0, 12));
    return <div className="attachment-csv"><table><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => index === 0 ? <th key={cellIndex}>{cell.trim()}</th> : <td key={cellIndex}>{cell.trim()}</td>)}</tr>)}</tbody></table></div>;
  }
  return <pre className="attachment-text-preview">{content}</pre>;
}

/** One owner-scoped viewer for all surfaces that expose a retained attachment. */
export function AttachmentViewer({ asset, onClose }: { asset: ViewableAttachment; onClose: () => void }) {
  const name = titleOf(asset);
  const preview = `/api/vault/assets/${asset.id}/preview`;
  const image = asset.mime_type.startsWith("image/");
  const video = asset.mime_type.startsWith("video/");
  const audio = asset.mime_type.startsWith("audio/");
  const pdf = asset.mime_type === "application/pdf";
  return <div className="attachment-viewer-overlay" role="dialog" aria-modal="true" aria-label={`Förhandsvisa ${name}`}>
    <section className="attachment-viewer">
      <header className="attachment-viewer-head"><div><span className="eyebrow">Säker förhandsvisning</span><h2>{name}</h2>{asset.summary && <p>{asset.summary}</p>}</div><button type="button" className="icon-button" aria-label="Stäng förhandsvisning" onClick={onClose}><X size={18} /></button></header>
      <div className="attachment-viewer-content">
        {pdf && <iframe className="attachment-pdf" title={name} src={preview} />}
        {image && <img className="attachment-image" src={preview} alt={asset.summary || name} />}
        {video && <video className="attachment-video" controls autoPlay={false} preload="metadata" src={preview}>Din webbläsare kan inte spela upp videon.</video>}
        {audio && <div className="attachment-audio"><audio controls autoPlay={false} preload="metadata" src={preview}>Din webbläsare kan inte spela upp ljudet.</audio>{asset.transcript && <details open><summary>Transkribering</summary><p>{asset.transcript}</p></details>}</div>}
        {isText(asset.mime_type) && <TextPreview asset={asset} />}
        {!pdf && !image && !video && !audio && !isText(asset.mime_type) && <div className="attachment-unsupported"><FileText size={28} /><strong>Förhandsvisning saknas för detta filformat</strong><p>Originalet är fortfarande skyddat och kan hämtas utan att lämna ut en permanent länk.</p></div>}
      </div>
      <footer className="attachment-viewer-actions"><a className="btn" href={preview} target="_blank" rel="noreferrer"><Download size={14} />Hämta original</a><button type="button" className="btn primary" onClick={onClose}>Klar</button></footer>
    </section>
  </div>;
}
