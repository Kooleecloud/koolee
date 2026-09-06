-- ---------------------------------------------------------------------------
-- 0024 — an agreement version freezes the moment it takes effect.
--
-- THE RULE
--
-- A version whose `effective_from` is still in the future may be edited: it
-- is not current (the derivation is `max(version) WHERE effective_from <=
-- now()`), and `acceptAgreement` only ever resolves the CURRENT version, so
-- such a row provably has no acceptances. Editing it cannot change what
-- anyone agreed to. That is what makes "schedule it, then keep working on it"
-- safe, and it is why the product has no separate draft state.
--
-- The instant it takes effect, it becomes the document customers are shown
-- and asked to accept, and it must never change again. `agreement_acceptances`
-- references the version by id, so mutating `body_md` afterwards would
-- silently rewrite the terms every past acceptor agreed to — which would make
-- the append-only guarantee on that table (0022) worth nothing.
--
-- WHY A TRIGGER AND NOT JUST THE SERVICE CHECK
--
-- `updateScheduledAgreementVersion` performs the same test in its WHERE
-- clause, which is what closes the read-then-write race for the app. This is
-- the layer that also holds against psql, a service-role client, and a future
-- contributor who adds a second update path. Same reasoning as the custody
-- and acceptance guards.
--
-- The one-minute grace on the "not in the past" check absorbs clock skew
-- between the operator's form and the server, and deliberately permits
-- setting `effective_from` to NOW — that is how a scheduled version is
-- published immediately, after which this trigger freezes it like any other.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agreement_versions_freeze_once_effective()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.effective_from <= now() THEN
      RAISE EXCEPTION
        'agreement version % is in effect and cannot be deleted. Publish a new version instead.',
        OLD.version USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agreement_acceptances a
      WHERE a.agreement_version_id = OLD.id
    ) THEN
      RAISE EXCEPTION
        'agreement version % has acceptances and cannot be deleted.',
        OLD.version USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE from here.
  IF OLD.effective_from <= now() THEN
    RAISE EXCEPTION
      'agreement version % took effect at % and is frozen. Publish a new version instead of editing this one.',
      OLD.version, OLD.effective_from USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agreement_acceptances a
    WHERE a.agreement_version_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'agreement version % has been accepted and is frozen.',
      OLD.version USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION
      'agreement version numbers are immutable (tried % -> %).',
      OLD.version, NEW.version USING ERRCODE = 'restrict_violation';
  END IF;

  -- Backdating an edit is the same hazard `publishAgreementVersion` refuses:
  -- it would make the version current retroactively. Setting it to now is
  -- allowed and means "publish this immediately".
  IF NEW.effective_from < now() - interval '1 minute' THEN
    RAISE EXCEPTION
      'an agreement version cannot be moved into the past (tried %).',
      NEW.effective_from USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS agreement_versions_freeze ON public.agreement_versions;
--> statement-breakpoint

CREATE TRIGGER agreement_versions_freeze
  BEFORE UPDATE OR DELETE ON public.agreement_versions
  FOR EACH ROW EXECUTE FUNCTION public.agreement_versions_freeze_once_effective();
