-- Allow Super Admin to control which operational modules a Viewer can access.
-- NULL means "use the Viewer role's default module access" (all current Viewer modules).
-- An empty array intentionally means the Viewer has no operational module access.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS module_access text[] DEFAULT NULL;
