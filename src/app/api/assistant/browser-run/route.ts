import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeTask, readTask } from "@/lib/assistant/repository";
import { browserVariables } from "@/lib/assistant/browser-private-fields";
import { browserActionRisk, browserAgentResultSchema, ensureBrowserbaseContext, exactBrowserTarget, getBrowserbaseAgent, startBrowserbaseAgent, terminalBrowserbaseRun } from "@/lib/assistant/browserbase-agent";
import { checkBrowserRequest } from "@/lib/assistant/browser-network";

export const maxDuration = 60;

const startSchema = z.object({
  taskId: z.string().uuid(),
  revision: z.number().int().positive(),
  approved: z.literal(true),
  ephemeral: z.record(z.string().max(80), z.string().max(2000)).default({}),
});
const querySchema = z.object({ taskId: z.string().uuid() });

async function session() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Din session har gått ut. Logga in igen." }, { status: 401 }) };
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: NextResponse.json({ error: "Tvåfaktorsinloggning krävs." }, { status: 403 }) };
  return { db, owner: user.id };
}

async function ensureNoActiveRun(admin: ReturnType<typeof createAdminClient>, owner: string) {
  const { data, error } = await admin.from("assistant_browser_agent_runs")
    .select("id,run_id,status").eq("owner_id", owner).in("status", ["PREPARING","PENDING","RUNNING"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Pågående Browserbase-körningar kunde inte kontrolleras.");
  if (!data) return;
  if (!data.run_id || data.status === "PREPARING") throw new Error("En Browserbase-körning håller fortfarande på att starta. Vänta och hämta status innan en ny körning startas.");
  const run = await getBrowserbaseAgent(data.run_id);
  if (!terminalBrowserbaseRun(run.status)) throw new Error("En annan Browserbase-körning pågår. Vänta tills den är klar.");
  await admin.from("assistant_browser_agent_runs").update({
    status: run.status,
    session_id: run.sessionId ?? null,
    result: run.result ?? {},
    updated_at: new Date().toISOString(),
  }).eq("id", data.id).eq("owner_id", owner);
}

function safeMissingInformation(value: unknown) {
  const parsed = z.array(z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    kind: z.enum(["text","email","phone","date","username","password","account_number","one_time_code","other"]),
    description: z.string().max(240),
    sensitivity: z.enum(["personal","sensitive","restricted"]),
  })).max(12).safeParse(value);
  return parsed.success ? parsed.data : [];
}

