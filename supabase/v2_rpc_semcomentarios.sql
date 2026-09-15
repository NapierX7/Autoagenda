DROP FUNCTION IF EXISTS public.get_profiles_of_my_company();

CREATE OR REPLACE FUNCTION public.get_profiles_of_my_company()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  role text,
  approval_status text,
  requested_at timestamptz,
  created_at timestamptz,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT p.company_id INTO v_company_id
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    au.email,
    p.role,
    p.approval_status,
    p.requested_at,
    p.created_at,
    p.is_active
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.company_id = v_company_id
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profiles_of_my_company() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profiles_of_my_company() TO authenticated;

SELECT * FROM public.get_profiles_of_my_company();
