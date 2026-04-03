CREATE OR REPLACE FUNCTION public.handle_new_user_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.projects (user_id, name)
  VALUES (NEW.id, 'הפרויקט הראשון');
  RETURN NEW;
END;
$function$;