async function transitionToExecuting(db: Awaited<ReturnType<typeof createClient>>, owner: string, task: Awaited<ReturnType<typeof readTask>>) {
  let current = task;
  if (current.status === "waiting") current = await changeTask(db, owner, current, "decision", current.plan, current.result);
  if (current.status === "decision") current = await changeTask(db, owner, current, "ready", current.plan, current.result);
  if (current.status !== "ready") throw new Error("Webbuppgiften kan inte köras i sitt nuvarande läge.");
  return changeTask(db, owner, current, "executing", current.plan, current.result);
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Kontrollera webbuppgiften." }, { status: 400 });
  const auth = await session();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  try {
    if (!process.env.BROWSERBASE_API_KEY?.trim()) return NextResponse.json({ error: "Browserbase är inte konfigurerat i production." }, { status: 503 });
    await ensureNoActiveRun(admin, auth.owner);
    const task = await readTask(auth.db, auth.owner, parsed.data.taskId);
    if (task.kind !== "website" || task.revision !== parsed.data.revision || !["decision","ready","waiting"].includes(task.status)) {
      return NextResponse.json({ error: "Webbuppgiften har ändrats. Granska den senaste versionen först." }, { status: 409 });
    }
    const action = task.plan.evidence.analysis.actionSuggestion;
    if (!action?.detected || !action.targetUrl?.trim()) return NextResponse.json({ error: "Uppgiften saknar en verifierad webbåtgärd." }, { status: 409 });
    const target = exactBrowserTarget(action.targetUrl);
    await checkBrowserRequest({ url: target.url, method: "GET", approvedUrls: [target.url] });

    const riskText = [action.task, action.reason, task.plan.evidence.title].filter(Boolean).join(" ");
    if (browserActionRisk(riskText) === "critical") {
      return NextResponse.json({ error: "Den här webbåtgärden kan skapa betalning, juridiskt åtagande eller säkerhetsändring och kräver ett separat kritiskt godkännandeflöde." }, { status: 409 });
    }

    const prepared = await browserVariables(auth.owner, task, parsed.data.ephemeral);
    if (prepared.missing.length) {
      return NextResponse.json({
        error: "Fyll i de uppgifter som saknas innan Browserbase kör uppgiften.",
        missingFields: prepared.missing.map((field) => ({
          key: field.key, label: field.label, kind: field.kind, description: field.description,
          sensitivity: field.sensitivity, persist: field.persist,
        })),
      }, { status: 409 });
    }

    const contextId = await ensureBrowserbaseContext(admin, auth.owner, target.host);
    const claimed = await transitionToExecuting(auth.db, auth.owner, task);

    const { data: reservation, error: reserveError } = await admin.from("assistant_browser_agent_runs").insert({
      owner_id: auth.owner,
      task_id: claimed.id,
      execution_revision: claimed.revision,
      host: target.host,
      run_id: null,
      status: "PREPARING",
    }).select("id").single();
    if (reserveError || !reservation) {
      await changeTask(auth.db, auth.owner, claimed, "uncertain", claimed.plan, { ...claimed.result, browserError: "active_run_or_reservation_failed" }).catch(() => undefined);
      return NextResponse.json({ error: "En annan webbuppgift pågår eller körningen kunde inte reserveras. Starta inte om den automatiskt." }, { status: 409 });
    }

    try {
      const run = await startBrowserbaseAgent({
        targetUrl: target.url,
        action: action.task || task.plan.reason,
        contextId,
        variables: prepared.variables,
        placeholders: prepared.placeholders,
      });
      const { error: saveRunError } = await admin.from("assistant_browser_agent_runs").update({
        run_id: run.runId,
        session_id: run.sessionId ?? null,
        status: run.status,
        updated_at: new Date().toISOString(),
      }).eq("id", reservation.id).eq("owner_id", auth.owner).eq("status", "PREPARING");
      if (saveRunError) throw new Error("run_receipt_failed");
      return NextResponse.json({ success: true, runId: run.runId, status: run.status, taskRevision: claimed.revision });
    } catch {
      await admin.from("assistant_browser_agent_runs").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", reservation.id).eq("owner_id", auth.owner);
      await changeTask(auth.db, auth.owner, claimed, "uncertain", claimed.plan, { ...claimed.result, browserError: "start_uncertain" }).catch(() => undefined);
      return NextResponse.json({ error: "Browserbase-körningens start kunde inte verifieras. Uppgiften är låst för att undvika dubbelkörning." }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webbuppgiften kunde inte startas." }, { status: 409 });
  }
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ taskId: request.nextUrl.searchParams.get("taskId") });
  if (!parsed.success) return NextResponse.json({ error: "Välj en giltig webbuppgift." }, { status: 400 });
  const auth = await session();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();

  try {
    let task = await readTask(auth.db, auth.owner, parsed.data.taskId);
    if (task.kind !== "website") return NextResponse.json({ error: "Uppgiften är inte en webbåtgärd." }, { status: 409 });
    const { data: ledger, error: ledgerError } = await admin.from("assistant_browser_agent_runs")
      .select("id,run_id,status,execution_revision,host,result,updated_at")
      .eq("owner_id", auth.owner).eq("task_id", task.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ledgerError) throw new Error("Browserbase-körningen kunde inte läsas.");
    if (!ledger) return NextResponse.json({ status: "NOT_STARTED" });
    if (!ledger.run_id || ledger.status === "PREPARING") return NextResponse.json({ status: ledger.status });

    const run = await getBrowserbaseAgent(ledger.run_id);
    await admin.from("assistant_browser_agent_runs").update({
      status: run.status,
      session_id: run.sessionId ?? null,
      result: run.result ?? {},
      updated_at: new Date().toISOString(),
    }).eq("id", ledger.id).eq("owner_id", auth.owner);

    if (!terminalBrowserbaseRun(run.status)) return NextResponse.json({ status: run.status, runId: run.runId });

    if (task.status === "executing" && task.revision === ledger.execution_revision) {
      if (run.status === "COMPLETED") {
        const parsedResult = browserAgentResultSchema.safeParse(run.result);
        if (!parsedResult.success) {
          task = await changeTask(auth.db, auth.owner, task, "uncertain", task.plan, { ...task.result, browserRunId: run.runId, browserError: "invalid_result" });
        } else {
          const result = parsedResult.data;
          const target = exactBrowserTarget(task.plan.evidence.analysis.actionSuggestion?.targetUrl ?? "");
          let finalHostMatches = false;
          try { finalHostMatches = new URL(result.finalUrl).hostname.toLowerCase() === target.host; } catch { finalHostMatches = false; }
          const missing = safeMissingInformation(result.missingInformation);
          const safeResult = {
            browserRunId: run.runId,
            browserStatus: run.status,
            browserSummary: result.summary,
            browserConfirmation: result.confirmationText,
            browserFinalUrl: result.finalUrl,
            browserSubmitted: result.submitted,
            browserMissingInformation: missing,
            browserBlockedReason: result.blockedReason,
            completedAt: new Date().toISOString(),
          };
          if (!finalHostMatches && !result.requiresHuman) {
            task = await changeTask(auth.db, auth.owner, task, "uncertain", task.plan, { ...task.result, ...safeResult, browserError: "final_host_mismatch" });
          } else if (result.requiresHuman || missing.length || !result.completed) {
            task = await changeTask(auth.db, auth.owner, task, "waiting", task.plan, { ...task.result, ...safeResult });
          } else {
            task = await changeTask(auth.db, auth.owner, task, "done", task.plan, { ...task.result, ...safeResult, confirmedByProvider: true });
          }
        }
      } else {
        task = await changeTask(auth.db, auth.owner, task, "uncertain", task.plan, {
          ...task.result,
          browserRunId: run.runId,
          browserStatus: run.status,
          browserError: run.cause?.code ?? run.status.toLowerCase(),
        });
      }
    }

    return NextResponse.json({
      status: run.status,
      runId: run.runId,
      taskStatus: task.status,
      result: {
        summary: typeof task.result.browserSummary === "string" ? task.result.browserSummary : "",
        confirmation: typeof task.result.browserConfirmation === "string" ? task.result.browserConfirmation : "",
        finalUrl: typeof task.result.browserFinalUrl === "string" ? task.result.browserFinalUrl : "",
        submitted: task.result.browserSubmitted === true,
        missingInformation: safeMissingInformation(task.result.browserMissingInformation),
        blockedReason: typeof task.result.browserBlockedReason === "string" ? task.result.browserBlockedReason : "",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Browserbase-körningen kunde inte uppdateras." }, { status: 409 });
  }
}
