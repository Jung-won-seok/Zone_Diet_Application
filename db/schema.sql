-- Use a direct, server-side database connection. Nothing in this schema is
-- granted to browser roles; the service/migration role owns its objects.
CREATE SCHEMA IF NOT EXISTS leben;
REVOKE ALL ON SCHEMA leben FROM PUBLIC;

CREATE TABLE IF NOT EXISTS leben.sections (
  field text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('object', 'array', 'scalar')),
  value jsonb
);
CREATE TABLE IF NOT EXISTS leben.section_items (
  field text NOT NULL REFERENCES leben.sections(field),
  group_key text NOT NULL,
  item_key text NOT NULL,
  value jsonb,
  PRIMARY KEY (field, group_key, item_key)
);

CREATE TABLE IF NOT EXISTS leben.accounts (
  member_id text PRIMARY KEY,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  username text NOT NULL,
  display_name text,
  is_admin boolean,
  salt text,
  password_hash text,
  details jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_lower ON leben.accounts (lower(username));
CREATE TABLE IF NOT EXISTS leben.members (
  member_id text PRIMARY KEY REFERENCES leben.accounts(member_id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  team_id text,
  role text,
  custom_role text,
  details jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS leben.memberships (
  member_id text PRIMARY KEY REFERENCES leben.accounts(member_id),
  kind text NOT NULL CHECK (kind IN ('unassigned','period','visits')),
  expires_on date,
  remaining_visits integer CHECK (remaining_visits >= 0),
  revision bigint CHECK (revision >= 0),
  has_charges boolean NOT NULL,
  details jsonb NOT NULL,
  CHECK ((kind = 'visits') = (remaining_visits IS NOT NULL)),
  CHECK (kind <> 'period' OR expires_on IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS leben.pass_charges (
  member_id text NOT NULL REFERENCES leben.memberships(member_id),
  class_date date NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (member_id, class_date)
);
CREATE TABLE IF NOT EXISTS leben.membership_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id text NOT NULL REFERENCES leben.accounts(member_id),
  class_date date,
  reason text NOT NULL,
  delta integer NOT NULL,
  balance_after integer CHECK (balance_after >= 0),
  pass_revision bigint CHECK (pass_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_ledger_history ON leben.membership_ledger(member_id, id);
CREATE OR REPLACE FUNCTION leben.protect_membership_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Membership ledger is append-only' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS protect_membership_ledger ON leben.membership_ledger;
CREATE TRIGGER protect_membership_ledger BEFORE UPDATE OR DELETE OR TRUNCATE ON leben.membership_ledger
FOR EACH STATEMENT EXECUTE FUNCTION leben.protect_membership_ledger();

CREATE TABLE IF NOT EXISTS leben.class_days (
  class_date date PRIMARY KEY,
  schedule_details jsonb,
  schedule_revision bigint GENERATED ALWAYS AS ((schedule_details->>'revision')::bigint) STORED,
  closure_from_ms bigint GENERATED ALWAYS AS ((schedule_details->'closure'->>'from')::bigint) STORED,
  closure_reason text GENERATED ALWAYS AS (schedule_details->'closure'->>'reason') STORED,
  roster_revision bigint CHECK (roster_revision >= 0),
  has_reservations boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS leben.class_slots (
  class_date date NOT NULL REFERENCES leben.class_days(class_date),
  start_time text NOT NULL CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time > start_time),
  capacity integer NOT NULL CHECK (capacity > 0),
  waitlist_capacity integer NOT NULL CHECK (waitlist_capacity >= 0),
  special_ordinal integer CHECK (special_ordinal >= 0),
  special_details jsonb,
  cancel_details jsonb,
  has_queue boolean NOT NULL,
  PRIMARY KEY (class_date, start_time)
);
CREATE TABLE IF NOT EXISTS leben.reservations (
  class_date date NOT NULL,
  start_time text NOT NULL,
  member_id text NOT NULL REFERENCES leben.accounts(member_id),
  position integer NOT NULL CHECK (position > 0),
  PRIMARY KEY (class_date, member_id),
  FOREIGN KEY (class_date, start_time) REFERENCES leben.class_slots(class_date, start_time),
  UNIQUE (class_date, start_time, position) DEFERRABLE INITIALLY DEFERRED
);

-- Validate the final queue after promotions, moves, and cancellations finish.
CREATE OR REPLACE FUNCTION leben.check_queue(target_day date, target_time text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  allowed integer;
  queue_size integer;
  last_position integer;
BEGIN
  SELECT capacity + waitlist_capacity INTO allowed FROM leben.class_slots
  WHERE class_date = target_day AND start_time = target_time FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*), coalesce(max(position), 0) INTO queue_size, last_position
  FROM leben.reservations WHERE class_date = target_day AND start_time = target_time;
  IF queue_size > allowed OR last_position <> queue_size THEN
    RAISE EXCEPTION 'Invalid class queue capacity or position' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION leben.validate_queue() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('DELETE','UPDATE') THEN PERFORM leben.check_queue(OLD.class_date, OLD.start_time); END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.class_date, NEW.start_time) IS DISTINCT FROM (OLD.class_date, OLD.start_time))
    THEN PERFORM leben.check_queue(NEW.class_date, NEW.start_time); END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS validate_roster ON leben.reservations;
CREATE CONSTRAINT TRIGGER validate_roster AFTER INSERT OR UPDATE OR DELETE ON leben.reservations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION leben.validate_queue();
DROP TRIGGER IF EXISTS validate_capacity ON leben.class_slots;
CREATE CONSTRAINT TRIGGER validate_capacity AFTER UPDATE ON leben.class_slots
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION leben.validate_queue();

CREATE TABLE IF NOT EXISTS leben.media (
  media_id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES leben.accounts(member_id),
  team_id text,
  mime text,
  details jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS media_owner ON leben.media(member_id);

-- Also protect accidentally exposed schemas on installations using Supabase's
-- API roles. RLS has no client policies; the private schema owner runs the API.
DO $$
DECLARE
  table_name text;
  client_role text;
BEGIN
  FOR table_name IN SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'leben' LOOP
    EXECUTE format('ALTER TABLE leben.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA leben FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA leben FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA leben FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA leben FROM %I', client_role);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA leben FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA leben FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA leben FROM PUBLIC;
