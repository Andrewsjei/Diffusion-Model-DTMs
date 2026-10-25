-- ---------------------------------------------------------------------
-- ONE-TIME MIGRATION for an EXISTING Supabase project.
-- Run it once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- (A fresh project doesn't need this -- supabase/schema.sql already has it.)
--
-- What it does: adds an `experiment_version` column to the `images` table,
-- so every image is tagged with the round (image set) it belongs to.
-- Every image that exists right now automatically becomes 'v1'.
-- It deletes and rewrites nothing. It is safe to run twice.
-- ---------------------------------------------------------------------

alter table images
  add column if not exists experiment_version text not null default 'v1';

create index if not exists images_version_idx
  on images (experiment_version, source_type, active);

-- ---------------------------------------------------------------------
-- CHECKS -- run these after the migration and look at the results.
-- ---------------------------------------------------------------------

-- 1) Existing participants and responses should ALL be tagged 'v1'.
--    If you see anything else, stop and check before going on: the
--    EXPERIMENT_VERSION constant in config.ts must match your old data.
select 'participants' as tbl, experiment_version, count(*) as n
from participants group by experiment_version
union all
select 'responses', experiment_version, count(*)
from responses group by experiment_version;

-- 2) Every existing image should now be 'v1'.
select experiment_version, source_type, active, count(*) as n_images
from images
group by experiment_version, source_type, active
order by experiment_version, source_type, active;
