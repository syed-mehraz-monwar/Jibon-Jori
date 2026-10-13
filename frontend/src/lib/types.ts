/**
 * Domain types mirrored from the backend API contract
 * (`backend/API_DOCUMENTATION.md`). These are the shapes the REST envelope
 * unwraps to, not the raw envelope itself.
 */

/** Mirrors the PostgreSQL `Role` enum: `member | admin` (see `supabase/migrations/20260927000001_foundation.sql`). */
export type Role = "member" | "admin";
export type UserStatus = "pending" | "active" | "suspended" | "deleted";
export type Gender = "male" | "female" | "other";
export type MaritalStatus = "never_married" | "divorced" | "widowed" | "annulled";
export type PhotoVisibility = "public" | "members" | "private";
export type InteractionValue = -1 | 1 | 2;
export type NotificationType = "like" | "comment" | "rating" | "match" | "security" | "system";

export type User = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: UserStatus;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  createdAt: string;
};

export type TokenPair = { accessToken: string; refreshToken: string };
export type LoginResult = TokenPair & { user: User };

/**
 * R-012: the truthful OTP challenge outcome. `deliveredTo` is only the masked
 * destination, so a screen must branch on `delivered` before telling the user a
 * code was sent. `deliveryReason` is `NO_PROVIDER` when no email/SMS provider is
 * configured in the environment and `DELIVERY_FAILED` when a provider rejected it.
 */
export type OtpDeliveryReason = "NO_PROVIDER" | "DELIVERY_FAILED" | null;

/**
 * The flat shape `POST /api/auth/register` and `POST /api/auth/otp/request`
 * actually return (see `backend/API_DOCUMENTATION.md` section 3). It is flat, not
 * nested under an `otp` key - the previous nested type was a contract mismatch that
 * made `channel` undefined at runtime.
 */
export type OtpChallenge = {
  channel: "email" | "phone";
  deliveredTo: string;
  expiresInSeconds: number;
  delivered: boolean;
  deliveryProvider: string | null;
  deliveryReason: OtpDeliveryReason;
};

export type RegisterResult = { user: User } & OtpChallenge;

