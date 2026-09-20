CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  email text NOT NULL CHECK (char_length(email) <= 254),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  emailed_at timestamptz
);
ALTER TABLE public.contact_messages ADD COLUMN IF NOT EXISTS phone text CHECK (char_length(phone) <= 30);
ALTER TABLE public.contact_messages ALTER COLUMN email DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contact_messages'::regclass AND conname = 'contact_messages_contact_required') THEN
    ALTER TABLE public.contact_messages ADD CONSTRAINT contact_messages_contact_required
      CHECK (NULLIF(trim(phone), '') IS NOT NULL OR NULLIF(trim(email), '') IS NOT NULL);
  END IF;
END $$;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_messages FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS contact_messages_created_at_idx ON public.contact_messages (created_at DESC);
