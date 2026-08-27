/* PRE-APPLY READ-ONLY VERIFICATION
with
community_tables as (
  select c.relname, c.relrowsecurity, c.relforcerowsecurity,
         pg_catalog.pg_get_userbyid(c.relowner) as owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('community_posts', 'community_comments')
),
community_columns as (
  select table_name, jsonb_agg(column_name order by ordinal_position) as columns
  from information_schema.columns
  where table_schema = 'public' and table_name in ('community_posts', 'community_comments')
  group by table_name
),
community_schema_baseline as (
  select jsonb_build_object(
    'existing_post_columns',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'name',c.column_name,'type',c.data_type,'nullable',c.is_nullable,'default',c.column_default
      ) order by c.ordinal_position),'[]'::jsonb)
      from information_schema.columns c
      where c.table_schema='public' and c.table_name='community_posts'
        and c.column_name in ('course_id','cohort_id','author_type','created_by_student_id','hidden_by_user_id','author_display_name')
    ),
    'author_constraints',(
      select coalesce(jsonb_agg(jsonb_build_object('name',con.conname,'type',con.contype,'definition',pg_catalog.pg_get_constraintdef(con.oid)) order by con.conname),'[]'::jsonb)
      from pg_catalog.pg_constraint con
      where con.conrelid='public.community_posts'::regclass
        and con.conname in ('community_posts_created_by_student_id_fkey','community_posts_hidden_by_user_id_fkey','community_posts_author_identity_check')
    )
  ) as value
),
community_functions as (
  select jsonb_build_object(
    'expected',(
      select jsonb_agg(jsonb_build_object('identity',expected.identity,'installed',pg_catalog.to_regprocedure(expected.identity) is not null) order by expected.identity)
      from (values
        ('public.get_student_community_posts()'),('public.get_student_community_comments(uuid)'),
        ('public.create_student_community_comment(uuid,text)'),('public.create_student_community_post(uuid,text,text,text)'),
        ('public.get_team_community_posts(uuid)'),
        ('public.get_team_community_comments(uuid)'),('public.create_team_community_post(uuid,text,text,text)'),
        ('public.update_team_community_post(uuid,text,text,text)'),('public.publish_community_post(uuid)'),
        ('public.archive_community_post(uuid)'),('public.hide_community_post(uuid)'),
        ('public.create_team_community_comment(uuid,text)'),('public.hide_community_comment(uuid)')
      ) expected(identity)
    ),
    'unexpected',(
      select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]'::jsonb)
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'get_student_community_posts','get_student_community_comments','create_student_community_comment','create_student_community_post',
        'get_team_community_posts','get_team_community_comments','create_team_community_post','update_team_community_post',
        'publish_community_post','archive_community_post','hide_community_post','create_team_community_comment','hide_community_comment',
        'get_student_community_posts_v2','get_student_community_comments_v2','create_student_community_post_v2',
        'get_team_community_posts_v2','get_team_community_comments_v2','create_team_community_post_v2'
      ) and p.oid not in (select pg_catalog.to_regprocedure(e.identity) from (values
        ('public.get_student_community_posts()'),('public.get_student_community_comments(uuid)'),
        ('public.create_student_community_comment(uuid,text)'),('public.create_student_community_post(uuid,text,text,text)'),
        ('public.get_team_community_posts(uuid)'),
        ('public.get_team_community_comments(uuid)'),('public.create_team_community_post(uuid,text,text,text)'),
        ('public.update_team_community_post(uuid,text,text,text)'),('public.publish_community_post(uuid)'),
        ('public.archive_community_post(uuid)'),('public.hide_community_post(uuid)'),
        ('public.create_team_community_comment(uuid,text)'),('public.hide_community_comment(uuid)')
      ) e(identity))
    )
  ) as value
),
community_data as (
  select jsonb_build_object(
    'posts', (select count(*) from public.community_posts),
    'comments', (select count(*) from public.community_comments),
    'known_regression_smoke_posts', (select count(*) from public.community_posts cp
      where cp.id='e3002920-107d-4f24-b7c9-b1b82eacb8bc'::uuid
        and cp.tenant_id='29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
        and cp.title='Recovery 4C Student Post Smoke - 2026-07-14T15-37-41-877Z'
        and cp.status='hidden' and cp.audience_type='all_students' and cp.post_type='discussion'
        and cp.author_type='student' and cp.created_by_student_id is not null
        and not exists(select 1 from public.enrollments e where e.tenant_id=cp.tenant_id and e.student_id=cp.created_by_student_id)
        and not exists(select 1 from public.cohort_members cm where cm.tenant_id=cp.tenant_id and cm.student_id=cp.created_by_student_id)),
    'known_regression_smoke_comments', (select count(*) from public.community_comments where post_id='e3002920-107d-4f24-b7c9-b1b82eacb8bc'::uuid),
    'unclassified_business_posts', (select count(*) from public.community_posts cp
      where not (
        cp.id='e3002920-107d-4f24-b7c9-b1b82eacb8bc'::uuid
        and cp.tenant_id='29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
        and cp.title='Recovery 4C Student Post Smoke - 2026-07-14T15-37-41-877Z'
        and cp.status='hidden' and cp.audience_type='all_students' and cp.post_type='discussion'
        and cp.author_type='student' and cp.created_by_student_id is not null
        and not exists(select 1 from public.enrollments e where e.tenant_id=cp.tenant_id and e.student_id=cp.created_by_student_id)
        and not exists(select 1 from public.cohort_members cm where cm.tenant_id=cp.tenant_id and cm.student_id=cp.created_by_student_id)
      )),
    'unsupported_post_status', (select count(*) from public.community_posts where status not in ('draft','published','archived','hidden')),
    'unsupported_post_type', (select count(*) from public.community_posts where post_type not in ('discussion','question','resource','update')),
    'legacy_all_students_posts', (select count(*) from public.community_posts where audience_type = 'all_students'),
    'unsupported_comment_status', (select count(*) from public.community_comments where status not in ('published','hidden')),
    'comment_tenant_mismatch', (select count(*) from public.community_comments cc join public.community_posts cp on cp.id = cc.post_id where cc.tenant_id is distinct from cp.tenant_id)
  ) as value
),
feature_gate as (
  select jsonb_build_object(
    'module62_community_allowed', 'community_hub' = any(public.feature_access_allowed_keys()),
    'subscription_community_known', 'community_hub' = any(public.subscription_entitlements_feature_keys()),
    'community_plan_states', coalesce((
      select jsonb_object_agg(sp.code, spfe.entitlement_status order by sp.code)
      from public.subscription_plan_feature_entitlements spfe
      join public.subscription_plans sp on sp.id = spfe.plan_id
      where spfe.feature_key = 'community_hub'
    ), '{}'::jsonb),
    'messages_plan_states', coalesce((
      select jsonb_object_agg(sp.code, spfe.entitlement_status order by sp.code)
      from public.subscription_plan_feature_entitlements spfe
      join public.subscription_plans sp on sp.id = spfe.plan_id
      where spfe.feature_key = 'messages'
    ), '{}'::jsonb),
    'messages_plan_count', (select count(*) from public.subscription_plan_feature_entitlements where feature_key='messages'),
    'community_plan_count', (select count(*) from public.subscription_plan_feature_entitlements where feature_key='community_hub'),
    'missing_community_plan_rows', (select count(*) from public.subscription_plan_feature_entitlements m left join public.subscription_plan_feature_entitlements c on c.plan_id=m.plan_id and c.feature_key='community_hub' where m.feature_key='messages' and c.id is null),
    'messages_tenant_setting_count', (select count(*) from public.tenant_feature_settings where feature_key='messages'),
    'community_tenant_setting_count', (select count(*) from public.tenant_feature_settings where feature_key='community_hub'),
    'missing_community_tenant_twins', (select count(*) from public.tenant_feature_settings m left join public.tenant_feature_settings c on c.tenant_id=m.tenant_id and c.feature_key='community_hub' where m.feature_key='messages' and c.tenant_id is null),
    'missing_messages_tenant_twins', (select count(*) from public.tenant_feature_settings c left join public.tenant_feature_settings m on m.tenant_id=c.tenant_id and m.feature_key='messages' where c.feature_key='community_hub' and m.tenant_id is null),
    'tenant_status_mismatches', (select count(*) from public.tenant_feature_settings m join public.tenant_feature_settings c on c.tenant_id=m.tenant_id and c.feature_key='community_hub' where m.feature_key='messages' and c.status is distinct from m.status)
  ) as value
),
required_helpers as (
  select jsonb_agg(jsonb_build_object(
    'identity', expected.identity,
    'installed', pg_catalog.to_regprocedure(expected.identity) is not null
  ) order by expected.identity) as value
  from (values
    ('public.m76b_validate_text(text,text,boolean,integer)'),
    ('public.m76b_normalize_post_type(text)'),
    ('public.feature_access_effective_rows(uuid)'),
    ('public.subscription_entitlements_feature_keys()'),
    ('public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'),
    ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_cohort(uuid,uuid,uuid)'),
    ('public.m69_5_write_audit(uuid,text,text,uuid,text,text,text,jsonb)')
  ) expected(identity)
),
direct_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', table_name, 'grantee', grantee, 'privilege', privilege_type
  ) order by table_name, grantee, privilege_type), '[]'::jsonb) as value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('community_posts','community_comments')
    and grantee in ('PUBLIC','anon','authenticated','service_role')
),
baseline as (
  select jsonb_build_object(
    'announcements', (select count(*) from (values
      ('public.get_student_announcements_v2(integer,timestamp with time zone,uuid)'),
      ('public.get_student_announcement_v2(uuid)'),
      ('public.get_team_announcements_v2(uuid,text,text,integer,timestamp with time zone,uuid)'),
      ('public.get_team_announcement_v2(uuid,uuid)'),
      ('public.create_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
      ('public.update_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
      ('public.publish_academy_announcement_v2(uuid)'),
      ('public.archive_academy_announcement_v2(uuid)'),
      ('public.delete_draft_academy_announcement_v2(uuid)')
    ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null),
    'academy_chat', (select count(*) from (values
      ('public.get_team_chat_threads(uuid)'), ('public.get_team_chat_thread(uuid)'),
      ('public.get_student_chat_threads()'), ('public.get_student_chat_thread(uuid)'),
      ('public.add_default_team_chat_participants(uuid,uuid,uuid,uuid)'),
      ('public.create_student_direct_chat(uuid,uuid,text,text)'),
      ('public.create_student_support_thread(text,text)'), ('public.send_team_chat_message(uuid,text)'),
      ('public.send_student_chat_message(uuid,text)'), ('public.close_chat_thread(uuid)'),
      ('public.mark_chat_thread_read(uuid)')
    ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null)
  ) as value
)
select jsonb_build_object(
  'community_tables', (select coalesce(jsonb_agg(to_jsonb(t) order by relname),'[]'::jsonb) from community_tables t),
  'community_columns', (select coalesce(jsonb_object_agg(table_name, columns),'{}'::jsonb) from community_columns),
  'community_schema_baseline', (select value from community_schema_baseline),
  'community_baseline', (select value from community_functions),
  'community_data', (select value from community_data),
  'feature_gate', (select value from feature_gate),
  'required_helpers', (select value from required_helpers),
  'direct_grants', (select value from direct_grants),
  'system_baseline', (select value from baseline)
) as ux7e_preflight;
*/

