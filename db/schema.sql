-- ============================================================
--  GharSaathi — Complete Database Schema
--  Compatible with: Supabase / Railway / Neon (free PostgreSQL)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy search

-- ──────────────────────────────────────────
--  USERS
-- ──────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  phone           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  gender          TEXT CHECK (gender IN ('male','female','other')),
  occupation      TEXT,
  employer        TEXT,
  linkedin_url    TEXT,
  bio             TEXT,
  profile_pic_url TEXT,
  trust_score     INTEGER DEFAULT 0,          -- 0-100, computed
  is_verified     BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  role            TEXT DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  IDENTITY VERIFICATIONS
-- ──────────────────────────────────────────
CREATE TABLE verifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id_type         TEXT NOT NULL CHECK (id_type IN ('aadhaar','pan','passport','voter_id','driving_licence')),
  id_number_hash  TEXT NOT NULL,              -- SHA-256 hashed, never store plain
  id_number_last4 TEXT NOT NULL,              -- last 4 digits for display
  doc_url         TEXT,                       -- Supabase Storage URL
  selfie_url      TEXT,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  LISTINGS (rooms available)
-- ──────────────────────────────────────────
CREATE TABLE listings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lister_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  city                TEXT NOT NULL,
  locality            TEXT NOT NULL,
  address_line        TEXT,
  pincode             TEXT,
  lat                 DECIMAL(9,6),
  lng                 DECIMAL(9,6),
  flat_type           TEXT NOT NULL CHECK (flat_type IN ('1bhk','2bhk','3bhk','4bhk','studio','other')),
  rooms_available     INTEGER DEFAULT 1,
  total_rooms         INTEGER,
  existing_flatmates  INTEGER DEFAULT 0,
  monthly_rent        INTEGER NOT NULL,
  security_deposit    INTEGER NOT NULL,
  utility_charges     INTEGER DEFAULT 0,
  available_from      DATE,
  min_stay_months     INTEGER DEFAULT 3,
  vacancy_reason      TEXT,
  house_rules         TEXT,
  preferred_gender    TEXT DEFAULT 'any' CHECK (preferred_gender IN ('male','female','any')),
  preferred_occupation TEXT,
  status              TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','filled','under_review')),
  is_urgent           BOOLEAN DEFAULT FALSE,
  views_count         INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Amenities as JSONB for flexibility
ALTER TABLE listings ADD COLUMN amenities JSONB DEFAULT '{}';
-- e.g. {"wifi":true,"ac":true,"gym":false,"pool":false,"washing_machine":true,...}

-- ──────────────────────────────────────────
--  LISTING PHOTOS
-- ──────────────────────────────────────────
CREATE TABLE listing_photos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  caption     TEXT,
  is_primary  BOOLEAN DEFAULT FALSE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  FLATMATE REFERENCE NOTES
--  (the departing flatmate vouches for current resident)
-- ──────────────────────────────────────────
CREATE TABLE flatmate_notes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id          UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  author_name         TEXT NOT NULL,              -- departing flatmate's name
  author_linkedin     TEXT,
  note_text           TEXT NOT NULL,
  is_verified         BOOLEAN DEFAULT FALSE,      -- admin verified the author
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  SEEKER PROFILES
--  (people looking for a room)
-- ──────────────────────────────────────────
CREATE TABLE seeker_profiles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  looking_in_cities   TEXT[],                     -- array of cities
  looking_in_locality TEXT,
  max_budget          INTEGER,
  move_in_date        DATE,
  stay_duration_min   INTEGER DEFAULT 3,          -- months
  looking_reason      TEXT,
  lifestyle_tags      TEXT[],                     -- ['non_smoker','vegetarian','early_riser',...]
  reference_name      TEXT,
  reference_phone     TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  MATCHES / INTEREST EXPRESSIONS
-- ──────────────────────────────────────────
CREATE TABLE matches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  seeker_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lister_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- mutual match: both must set true before contact unlocks
  seeker_liked    BOOLEAN DEFAULT FALSE,
  lister_liked    BOOLEAN DEFAULT FALSE,
  is_matched      BOOLEAN GENERATED ALWAYS AS (seeker_liked AND lister_liked) STORED,
  seeker_message  TEXT,                           -- intro message from seeker
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','matched','rejected','expired')),
  matched_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(listing_id, seeker_id)
);

