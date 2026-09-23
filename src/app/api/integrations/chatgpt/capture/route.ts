import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const sourceSchema = z.enum(["email", "instagram", "whatsapp", "messenger", "tinder", "tiktok", "linkedin", "manual", "imessage"]);

const payloadSchema = z.object({
  source: sourceSchema,
  participantName: z.string().trim().min(1).max(120),
  inboundText: z.string().trim().min(1).max(50_000),
  draftResponse: z.string().max(8_000).optional().default(""),
  draftTone: z.string().trim().max(120).optional().default("Natural"),
  title: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(600).optional(),
  priorityScore: z.number().min(0).max(10).optional(),
  sentAt: z.string().datetime({ offset: true }).optional(),
  externalMessageId: z.string().trim().max(300).optional(),
  accountLabel: z.string().trim().max(120).optional().default("ChatGPT observed"),
});

function authorized(request: NextRequest) {
  const expected = process.env.CHATGPT_CAPTURE_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const actual = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerId = process.env.CHATGPT_CAPTURE_OWNER_ID;
  if (!ownerId) return NextResponse.json({ error: "ChatGPT capture owner is not configured." }, { status: 503 });

  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payload." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const sentAt = parsed.sentAt ? new Date(parsed.sentAt) : new Date();
  const sentAtIso = sentAt.toISOString();

  const { data: candidates, error: peopleError } = await supabase
    .from("people")
    .select("id,display_name,last_contact_at")
    .eq("owner_id", ownerId)
    .ilike("display_name", parsed.participantName)
    .or("relationship_status.is.null,relationship_status.neq.merged")
    .limit(20);
  if (peopleError) return NextResponse.json({ error: "Could not resolve contact." }, { status: 500 });

  let personId: string | undefined;
  if (candidates?.length) {
    const candidateIds = candidates.map((person) => person.id);
    const { data: matchingIdentities } = await supabase
      .from("identities")
      .select("person_id,source")
      .eq("owner_id", ownerId)
      .eq("source", parsed.source)
      .in("person_id", candidateIds);

    const sameSourceIds = new Set((matchingIdentities ?? []).map((item) => item.person_id));
    const ordered = [...candidates].sort((a, b) => {
      const sourceDifference = Number(sameSourceIds.has(b.id)) - Number(sameSourceIds.has(a.id));
      if (sourceDifference) return sourceDifference;
      return String(b.last_contact_at ?? "").localeCompare(String(a.last_contact_at ?? ""));
    });
    personId = ordered[0]?.id;
  }

  if (!personId) {
    const { data: createdPerson, error } = await supabase
      .from("people")
      .insert({
        owner_id: ownerId,
        display_name: parsed.participantName,
        first_name: parsed.participantName.split(/\s+/)[0] ?? parsed.participantName,
        entity_type: "person",
        first_contact_at: sentAtIso,
        last_contact_at: sentAtIso,
      })
      .select("id")
      .single();
    if (error || !createdPerson) return NextResponse.json({ error: "Could not create contact." }, { status: 500 });
    personId = createdPerson.id;
  }

  const syntheticIdentity = `assistant-observed:${parsed.source}:${normalized(parsed.participantName)}`;
  const { data: exactIdentity } = await supabase
    .from("identities")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("person_id", personId)
    .eq("source", parsed.source)
    .limit(1)
    .maybeSingle();

  if (!exactIdentity) {
    await supabase.from("identities").upsert({
      owner_id: ownerId,
      person_id: personId,
      source: parsed.source,
      external_identifier: syntheticIdentity,
      metadata: { provider: "chatgpt-observed", account_label: parsed.accountLabel, assistant_observed: true },
      verified_match: false,
      confidence: 0.8,
    }, { onConflict: "owner_id,source,external_identifier" });
  }

  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("id,connection_id,title")
    .eq("owner_id", ownerId)
    .eq("person_id", personId)
    .eq("source", parsed.source)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  let conversationId = existingConversation?.id;
  if (!conversationId) {
    const conversationKey = `assistant-observed:${parsed.source}:${personId}`;
    const { data: createdConversation, error } = await supabase
      .from("conversations")
      .upsert({
        owner_id: ownerId,
        person_id: personId,
        source: parsed.source,
        external_conversation_id: conversationKey,
        title: parsed.title || parsed.participantName,
        conversation_type: "assistant_observed",
        status: "active",
        last_message_at: sentAtIso,
        last_other_message_at: sentAtIso,
        summary: parsed.summary || null,
        priority_score: parsed.priorityScore ?? null,
        recommended_action: { imported_analysis: true, captured_by: "chatgpt" },
      }, { onConflict: "owner_id,source,external_conversation_id" })
      .select("id")
      .single();
    if (error || !createdConversation) return NextResponse.json({ error: "Could not create conversation." }, { status: 500 });
    conversationId = createdConversation.id;
  }

  const aiAnalysis = {
    summary: parsed.summary || "Conversation captured from ChatGPT.",
    intent: "",
    priorityReason: "Captured from a message the owner showed to ChatGPT.",
    requiresReply: true,
    draftResponse: parsed.draftResponse,
    draftTone: parsed.draftTone,
  };

  const generatedMessageId = `assistant-observed:${createHash("sha256")
    .update([parsed.source, personId, parsed.inboundText, sentAtIso.slice(0, 16)].join("\n"))
    .digest("hex")}`;
  const externalMessageId = parsed.externalMessageId || generatedMessageId;

  const { data: savedMessage, error: messageError } = await supabase
    .from("messages")
    .upsert({
      owner_id: ownerId,
      conversation_id: conversationId,
      external_message_id: externalMessageId,
      direction: "in",
      source: parsed.source,
      body_text: parsed.inboundText,
      sent_at: sentAtIso,
      metadata: {
        provider: "chatgpt-observed",
        assistant_observed: true,
        owner_reviewed: true,
        account_label: parsed.accountLabel,
        ai_analysis: aiAnalysis,
      },
      attachment_count: 0,
      processed_at: null,
    }, { onConflict: "owner_id,source,external_message_id" })
    .select("id")
    .single();

  if (messageError || !savedMessage) return NextResponse.json({ error: "Could not save message." }, { status: 500 });

  await Promise.all([
    supabase.from("conversations").update({
      last_message_at: sentAtIso,
      last_other_message_at: sentAtIso,
      summary: parsed.summary || undefined,
      priority_score: parsed.priorityScore,
      recommended_action: { imported_analysis: true, captured_by: "chatgpt" },
      updated_at: new Date().toISOString(),
    }).eq("id", conversationId).eq("owner_id", ownerId),
    supabase.from("people").update({
      last_contact_at: sentAtIso,
      updated_at: new Date().toISOString(),
    }).eq("id", personId).eq("owner_id", ownerId),
    supabase.from("audit_logs").insert({
      owner_id: ownerId,
      actor_id: ownerId,
      actor_type: "assistant",
      action: "conversation.assistant_observed",
      object_type: "message",
      object_id: savedMessage.id,
      source: parsed.source,
      new_value: {
        person_id: personId,
        conversation_id: conversationId,
        draft_saved: Boolean(parsed.draftResponse.trim()),
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    personId,
    conversationId,
    messageId: savedMessage.id,
    draftStored: Boolean(parsed.draftResponse.trim()),
  });
}
