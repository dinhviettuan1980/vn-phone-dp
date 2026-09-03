import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const sourceTypeEnum = pgEnum("source_type", [
  "OFFICIAL_WEBSITE",
  "BUSINESS_DIRECTORY",
  "PUBLIC_DATASET",
  "NEWS",
  "GOVERNMENT",
  "USER_SUBMITTED",
  "OTHER",
]);

export const trustLevelEnum = pgEnum("trust_level", ["HIGH", "MEDIUM", "LOW"]);

export const crawlStatusEnum = pgEnum("crawl_status", [
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
]);

export const phoneTypeEnum = pgEnum("phone_type", [
  "MOBILE",
  "LANDLINE",
  "HOTLINE_1800",
  "HOTLINE_1900",
  "SHORT_CODE",
  "UNKNOWN",
]);

export const identityTypeEnum = pgEnum("identity_type", [
  "PERSON",
  "BUSINESS",
  "HOTLINE",
  "ORGANIZATION",
  "UNKNOWN",
]);

export const identityCategoryEnum = pgEnum("identity_category", [
  "BANK",
  "INSURANCE",
  "TELECOM",
  "HOSPITAL",
  "GOVERNMENT",
  "DELIVERY",
  "ECOMMERCE",
  "REAL_ESTATE",
  "TELEMARKETING",
  "SPAM",
  "SCAM",
  "OTHER",
]);

export const identityStatusEnum = pgEnum("identity_status", [
  "CANDIDATE",
  "CONFIRMED",
  "REJECTED",
]);

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  country: text("country").notNull().default("VN"),
  trustLevel: trustLevelEnum("trust_level").notNull().default("MEDIUM"),
  crawlPolicy: jsonb("crawl_policy").notNull().default({}),
  robotsChecked: boolean("robots_checked").notNull().default(false),
  licenseNotes: text("license_notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crawlTargets = pgTable(
  "crawl_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    status: text("status").notNull().default("active"),
    priority: integer("priority").notNull().default(100),
    crawlStatus: crawlStatusEnum("crawl_status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    nextCrawlAt: timestamp("next_crawl_at", { withTimezone: true }).notNull().defaultNow(),
    httpStatus: integer("http_status"),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    normalizedUrlUq: uniqueIndex("crawl_targets_normalized_url_uq").on(t.normalizedUrl),
    statusIdx: index("crawl_targets_status_idx").on(t.crawlStatus, t.nextCrawlAt),
  })
);

export const rawDocuments = pgTable(
  "raw_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").notNull().references(() => dataSources.id),
    crawlTargetId: uuid("crawl_target_id").references(() => crawlTargets.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    finalUrl: text("final_url").notNull(),
    title: text("title"),
    contentType: text("content_type"),
    httpStatus: integer("http_status"),
    contentHash: text("content_hash").notNull(),
    rawContent: text("raw_content").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contentHashIdx: index("raw_documents_content_hash_idx").on(t.contentHash),
  })
);

export const phoneObservations = pgTable(
  "phone_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rawDocumentId: uuid("raw_document_id").notNull().references(() => rawDocuments.id, { onDelete: "cascade" }),
    phoneRaw: text("phone_raw").notNull(),
    phoneNormalized: text("phone_normalized"),
    contextText: text("context_text").notNull(),
    contextBefore: text("context_before").notNull().default(""),
    contextAfter: text("context_after").notNull().default(""),
    extractionMethod: text("extraction_method").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull().default("0.5"),
    positionStart: integer("position_start").notNull(),
    positionEnd: integer("position_end").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    normalizedIdx: index("phone_observations_normalized_idx").on(t.phoneNormalized),
  })
);

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneE164: text("phone_e164").notNull(),
    countryCode: text("country_code").notNull().default("84"),
    nationalNumber: text("national_number").notNull(),
    phoneType: phoneTypeEnum("phone_type").notNull().default("UNKNOWN"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    observationCount: integer("observation_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    e164Uq: uniqueIndex("phone_numbers_e164_uq").on(t.phoneE164),
  })
);

export const phoneIdentities = pgTable(
  "phone_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneNumberId: uuid("phone_number_id").notNull().references(() => phoneNumbers.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    identityType: identityTypeEnum("identity_type").notNull().default("UNKNOWN"),
    category: identityCategoryEnum("category"),
    claimSource: text("claim_source").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull().default("0"),
    evidenceCount: integer("evidence_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    status: identityStatusEnum("status").notNull().default("CANDIDATE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: index("phone_identities_phone_number_idx").on(t.phoneNumberId),
    phoneNameSourceUq: uniqueIndex("phone_identities_phone_name_source_uq").on(t.phoneNumberId, t.normalizedName, t.claimSource),
  })
);

export const phoneIdentityEvidence = pgTable(
  "phone_identity_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneIdentityId: uuid("phone_identity_id").notNull().references(() => phoneIdentities.id, { onDelete: "cascade" }),
    phoneObservationId: uuid("phone_observation_id").notNull().references(() => phoneObservations.id, { onDelete: "cascade" }),
    evidenceWeight: numeric("evidence_weight", { precision: 5, scale: 2 }).notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identityIdx: index("phone_identity_evidence_identity_idx").on(t.phoneIdentityId),
    uq: uniqueIndex("phone_identity_evidence_uq").on(t.phoneIdentityId, t.phoneObservationId),
  })
);
