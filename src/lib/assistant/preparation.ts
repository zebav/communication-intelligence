import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeCalendarIntent } from "@/lib/calendar/ai-intent";
import { calendarSuggestions } from "@/lib/calendar/suggestions-service";
import { meetingDefaults } from "@/lib/calendar/types";
import { GooglePlacesRoutes } from "@/lib/calendar/places-routing";
import { mapsEnabled, reserveMapsOperation } from "@/lib/calendar/maps-budget";
import { listKnowledgeEntries } from "@/lib/personal-knowledge";
import { getAIService } from "@/lib/ai/service";
import { generateDraft } from "./repository";
import type { Plan, PreparedDecision, TaskKind } from "./model";

function dateInTimezone(timezone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function resolveRelativeMeetingDate(messages: Array<{ body: string }>, timezone: string) {
  const text = messages.map((message) => message.body).reverse().join("\n").toLocaleLowerCase();
  const base = dateInTimezone(timezone);
  const plus = (days: number) => { const value = new Date(base); value.setUTCDate(value.getUTCDate() + days); return isoDay(value); };
  if (/\b(i övermorgon|day after tomorrow)\b/i.test(text)) return plus(2);
  if (/\b(imorgon|tomorrow)\b/i.test(text)) return plus(1);
  if (/\b(idag|today)\b/i.test(text)) return plus(0);

  const weekdays: Record<string, number> = {
    söndag: 0, sunday: 0, måndag: 1, monday: 1, tisdag: 2, tuesday: 2,
    onsdag: 3, wednesday: 3, torsdag: 4, thursday: 4, fredag: 5, friday: 5,
    lördag: 6, saturday: 6,
  };
  for (const [name, target] of Object.entries(weekdays)) {
    const nextPattern = new RegExp(`\\b(nästa|next)\\s+${name}\\b`, "i");
    const ordinaryPattern = new RegExp(`\\b(på|on)?\\s*${name}\\b`, "i");
    if (!nextPattern.test(text) && !ordinaryPattern.test(text)) continue;
    const current = base.getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    if (nextPattern.test(text) && delta < 7) delta += 7;
    return plus(delta);
  }
  return null;
}

function svTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function homeAddress(entries: Awaited<ReturnType<typeof listKnowledgeEntries>>) {
  return entries.find((entry) =>
    entry.category === "home" &&
    /(home_address|hemadress|address|adress)/i.test(entry.key) &&
    (entry.sensitivity !== "restricted" || entry.allowedUses.some((use) => /travel|calendar|meeting/i.test(use)))
  )?.value ?? "";
}

async function meetingPreparation(db: SupabaseClient, owner: string, plan: Plan): Promise<Plan> {
  const [messages, settings] = await Promise.all([
    db.from("messages").select("id,body_text,sent_at,direction,source").eq("owner_id", owner).eq("conversation_id", plan.evidence.conversationId)
      .order("sent_at", { ascending: false }).order("id").limit(16),
    db.from("calendar_workspace").select("timezone").eq("owner_id", owner).single(),
  ]);
  if (messages.error || settings.error || !messages.data?.length) throw new Error("Mötesunderlaget eller masterkalendern kunde inte läsas.");

  const evidence = [...messages.data].reverse().map((message) => ({
    id: String(message.id),
    body: String(message.body_text ?? "").slice(0, 3000),
    sentAt: message.sent_at,
    direction: String(message.direction),
    source: String(message.source),
  }));
  const intent = await analyzeCalendarIntent({ ownerId: owner, timezone: settings.data.timezone, messages: evidence });
  const defaults = meetingDefaults[intent.meetingType] ?? meetingDefaults.OTHER;
  const duration = intent.durationMinutes ?? defaults.durationMinutes;
  const resolvedDate = intent.date ?? resolveRelativeMeetingDate(evidence, settings.data.timezone);

  let preparation: PreparedDecision = {
    status: "needs_input",
    summary: intent.summary,
    preparedAt: new Date().toISOString(),
    meeting: {
      date: resolvedDate ?? "",
      durationMinutes: duration,
      location: intent.locationText,
      placeName: "",
      placeAddress: "",
      travelSummary: "",
      slots: [],
    },
  };

  if (intent.operation !== "propose") {
    const context = [
      `Kalenderanalys: ${intent.summary}`,
      intent.questions.length ? `Frågor som behöver klargöras: ${intent.questions.join(" | ")}` : "",
    ].filter(Boolean).join("\n");
    const draft = await generateDraft(db, owner, plan, false, context);
    return { ...plan, draft, originalDraft: draft, preparation };
  }

  if (!resolvedDate) {
    const context = [
      `Mötesönskemål: ${intent.summary}`,
      `Datum saknas eller behöver bekräftas.`,
      intent.questions.length ? `Be personen om: ${intent.questions.join(" | ")}` : "",
    ].filter(Boolean).join("\n");
    const draft = await generateDraft(db, owner, plan, false, context);
    return { ...plan, draft, originalDraft: draft, preparation };
  }

  const slotsResult = await calendarSuggestions(db, owner, {
    date: resolvedDate,
    duration,
    preparation: defaults.preparationMinutes,
    recovery: defaults.recoveryMinutes,
    physical: Boolean(intent.locationText.trim()),
  });
  const slots = slotsResult.slots.filter((slot) => slot.bookable).slice(0, 3).map((slot) => ({ start: slot.start, end: slot.end }));

  let placeName = "";
  let placeAddress = "";
  let travelSummary = "";
  if (intent.locationText.trim() && mapsEnabled()) {
    try {
      const maps = new GooglePlacesRoutes(process.env.GOOGLE_MAPS_SERVER_API_KEY!, fetch, reserveMapsOperation);
      const places = await maps.search(intent.locationText.trim());
      const place = places[0];
      if (place) {
        placeName = place.name;
        placeAddress = place.address;
        const entries = await listKnowledgeEntries(owner);
        const address = homeAddress(entries);
        if (address && slots[0]) {
          const origins = await maps.search(address);
          const origin = origins[0];
          if (origin) {
            const outboundDeparture = new Date(Math.max(Date.now() + 60_000, Date.parse(slots[0].start) - 90 * 60_000)).toISOString();
            const returnDeparture = new Date(Date.parse(slots[0].end) + 10 * 60_000).toISOString();
            const [outbound, inbound] = await Promise.all([
              maps.estimate({ originPlaceId: origin.id, destinationPlaceId: place.id, departureTime: outboundDeparture, mode: "DRIVE" }),
              maps.estimate({ originPlaceId: place.id, destinationPlaceId: origin.id, departureTime: returnDeparture, mode: "DRIVE" }),
            ]);
            travelSummary = `Beräknad bilresa cirka ${outbound.minutes} min dit och ${inbound.minutes} min tillbaka från din sparade hemadress.`;
          }
        }
      }
    } catch {
      // Place/travel enrichment is useful but must not destroy an otherwise safe calendar decision.
    }
  }

  preparation = {
    status: slots.length ? "ready" : "needs_input",
    summary: intent.summary,
    preparedAt: new Date().toISOString(),
    meeting: {
      date: resolvedDate,
      durationMinutes: duration,
      location: intent.locationText,
      placeName,
      placeAddress,
      travelSummary,
      slots,
    },
  };

  const context = [
    `Mötesönskemål: ${intent.summary}`,
    slots.length ? `Kontrollerade lediga tider i masterkalendern: ${slots.map((slot) => `${svTime(slot.start, settings.data.timezone)}–${new Intl.DateTimeFormat("sv-SE", { timeZone: settings.data.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(slot.end))}`).join(" | ")}` : "Inga säkert bokningsbara tider hittades för det angivna datumet.",
    placeName ? `Platsförslag från Google Places: ${placeName}, ${placeAddress}.` : intent.locationText ? `Önskad plats enligt konversationen: ${intent.locationText}.` : "",
    travelSummary,
    "Skriv ett komplett naturligt svar. Om flera tider finns: erbjud dem kort och tydligt. Påstå inte att en kalenderbokning eller restaurangbokning redan är gjord.",
  ].filter(Boolean).join("\n");

  const draft = await generateDraft(db, owner, plan, false, context);
  return { ...plan, draft, originalDraft: draft, preparation };
}

async function researchPreparation(db: SupabaseClient, owner: string, plan: Plan): Promise<Plan> {
  const e = plan.evidence;
  const action = e.analysis.actionSuggestion;
  const context = `${e.title} ${e.body} ${action?.task ?? ""} ${action?.reason ?? ""}`;
  const needsResearch = /(restaurant|restaurang|hotel|hotell|flight|flyg|travel|resa|place|plats|book|boka|reserve|reservation|research|undersök|jämför)/i.test(context);

  if (!needsResearch) {
    const shouldDraft = e.analysis.requiresReply || ["instagram", "whatsapp"].includes(e.source);
    const draft = plan.draft || (shouldDraft ? await generateDraft(db, owner, plan, false) : "");
    return {
      ...plan,
      draft,
      originalDraft: draft,
      preparation: {
        status: "ready",
        summary: action?.task || e.analysis.summary || plan.reason,
        preparedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const deep = await getAIService().deeplyAnalyzeEmail({
      ownerId: owner,
      source: e.source,
      senderName: e.personName,
      subject: e.title,
      preview: e.body,
      currentClassification: e.classification || "Business",
      researchApproved: true,
    });
    const research = {
      overview: deep.overview,
      recommendedApproach: deep.recommendedApproach,
      sources: deep.sources.slice(0, 6),
    };
    const contextText = [
      `Research overview: ${deep.overview}`,
      `Recommended approach: ${deep.recommendedApproach}`,
      deep.facts.length ? `Verified/public facts found: ${deep.facts.join(" | ")}` : "",
      deep.sources.length ? `Sources: ${deep.sources.slice(0, 6).map((source) => `${source.title} — ${source.url}`).join(" | ")}` : "",
      "Use only facts supported by the research. Do not say a booking has been made unless a provider has actually confirmed it.",
    ].filter(Boolean).join("\n");
    const shouldDraft = e.analysis.requiresReply || ["instagram", "whatsapp"].includes(e.source);
    const draft = shouldDraft ? await generateDraft(db, owner, plan, false, contextText) : (deep.suggestedReply || plan.draft);
    return {
      ...plan,
      draft,
      originalDraft: draft,
      preparation: {
        status: "ready",
        summary: deep.recommendedApproach,
        preparedAt: new Date().toISOString(),
        research,
      },
    };
  } catch {
    const shouldDraft = e.analysis.requiresReply || ["instagram", "whatsapp"].includes(e.source);
    const draft = plan.draft || (shouldDraft ? await generateDraft(db, owner, plan, false) : "");
    return {
      ...plan,
      draft,
      originalDraft: draft,
      preparation: {
        status: "failed",
        summary: "Research kunde inte slutföras automatiskt. Granska webbuppgiften innan extern körning.",
        preparedAt: new Date().toISOString(),
      },
    };
  }
}

export async function prepareDecisionPlan(db: SupabaseClient, owner: string, plan: Plan, kind: TaskKind): Promise<Plan> {
  if (kind === "meeting") return meetingPreparation(db, owner, plan);
  if (kind === "website") return researchPreparation(db, owner, plan);
  if ((kind === "reply" || kind === "follow_up") && !plan.draft.trim()) {
    const draft = await generateDraft(db, owner, plan, kind === "follow_up");
    return { ...plan, draft, originalDraft: draft, preparation: { status: "ready", summary: plan.reason, preparedAt: new Date().toISOString() } };
  }
  return { ...plan, preparation: { status: "ready", summary: plan.reason, preparedAt: new Date().toISOString() } };
}
