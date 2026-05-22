-- ═══════════════════════════════════════════════════
--  GharSaathi — Complete PostgreSQL Database Schema
-- ═══════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUM TYPES ──────────────────────────────────────
CREATE TYPE gender_pref   AS ENUM ('any','male_only','female_only');
CREATE TYPE id_type       AS ENUM ('aadhaar','pan','passport','voter_id','driving_licence');
CREATE TYPE verify_status AS ENUM ('pending','verified','rejected');
CREATE TYPE match_status  AS ENUM ('pending','matched','rejected','expired');
CREATE TYPE flat_type     AS ENUM ('1bhk','2bhk','3bhk','4bhk','studio','pg');
CREATE TYPE user_role     AS ENUM ('lister','seeker','both');
CREATE TYPE msg_status    AS ENUM ('sent','delivered','read');

-- ─── USERS ───────────────────────────────────────────
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             TEXT UNIQUE NOT NULL,
  phone             TEXT UNIQUE NOT NULL,
  phone_verified    BOOLEAN DEFAULT FALSE,
  email_verified    BOOLEAN DEFAULT FALSE,
  password_hash     TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  avatar_url        TEXT,
  role              user_role DEFAULT 'seeker',
  linkedin_url      TEXT,
  occupation        TEXT,
  employer          TEXT,
  bio               TEXT,                          -- self intro
  trust_score       NUMERIC(3,1) DEFAULT 0.0,     -- 0.0 – 5.0
  is_active         BOOLEAN DEFAULT TRUE,
  is_banned         BOOLEAN DEFAULT FALSE,
  last_seen         TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── USER LIFESTYLE TAGS ─────────────────────────────
CREATE TABLE user_lifestyle (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  non_smoker      BOOLEAN DEFAULT FALSE,
  vegetarian      BOOLEAN DEFAULT FALSE,
  early_sleeper   BOOLEAN DEFAULT FALSE,
  night_owl       BOOLEAN DEFAULT FALSE,
  work_from_home  BOOLEAN DEFAULT FALSE,
  has_pet         BOOLEAN DEFAULT FALSE,
  high_tidiness   BOOLEAN DEFAULT FALSE,
  social_drinker  BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id)
);

-- ─── IDENTITY VERIFICATION ───────────────────────────
CREATE TABLE verifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  id_type         id_type NOT NULL,
  id_number       TEXT NOT NULL,                  -- encrypted at app layer
  id_doc_url      TEXT,                           -- Supabase Storage path
  selfie_url      TEXT,
  status          verify_status DEFAULT 'pending',
  verified_at     TIMESTAMPTZ,
  rejected_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── EMERGENCY CONTACTS ──────────────────────────────
CREATE TABLE emergency_contacts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  relation     TEXT,
  UNIQUE(user_id)
);

-- ─── LISTINGS ────────────────────────────────────────
CREATE TABLE listings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lister_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  flat_type             flat_type NOT NULL,
  city                  TEXT NOT NULL,
  locality              TEXT NOT NULL,
  address               TEXT,
  lat                   NUMERIC(10,7),
  lng                   NUMERIC(10,7),
  pincode               TEXT,
  floor                 INT,
  total_floors          INT,
  monthly_rent          INT NOT NULL,
  security_deposit      INT NOT NULL,
  electricity_included  BOOLEAN DEFAULT FALSE,
  water_included        BOOLEAN DEFAULT FALSE,
  maintenance_charge    INT DEFAULT 0,
  rooms_available       INT DEFAULT 1,
  total_rooms           INT,
  existing_flatmates    INT DEFAULT 0,
  gender_pref           gender_pref DEFAULT 'any',
  occupation_pref       TEXT,                   -- e.g. 'working_professional'
  available_from        DATE NOT NULL,
  min_stay_months       INT DEFAULT 3,
  description           TEXT,
  vacancy_reason        TEXT,
  is_active             BOOLEAN DEFAULT TRUE,
  is_verified           BOOLEAN DEFAULT FALSE,
  is_urgent             BOOLEAN DEFAULT FALSE,
  views_count           INT DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LISTING AMENITIES ───────────────────────────────
CREATE TABLE listing_amenities (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id        UUID REFERENCES listings(id) ON DELETE CASCADE,
  wifi              BOOLEAN DEFAULT FALSE,
  ac                BOOLEAN DEFAULT FALSE,
  washing_machine   BOOLEAN DEFAULT FALSE,
  furnished         BOOLEAN DEFAULT FALSE,
  gym               BOOLEAN DEFAULT FALSE,
  swimming_pool     BOOLEAN DEFAULT FALSE,
  parking           BOOLEAN DEFAULT FALSE,
  power_backup      BOOLEAN DEFAULT FALSE,
  gated_society     BOOLEAN DEFAULT FALSE,
  near_metro        BOOLEAN DEFAULT FALSE,
  pet_friendly      BOOLEAN DEFAULT FALSE,
  attached_bathroom BOOLEAN DEFAULT FALSE,
  modular_kitchen   BOOLEAN DEFAULT FALSE,
  balcony           BOOLEAN DEFAULT FALSE,
  UNIQUE(listing_id)
);

