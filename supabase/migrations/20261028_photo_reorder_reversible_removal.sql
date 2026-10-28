-- Existing files remain in Storage. Users can reorder and reversibly remove
-- module photos from the Tracker and all PDF exports.
ALTER TABLE public.pavilion_module_photos
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Keep each module's existing newest-first order at migration time.
WITH ranked AS (
 SELECT id, row_number() OVER
 (PARTITION BY project_id,rhino_guid ORDER BY created_at DESC,id DESC) AS n
 FROM public.pavilion_module_photos
)
UPDATE public.pavilion_module_photos p
SET display_order=ranked.n
FROM ranked WHERE p.id=ranked.id AND p.display_order=0;

-- This static Tracker uses shared/anonymous editing; limit the scope of those
-- edits to photo ordering/visibility only. Photo paths and other metadata
-- cannot be changed via the public browser client.
REVOKE UPDATE ON public.pavilion_module_photos FROM anon, authenticated;
GRANT UPDATE (display_order,is_hidden) ON public.pavilion_module_photos TO anon, authenticated;

DROP POLICY IF EXISTS "pavilion_module_photos_reorder_hide" ON public.pavilion_module_photos;
CREATE POLICY "pavilion_module_photos_reorder_hide"
  ON public.pavilion_module_photos FOR UPDATE TO anon, authenticated
  USING (project_id='pavilion-2026')
  WITH CHECK (project_id='pavilion-2026');

CREATE OR REPLACE FUNCTION public.limit_pavilion_module_photos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.pavilion_module_photos
    WHERE project_id=new.project_id AND rhino_guid=new.rhino_guid AND NOT is_hidden
  ) >= 5 THEN RAISE EXCEPTION 'Maximum 5 visible photos per module'; END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.limit_visible_module_photos_on_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF old.is_hidden AND NOT new.is_hidden AND (
    SELECT count(*) FROM public.pavilion_module_photos
    WHERE project_id=new.project_id AND rhino_guid=new.rhino_guid AND NOT is_hidden
  ) >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 visible photos per module; hide another photo before restoring this one';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_limit_visible_module_photos_restore ON public.pavilion_module_photos;
CREATE TRIGGER trg_limit_visible_module_photos_restore
BEFORE UPDATE OF is_hidden ON public.pavilion_module_photos
FOR EACH ROW EXECUTE FUNCTION public.limit_visible_module_photos_on_restore();
