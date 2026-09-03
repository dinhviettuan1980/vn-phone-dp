export type SourceType =
  | "OFFICIAL_WEBSITE"
  | "BUSINESS_DIRECTORY"
  | "PUBLIC_DATASET"
  | "NEWS"
  | "GOVERNMENT"
  | "USER_SUBMITTED"
  | "OTHER";

export type TrustLevel = "HIGH" | "MEDIUM" | "LOW";

export type CrawlStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "SKIPPED";

export type PhoneType =
  | "MOBILE"
  | "LANDLINE"
  | "HOTLINE_1800"
  | "HOTLINE_1900"
  | "SHORT_CODE"
  | "UNKNOWN";

export type IdentityType = "PERSON" | "BUSINESS" | "HOTLINE" | "ORGANIZATION" | "UNKNOWN";

export type IdentityCategory =
  | "BANK"
  | "INSURANCE"
  | "TELECOM"
  | "HOSPITAL"
  | "GOVERNMENT"
  | "DELIVERY"
  | "ECOMMERCE"
  | "REAL_ESTATE"
  | "TELEMARKETING"
  | "SPAM"
  | "SCAM"
  | "OTHER";

export type IdentityStatus = "CANDIDATE" | "CONFIRMED" | "REJECTED";

export interface NormalizedPhoneResult {
  raw: string;
  normalized: string | null;
  country: "VN";
  type: PhoneType;
  valid: boolean;
  normalization_confidence: number;
  reason?: string;
}

export interface PhoneExtractionCandidate {
  phoneRaw: string;
  contextText: string;
  contextBefore: string;
  contextAfter: string;
  extractionMethod: string;
  positionStart: number;
  positionEnd: number;
  confidence: number;
}

export interface PhoneLookupResponse {
  phone: {
    raw_input: string;
    normalized: string | null;
    type: PhoneType;
    valid: boolean;
  };
  statistics: {
    observation_count: number;
    source_count: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
  };
  identities: Array<{
    name: string;
    type: IdentityType;
    category: IdentityCategory | null;
    confidence: number;
    evidence_count: number;
    status: IdentityStatus;
  }>;
}