-- ─── LISTING PHOTOS ──────────────────────────────────
CREATE TABLE listing_photos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id   UUID REFERENCES listings(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  label        TEXT,                             -- 'bedroom','kitchen','bathroom','living'
  is_primary   BOOLEAN DEFAULT FALSE,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FLATMATE REFERENCE NOTES ────────────────────────
CREATE TABLE flatmate_notes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id          UUID REFERENCES listings(id) ON DELETE CASCADE,
  author_name         TEXT NOT NULL,             -- departing flatmate name
  author_linkedin     TEXT,
  note                TEXT NOT NULL,             -- the personalised message
  is_verified         BOOLEAN DEFAULT FALSE,     -- we called them to confirm
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(listing_id)
);

-- ─── SEEKER PROFILES ─────────────────────────────────
CREATE TABLE seeker_profiles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  target_city       TEXT NOT NULL,
  target_localities TEXT[],
  max_budget        INT NOT NULL,
  preferred_flat    flat_type,
  gender_pref       gender_pref DEFAULT 'any',
  move_in_date      DATE,
  stay_duration_mo  INT,
  reason_for_move   TEXT,
  reference_name    TEXT,
  reference_phone   TEXT,
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ─── INTEREST / MATCH SYSTEM ─────────────────────────
CREATE TABLE interests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id   UUID REFERENCES listings(id) ON DELETE CASCADE,
  seeker_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  lister_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  -- seeker expresses interest first
  seeker_msg   TEXT,                             -- intro message from seeker
  seeker_at    TIMESTAMPTZ DEFAULT NOW(),
  -- lister responds
  lister_resp  match_status DEFAULT 'pending',
  lister_at    TIMESTAMPTZ,
  -- when both match → contact unlocks
  matched_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(listing_id, seeker_id)
);

-- ─── MESSAGES (only after match) ─────────────────────
CREATE TABLE messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interest_id  UUID REFERENCES interests(id) ON DELETE CASCADE,
  sender_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  status       msg_status DEFAULT 'sent',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── VISIT REQUESTS ──────────────────────────────────
CREATE TABLE visit_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interest_id   UUID REFERENCES interests(id) ON DELETE CASCADE,
  requested_by  UUID REFERENCES users(id),
  proposed_time TIMESTAMPTZ NOT NULL,
  confirmed     BOOLEAN DEFAULT FALSE,
  confirmed_at  TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SAVED / FAVOURITES ──────────────────────────────
CREATE TABLE saved_listings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, listing_id)
);

-- ─── REVIEWS ─────────────────────────────────────────
CREATE TABLE reviews (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interest_id  UUID REFERENCES interests(id),
  reviewer_id  UUID REFERENCES users(id),
  reviewee_id  UUID REFERENCES users(id),
  rating       INT CHECK(rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(interest_id, reviewer_id)
);

-- ─── REPORTS ─────────────────────────────────────────
CREATE TABLE reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id  UUID REFERENCES users(id),
  reported_id  UUID REFERENCES users(id),
  listing_id   UUID REFERENCES listings(id),
  reason       TEXT NOT NULL,
  details      TEXT,
  resolved     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── OTP STORE ───────────────────────────────────────
CREATE TABLE otps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes',
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── REFRESH TOKENS ──────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────
CREATE INDEX idx_listings_city        ON listings(city);
CREATE INDEX idx_listings_locality    ON listings(locality);
CREATE INDEX idx_listings_rent        ON listings(monthly_rent);
CREATE INDEX idx_listings_active      ON listings(is_active);
CREATE INDEX idx_listings_lister      ON listings(lister_id);
CREATE INDEX idx_interests_listing    ON interests(listing_id);
CREATE INDEX idx_interests_seeker     ON interests(seeker_id);
CREATE INDEX idx_messages_interest    ON messages(interest_id);
CREATE INDEX idx_users_phone          ON users(phone);
CREATE INDEX idx_users_email          ON users(email);
CREATE INDEX idx_verif_user           ON verifications(user_id);

-- ─── AUTO-UPDATE updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── TRUST SCORE FUNCTION ────────────────────────────
CREATE OR REPLACE FUNCTION recalculate_trust_score(p_user_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_score NUMERIC := 0;
  v_reviews_avg NUMERIC;
  v_verified BOOLEAN;
  v_linkedin BOOLEAN;
  v_emergency BOOLEAN;
BEGIN
  SELECT (status = 'verified') INTO v_verified FROM verifications WHERE user_id = p_user_id LIMIT 1;
  SELECT (linkedin_url IS NOT NULL) INTO v_linkedin FROM users WHERE id = p_user_id;
  SELECT EXISTS(SELECT 1 FROM emergency_contacts WHERE user_id = p_user_id) INTO v_emergency;
  SELECT AVG(rating) INTO v_reviews_avg FROM reviews WHERE reviewee_id = p_user_id;

  IF v_verified   THEN v_score := v_score + 2.0; END IF;
  IF v_linkedin   THEN v_score := v_score + 1.0; END IF;
  IF v_emergency  THEN v_score := v_score + 0.5; END IF;
  IF v_reviews_avg IS NOT NULL THEN v_score := v_score + (v_reviews_avg * 0.3); END IF;

  v_score := LEAST(v_score, 5.0);
  UPDATE users SET trust_score = v_score WHERE id = p_user_id;
  RETURN v_score;
END;
$$ LANGUAGE plpgsql;
