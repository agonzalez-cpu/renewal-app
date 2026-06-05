import { jsonError, jsonOk } from "@/lib/api-response";
import { config } from "@/lib/config";
import { validateHubSpotRequestSignature } from "@/lib/hubspot/signature";
import { handleBreezeOutputAction } from "@/lib/webhooks/breeze-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!config.breezeWebhookAllowUnsigned) {
    if (!config.hubspotClientSecret) {
      return jsonError("HUBSPOT_CLIENT_SECRET is required for signed HubSpot agent-tool requests.", 503);
    }

    const valid = validateHubSpotRequestSignature({
      clientSecret: config.hubspotClientSecret,
      method: request.method,
      url: request.url,
      body: rawBody,
      headers: request.headers
    });
    if (!valid) return jsonError("Invalid HubSpot request signature.", 401);
  }

  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonError("Webhook body must be valid JSON.", 400);
  }

  const response = await handleBreezeOutputAction(body as Parameters<typeof handleBreezeOutputAction>[0]);
  return jsonOk(response);
}
