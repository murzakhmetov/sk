// Helpers for Web-standard (Request -> Response) serverless handlers.

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Parsed JSON body, or `undefined` when the body is missing or malformed. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
