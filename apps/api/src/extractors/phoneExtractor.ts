import type { PhoneExtractionCandidate } from "@phoneintel/shared-types";

// Matches Vietnamese phone-shaped digit runs in free text: leading 0/+84/84,
// then groups of digits separated by spaces, dots, dashes, or nothing.
// Deliberately permissive — validity is decided later by the normalizer,
// not here. This regex's only job is "does this look like a phone number".
const PHONE_CANDIDATE_REGEX =
  /(\+?84|0)(?:[\s.-]?\d){8,10}|1[89]00(?:[\s.-]?\d){4,7}/g;

const CONTEXT_WINDOW_CHARS = 80;

// Block-level tags become a paragraph break (\n) before stripping, so the
// context window below can't bleed across unrelated <li>/<p>/<h1> chunks —
// without this, "Công ty A ... Công ty B - 0912..." from two different list
// items gets read as one run-on sentence.
function stripHtmlToVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|tr|td|th|section|article|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

// Clamp a context slice to the nearest paragraph boundary within it, so a
// window never crosses into an unrelated <li>/<p>.
function clampToParagraph(slice: string, side: "before" | "after"): string {
  const idx = side === "before" ? slice.lastIndexOf("\n") : slice.indexOf("\n");
  const clamped = idx === -1 ? slice : side === "before" ? slice.slice(idx + 1) : slice.slice(0, idx);
  return clamped.replace(/\n/g, " ").trim();
}

export function extractPhoneCandidatesFromText(text: string, extractionMethod = "REGEX_TEXT"): PhoneExtractionCandidate[] {
  const candidates: PhoneExtractionCandidate[] = [];
  for (const match of text.matchAll(PHONE_CANDIDATE_REGEX)) {
    const phoneRaw = match[0].trim();
    const start = match.index ?? 0;
    const end = start + match[0].length;

    const contextBefore = clampToParagraph(text.slice(Math.max(0, start - CONTEXT_WINDOW_CHARS), start), "before");
    const contextAfter = clampToParagraph(text.slice(end, Math.min(text.length, end + CONTEXT_WINDOW_CHARS)), "after");
    const contextText = `${contextBefore} ${phoneRaw} ${contextAfter}`.trim();

    // Cheap confidence signal: presence of digit-group separators or a
    // recognizable keyword nearby raises confidence a bit over a bare
    // unbroken digit run, which is more likely to be an ID/order number.
    const looksFormatted = /[\s.-]/.test(phoneRaw);
    const hasContextKeyword = /(hotline|đt|đường dây|liên hệ|sđt|tel|phone|gọi)/i.test(contextText);
    let confidence = 0.5;
    if (looksFormatted) confidence += 0.2;
    if (hasContextKeyword) confidence += 0.2;
    confidence = Math.min(confidence, 0.95);

    candidates.push({
      phoneRaw,
      contextText,
      contextBefore,
      contextAfter,
      extractionMethod,
      positionStart: start,
      positionEnd: end,
      confidence,
    });
  }
  return candidates;
}

export function extractPhoneCandidatesFromHtml(html: string): PhoneExtractionCandidate[] {
  const visibleText = stripHtmlToVisibleText(html);
  const fromBody = extractPhoneCandidatesFromText(visibleText, "REGEX_TEXT");

  const telHrefCandidates: PhoneExtractionCandidate[] = [];
  const telHrefRegex = /href=["']tel:([^"']+)["']/gi;
  for (const match of html.matchAll(telHrefRegex)) {
    const phoneRaw = match[1].trim();
    telHrefCandidates.push({
      phoneRaw,
      contextText: phoneRaw,
      contextBefore: "",
      contextAfter: "",
      extractionMethod: "TEL_HREF",
      positionStart: match.index ?? 0,
      positionEnd: (match.index ?? 0) + match[0].length,
      confidence: 0.9,
    });
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const fromTitle = titleMatch ? extractPhoneCandidatesFromText(titleMatch[1], "REGEX_TITLE") : [];

  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const fromMeta = metaDescMatch ? extractPhoneCandidatesFromText(metaDescMatch[1], "REGEX_META_DESCRIPTION") : [];

  return [...telHrefCandidates, ...fromBody, ...fromTitle, ...fromMeta];
}
