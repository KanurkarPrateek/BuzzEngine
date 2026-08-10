/**
 * Providers differ wildly in how faithfully they honour "return JSON only" — some
 * wrap it in prose, some in a code fence, some emit a leading explanation. This
 * pulls the first complete JSON value out of a response without regex guesswork.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Fast path: the whole body is already valid JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to scanning
  }

  const fenced = stripCodeFence(trimmed);
  if (fenced !== trimmed) {
    try {
      return JSON.parse(fenced);
    } catch {
      // fall through
    }
  }

  const scanned = scanBalanced(fenced);
  if (scanned !== undefined) return scanned;

  throw new Error(`no JSON value found in model output: ${text.slice(0, 300)}`);
}

function stripCodeFence(text: string): string {
  if (!text.startsWith("```")) return text;
  const firstNewline = text.indexOf("\n");
  if (firstNewline === -1) return text;
  const closing = text.lastIndexOf("```");
  if (closing <= firstNewline) return text.slice(firstNewline + 1).trim();
  return text.slice(firstNewline + 1, closing).trim();
}

/** Walk the string tracking brace/bracket depth, ignoring delimiters inside strings. */
function scanBalanced(text: string): unknown {
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break; // malformed from this start point; try the next one
          }
        }
      }
    }
  }
  return undefined;
}

/** Prompt suffix used by adapters without a native structured-output mode. */
export function jsonInstruction(schema: Record<string, unknown>): string {
  return [
    "Respond with a single JSON object and nothing else.",
    "No prose before or after it, no markdown code fence.",
    "It must validate against this JSON Schema:",
    JSON.stringify(schema),
  ].join("\n");
}