begin;

do $$
declare
  v_missing text[];
  v_missing_identity text;
  v_unexpected_identity text;
begin
  select array_agg(required.identity order by required.identity)
  into v_missing
  from (values
    ('public.community_posts'::text), ('public.community_comments'),
    ('public.courses'), ('public.cohorts'), ('public.cohort_members'),
    ('public.enrollments'), ('public.students'), ('public.student_portal_accounts'),
    ('public.tenant_members'), ('public.delegated_permissions'), ('public.profiles'),
    ('public.trainer_course_assignments'), ('public.trainer_cohort_assignments'),
    ('public.tenant_feature_settings'), ('public.tenant_feature_activity_logs'),
    ('public.subscription_plan_feature_entitlements')
  ) required(identity)
  where pg_catalog.to_regclass(required.identity) is null;

  if v_missing is not null then
    raise exception 'UX-7E prerequisite failed: missing tables: %', array_to_string(v_missing, ', ') using errcode = '55000';
  end if;

  select string_agg(expected.identity, ', ' order by expected.identity)
  into v_missing_identity
  from (values
    ('public.get_student_community_posts()'),('public.get_student_community_comments(uuid)'),
    ('public.create_student_community_comment(uuid,text)'),('public.create_student_community_post(uuid,text,text,text)'),
    ('public.get_team_community_posts(uuid)'),
    ('public.get_team_community_comments(uuid)'),('public.create_team_community_post(uuid,text,text,text)'),
    ('public.update_team_community_post(uuid,text,text,text)'),('public.publish_community_post(uuid)'),
    ('public.archive_community_post(uuid)'),('public.hide_community_post(uuid)'),
    ('public.create_team_community_comment(uuid,text)'),('public.hide_community_comment(uuid)')
  ) expected(identity)
  where pg_catalog.to_regprocedure(expected.identity) is null;
  if v_missing_identity is not null then
    raise exception 'UX-7E prerequisite failed: missing Community identities: %.', v_missing_identity using errcode='55000';
  end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_unexpected_identity
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'get_student_community_posts','get_student_community_comments','create_student_community_comment','create_student_community_post',
      'get_team_community_posts','get_team_community_comments','create_team_community_post','update_team_community_post',
      'publish_community_post','archive_community_post','hide_community_post','create_team_community_comment','hide_community_comment',
      'get_student_community_posts_v2','get_student_community_comments_v2','create_student_community_post_v2',
      'get_team_community_posts_v2','get_team_community_comments_v2','create_team_community_post_v2'
    )
    and p.oid not in (
      select pg_catalog.to_regprocedure(expected.identity)
      from (values
        ('public.get_student_community_posts()'),('public.get_student_community_comments(uuid)'),
        ('public.create_student_community_comment(uuid,text)'),('public.create_student_community_post(uuid,text,text,text)'),
        ('public.get_team_community_posts(uuid)'),
        ('public.get_team_community_comments(uuid)'),('public.create_team_community_post(uuid,text,text,text)'),
        ('public.update_team_community_post(uuid,text,text,text)'),('public.publish_community_post(uuid)'),
        ('public.archive_community_post(uuid)'),('public.hide_community_post(uuid)'),
        ('public.create_team_community_comment(uuid,text)'),('public.hide_community_comment(uuid)')
      ) expected(identity)
    );
  if v_unexpected_identity is not null then
    raise exception 'UX-7E prerequisite failed: unexpected Community overloads: %.', v_unexpected_identity using errcode='55000';
  end if;

  if (select count(*) from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('community_posts','community_comments')) <> 9
     or exists (
      select 1 from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('community_posts','community_comments')
        and p.polname not in (
          'Team can read community posts','Students can read published community posts',
          'Team can insert community posts','Team can update community posts',
          'Team can read community comments','Students can read published community comments',
          'Team can insert community comments','Students can insert community comments',
          'Team can update community comments'
        )
    ) then
    raise exception 'UX-7E prerequisite failed: Community policy baseline drift.' using errcode='55000';
  end if;

  if exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='community_posts'
      and c.column_name in ('course_id','cohort_id')
  ) then
    raise exception 'UX-7E prerequisite failed: Community scope columns already exist.' using errcode='55000';
  end if;

  if (select count(*) from information_schema.columns c
      where c.table_schema='public' and c.table_name='community_posts'
        and ((c.column_name in ('created_by_student_id','hidden_by_user_id') and c.data_type='uuid' and c.is_nullable='YES')
          or (c.column_name in ('author_type','author_display_name') and c.data_type='text'))) <> 4
     or not exists (
       select 1 from pg_catalog.pg_constraint con
       where con.conrelid='public.community_posts'::regclass
         and con.conname='community_posts_created_by_student_id_fkey'
         and con.contype='f' and con.confrelid='public.students'::regclass
         and pg_catalog.pg_get_constraintdef(con.oid) like '%ON DELETE SET NULL%'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint con
       where con.conrelid='public.community_posts'::regclass
         and con.conname='community_posts_hidden_by_user_id_fkey'
         and con.contype='f' and con.confrelid='auth.users'::regclass
         and pg_catalog.pg_get_constraintdef(con.oid) like '%ON DELETE SET NULL%'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint con
       where con.conrelid='public.community_posts'::regclass
         and con.conname='community_posts_author_identity_check' and con.contype='c'
     ) then
    raise exception 'UX-7E prerequisite failed: Community author/moderation column or constraint baseline drift.' using errcode='55000';
  end if;

  select string_agg(expected.identity, ', ' order by expected.identity)
  into v_missing_identity
  from (values
    ('public.m76b_validate_text(text,text,boolean,integer)'),
    ('public.m76b_normalize_post_type(text)'),
    ('public.feature_access_effective_rows(uuid)'),
    ('public.subscription_entitlements_feature_keys()'),
    ('public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'),
    ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_cohort(uuid,uuid,uuid)'),
    ('public.m69_5_write_audit(uuid,text,text,uuid,text,text,text,jsonb)')
  ) expected(identity)
  where pg_catalog.to_regprocedure(expected.identity) is null;
  if v_missing_identity is not null then
    raise exception 'UX-7E prerequisite failed: missing runtime helpers: %.', v_missing_identity using errcode='55000';
  end if;

  if (select count(*) from public.subscription_plan_feature_entitlements where feature_key='messages')=0
     or exists (
       select 1 from public.subscription_plan_feature_entitlements m
       left join public.subscription_plan_feature_entitlements c on c.plan_id=m.plan_id and c.feature_key='community_hub'
       where m.feature_key='messages' and c.id is null
     )
     or exists (
       select 1 from public.subscription_plan_feature_entitlements c
       left join public.subscription_plan_feature_entitlements m on m.plan_id=c.plan_id and m.feature_key='messages'
       where c.feature_key='community_hub' and m.id is null
     ) then
    raise exception 'UX-7E prerequisite failed: Community feature entitlement plan coverage drift.' using errcode='55000';
  end if;

  if not ('community_hub'=any(public.subscription_entitlements_feature_keys())) then
    raise exception 'UX-7E prerequisite failed: Community is not a canonical subscription feature key.' using errcode='55000';
  end if;

  if exists (
    select 1 from public.tenant_feature_settings c
    left join public.tenant_feature_settings m
      on m.tenant_id=c.tenant_id and m.feature_key='messages'
    where c.feature_key='community_hub' and m.tenant_id is null
  ) then
    raise exception 'UX-7E prerequisite failed: Community tenant setting has no Messages cutover source.' using errcode='55000';
  end if;

  if not exists(select 1 from pg_catalog.pg_roles r where r.rolname='postgres' and (r.rolsuper or r.rolbypassrls)) then
    raise exception 'UX-7E prerequisite failed: helper owner cannot bypass RLS.' using errcode='55000';
  end if;
  if position('coachfort_internal' in coalesce(current_setting('pgrst.db_schemas',true),''))>0 then
    raise exception 'UX-7E prerequisite failed: internal schema is API exposed.' using errcode='55000';
  end if;

  if (select count(*) from (values
      ('public.get_student_announcements_v2(integer,timestamp with time zone,uuid)'),
      ('public.get_student_announcement_v2(uuid)'),
      ('public.get_team_announcements_v2(uuid,text,text,integer,timestamp with time zone,uuid)'),
      ('public.get_team_announcement_v2(uuid,uuid)'),
      ('public.create_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
      ('public.update_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
      ('public.publish_academy_announcement_v2(uuid)'),('public.archive_academy_announcement_v2(uuid)'),
      ('public.delete_draft_academy_announcement_v2(uuid)')
    ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null) <> 9 then
    raise exception 'UX-7E prerequisite failed: Announcement V2 baseline drift.' using errcode='55000';
  end if;
  if (select count(*) from (values
      ('public.get_team_chat_threads(uuid)'),('public.get_team_chat_thread(uuid)'),
      ('public.get_student_chat_threads()'),('public.get_student_chat_thread(uuid)'),
      ('public.add_default_team_chat_participants(uuid,uuid,uuid,uuid)'),
      ('public.create_student_direct_chat(uuid,uuid,text,text)'),('public.create_student_support_thread(text,text)'),
      ('public.send_team_chat_message(uuid,text)'),('public.send_student_chat_message(uuid,text)'),
      ('public.close_chat_thread(uuid)'),('public.mark_chat_thread_read(uuid)')
    ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null) <> 11 then
    raise exception 'UX-7E prerequisite failed: Academy Chat baseline drift.' using errcode='55000';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('community_posts','community_comments')
      and (not c.relrowsecurity or c.relforcerowsecurity)
  ) then
    raise exception 'UX-7E prerequisite failed: Community RLS/FORCE state drift.' using errcode = '55000';
  end if;

  if (select count(*) from public.community_posts) <> 1
     or not exists (
       select 1 from public.community_posts cp
       where cp.id='e3002920-107d-4f24-b7c9-b1b82eacb8bc'::uuid
         and cp.tenant_id='29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
         and cp.title='Recovery 4C Student Post Smoke - 2026-07-14T15-37-41-877Z'
         and cp.status='hidden' and cp.audience_type='all_students' and cp.post_type='discussion'
         and cp.author_type='student' and cp.created_by_student_id is not null
         and not exists(select 1 from public.enrollments e where e.tenant_id=cp.tenant_id and e.student_id=cp.created_by_student_id)
         and not exists(select 1 from public.cohort_members cm where cm.tenant_id=cp.tenant_id and cm.student_id=cp.created_by_student_id)
     ) then
    raise exception 'UX-7E prerequisite failed: Community posts do not exactly match the classified Recovery 4C smoke fixture.' using errcode = '55000';
  end if;
  if exists (select 1 from public.community_comments)
     or exists (select 1 from public.community_comments where post_id='e3002920-107d-4f24-b7c9-b1b82eacb8bc'::uuid) then
    raise exception 'UX-7E prerequisite failed: Community comments must be empty before classified smoke cleanup.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.delegated_permissions dp
    where dp.permission_key='manage_messages' and dp.status='active'
      and dp.starts_at <= now() and (dp.expires_at is null or dp.expires_at > now())
      and (dp.scope_type is null or dp.scope_type not in ('workspace','course','cohort'))
  ) then
    raise exception 'UX-7E prerequisite failed: active manage_messages scope drift.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.cohorts co left join public.courses c on c.id=co.course_id
    where c.id is null or c.tenant_id is distinct from co.tenant_id
  ) or exists (
    select 1 from public.cohort_members cm
    left join public.cohorts co on co.id=cm.cohort_id
    left join public.students s on s.id=cm.student_id
    where co.id is null or s.id is null or co.tenant_id is distinct from cm.tenant_id or s.tenant_id is distinct from cm.tenant_id
  ) then
    raise exception 'UX-7E prerequisite failed: cohort integrity drift.' using errcode = '55000';
  end if;
end $$;

do $$
declare v_deleted integer;
begin
  delete from public.community_posts cp
  where cp.id='e3002920-107d-4f24-b7c9-b1b82eacb8bc'::uuid
    and cp.tenant_id='29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
    and cp.title='Recovery 4C Student Post Smoke - 2026-07-14T15-37-41-877Z'
    and cp.status='hidden' and cp.audience_type='all_students' and cp.post_type='discussion'
    and cp.author_type='student' and cp.created_by_student_id is not null
    and not exists(select 1 from public.enrollments e where e.tenant_id=cp.tenant_id and e.student_id=cp.created_by_student_id)
    and not exists(select 1 from public.cohort_members cm where cm.tenant_id=cp.tenant_id and cm.student_id=cp.created_by_student_id);
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'UX-7E apply failed: classified Recovery 4C smoke fixture delete count was %, expected 1.',v_deleted using errcode='55000';
  end if;
end $$;

alter table public.tenant_feature_settings drop constraint tenant_feature_settings_feature_key_check;
alter table public.tenant_feature_settings add constraint tenant_feature_settings_feature_key_check check (
  feature_key in ('dashboard','students','courses','attendance','assignments','finance','reports','documents','document_uploads','messages','community_hub','crm','marketing','automations','workflows','approvals','team_operations','audit_compliance','backup_recovery','website_builder','certificates','payment_gateway','live_classes','notifications','mobile_pwa')
);
alter table public.tenant_feature_activity_logs drop constraint tenant_feature_activity_logs_feature_key_check;
alter table public.tenant_feature_activity_logs add constraint tenant_feature_activity_logs_feature_key_check check (
  feature_key in ('dashboard','students','courses','attendance','assignments','finance','reports','documents','document_uploads','messages','community_hub','crm','marketing','automations','workflows','approvals','team_operations','audit_compliance','backup_recovery','website_builder','certificates','payment_gateway','live_classes','notifications','mobile_pwa')
);

create or replace function public.feature_access_allowed_keys()
returns text[] language sql immutable set search_path = public
as $$
  select array['dashboard','students','courses','attendance','assignments','finance','reports','documents','document_uploads','messages','community_hub','crm','marketing','automations','workflows','approvals','team_operations','audit_compliance','backup_recovery','website_builder','certificates','payment_gateway','live_classes','notifications','mobile_pwa']::text[];
$$;

insert into public.tenant_feature_settings (
  tenant_id, feature_key, status, source, configured_by, configured_at, metadata_json, created_at, updated_at
)
select m.tenant_id, 'community_hub', m.status, m.source, m.configured_by, m.configured_at,
       coalesce(m.metadata_json,'{}'::jsonb) || '{"ux7e_copied_from":"messages"}'::jsonb,
       now(), now()
from public.tenant_feature_settings m
where m.feature_key='messages'
on conflict (tenant_id, feature_key) do update
set status=excluded.status,
    source=excluded.source,
    configured_by=excluded.configured_by,
    configured_at=excluded.configured_at,
    metadata_json=coalesce(public.tenant_feature_settings.metadata_json,'{}'::jsonb)
      || excluded.metadata_json
      || jsonb_build_object('ux7e_cutover_synced_at',now()),
    updated_at=now();

update public.subscription_plan_feature_entitlements community
set entitlement_status=messages.entitlement_status,
    requires_platform_approval=messages.requires_platform_approval,
    included_quota=messages.included_quota,
    metadata_json=coalesce(community.metadata_json,'{}'::jsonb) || '{"ux7e_copied_from":"messages"}'::jsonb,
    updated_at=now()
from public.subscription_plan_feature_entitlements messages
where community.plan_id=messages.plan_id
  and community.feature_key='community_hub'
  and messages.feature_key='messages';

alter table public.community_posts
  add column course_id uuid references public.courses(id) on delete restrict,
  add column cohort_id uuid references public.cohorts(id) on delete restrict;

alter table public.community_posts drop constraint community_posts_audience_type_check;
alter table public.community_posts add constraint community_posts_audience_type_check
  check (audience_type in ('program','cohort'));
alter table public.community_posts add constraint community_posts_scope_shape_check check (
  (audience_type='program' and course_id is not null and cohort_id is null)
  or (audience_type='cohort' and course_id is not null and cohort_id is not null)
);
alter table public.community_posts drop constraint community_posts_author_identity_check;
alter table public.community_posts add constraint community_posts_author_identity_check check (
  (author_type='team' and created_by_user_id is not null and created_by_student_id is null)
  or (author_type='student' and created_by_student_id is not null and created_by_user_id is not null)
);

create index community_posts_program_feed_idx
  on public.community_posts (tenant_id, course_id, status, published_at desc, id desc)
  where audience_type='program';
create index community_posts_cohort_feed_idx
  on public.community_posts (tenant_id, cohort_id, status, published_at desc, id desc)
  where audience_type='cohort';
create index community_comments_bounded_feed_idx
  on public.community_comments (post_id, status, created_at, id);

create or replace function coachfort_internal.enforce_community_post_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_course public.courses%rowtype; v_cohort public.cohorts%rowtype;
begin
  if new.audience_type not in ('program','cohort') or new.tenant_id is null or new.course_id is null then
    raise exception 'Community scope is invalid.' using errcode='22023';
  end if;
  select * into v_course from public.courses c where c.id=new.course_id and c.tenant_id=new.tenant_id;
  if not found then raise exception 'Program is not available in this workspace.' using errcode='22023'; end if;
  if new.audience_type='program' then
    if new.cohort_id is not null then raise exception 'Program Community scope cannot include a cohort.' using errcode='22023'; end if;
  else
    select * into v_cohort from public.cohorts co where co.id=new.cohort_id and co.tenant_id=new.tenant_id;
    if not found or v_cohort.course_id is distinct from new.course_id then
      raise exception 'Cohort does not belong to the selected Program.' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
alter function coachfort_internal.enforce_community_post_scope() owner to postgres;
revoke all on function coachfort_internal.enforce_community_post_scope() from public,anon,authenticated,service_role;
create trigger enforce_community_post_scope before insert or update of tenant_id,audience_type,course_id,cohort_id
  on public.community_posts for each row execute function coachfort_internal.enforce_community_post_scope();

create or replace function coachfort_internal.community_feature_enabled(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select coalesce(exists(select 1 from public.feature_access_effective_rows(p_tenant_id) f where f.feature_key='community_hub' and f.status='enabled'),false);
$$;
alter function coachfort_internal.community_feature_enabled(uuid) owner to postgres;
revoke all on function coachfort_internal.community_feature_enabled(uuid) from public,anon,authenticated,service_role;

create or replace function coachfort_internal.community_team_authorization_context(
  p_tenant_id uuid, p_audience_type text, p_course_id uuid, p_cohort_id uuid
)
returns table(actor_role text, delegated_permission_id uuid, delegated_scope_type text, delegated_scope_id uuid)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_permission_id uuid; v_permission public.delegated_permissions%rowtype;
begin
  if v_actor is null or p_tenant_id is null or p_course_id is null or p_audience_type not in ('program','cohort') then return; end if;
  if not coachfort_internal.community_feature_enabled(p_tenant_id) then return; end if;
  if not exists(select 1 from public.courses c where c.id=p_course_id and c.tenant_id=p_tenant_id) then return; end if;
  if p_audience_type='program' and p_cohort_id is not null then return; end if;
  if p_audience_type='cohort' and not exists(select 1 from public.cohorts co where co.id=p_cohort_id and co.tenant_id=p_tenant_id and co.course_id=p_course_id) then return; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_actor limit 1;
  if v_role in ('owner','admin') then return query select v_role,null::uuid,null::text,null::uuid; return; end if;
  if v_role not in ('staff','trainer') then return; end if;
  v_permission_id:=public.find_active_delegated_permission_for_action(
    p_tenant_id,v_actor,array['manage_messages'],p_course_id,p_cohort_id,null,null,null
  );
  if v_permission_id is null then return; end if;
  select dp.* into v_permission from public.delegated_permissions dp
  where dp.id=v_permission_id and dp.tenant_id=p_tenant_id and dp.user_id=v_actor
    and dp.permission_key='manage_messages' and dp.status='active'
    and dp.starts_at<=now() and (dp.expires_at is null or dp.expires_at>now());
  if not found or v_permission.scope_type is null then return; end if;
  if p_audience_type='program' and not (v_permission.scope_type='workspace' or (v_permission.scope_type='course' and v_permission.scope_id=p_course_id)) then return; end if;
  if p_audience_type='cohort' and not (v_permission.scope_type='workspace' or (v_permission.scope_type='course' and v_permission.scope_id=p_course_id) or (v_permission.scope_type='cohort' and v_permission.scope_id=p_cohort_id)) then return; end if;
  if v_role='trainer' then
    if p_audience_type='program' and not public.ux4b_trainer_can_manage_course(p_tenant_id,v_actor,p_course_id) then return; end if;
    if p_audience_type='cohort' and not public.ux4b_trainer_can_manage_cohort(p_tenant_id,v_actor,p_cohort_id) then return; end if;
  end if;
  return query select v_role,v_permission.id,v_permission.scope_type,v_permission.scope_id;
end $$;
alter function coachfort_internal.community_team_authorization_context(uuid,text,uuid,uuid) owner to postgres;
revoke all on function coachfort_internal.community_team_authorization_context(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function coachfort_internal.community_student_scope_access(
  p_tenant_id uuid, p_student_id uuid, p_user_id uuid, p_course_id uuid, p_cohort_id uuid, p_mode text
)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_mode text:=lower(trim(coalesce(p_mode,'')));
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() or v_mode not in ('read','write') then return false; end if;
  if not coachfort_internal.community_feature_enabled(p_tenant_id) then return false; end if;
  if not coachfort_internal.student_portal_access_allowed_for_user(p_tenant_id,p_student_id,p_user_id,p_course_id,case when v_mode='write' then 'course_participate' else 'course_read' end) then return false; end if;
  if p_cohort_id is not null and not exists(
    select 1 from public.cohort_members cm join public.cohorts co on co.id=cm.cohort_id and co.tenant_id=cm.tenant_id
    where cm.tenant_id=p_tenant_id and cm.student_id=p_student_id and cm.cohort_id=p_cohort_id and co.course_id=p_course_id
  ) then return false; end if;
  return true;
end $$;
alter function coachfort_internal.community_student_scope_access(uuid,uuid,uuid,uuid,uuid,text) owner to postgres;
revoke all on function coachfort_internal.community_student_scope_access(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function coachfort_internal.community_student_post_access(p_post_id uuid,p_user_id uuid,p_mode text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_post public.community_posts%rowtype; v_mode text:=lower(trim(coalesce(p_mode,'')));
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() or v_mode not in ('read','write') then return false; end if;
  select * into v_post from public.community_posts cp where cp.id=p_post_id;
  if not found or v_post.status<>'published' or v_post.published_at is null then return false; end if;
  return exists(
    select 1 from public.student_portal_accounts spa
    join public.students s on s.id=spa.student_id and s.tenant_id=spa.tenant_id
    join public.enrollments e on e.tenant_id=s.tenant_id and e.student_id=s.id and e.course_id=v_post.course_id
    where spa.user_id=p_user_id and spa.tenant_id=v_post.tenant_id and spa.status='active'
      and coachfort_internal.community_student_scope_access(v_post.tenant_id,s.id,p_user_id,v_post.course_id,v_post.cohort_id,v_mode)
      and (v_mode='write' or e.status='active' or (e.status='completed' and e.completed_at is not null and v_post.published_at<=e.completed_at))
  );
end $$;
alter function coachfort_internal.community_student_post_access(uuid,uuid,text) owner to postgres;
revoke all on function coachfort_internal.community_student_post_access(uuid,uuid,text) from public,anon,authenticated,service_role;

drop policy if exists "Team can read community posts" on public.community_posts;
drop policy if exists "Students can read published community posts" on public.community_posts;
drop policy if exists "Team can insert community posts" on public.community_posts;
drop policy if exists "Team can update community posts" on public.community_posts;
drop policy if exists "Team can read community comments" on public.community_comments;
drop policy if exists "Students can read published community comments" on public.community_comments;
drop policy if exists "Team can insert community comments" on public.community_comments;
drop policy if exists "Students can insert community comments" on public.community_comments;
drop policy if exists "Team can update community comments" on public.community_comments;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
revoke all privileges on table public.community_posts from public,anon,authenticated;
revoke all privileges on table public.community_comments from public,anon,authenticated;
revoke truncate,trigger,references on table public.community_posts from service_role;
revoke truncate,trigger,references on table public.community_comments from service_role;

drop function public.get_student_community_posts();
drop function public.get_team_community_posts(uuid);

create or replace function public.get_student_community_posts_v2(
  p_course_id uuid default null, p_cohort_id uuid default null, p_limit integer default 25,
  p_cursor_published_at timestamptz default null, p_cursor_id uuid default null
)
returns table(id uuid,tenant_id uuid,course_id uuid,cohort_id uuid,audience_type text,title text,body text,post_type text,author_type text,author_name text,published_at timestamptz,created_at timestamptz,updated_at timestamptz,comment_count bigint)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
  if p_limit<1 or p_limit>50 then raise exception 'Community page size must be between 1 and 50.' using errcode='22023'; end if;
  if (p_cursor_published_at is null)<>(p_cursor_id is null) then raise exception 'Community cursor is invalid.' using errcode='22023'; end if;
  if p_cohort_id is not null and p_course_id is null then raise exception 'Cohort filtering requires a Program.' using errcode='22023'; end if;
  return query
  select cp.id,cp.tenant_id,cp.course_id,cp.cohort_id,cp.audience_type,cp.title,cp.body,cp.post_type,
    case when cp.created_by_student_id is null then 'team' else 'student' end,
    case when cp.created_by_student_id is null then coalesce(nullif(btrim(p.full_name),''),'Coach team') else coalesce(nullif(btrim(s.full_name),''),'Student') end,
    cp.published_at,cp.created_at,cp.updated_at,
    (select count(*) from public.community_comments cc where cc.post_id=cp.id and cc.status='published')
  from public.community_posts cp
  left join public.profiles p on p.id=cp.created_by_user_id
  left join public.students s on s.id=cp.created_by_student_id and s.tenant_id=cp.tenant_id
  where cp.status='published' and cp.published_at is not null
    and (p_course_id is null or cp.course_id=p_course_id)
    and (p_cohort_id is null or cp.cohort_id=p_cohort_id)
    and coachfort_internal.community_student_post_access(cp.id,auth.uid(),'read')
    and (p_cursor_published_at is null or (cp.published_at,cp.id)<(p_cursor_published_at,p_cursor_id))
  order by cp.published_at desc,cp.id desc limit p_limit;
end $$;

create or replace function public.get_team_community_posts_v2(
  p_tenant_id uuid,p_course_id uuid default null,p_cohort_id uuid default null,p_status text default null,
  p_limit integer default 25,p_cursor_updated_at timestamptz default null,p_cursor_id uuid default null
)
returns table(id uuid,tenant_id uuid,course_id uuid,cohort_id uuid,audience_type text,title text,body text,status text,post_type text,author_type text,author_name text,published_at timestamptz,archived_at timestamptz,hidden_at timestamptz,created_at timestamptz,updated_at timestamptz,comment_count bigint)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
  if p_limit<1 or p_limit>50 then raise exception 'Community page size must be between 1 and 50.' using errcode='22023'; end if;
  if (p_cursor_updated_at is null)<>(p_cursor_id is null) then raise exception 'Community cursor is invalid.' using errcode='22023'; end if;
  if p_status is not null and p_status not in ('draft','published','archived','hidden') then raise exception 'Community status filter is invalid.' using errcode='22023'; end if;
  return query
  select cp.id,cp.tenant_id,cp.course_id,cp.cohort_id,cp.audience_type,cp.title,cp.body,cp.status,cp.post_type,
    case when cp.created_by_student_id is null then 'team' else 'student' end,
    case when cp.created_by_student_id is null then coalesce(nullif(btrim(p.full_name),''),'Coach team') else coalesce(nullif(btrim(s.full_name),''),'Student') end,
    cp.published_at,cp.archived_at,cp.hidden_at,cp.created_at,cp.updated_at,
    (select count(*) from public.community_comments cc where cc.post_id=cp.id)
  from public.community_posts cp
  left join public.profiles p on p.id=cp.created_by_user_id
  left join public.students s on s.id=cp.created_by_student_id and s.tenant_id=cp.tenant_id
  where cp.tenant_id=p_tenant_id and (p_course_id is null or cp.course_id=p_course_id) and (p_cohort_id is null or cp.cohort_id=p_cohort_id)
    and (p_status is null or cp.status=p_status)
    and exists(select 1 from coachfort_internal.community_team_authorization_context(cp.tenant_id,cp.audience_type,cp.course_id,cp.cohort_id))
    and (p_cursor_updated_at is null or (cp.updated_at,cp.id)<(p_cursor_updated_at,p_cursor_id))
  order by cp.updated_at desc,cp.id desc limit p_limit;
end $$;

create or replace function public.get_student_community_comments_v2(
  p_post_id uuid,p_limit integer default 25,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null
)
returns table(id uuid,post_id uuid,body text,author_type text,author_name text,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
begin
  if p_limit<1 or p_limit>50 then raise exception 'Community page size must be between 1 and 50.' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then raise exception 'Community cursor is invalid.' using errcode='22023'; end if;
  if not coachfort_internal.community_student_post_access(p_post_id,auth.uid(),'read') then raise exception 'Community post is unavailable.' using errcode='42501'; end if;
  return query select cc.id,cc.post_id,cc.body,cc.author_type,
    case when cc.author_type='team' then coalesce(nullif(btrim(p.full_name),''),'Coach team') else coalesce(nullif(btrim(s.full_name),''),'Student') end,
    cc.created_at,cc.updated_at
  from public.community_comments cc
  left join public.profiles p on p.id=cc.created_by_user_id
  left join public.students s on s.id=cc.created_by_student_id and s.tenant_id=cc.tenant_id
  where cc.post_id=p_post_id and cc.status='published'
    and (p_cursor_created_at is null or (cc.created_at,cc.id)>(p_cursor_created_at,p_cursor_id))
  order by cc.created_at,cc.id limit p_limit;
end $$;

create or replace function public.get_team_community_comments_v2(
  p_post_id uuid,p_limit integer default 25,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null
)
returns table(id uuid,tenant_id uuid,post_id uuid,body text,status text,author_type text,author_name text,created_at timestamptz,updated_at timestamptz,hidden_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_post public.community_posts%rowtype;
begin
  if p_limit<1 or p_limit>50 then raise exception 'Community page size must be between 1 and 50.' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then raise exception 'Community cursor is invalid.' using errcode='22023'; end if;
  select * into v_post from public.community_posts cp where cp.id=p_post_id;
  if not found or not exists(select 1 from coachfort_internal.community_team_authorization_context(v_post.tenant_id,v_post.audience_type,v_post.course_id,v_post.cohort_id)) then raise exception 'Community post is unavailable.' using errcode='42501'; end if;
  return query select cc.id,cc.tenant_id,cc.post_id,cc.body,cc.status,cc.author_type,
    case when cc.author_type='team' then coalesce(nullif(btrim(p.full_name),''),'Coach team') else coalesce(nullif(btrim(s.full_name),''),'Student') end,
    cc.created_at,cc.updated_at,cc.hidden_at
  from public.community_comments cc
  left join public.profiles p on p.id=cc.created_by_user_id
  left join public.students s on s.id=cc.created_by_student_id and s.tenant_id=cc.tenant_id
  where cc.post_id=p_post_id and (p_cursor_created_at is null or (cc.created_at,cc.id)>(p_cursor_created_at,p_cursor_id))
  order by cc.created_at,cc.id limit p_limit;
end $$;

create or replace function public.create_student_community_post_v2(
  p_course_id uuid,p_cohort_id uuid,p_title text,p_body text,p_post_type text default 'discussion'
)
returns public.community_posts language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_ctx record; v_post public.community_posts%rowtype; v_tenant uuid; v_audience text:=case when p_cohort_id is null then 'program' else 'cohort' end;
begin
  select spa.tenant_id,spa.student_id,spa.user_id,s.full_name into v_ctx
  from public.student_portal_accounts spa join public.students s on s.id=spa.student_id and s.tenant_id=spa.tenant_id
  where spa.user_id=auth.uid() and spa.status='active' and s.status='active' and s.portal_enabled=true
    and coachfort_internal.community_student_scope_access(spa.tenant_id,s.id,spa.user_id,p_course_id,p_cohort_id,'write')
  order by spa.linked_at limit 1;
  if not found then raise exception 'Active Community participation is required.' using errcode='42501'; end if;
  v_tenant:=v_ctx.tenant_id;
  insert into public.community_posts(tenant_id,course_id,cohort_id,title,body,status,post_type,audience_type,author_type,author_display_name,created_by_user_id,created_by_student_id,published_at)
  values(v_tenant,p_course_id,p_cohort_id,public.m76b_validate_text(p_title,'Community post title',true,180),public.m76b_validate_text(p_body,'Community post body',true,6000),'published',public.m76b_normalize_post_type(p_post_type),v_audience,'student',coalesce(nullif(btrim(v_ctx.full_name),''),'Student'),auth.uid(),v_ctx.student_id,now()) returning * into v_post;
  return v_post;
end $$;

create or replace function public.create_team_community_post_v2(
  p_tenant_id uuid,p_course_id uuid,p_cohort_id uuid,p_title text,p_body text,p_post_type text default 'discussion'
)
returns public.community_posts language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_post public.community_posts%rowtype; v_auth record; v_audience text:=case when p_cohort_id is null then 'program' else 'cohort' end;
begin
  select * into v_auth from coachfort_internal.community_team_authorization_context(p_tenant_id,v_audience,p_course_id,p_cohort_id);
  if not found then raise exception 'Community scope access denied.' using errcode='42501'; end if;
  insert into public.community_posts(tenant_id,course_id,cohort_id,title,body,status,post_type,audience_type,author_type,author_display_name,created_by_user_id)
  values(p_tenant_id,p_course_id,p_cohort_id,public.m76b_validate_text(p_title,'Community post title',true,180),public.m76b_validate_text(p_body,'Community post body',true,6000),'draft',public.m76b_normalize_post_type(p_post_type),v_audience,'team',coalesce((select nullif(btrim(p.full_name),'') from public.profiles p where p.id=auth.uid()),'Coach team'),auth.uid()) returning * into v_post;
  if v_auth.delegated_permission_id is not null then perform public.log_delegated_permission_used(p_tenant_id,auth.uid(),v_auth.delegated_permission_id,'create_community_post','community_post',v_post.id,v_auth.delegated_scope_type,v_auth.delegated_scope_id); end if;
  return v_post;
end $$;

-- TEMPORARY UX-7F CUTOVER COMPATIBILITY: bounded reads retain deployed identities.
create function public.get_student_community_posts()
returns table(id uuid,tenant_id uuid,title text,body text,post_type text,author_type text,author_name text,published_at timestamptz,created_at timestamptz,updated_at timestamptz,comment_count bigint)
language sql stable security definer set search_path=public,pg_temp
as $$ select id,tenant_id,title,body,post_type,author_type,author_name,published_at,created_at,updated_at,comment_count from public.get_student_community_posts_v2(null,null,25,null,null) $$;

create function public.get_team_community_posts(p_tenant_id uuid)
returns table(id uuid,tenant_id uuid,title text,body text,status text,post_type text,audience_type text,author_type text,author_name text,published_at timestamptz,archived_at timestamptz,hidden_at timestamptz,created_at timestamptz,updated_at timestamptz,comment_count bigint)
language sql stable security definer set search_path=public,pg_temp
as $$ select id,tenant_id,title,body,status,post_type,audience_type,author_type,author_name,published_at,archived_at,hidden_at,created_at,updated_at,comment_count from public.get_team_community_posts_v2(p_tenant_id,null,null,null,25,null,null) $$;

create or replace function public.get_student_community_comments(p_post_id uuid)
returns table(id uuid,post_id uuid,body text,author_type text,author_name text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp
as $$ select * from public.get_student_community_comments_v2(p_post_id,25,null,null) $$;

create or replace function public.get_team_community_comments(p_post_id uuid)
returns table(id uuid,tenant_id uuid,post_id uuid,body text,status text,author_type text,author_name text,created_at timestamptz,updated_at timestamptz,hidden_at timestamptz)
language sql stable security definer set search_path=public,pg_temp
as $$ select * from public.get_team_community_comments_v2(p_post_id,25,null,null) $$;

drop function public.create_student_community_post(uuid,text,text,text);
drop function public.create_team_community_post(uuid,text,text,text);

create or replace function public.create_student_community_comment(p_post_id uuid,p_body text)
returns uuid language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_post public.community_posts%rowtype; v_student uuid; v_comment uuid;
begin
  select * into v_post from public.community_posts where id=p_post_id;
  if not found or v_post.status<>'published' or v_post.published_at is null then
    raise exception 'Published Community post required.' using errcode='42501';
  end if;
  select spa.student_id into v_student
  from public.student_portal_accounts spa
  join public.students s on s.id=spa.student_id and s.tenant_id=spa.tenant_id
  where spa.user_id=auth.uid() and spa.tenant_id=v_post.tenant_id and spa.status='active'
    and s.status='active' and s.portal_enabled=true
    and coachfort_internal.community_student_scope_access(
      v_post.tenant_id,spa.student_id,auth.uid(),v_post.course_id,v_post.cohort_id,'write'
    )
  order by spa.linked_at,spa.student_id
  limit 1;
  if v_student is null then raise exception 'Active Community participation is required.' using errcode='42501'; end if;
  insert into public.community_comments(tenant_id,post_id,body,status,author_type,created_by_user_id,created_by_student_id)
  values(v_post.tenant_id,v_post.id,public.m76b_validate_text(p_body,'Comment',true,3000),'published','student',auth.uid(),v_student) returning id into v_comment;
  return v_comment;
end $$;

create or replace function public.create_team_community_comment(p_post_id uuid,p_body text)
returns uuid language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_post public.community_posts%rowtype; v_auth record; v_comment uuid;
begin
  select * into v_post from public.community_posts where id=p_post_id;
  if not found or v_post.status<>'published' then raise exception 'Published Community post required.' using errcode='22023'; end if;
  select * into v_auth from coachfort_internal.community_team_authorization_context(v_post.tenant_id,v_post.audience_type,v_post.course_id,v_post.cohort_id);
  if not found then raise exception 'Community scope access denied.' using errcode='42501'; end if;
  insert into public.community_comments(tenant_id,post_id,body,status,author_type,created_by_user_id)
  values(v_post.tenant_id,v_post.id,public.m76b_validate_text(p_body,'Comment',true,3000),'published','team',auth.uid()) returning id into v_comment;
  if v_auth.delegated_permission_id is not null then perform public.log_delegated_permission_used(v_post.tenant_id,auth.uid(),v_auth.delegated_permission_id,'create_community_comment','community_comment',v_comment,v_auth.delegated_scope_type,v_auth.delegated_scope_id); end if;
  return v_comment;
end $$;

create or replace function public.update_team_community_post(p_post_id uuid,p_title text,p_body text,p_post_type text default 'discussion')
returns public.community_posts language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_existing public.community_posts%rowtype; v_post public.community_posts%rowtype; v_auth record;
begin
  select * into v_existing from public.community_posts where id=p_post_id for update;
  if not found then raise exception 'Community post not found.' using errcode='22023'; end if;
  if v_existing.status in ('archived','hidden') then raise exception 'Archived or hidden Community posts cannot be edited.' using errcode='22023'; end if;
  select * into v_auth from coachfort_internal.community_team_authorization_context(v_existing.tenant_id,v_existing.audience_type,v_existing.course_id,v_existing.cohort_id);
  if not found then raise exception 'Community scope access denied.' using errcode='42501'; end if;
  update public.community_posts set title=public.m76b_validate_text(p_title,'Community post title',true,180),body=public.m76b_validate_text(p_body,'Community post body',true,6000),post_type=public.m76b_normalize_post_type(p_post_type) where id=p_post_id returning * into v_post;
  return v_post;
end $$;

create or replace function public.publish_community_post(p_post_id uuid)
returns public.community_posts language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_existing public.community_posts%rowtype; v_post public.community_posts%rowtype; v_auth record;
begin
  select * into v_existing from public.community_posts where id=p_post_id for update;
  if not found or v_existing.status<>'draft' then raise exception 'Only draft Community posts can be published.' using errcode='22023'; end if;
  select * into v_auth from coachfort_internal.community_team_authorization_context(v_existing.tenant_id,v_existing.audience_type,v_existing.course_id,v_existing.cohort_id);
  if not found then raise exception 'Community moderation access denied.' using errcode='42501'; end if;
  update public.community_posts set status='published',published_at=now(),archived_at=null,hidden_at=null,hidden_by_user_id=null where id=p_post_id returning * into v_post;
  perform public.m69_5_write_audit(v_post.tenant_id,'community_post_published','community_post',v_post.id,v_post.title,'Published a Community post.','info',jsonb_build_object('audience_type',v_post.audience_type,'course_id',v_post.course_id,'cohort_id',v_post.cohort_id));
  return v_post;
end $$;

create or replace function public.archive_community_post(p_post_id uuid)
returns public.community_posts language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_existing public.community_posts%rowtype; v_post public.community_posts%rowtype;
begin
  select * into v_existing from public.community_posts where id=p_post_id for update;
  if not found or v_existing.status<>'published' then raise exception 'Only published Community posts can be archived.' using errcode='22023'; end if;
  if not exists(select 1 from coachfort_internal.community_team_authorization_context(v_existing.tenant_id,v_existing.audience_type,v_existing.course_id,v_existing.cohort_id)) then raise exception 'Community moderation access denied.' using errcode='42501'; end if;
  update public.community_posts set status='archived',archived_at=now() where id=p_post_id returning * into v_post;
  perform public.m69_5_write_audit(v_post.tenant_id,'community_post_archived','community_post',v_post.id,v_post.title,'Archived a Community post.','info','{}'::jsonb);
  return v_post;
end $$;

create or replace function public.hide_community_post(p_post_id uuid)
returns public.community_posts language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_existing public.community_posts%rowtype; v_post public.community_posts%rowtype;
begin
  select * into v_existing from public.community_posts where id=p_post_id for update;
  if not found or v_existing.status not in ('draft','published') then raise exception 'Community post cannot be hidden from its current state.' using errcode='22023'; end if;
  if not exists(select 1 from coachfort_internal.community_team_authorization_context(v_existing.tenant_id,v_existing.audience_type,v_existing.course_id,v_existing.cohort_id)) then raise exception 'Community moderation access denied.' using errcode='42501'; end if;
  update public.community_posts set status='hidden',hidden_at=now(),hidden_by_user_id=auth.uid() where id=p_post_id returning * into v_post;
  perform public.m69_5_write_audit(v_post.tenant_id,'community_post_hidden','community_post',v_post.id,v_post.title,'Hid a Community post.','warning','{}'::jsonb);
  return v_post;
end $$;

create or replace function public.hide_community_comment(p_comment_id uuid)
returns uuid language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_comment public.community_comments%rowtype; v_post public.community_posts%rowtype;
begin
  select * into v_comment from public.community_comments where id=p_comment_id for update;
  if not found or v_comment.status<>'published' then raise exception 'Published Community comment required.' using errcode='22023'; end if;
  select * into v_post from public.community_posts where id=v_comment.post_id;
  if not exists(select 1 from coachfort_internal.community_team_authorization_context(v_post.tenant_id,v_post.audience_type,v_post.course_id,v_post.cohort_id)) then raise exception 'Community moderation access denied.' using errcode='42501'; end if;
  update public.community_comments set status='hidden',hidden_by_user_id=auth.uid(),hidden_at=now() where id=p_comment_id;
  perform public.m69_5_write_audit(v_post.tenant_id,'community_comment_hidden','community_comment',v_comment.id,'Community comment','Hid a Community comment.','warning',jsonb_build_object('post_id',v_post.id));
  return v_comment.id;
end $$;

do $$
declare r record; v_unexpected text;
begin
  for r in
    select expected.identity,pg_catalog.to_regprocedure(expected.identity) as procedure_oid
    from (values
      ('public.get_student_community_posts()'),
      ('public.get_student_community_comments(uuid)'),
      ('public.create_student_community_comment(uuid,text)'),
      ('public.get_team_community_posts(uuid)'),
      ('public.get_team_community_comments(uuid)'),
      ('public.update_team_community_post(uuid,text,text,text)'),
      ('public.publish_community_post(uuid)'),
      ('public.archive_community_post(uuid)'),
      ('public.hide_community_post(uuid)'),
      ('public.create_team_community_comment(uuid,text)'),
      ('public.hide_community_comment(uuid)'),
      ('public.get_student_community_posts_v2(uuid,uuid,integer,timestamp with time zone,uuid)'),
      ('public.get_student_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),
      ('public.create_student_community_post_v2(uuid,uuid,text,text,text)'),
      ('public.get_team_community_posts_v2(uuid,uuid,uuid,text,integer,timestamp with time zone,uuid)'),
      ('public.get_team_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),
      ('public.create_team_community_post_v2(uuid,uuid,uuid,text,text,text)')
    ) expected(identity)
  loop
    if r.procedure_oid is null then
      raise exception 'UX-7E apply failed: expected Community identity missing: %.',r.identity using errcode='55000';
    end if;
    execute format('alter function %s owner to postgres',r.procedure_oid::regprocedure);
    execute format('revoke all on function %s from public, anon, authenticated, service_role',r.procedure_oid::regprocedure);
    execute format('grant execute on function %s to authenticated',r.procedure_oid::regprocedure);
  end loop;

  select string_agg(p.oid::regprocedure::text,', ' order by p.oid::regprocedure::text) into v_unexpected
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'get_student_community_posts','get_student_community_comments','create_student_community_comment','create_student_community_post',
      'get_team_community_posts','get_team_community_comments','create_team_community_post','update_team_community_post',
      'publish_community_post','archive_community_post','hide_community_post','create_team_community_comment','hide_community_comment',
      'get_student_community_posts_v2','get_student_community_comments_v2','create_student_community_post_v2',
      'get_team_community_posts_v2','get_team_community_comments_v2','create_team_community_post_v2'
    )
    and p.oid not in (
      select pg_catalog.to_regprocedure(expected.identity)
      from (values
        ('public.get_student_community_posts()'),('public.get_student_community_comments(uuid)'),
        ('public.create_student_community_comment(uuid,text)'),
        ('public.get_team_community_posts(uuid)'),('public.get_team_community_comments(uuid)'),
        ('public.update_team_community_post(uuid,text,text,text)'),
        ('public.publish_community_post(uuid)'),('public.archive_community_post(uuid)'),('public.hide_community_post(uuid)'),
        ('public.create_team_community_comment(uuid,text)'),('public.hide_community_comment(uuid)'),
        ('public.get_student_community_posts_v2(uuid,uuid,integer,timestamp with time zone,uuid)'),
        ('public.get_student_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),
        ('public.create_student_community_post_v2(uuid,uuid,text,text,text)'),
        ('public.get_team_community_posts_v2(uuid,uuid,uuid,text,integer,timestamp with time zone,uuid)'),
        ('public.get_team_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),
        ('public.create_team_community_post_v2(uuid,uuid,uuid,text,text,text)')
      ) expected(identity)
    );
  if v_unexpected is not null then raise exception 'UX-7E apply failed: unexpected Community overloads: %.',v_unexpected using errcode='55000'; end if;
end $$;

revoke all on function public.m76b_has_active_student_portal_tenant(uuid) from public,anon,authenticated,service_role;
revoke all on function public.m76b_current_team_role(uuid) from public,anon,authenticated,service_role;
revoke all on function public.m76b_assert_team_can_create(uuid) from public,anon,authenticated,service_role;
revoke all on function public.m76b_assert_team_can_moderate(uuid) from public,anon,authenticated,service_role;
revoke all on function public.m76b_student_context() from public,anon,authenticated,service_role;

select pg_catalog.pg_notify('pgrst','reload schema');
commit;

/* POST-APPLY READ-ONLY VERIFICATION
with
schema_contract as (
  select jsonb_build_object(
    'scope_columns', count(*) filter(where column_name in ('course_id','cohort_id'))=2,
    'student_author_column', count(*) filter(where column_name='created_by_student_id')=1,
    'moderator_column', count(*) filter(where column_name='hidden_by_user_id')=1,
    'author_type_preserved', count(*) filter(where column_name='author_type')=1,
    'author_display_name_preserved', count(*) filter(where column_name='author_display_name')=1,
    'student_author_fk_preserved',exists(select 1 from pg_catalog.pg_constraint con where con.conrelid='public.community_posts'::regclass and con.conname='community_posts_created_by_student_id_fkey' and con.contype='f' and con.confrelid='public.students'::regclass and pg_catalog.pg_get_constraintdef(con.oid) like '%ON DELETE SET NULL%'),
    'moderator_fk_preserved',exists(select 1 from pg_catalog.pg_constraint con where con.conrelid='public.community_posts'::regclass and con.conname='community_posts_hidden_by_user_id_fkey' and con.contype='f' and con.confrelid='auth.users'::regclass and pg_catalog.pg_get_constraintdef(con.oid) like '%ON DELETE SET NULL%'),
    'author_identity_constraint',exists(select 1 from pg_catalog.pg_constraint con where con.conrelid='public.community_posts'::regclass and con.conname='community_posts_author_identity_check' and con.contype='c'
      and regexp_replace(lower(pg_catalog.pg_get_constraintdef(con.oid)),'[[:space:]]+','','g') like '%author_type%team%'
      and regexp_replace(lower(pg_catalog.pg_get_constraintdef(con.oid)),'[[:space:]]+','','g') like '%author_type%student%'
      and regexp_replace(lower(pg_catalog.pg_get_constraintdef(con.oid)),'[[:space:]]+','','g') like '%created_by_student_idisnull%'
      and regexp_replace(lower(pg_catalog.pg_get_constraintdef(con.oid)),'[[:space:]]+','','g') like '%created_by_student_idisnotnull%'
      and regexp_replace(lower(pg_catalog.pg_get_constraintdef(con.oid)),'[[:space:]]+','','g') like '%created_by_user_idisnotnull%'),
    'rls_enabled', (select bool_and(c.relrowsecurity and not c.relforcerowsecurity) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('community_posts','community_comments')),
    'community_policies', (select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('community_posts','community_comments'))
  ) value
  from information_schema.columns where table_schema='public' and table_name='community_posts'
),
community_data as (
  select jsonb_build_object(
    'posts',(select count(*) from public.community_posts),
    'comments',(select count(*) from public.community_comments),
    'legacy_all_students_posts',(select count(*) from public.community_posts where audience_type='all_students')
  ) value
),
functions as (
  select jsonb_build_object(
    'legacy_count',count(*) filter(where expected.kind='legacy' and p.oid is not null),
    'v2_count',count(*) filter(where expected.kind='v2' and p.oid is not null),
    'security_definer',bool_and(coalesce(p.prosecdef,false)),
    'safe_search_path',bool_and(coalesce(array_to_string(p.proconfig,','),'') like '%search_path=public, pg_temp%'),
    'authenticated_execute',bool_and(coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false)),
    'public_revoked',bool_and(not coalesce(has_function_privilege('public',p.oid,'EXECUTE'),true)),
    'anon_revoked',bool_and(not coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),true)),
    'service_revoked',bool_and(not coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),true)),
    'legacy_student_create_absent',pg_catalog.to_regprocedure('public.create_student_community_post(uuid,text,text,text)') is null,
    'legacy_team_create_absent',pg_catalog.to_regprocedure('public.create_team_community_post(uuid,text,text,text)') is null,
    'unexpected_overloads',(select count(*) from pg_catalog.pg_proc extra join pg_catalog.pg_namespace en on en.oid=extra.pronamespace
      where en.nspname='public' and extra.proname in (
        'get_student_community_posts','get_student_community_comments','create_student_community_comment','create_student_community_post',
        'get_team_community_posts','get_team_community_comments','create_team_community_post','update_team_community_post',
        'publish_community_post','archive_community_post','hide_community_post','create_team_community_comment','hide_community_comment',
        'get_student_community_posts_v2','get_student_community_comments_v2','create_student_community_post_v2',
        'get_team_community_posts_v2','get_team_community_comments_v2','create_team_community_post_v2'
      ) and extra.oid not in (select pg_catalog.to_regprocedure(e.identity) from (values
        ('public.get_student_community_posts()'),('public.get_student_community_comments(uuid)'),('public.create_student_community_comment(uuid,text)'),
        ('public.get_team_community_posts(uuid)'),('public.get_team_community_comments(uuid)'),('public.update_team_community_post(uuid,text,text,text)'),
        ('public.publish_community_post(uuid)'),('public.archive_community_post(uuid)'),('public.hide_community_post(uuid)'),('public.create_team_community_comment(uuid,text)'),('public.hide_community_comment(uuid)'),
        ('public.get_student_community_posts_v2(uuid,uuid,integer,timestamp with time zone,uuid)'),('public.get_student_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),
        ('public.create_student_community_post_v2(uuid,uuid,text,text,text)'),('public.get_team_community_posts_v2(uuid,uuid,uuid,text,integer,timestamp with time zone,uuid)'),
        ('public.get_team_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),('public.create_team_community_post_v2(uuid,uuid,uuid,text,text,text)')
      ) e(identity)))
  ) value
  from (values
    ('legacy','public.get_student_community_posts()'),('legacy','public.get_student_community_comments(uuid)'),('legacy','public.create_student_community_comment(uuid,text)'),
    ('legacy','public.get_team_community_posts(uuid)'),('legacy','public.get_team_community_comments(uuid)'),('legacy','public.update_team_community_post(uuid,text,text,text)'),
    ('legacy','public.publish_community_post(uuid)'),('legacy','public.archive_community_post(uuid)'),('legacy','public.hide_community_post(uuid)'),('legacy','public.create_team_community_comment(uuid,text)'),('legacy','public.hide_community_comment(uuid)'),
    ('v2','public.get_student_community_posts_v2(uuid,uuid,integer,timestamp with time zone,uuid)'),('v2','public.get_student_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),
    ('v2','public.create_student_community_post_v2(uuid,uuid,text,text,text)'),('v2','public.get_team_community_posts_v2(uuid,uuid,uuid,text,integer,timestamp with time zone,uuid)'),
    ('v2','public.get_team_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),('v2','public.create_team_community_post_v2(uuid,uuid,uuid,text,text,text)')
  ) expected(kind,identity)
  left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(expected.identity)
),
private_functions as (
  select jsonb_build_object(
    'count',count(*),'owner_postgres',bool_and(pg_catalog.pg_get_userbyid(p.proowner)='postgres'),
    'security_definer',bool_and(p.prosecdef),'stable_or_trigger',bool_and(p.provolatile in ('s','v')),
    'public_revoked',bool_and(not has_function_privilege('public',p.oid,'EXECUTE')),
    'anon_revoked',bool_and(not has_function_privilege('anon',p.oid,'EXECUTE')),
    'authenticated_revoked',bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE')),
    'service_revoked',bool_and(not has_function_privilege('service_role',p.oid,'EXECUTE'))
  ) value
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='coachfort_internal' and p.proname like '%community%'
),
source_contract as (
  select jsonb_build_object(
    'auth_bound_student',bool_and(definition like '%auth.uid()%') filter(where identity in ('community_student_scope_access','community_student_post_access','create_student_community_comment')),
    'canonical_portal_access',bool_or(definition like '%student_portal_access_allowed_for_user%'),
    'course_participate_write',bool_or(definition like '%course_participate%'),
    'exact_cohort_membership',bool_or(definition like '%cm.cohort_id=p_cohort_id%'),
    'exact_comment_student_scope',bool_or(
      identity='create_student_community_comment'
      and definition like '%community_student_scope_access(v_post.tenant_id,spa.student_id,auth.uid(),v_post.course_id,v_post.cohort_id,''write'')%'
    ),
    'delegation',bool_or(definition like '%find_active_delegated_permission_for_action%'),
    'owner_admin',bool_or(definition like '%v_rolein(''owner'',''admin'')%'),
    'trainer_course_scope',bool_or(definition like '%ux4b_trainer_can_manage_course%'),
    'trainer_cohort_scope',bool_or(definition like '%ux4b_trainer_can_manage_cohort%'),
    'completed_cutoff',bool_or(definition like '%published_at<=e.completed_at%'),
    'notification_as_access',bool_or(definition like '%notifications%'),
    'v2_profile_author_source',bool_and(definition like '%public.profiles%') filter(where identity in ('get_student_community_posts_v2','get_team_community_posts_v2','get_student_community_comments_v2','get_team_community_comments_v2')),
    'v2_student_author_source',bool_and(definition like '%public.students%') filter(where identity in ('get_student_community_posts_v2','get_team_community_posts_v2','get_student_community_comments_v2','get_team_community_comments_v2')),
    'v2_author_display_name_source',bool_or(definition like '%author_display_name%') filter(where identity in ('get_student_community_posts_v2','get_team_community_posts_v2','get_student_community_comments_v2','get_team_community_comments_v2'))
  ) value
  from (
    select expected.identity,regexp_replace(lower(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(expected.signature))),'[[:space:]]+','','g') definition
    from (values
      ('community_student_scope_access','coachfort_internal.community_student_scope_access(uuid,uuid,uuid,uuid,uuid,text)'),
      ('community_student_post_access','coachfort_internal.community_student_post_access(uuid,uuid,text)'),
      ('community_team_authorization_context','coachfort_internal.community_team_authorization_context(uuid,text,uuid,uuid)'),
      ('create_student_community_comment','public.create_student_community_comment(uuid,text)'),
      ('get_student_community_posts_v2','public.get_student_community_posts_v2(uuid,uuid,integer,timestamp with time zone,uuid)'),
      ('get_team_community_posts_v2','public.get_team_community_posts_v2(uuid,uuid,uuid,text,integer,timestamp with time zone,uuid)'),
      ('get_student_community_comments_v2','public.get_student_community_comments_v2(uuid,integer,timestamp with time zone,uuid)'),
      ('get_team_community_comments_v2','public.get_team_community_comments_v2(uuid,integer,timestamp with time zone,uuid)')
    ) expected(identity,signature)
  ) f
),
browser_grants as (
  select jsonb_build_object(
    'writes',count(*) filter(where grantee in ('PUBLIC','anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')),
    'dangerous',count(*) filter(where grantee in ('PUBLIC','anon','authenticated') and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'))
  ) value
  from information_schema.role_table_grants where table_schema='public' and table_name in ('community_posts','community_comments')
),
feature_gate as (
  select jsonb_build_object(
    'module62_key', 'community_hub'=any(public.feature_access_allowed_keys()),
    'subscription_key', 'community_hub'=any(public.subscription_entitlements_feature_keys()),
    'messages_plan_count',(select count(*) from public.subscription_plan_feature_entitlements where feature_key='messages'),
    'community_plan_count',(select count(*) from public.subscription_plan_feature_entitlements where feature_key='community_hub'),
    'missing_community_plan_rows',(select count(*) from public.subscription_plan_feature_entitlements m left join public.subscription_plan_feature_entitlements c on c.plan_id=m.plan_id and c.feature_key='community_hub' where m.feature_key='messages' and c.id is null),
    'missing_messages_plan_rows',(select count(*) from public.subscription_plan_feature_entitlements c left join public.subscription_plan_feature_entitlements m on m.plan_id=c.plan_id and m.feature_key='messages' where c.feature_key='community_hub' and m.id is null),
    'plan_parity',not exists(select 1 from public.subscription_plan_feature_entitlements m left join public.subscription_plan_feature_entitlements c on c.plan_id=m.plan_id and c.feature_key='community_hub' where m.feature_key='messages' and (c.id is null or (c.entitlement_status,c.requires_platform_approval,c.included_quota) is distinct from (m.entitlement_status,m.requires_platform_approval,m.included_quota))),
    'messages_tenant_setting_count',(select count(*) from public.tenant_feature_settings where feature_key='messages'),
    'community_tenant_setting_count',(select count(*) from public.tenant_feature_settings where feature_key='community_hub'),
    'missing_community_tenant_twins',(select count(*) from public.tenant_feature_settings m left join public.tenant_feature_settings c on c.tenant_id=m.tenant_id and c.feature_key='community_hub' where m.feature_key='messages' and c.tenant_id is null),
    'missing_messages_tenant_twins',(select count(*) from public.tenant_feature_settings c left join public.tenant_feature_settings m on m.tenant_id=c.tenant_id and m.feature_key='messages' where c.feature_key='community_hub' and m.tenant_id is null),
    'tenant_status_mismatches',(select count(*) from public.tenant_feature_settings m join public.tenant_feature_settings c on c.tenant_id=m.tenant_id and c.feature_key='community_hub' where m.feature_key='messages' and c.status is distinct from m.status),
    'tenant_cutover_marked',not exists(select 1 from public.tenant_feature_settings c where c.feature_key='community_hub' and coalesce(c.metadata_json->>'ux7e_copied_from','')<>'messages')
  ) value
),
baselines as (
  select jsonb_build_object(
    'community', (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%community%'),
    'announcements', (select count(*) from (values
      ('public.get_student_announcements_v2(integer,timestamp with time zone,uuid)'),
      ('public.get_student_announcement_v2(uuid)'),
      ('public.get_team_announcements_v2(uuid,text,text,integer,timestamp with time zone,uuid)'),
      ('public.get_team_announcement_v2(uuid,uuid)'),
      ('public.create_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
      ('public.update_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
      ('public.publish_academy_announcement_v2(uuid)'),
      ('public.archive_academy_announcement_v2(uuid)'),
      ('public.delete_draft_academy_announcement_v2(uuid)')
    ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null),
    'academy_chat', (select count(*) from (values
      ('public.get_team_chat_threads(uuid)'), ('public.get_team_chat_thread(uuid)'),
      ('public.get_student_chat_threads()'), ('public.get_student_chat_thread(uuid)'),
      ('public.add_default_team_chat_participants(uuid,uuid,uuid,uuid)'),
      ('public.create_student_direct_chat(uuid,uuid,text,text)'),
      ('public.create_student_support_thread(text,text)'), ('public.send_team_chat_message(uuid,text)'),
      ('public.send_student_chat_message(uuid,text)'), ('public.close_chat_thread(uuid)'),
      ('public.mark_chat_thread_read(uuid)')
    ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null)
  ) value
),
result as (
  select jsonb_build_object(
    'schema',(select value from schema_contract),'community_data',(select value from community_data),'public_functions',(select value from functions),
    'private_functions',(select value from private_functions),'source_contract',(select value from source_contract),
    'student_access',jsonb_build_object(
      'auth_bound',(select (value->>'auth_bound_student')::boolean from source_contract),
      'program_read',(select (value->>'canonical_portal_access')::boolean from source_contract),
      'program_write',(select (value->>'canonical_portal_access')::boolean and (value->>'course_participate_write')::boolean from source_contract),
      'cohort_read',(select (value->>'canonical_portal_access')::boolean and (value->>'exact_cohort_membership')::boolean from source_contract),
      'cohort_write',(select (value->>'course_participate_write')::boolean and (value->>'exact_cohort_membership')::boolean from source_contract),
      'exact_comment_author',(select (value->>'exact_comment_student_scope')::boolean from source_contract),
      'completed_read_only',(select (value->>'completed_cutoff')::boolean from source_contract),
      'notification_as_access',(select (value->>'notification_as_access')::boolean from source_contract)
    ),
    'coach_access',jsonb_build_object(
      'owner_admin',(select (value->>'owner_admin')::boolean from source_contract),
      'staff_delegated',(select (value->>'delegation')::boolean from source_contract),
      'trainer_course_scope',(select (value->>'delegation')::boolean and (value->>'trainer_course_scope')::boolean from source_contract),
      'trainer_cohort_scope',(select (value->>'delegation')::boolean and (value->>'trainer_cohort_scope')::boolean from source_contract)
    ),
    'browser_grants',(select value from browser_grants),'feature_gate',(select value from feature_gate),
    'community_baseline',(select value->'community' from baselines),'announcement_baseline',(select value->'announcements' from baselines),'chat_baseline',(select value->'academy_chat' from baselines)
  ) value
)
select value || jsonb_build_object('security_gate',
  (value->'schema'->>'scope_columns')::boolean and (value->'schema'->>'rls_enabled')::boolean
  and (value->'schema'->>'student_author_column')::boolean
  and (value->'schema'->>'moderator_column')::boolean
  and (value->'schema'->>'author_type_preserved')::boolean
  and (value->'schema'->>'author_display_name_preserved')::boolean
  and (value->'schema'->>'student_author_fk_preserved')::boolean
  and (value->'schema'->>'moderator_fk_preserved')::boolean
  and (value->'schema'->>'author_identity_constraint')::boolean
  and (value->'schema'->>'community_policies')::integer=0
  and (value->'community_data'->>'posts')::integer=0
  and (value->'community_data'->>'comments')::integer=0
  and (value->'community_data'->>'legacy_all_students_posts')::integer=0
  and (value->'public_functions'->>'legacy_count')::integer=11
  and (value->'public_functions'->>'v2_count')::integer=6
  and (value->'public_functions'->>'unexpected_overloads')::integer=0
  and (value->'public_functions'->>'legacy_student_create_absent')::boolean
  and (value->'public_functions'->>'legacy_team_create_absent')::boolean
  and (value->'public_functions'->>'security_definer')::boolean
  and (value->'public_functions'->>'safe_search_path')::boolean
  and (value->'public_functions'->>'authenticated_execute')::boolean
  and (value->'public_functions'->>'public_revoked')::boolean and (value->'public_functions'->>'anon_revoked')::boolean
  and (value->'public_functions'->>'service_revoked')::boolean
  and (value->'private_functions'->>'count')::integer=5
  and (value->'private_functions'->>'owner_postgres')::boolean
  and (value->'private_functions'->>'security_definer')::boolean
  and (value->'private_functions'->>'stable_or_trigger')::boolean
  and (value->'private_functions'->>'public_revoked')::boolean
  and (value->'private_functions'->>'anon_revoked')::boolean
  and (value->'private_functions'->>'authenticated_revoked')::boolean
  and (value->'private_functions'->>'service_revoked')::boolean
  and (value->'source_contract'->>'auth_bound_student')::boolean
  and (value->'source_contract'->>'canonical_portal_access')::boolean
  and (value->'source_contract'->>'course_participate_write')::boolean
  and (value->'source_contract'->>'exact_cohort_membership')::boolean
  and (value->'source_contract'->>'exact_comment_student_scope')::boolean
  and (value->'source_contract'->>'owner_admin')::boolean
  and (value->'source_contract'->>'delegation')::boolean
  and (value->'source_contract'->>'trainer_course_scope')::boolean
  and (value->'source_contract'->>'trainer_cohort_scope')::boolean
  and (value->'source_contract'->>'completed_cutoff')::boolean
  and not (value->'source_contract'->>'notification_as_access')::boolean
  and (value->'source_contract'->>'v2_profile_author_source')::boolean
  and (value->'source_contract'->>'v2_student_author_source')::boolean
  and not (value->'source_contract'->>'v2_author_display_name_source')::boolean
  and (value->'browser_grants'->>'writes')::integer=0 and (value->'browser_grants'->>'dangerous')::integer=0
  and (value->'feature_gate'->>'module62_key')::boolean
  and (value->'feature_gate'->>'subscription_key')::boolean
  and (value->'feature_gate'->>'messages_plan_count')::integer>0
  and (value->'feature_gate'->>'messages_plan_count')::integer=(value->'feature_gate'->>'community_plan_count')::integer
  and (value->'feature_gate'->>'missing_community_plan_rows')::integer=0
  and (value->'feature_gate'->>'missing_messages_plan_rows')::integer=0
  and (value->'feature_gate'->>'plan_parity')::boolean
  and (value->'feature_gate'->>'messages_tenant_setting_count')::integer=(value->'feature_gate'->>'community_tenant_setting_count')::integer
  and (value->'feature_gate'->>'missing_community_tenant_twins')::integer=0
  and (value->'feature_gate'->>'missing_messages_tenant_twins')::integer=0
  and (value->'feature_gate'->>'tenant_status_mismatches')::integer=0
  and (value->'feature_gate'->>'tenant_cutover_marked')::boolean
  and (value->>'announcement_baseline')::integer=9
  and (value->>'chat_baseline')::integer=11
) as ux7e_post_apply from result;
*/