-- ──────────────────────────────────────────
--  MESSAGES (only after mutual match)
-- ──────────────────────────────────────────
CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  REVIEWS
-- ──────────────────────────────────────────
CREATE TABLE reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  reviewer_id     UUID NOT NULL REFERENCES users(id),
  reviewee_id     UUID NOT NULL REFERENCES users(id),
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, reviewer_id)
);

-- ──────────────────────────────────────────
--  SAVED / FAVOURITES
-- ──────────────────────────────────────────
CREATE TABLE saved_listings (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  saved_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, listing_id)
);

-- ──────────────────────────────────────────
--  REPORTS
-- ──────────────────────────────────────────
CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id     UUID NOT NULL REFERENCES users(id),
  target_type     TEXT NOT NULL CHECK (target_type IN ('listing','user','message')),
  target_id       UUID NOT NULL,
  reason          TEXT NOT NULL,
  details         TEXT,
  status          TEXT DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  OTP / PHONE VERIFICATION
-- ──────────────────────────────────────────
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  REFRESH TOKENS (JWT rotation)
-- ──────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  INDEXES for performance
-- ──────────────────────────────────────────
CREATE INDEX idx_listings_city       ON listings(city);
CREATE INDEX idx_listings_locality   ON listings(locality);
CREATE INDEX idx_listings_status     ON listings(status);
CREATE INDEX idx_listings_rent       ON listings(monthly_rent);
CREATE INDEX idx_listings_lister     ON listings(lister_id);
CREATE INDEX idx_listings_search     ON listings USING gin(to_tsvector('english', city || ' ' || locality || ' ' || COALESCE(title,'')));
CREATE INDEX idx_matches_seeker      ON matches(seeker_id);
CREATE INDEX idx_matches_lister      ON matches(lister_id);
CREATE INDEX idx_matches_listing     ON matches(listing_id);
CREATE INDEX idx_messages_match      ON messages(match_id);
CREATE INDEX idx_users_email         ON users(email);
CREATE INDEX idx_users_phone         ON users(phone);
CREATE INDEX idx_verif_user          ON verifications(user_id);

-- ──────────────────────────────────────────
--  UPDATED_AT auto-trigger
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_matches_updated  BEFORE UPDATE ON matches  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_seeker_updated   BEFORE UPDATE ON seeker_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────
--  TRUST SCORE auto-compute function
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_trust_score(uid UUID)
RETURNS INTEGER AS $$
DECLARE score INTEGER := 0;
BEGIN
  -- Phone verified: +15
  IF EXISTS (SELECT 1 FROM users WHERE id=uid AND is_verified=TRUE) THEN score := score + 15; END IF;
  -- ID verified: +30
  IF EXISTS (SELECT 1 FROM verifications WHERE user_id=uid AND status='approved') THEN score := score + 30; END IF;
  -- LinkedIn added: +10
  IF EXISTS (SELECT 1 FROM users WHERE id=uid AND linkedin_url IS NOT NULL) THEN score := score + 10; END IF;
  -- Profile pic: +5
  IF EXISTS (SELECT 1 FROM users WHERE id=uid AND profile_pic_url IS NOT NULL) THEN score := score + 5; END IF;
  -- Reviews (avg * 8): max +40
  score := score + LEAST(40, (SELECT COALESCE(ROUND(AVG(rating) * 8), 0) FROM reviews WHERE reviewee_id=uid));
  RETURN LEAST(score, 100);
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────
--  SEED: Admin user (change password!)
-- ──────────────────────────────────────────
INSERT INTO users (email, phone, password_hash, full_name, role, is_verified)
VALUES (
  'admin@gharsaathi.in',
  '+919999999999',
  '$2b$12$CHANGE_THIS_HASH_BEFORE_DEPLOY',
  'GharSaathi Admin',
  'admin',
  TRUE
);