export type SessionInfo = {
  id: string;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

/**
 * Database-backed reference row. Carries the primary key because that is what the
 * API accepts on write (`educationId`, `professionId`, `interestIds`).
 */
export type Reference = { id: string; slug: string; label: string; tier?: number };

export type Profile = {
  id: string;
  userId: string;
  displayName: string;
  dob: string;
  gender: Gender;
  heightCm: number | null;
  maritalStatus: MaritalStatus;
  religion: string | null;
  casteCommunity: string | null;
  education: Reference | null;
  educationDetail: string | null;
  profession: Reference | null;
  professionDetail: string | null;
  incomeBand: string | null;
  city: string;
  district: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  locationConsent: boolean;
  showExactLocation: boolean;
  about: string | null;
  lifestyle: Record<string, unknown>;
  interests: Reference[];
  isPublic: boolean;
  photoVisibility: PhotoVisibility;
  completeness: number;
  createdAt: string;
  updatedAt: string;
};

export type ProfileInput = {
  displayName?: string;
  dob?: string;
  gender?: Gender;
  heightCm?: number;
  maritalStatus?: MaritalStatus;
  religion?: string;
  casteCommunity?: string;
  educationId?: string;
  educationDetail?: string;
  professionId?: string;
  professionDetail?: string;
  incomeBand?: string;
  city?: string;
  district?: string;
  country?: string;
  lat?: number;
  lng?: number;
  locationConsent?: boolean;
  showExactLocation?: boolean;
  about?: string;
  lifestyle?: Record<string, unknown>;
  /** Full replacement set for the profile's interests. */
  interestIds?: string[];
  isPublic?: boolean;
  photoVisibility?: PhotoVisibility;
};

export type PreferenceRule = {
  educationIds?: string[];
  professionIds?: string[];
  locations?: string[];
  religions?: string[];
  maritalStatuses?: MaritalStatus[];
  minHeightCm?: number;
  maxHeightCm?: number;
  requiresVerifiedContact?: boolean;
  notes?: string;
};

export type PartnerPreferences = {
  id: string;
  profileId: string;
  ageMin: number | null;
  ageMax: number | null;
  genders: Gender[];
  educationIds: string[];
  professionIds: string[];
  locations: string[];
  mustHave: PreferenceRule | null;
  dealbreakers: PreferenceRule | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaItem = {
  id: string;
  firebasePath: string;
  kind: "photo" | "document";
  mime: string;
  bytes: number;
  isPrimary: boolean;
  createdAt: string;
};

export type SearchProfile = {
  id: string;
  displayName: string;
  gender: Gender;
  age: number;
  maritalStatus: MaritalStatus;
  city: string | null;
  district: string | null;
  country: string | null;
  education: { slug: string; label: string } | null;
  profession: { slug: string; label: string } | null;
  incomeBand: string | null;
  about: string | null;
  interests: { slug: string; label: string }[];
  primaryPhoto: string | null;
  completeness: number;
  createdAt: string;
};

export type Pagination = { page: number; limit: number; total: number; totalPages: number };

/** Spec 14: a curated YouTube entry. Only the video id is stored; the player is an iframe. */
export type CuratedVideo = {
  id: string;
  youtubeId: string;
  title: string;
  description: string | null;
  category: string;
  createdAt: string;
};

export type Interaction = {
  actorProfileId: string;
  targetProfileId: string;
  value: InteractionValue;
  createdAt: string;
};

export type RatingSummary = {
  targetProfileId: string;
  count: number;
  average: number | null;
  distribution: Record<string, number>;
};

export type Comment = {
  id: string;
  authorProfileId: string;
  targetProfileId: string;
  body: string;
  createdAt: string;
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type CompatibilityFactors = {
  interests: number;
  education: number;
  profession: number;
  educationProfession: number;
  location: number;
  lifestyle: number;
  partnerPreference: number;
};

export type CompatibilityAvailability = Record<keyof CompatibilityFactors, boolean>;

export type CompatibilityScore = {
  overall: number;
  factors: CompatibilityFactors;
  availability: CompatibilityAvailability;
};

export type ModelInfo = {
  version: string;
  inputsHash: string;
  fromCache: boolean;
  computedAt: string | null;
};

export type Eligibility = { eligible: boolean; reasons: string[] };

export type CompatibilityResult = {
  targetProfileId: string;
  eligibility: Eligibility;
  weights: Record<string, number>;
  model: ModelInfo;
  score: CompatibilityScore | null;
};

export type RecommendationItem = {
  profileId: string;
  eligibility: Eligibility;
  model: ModelInfo;
  score: CompatibilityScore;
};

export type RecommendationsResult = {
  weights: Record<string, number>;
  items: RecommendationItem[];
  pagination: Pagination;
  candidatePoolTruncated: boolean;
};

export type MlPrior = {
  available: boolean;
  modelVersion: string | null;
  featureVersion: string;
  score: number | null;
};

export type MlPriorResult = {
  targetProfileId: string;
  eligibility: Eligibility;
  prior: MlPrior;
  features: Record<string, number | string>;
  fallback: { used: boolean; reason: string };
};

export type Explanation = {
  available: boolean;
  text: string | null;
  providerVersion: string | null;
  promptVersion: string;
  generatedAt: string | null;
};

export type ExplanationResult = {
  targetProfileId: string;
  eligibility: Eligibility;
  compatibility: { overall: number | null; factors: Record<string, number>; availability: Record<string, boolean> };
  model: ModelInfo;
  mlPrior: MlPrior;
  explanation: Explanation;
  fallback: { used: boolean; reason: string };
};

export type ChatConversation = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  model: string | null;
  createdAt: string;
};

export type ChatReplyResult = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage | null;
  reply: Explanation;
  fallback: { used: boolean; reason: string };
};

/**
 * Enum-backed option (gender, marital status, notification type). These are literal
 * enum values, not rows, so they have no id to submit.
 */
export type SlugLabelReference = { slug: string; label: string };

export type ReferenceData = {
  educationLevels: Reference[];
  professions: Reference[];
  interests: Reference[];
  genderOptions: SlugLabelReference[];
  maritalStatusOptions: SlugLabelReference[];
  notificationTypeOptions: SlugLabelReference[];
};

export type ReportColumnType = "ID" | "String" | "Int" | "Float" | "Boolean" | "Enum" | "DateTime";

export type ReportColumn = { name: string; type: ReportColumnType };

export type ReportKind =
  | "users"
  | "matchmaking"
  | "compatibility"
  | "ratings"
  | "ratings-summary"
  | "admin";

export type ReportDataset = {
  kind: ReportKind;
  label: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  rowLimit: number;
};

export type HealthReport = {
  status: string;
  checks?: Record<string, { status: string; detail?: string }>;
  [key: string]: unknown;
};
