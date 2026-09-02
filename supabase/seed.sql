-- Lokal geliştirme verisi. Sadece `supabase db reset` / `supabase start` sırasında çalışır,
-- prod'a gitmez. Buradaki kullanıcı /api/dev-login route'unun sessizce giriş yaptığı hesaptır.
--
-- Parola .env.local'deki SUPABASE_DEV_USER_PASSWORD ile aynı olmalı.

insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    -- gotrue bu kolonları Go tarafında `string` olarak okuyor; NULL bırakılırsa
    -- giriş "Database error querying schema" ile patlar. Boş string olmalılar.
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
) values (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000a1',
    'authenticated',
    'authenticated',
    'dev@local.test',
    extensions.crypt('devparola123', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    '',
    '',
    '',
    ''
);

-- gotrue parola girişinde identity kaydını da arar; olmadan signInWithPassword başarısız olur.
insert into auth.identities (
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
) values (
    '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0000-0000000000a1',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"dev@local.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
);

-- Aile ve üyelik. ensureHouseholdExists() bunu bulup yeni household açmayacak.
insert into public.households (id, name)
values ('00000000-0000-0000-0000-0000000000b1', 'Benim Ailem');

insert into public.household_members (household_id, user_id, role)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'admin');
