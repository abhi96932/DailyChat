-- VibeMeet Community + Uttarakhand Travel layer
CREATE TABLE IF NOT EXISTS notifications (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 type VARCHAR(40) NOT NULL,
 title VARCHAR(180) NOT NULL,
 body VARCHAR(500) DEFAULT '',
 read_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS destinations (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(120) NOT NULL UNIQUE,
 slug VARCHAR(140) NOT NULL UNIQUE,
 region VARCHAR(30) NOT NULL DEFAULT 'Uttarakhand',
 district VARCHAR(80) DEFAULT '',
 description VARCHAR(500) DEFAULT '',
 icon VARCHAR(10) DEFAULT '🏔️',
 difficulty VARCHAR(30) DEFAULT 'Easy',
 base_transport INTEGER NOT NULL DEFAULT 1000,
 stay_per_night INTEGER NOT NULL DEFAULT 500,
 food_per_day INTEGER NOT NULL DEFAULT 350,
 local_transport INTEGER NOT NULL DEFAULT 250,
 activities INTEGER NOT NULL DEFAULT 200,
 recommended_months SMALLINT[] NOT NULL DEFAULT '{}',
 route_stops JSONB NOT NULL DEFAULT '[]'::jsonb,
 tags TEXT[] NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_destinations_region ON destinations(region);

CREATE TABLE IF NOT EXISTS travel_profiles (
 user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 styles TEXT[] NOT NULL DEFAULT '{}',
 pace VARCHAR(20) NOT NULL DEFAULT 'balanced',
 budget_style VARCHAR(20) NOT NULL DEFAULT 'balanced',
 interests TEXT[] NOT NULL DEFAULT '{}',
 emergency_name VARCHAR(80) DEFAULT '',
 emergency_phone VARCHAR(30) DEFAULT '',
 emergency_relation VARCHAR(40) DEFAULT '',
 home_base VARCHAR(100) DEFAULT '',
 bio VARCHAR(500) DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips (
 id BIGSERIAL PRIMARY KEY,
 host_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 destination_id BIGINT REFERENCES destinations(id) ON DELETE SET NULL,
 title VARCHAR(160) NOT NULL,
 description VARCHAR(1000) DEFAULT '',
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 start_point VARCHAR(120) NOT NULL,
 max_members INTEGER NOT NULL DEFAULT 4 CHECK(max_members BETWEEN 1 AND 20),
 travel_style VARCHAR(20) NOT NULL DEFAULT 'balanced',
 pace VARCHAR(20) NOT NULL DEFAULT 'balanced',
 budget_min INTEGER NOT NULL DEFAULT 0,
 budget_max INTEGER NOT NULL DEFAULT 0,
 budget_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
 route JSONB NOT NULL DEFAULT '[]'::jsonb,
 status VARCHAR(20) NOT NULL DEFAULT 'open',
 visibility VARCHAR(20) NOT NULL DEFAULT 'public',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(end_date>=start_date)
);
CREATE INDEX IF NOT EXISTS idx_trips_destination_dates ON trips(destination_id,start_date,end_date,status);
CREATE INDEX IF NOT EXISTS idx_trips_host ON trips(host_id,created_at DESC);

CREATE TABLE IF NOT EXISTS trip_members (
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 role VARCHAR(20) NOT NULL DEFAULT 'member',
 joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 status VARCHAR(20) NOT NULL DEFAULT 'active',
 PRIMARY KEY(trip_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id,status);

CREATE TABLE IF NOT EXISTS trip_join_requests (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 message VARCHAR(500) DEFAULT '',
 status VARCHAR(20) NOT NULL DEFAULT 'pending',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(trip_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_trip_requests_trip ON trip_join_requests(trip_id,status,created_at);

CREATE TABLE IF NOT EXISTS trip_messages (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 sender_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 body VARCHAR(2000) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trip_messages_trip ON trip_messages(trip_id,created_at);

CREATE TABLE IF NOT EXISTS trip_checklist (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 title VARCHAR(160) NOT NULL,
 assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
 done BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trip_checklist_trip ON trip_checklist(trip_id);

CREATE TABLE IF NOT EXISTS trip_expenses (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 paid_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 title VARCHAR(120) NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>=0),
 category VARCHAR(40) NOT NULL DEFAULT 'other',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_trip ON trip_expenses(trip_id);

CREATE TABLE IF NOT EXISTS trip_expense_members (
 expense_id BIGINT REFERENCES trip_expenses(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 share INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(expense_id,user_id)
);

CREATE TABLE IF NOT EXISTS travel_reviews (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 reviewer_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 reviewed_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment VARCHAR(500) DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(trip_id,reviewer_id,reviewed_user_id)
);

CREATE TABLE IF NOT EXISTS trip_checkins (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 status VARCHAR(20) NOT NULL DEFAULT 'safe',
 note VARCHAR(300) DEFAULT '',
 latitude DOUBLE PRECISION,
 longitude DOUBLE PRECISION,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trip_checkins_trip ON trip_checkins(trip_id,created_at DESC);

CREATE TABLE IF NOT EXISTS saved_trips (
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id,trip_id)
);

CREATE TABLE IF NOT EXISTS going_posts (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 destination_id BIGINT REFERENCES destinations(id) ON DELETE SET NULL,
 text VARCHAR(500) NOT NULL,
 trip_date DATE,
 start_point VARCHAR(120) DEFAULT '',
 budget_min INTEGER DEFAULT 0,
 budget_max INTEGER DEFAULT 0,
 interested_count INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_going_posts_date ON going_posts(trip_date,created_at DESC);

-- VibeMeet community feed layer
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member';
CREATE INDEX IF NOT EXISTS idx_group_members_role ON group_members(group_id,role);
CREATE TABLE IF NOT EXISTS community_posts (
 id BIGSERIAL PRIMARY KEY,
 author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE,
 body VARCHAR(2000) NOT NULL,
 image_data TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_posts_time ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_group ON community_posts(group_id,created_at DESC);
CREATE TABLE IF NOT EXISTS community_post_likes (
 post_id BIGINT REFERENCES community_posts(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(post_id,user_id)
);
CREATE TABLE IF NOT EXISTS community_post_comments (
 id BIGSERIAL PRIMARY KEY,
 post_id BIGINT REFERENCES community_posts(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 body VARCHAR(500) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON community_post_comments(post_id,created_at);
CREATE TABLE IF NOT EXISTS saved_posts (
 post_id BIGINT REFERENCES community_posts(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(post_id,user_id)
);
CREATE TABLE IF NOT EXISTS user_follows (
 follower_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 following_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(follower_id,following_id),
 CHECK(follower_id<>following_id)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id);
