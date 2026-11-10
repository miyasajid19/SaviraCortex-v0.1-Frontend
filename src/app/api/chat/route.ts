const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type GenerationResult = {
  generation_id?: string | null;
  conversation_id?: string | null;
  query: string;
  answer: string;
  status: "answered" | "partial" | "insufficient_evidence";
  citations?: unknown[];
  warnings?: string[];
  missing_information?: string[];
  guardrail_decision?: "blocked" | "redirected" | "redacted" | null;
  guardrail_categories?: string[];
};

type BackendEvent = Record<string, unknown>;

function frame(chunk: Record<string, unknown> | "[DONE]") {
  return `data: ${chunk === "[DONE]" ? "[DONE]" : JSON.stringify(chunk)}\n\n`;
}

function parseEventFrame(value: string): { event: string; payload: BackendEvent } | null {
  if (!value.trim() || value.startsWith(":")) return null;
  let event = "message";
  const data: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, payload: JSON.parse(data.join("\n")) as BackendEvent };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return Response.json({ detail: "Authentication is required." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ detail: "The chat request must be valid JSON." }, { status: 400 });
  }

  const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
  const query = typeof body.query === "string" ? body.query : "";
  const requestId = typeof body.request_id === "string" ? body.request_id : crypto.randomUUID();
  const assistantMessageId = typeof body.assistant_message_id === "string" ? body.assistant_message_id : crypto.randomUUID();
  const userMessageId = typeof body.user_message_id === "string" ? body.user_message_id : "";

  if (!organizationId || !query.trim()) {
    return Response.json({ detail: "An organization and a non-empty message are required." }, { status: 422 });
  }

  const backendPayload = {
    query,
    conversation_id: typeof body.conversation_id === "string" ? body.conversation_id : null,
    request_id: requestId,
    ...(body.pii_action === "redact" || body.pii_action === "send_as_is" ? { pii_action: body.pii_action } : {}),
  };

  let upstream: Response;
  try {
    upstream = await fetch(
      `${API}/api/v1/organizations/${encodeURIComponent(organizationId)}/generation/stream`,
      {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(backendPayload),
        cache: "no-store",
        signal: request.signal,
      },
    );
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 204 });
    return Response.json(
      { detail: error instanceof Error ? error.message : "The generation service is unavailable." },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    const errorBody = await upstream.json().catch(() => ({}));
    return Response.json(errorBody, { status: upstream.status });
  }
  if (!upstream.body) {
    return Response.json({ detail: "The generation service did not open a response stream." }, { status: 502 });
  }

  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (chunk: Record<string, unknown> | "[DONE]") => controller.enqueue(encoder.encode(frame(chunk)));
      const reader = upstream.body!.getReader();
      upstreamReader = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      let textStarted = false;
      let finished = false;

      emit({ type: "start", messageId: assistantMessageId });

      const processFrame = (raw: string) => {
        const parsed = parseEventFrame(raw);
        if (!parsed) return;
        const { event, payload } = parsed;

        if (event === "status") {
          emit({
            type: "data-status",
            data: {
              stage: typeof payload.stage === "string" ? payload.stage : "working",
              message: typeof payload.message === "string" ? payload.message : "Preparing your answer…",
            },
            transient: true,
          });
          return;
        }

        if (event === "delta") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          if (!delta) return;
          if (!textStarted) {
            emit({ type: "text-start", id: "savira-answer" });
            textStarted = true;
          }
          emit({ type: "text-delta", id: "savira-answer", delta });
          return;
        }

        if (event === "completed") {
          const result = payload.result as GenerationResult | undefined;
          if (!result || typeof result.answer !== "string") {
            if (textStarted) emit({ type: "text-end", id: "savira-answer" });
            emit({ type: "data-generationError", data: { message: "The server completed without a validated answer." }, transient: true });
            emit({ type: "finish", finishReason: "error" });
            finished = true;
            return;
          }

          if (textStarted) emit({ type: "text-end", id: "savira-answer" });
          // Replace provisional checked segments with the final validated response.
          emit({ type: "reset-step" });
          emit({ type: "text-start", id: "savira-final-answer" });
          if (result.answer) emit({ type: "text-delta", id: "savira-final-answer", delta: result.answer });
          emit({ type: "text-end", id: "savira-final-answer" });

          if (userMessageId) {
            emit({
              type: "data-userMessageUpdate",
              data: {
                messageId: userMessageId,
                content: result.query,
                guardrailDecision: result.query !== query ? "redacted" : undefined,
              },
              transient: true,
            });
          }

          const metadata = {
            generationId: result.generation_id || undefined,
            conversationId: result.conversation_id || undefined,
            status: result.status,
            citations: result.citations || [],
            warnings: result.warnings || [],
            missingInformation: result.missing_information || [],
            guardrailDecision: result.guardrail_decision || undefined,
            guardrailCategories: result.guardrail_categories || [],
          };
          emit({ type: "message-metadata", messageMetadata: metadata });
          emit({ type: "finish", finishReason: "stop", messageMetadata: metadata });
          finished = true;
          return;
        }

        if (event === "error") {
          if (textStarted) {
            emit({ type: "text-end", id: "savira-answer" });
            textStarted = false;
          }
          if (payload.code === "pii_consent_required") {
            emit({
              type: "data-piiConsent",
              data: {
                requestId,
                userMessageId,
                query,
                redactedPreview: String(payload.redacted_preview || ""),
                entities: Array.isArray(payload.entities) ? payload.entities.map(String) : [],
                allowedActions: Array.isArray(payload.allowed_actions)
                  ? payload.allowed_actions.filter((item) => item === "redact" || item === "send_as_is" || item === "reject")
                  : ["redact", "reject"],
              },
              transient: true,
            });
          } else {
            emit({
              type: "data-generationError",
              data: {
                code: String(payload.code || "generation_error"),
                message: String(payload.message || "Generation failed. Please retry."),
                conversationId: typeof payload.conversation_id === "string" ? payload.conversation_id : undefined,
                userMessageId,
              },
              transient: true,
            });
          }
          emit({ type: "finish", finishReason: "stop" });
          finished = true;
        }
      };

      try {
        while (!request.signal.aborted) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || "";
          for (const raw of frames) processFrame(raw);
          if (finished || done) break;
        }
        if (!finished && buffer.trim()) processFrame(buffer);
        if (!finished && !request.signal.aborted) {
          if (textStarted) emit({ type: "text-end", id: "savira-answer" });
          emit({ type: "data-generationError", data: { message: "The response ended before final validation completed." }, transient: true });
          emit({ type: "finish", finishReason: "error" });
        }
        if (!request.signal.aborted) emit("[DONE]");
      } catch (error) {
        if (!request.signal.aborted) {
          emit({
            type: "data-generationError",
            data: { message: error instanceof Error ? error.message : "The response stream failed." },
            transient: true,
          });
          emit({ type: "finish", finishReason: "error" });
          emit("[DONE]");
        }
      } finally {
        try { reader.releaseLock(); } catch { /* the consumer may already have cancelled */ }
        try { controller.close(); } catch { /* cancellation already closed the stream */ }
      }
    },
    async cancel(reason) {
      await upstreamReader?.cancel(reason);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
