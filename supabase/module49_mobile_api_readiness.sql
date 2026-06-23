-- Module 49: Mobile API readiness
-- Additive only. Run after Module 48 public website builder.

create or replace function public.mobile_tenant_branding_json(tenant_row public.tenants)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', tenant_row.id,
    'name', tenant_row.name,
    'slug', tenant_row.slug,
    'workspace_display_name', coalesce(nullif(tenant_row.workspace_display_name, ''), tenant_row.name),
    'brand_name', coalesce(nullif(tenant_row.brand_name, ''), nullif(tenant_row.workspace_display_name, ''), tenant_row.name),
    'brand_tagline', tenant_row.brand_tagline,
    'logo_url', tenant_row.logo_url,
    'icon_url', tenant_row.icon_url,
    'brand_color', coalesce(tenant_row.brand_color, '#145da0'),
    'accent_color', tenant_row.accent_color,
    'student_portal_theme_color', coalesce(tenant_row.student_portal_theme_color, tenant_row.brand_color, '#145da0'),
    'show_powered_by', coalesce(tenant_row.show_powered_by, true),
    'support_email', tenant_row.support_email,
    'support_phone', tenant_row.support_phone,
    'website_url', tenant_row.website_url
  );
$$;

create or replace function public.mobile_team_sections_json(check_role text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case check_role
    when 'owner' then jsonb_build_array(
      'dashboard', 'students', 'courses', 'cohorts', 'sessions', 'attendance',
      'assignments', 'payments', 'notifications', 'messages', 'reports',
      'operations', 'compliance', 'backup', 'settings'
    )
    when 'admin' then jsonb_build_array(
      'dashboard', 'students', 'courses', 'cohorts', 'sessions', 'attendance',
      'assignments', 'payments', 'notifications', 'messages', 'reports',
      'operations', 'compliance', 'backup', 'settings'
    )
    when 'staff' then jsonb_build_array(
      'dashboard', 'students', 'sessions', 'attendance', 'payments',
      'notifications', 'messages'
    )
    when 'trainer' then jsonb_build_array(
      'dashboard', 'courses', 'cohorts', 'sessions', 'attendance',
      'assignments', 'notifications', 'messages'
    )
    else '[]'::jsonb
  end;
$$;

create or replace function public.mobile_role_permissions_json(check_role text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case check_role
    when 'owner' then jsonb_build_object(
      'can_manage_workspace', true,
      'can_manage_team', true,
      'can_manage_students', true,
      'can_manage_courses', true,
      'can_manage_attendance', true,
      'can_manage_payments', true,
      'can_view_reports', true,
      'can_view_compliance', true
    )
    when 'admin' then jsonb_build_object(
      'can_manage_workspace', true,
      'can_manage_team', false,
      'can_manage_students', true,
      'can_manage_courses', true,
      'can_manage_attendance', true,
      'can_manage_payments', true,
      'can_view_reports', true,
      'can_view_compliance', true
    )
    when 'staff' then jsonb_build_object(
      'can_manage_workspace', false,
      'can_manage_team', false,
      'can_manage_students', true,
      'can_manage_courses', false,
      'can_manage_attendance', false,
      'can_manage_payments', false,
      'can_view_reports', false,
      'can_view_compliance', false
    )
    when 'trainer' then jsonb_build_object(
      'can_manage_workspace', false,
      'can_manage_team', false,
      'can_manage_students', true,
      'can_manage_courses', false,
      'can_manage_attendance', true,
      'can_manage_payments', false,
      'can_view_reports', false,
      'can_view_compliance', false
    )
    else '{}'::jsonb
  end;
$$;

create or replace function public.get_mobile_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  team_context record;
  student_context record;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select
    tm.tenant_id,
    tm.role,
    t,
    p.full_name,
    p.email,
    p.avatar_url
  into team_context
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  left join public.profiles p on p.id = tm.user_id
  where tm.user_id = actor_id
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  order by tm.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'mode', 'team',
      'user', jsonb_build_object(
        'id', actor_id,
        'full_name', team_context.full_name,
        'email', team_context.email,
        'avatar_url', team_context.avatar_url
      ),
      'tenant', public.mobile_tenant_branding_json(team_context.t),
      'role', team_context.role,
      'permissions', public.mobile_role_permissions_json(team_context.role),
      'sections', public.mobile_team_sections_json(team_context.role),
      'unread_notifications', (
        select count(*)
        from public.notifications n
        where n.tenant_id = team_context.tenant_id
          and n.user_id = actor_id
          and n.status = 'unread'
      )
    );
  end if;

  select
    spa.tenant_id,
    spa.student_id,
    spa.email as portal_email,
    s.full_name as student_name,
    s.email as student_email,
    s.phone as student_phone,
    s.status as student_status,
    t,
    p.full_name,
    p.email,
    p.avatar_url
  into student_context
  from public.student_portal_accounts spa
  join public.students s on s.id = spa.student_id and s.tenant_id = spa.tenant_id
  join public.tenants t on t.id = spa.tenant_id
  left join public.profiles p on p.id = spa.user_id
  where spa.user_id = actor_id
    and spa.status = 'active'
    and coalesce(s.portal_enabled, true) = true
    and s.status = 'active'
  order by spa.linked_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'mode', 'student',
      'user', jsonb_build_object(
        'id', actor_id,
        'full_name', student_context.full_name,
        'email', student_context.email,
        'avatar_url', student_context.avatar_url
      ),
      'tenant', public.mobile_tenant_branding_json(student_context.t),
      'student', jsonb_build_object(
        'id', student_context.student_id,
        'full_name', student_context.student_name,
        'email', coalesce(student_context.student_email, student_context.portal_email),
        'phone', student_context.student_phone,
        'status', student_context.student_status
      ),
      'sections', jsonb_build_array(
        'home', 'courses', 'sessions', 'assignments',
        'certificates', 'payments', 'notifications', 'profile'
      ),
      'unread_notifications', (
        select count(*)
        from public.notifications n
        where n.tenant_id = student_context.tenant_id
          and n.user_id = actor_id
          and n.status = 'unread'
      )
    );
  end if;

  return jsonb_build_object(
    'mode', 'none',
    'user', jsonb_build_object('id', actor_id),
    'sections', '[]'::jsonb,
    'unread_notifications', 0
  );
end;
$$;

create or replace function public.get_mobile_student_home()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  ctx record;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select
    spa.tenant_id,
    spa.student_id,
    s.full_name,
    s.email,
    s.phone,
    s.status,
    t
  into ctx
  from public.student_portal_accounts spa
  join public.students s on s.id = spa.student_id and s.tenant_id = spa.tenant_id
  join public.tenants t on t.id = spa.tenant_id
  where spa.user_id = actor_id
    and spa.status = 'active'
    and coalesce(s.portal_enabled, true) = true
    and s.status = 'active'
  order by spa.linked_at asc
  limit 1;

  if not found then
    raise exception 'Linked student portal account required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tenant', public.mobile_tenant_branding_json(ctx.t),
    'profile', jsonb_build_object(
      'student_id', ctx.student_id,
      'full_name', ctx.full_name,
      'email', ctx.email,
      'phone', ctx.phone,
      'status', ctx.status
    ),
    'summary', jsonb_build_object(
      'enrolled_course_count', (
        select count(*)
        from public.enrollments e
        where e.tenant_id = ctx.tenant_id
          and e.student_id = ctx.student_id
          and e.status = 'active'
      ),
      'upcoming_session_count', (
        select count(*)
        from public.sessions s
        where s.tenant_id = ctx.tenant_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
          and (
            exists (
              select 1 from public.enrollments e
              where e.tenant_id = ctx.tenant_id
                and e.student_id = ctx.student_id
                and e.course_id = s.course_id
                and e.status = 'active'
            )
            or exists (
              select 1 from public.cohort_members cm
              where cm.tenant_id = ctx.tenant_id
                and cm.student_id = ctx.student_id
                and cm.cohort_id = s.cohort_id
            )
          )
      ),
      'pending_assignment_count', (
        select count(*)
        from public.assignments a
        where a.tenant_id = ctx.tenant_id
          and a.status = 'published'
          and (a.due_at is null or a.due_at >= now())
          and (
            exists (
              select 1 from public.enrollments e
              where e.tenant_id = ctx.tenant_id
                and e.student_id = ctx.student_id
                and e.course_id = a.course_id
                and e.status = 'active'
            )
            or exists (
              select 1 from public.cohort_members cm
              where cm.tenant_id = ctx.tenant_id
                and cm.student_id = ctx.student_id
                and cm.cohort_id = a.cohort_id
            )
          )
          and not exists (
            select 1 from public.assignment_submissions sub
            where sub.tenant_id = ctx.tenant_id
              and sub.assignment_id = a.id
              and sub.student_id = ctx.student_id
              and sub.status in ('submitted', 'reviewed', 'late')
          )
      ),
      'pending_payment_count', (
        select count(*)
        from public.payment_links pl
        where pl.tenant_id = ctx.tenant_id
          and pl.student_id = ctx.student_id
          and pl.status in ('created', 'sent')
      ),
      'unread_notification_count', (
        select count(*)
        from public.notifications n
        where n.tenant_id = ctx.tenant_id
          and n.user_id = actor_id
          and n.status = 'unread'
      )
    ),
    'upcoming_sessions', coalesce((
      select jsonb_agg(session_item order by session_item ->> 'scheduled_start_at')
      from (
        select jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'scheduled_start_at', s.scheduled_start_at,
          'scheduled_end_at', s.scheduled_end_at,
          'delivery_mode', s.delivery_mode,
          'meeting_provider', s.meeting_provider,
          'meeting_url', s.meeting_url,
          'course_title', c.title,
          'cohort_name', coh.name
        ) as session_item
        from public.sessions s
        left join public.courses c on c.id = s.course_id and c.tenant_id = s.tenant_id
        left join public.cohorts coh on coh.id = s.cohort_id and coh.tenant_id = s.tenant_id
        where s.tenant_id = ctx.tenant_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
          and (
            exists (
              select 1 from public.enrollments e
              where e.tenant_id = ctx.tenant_id
                and e.student_id = ctx.student_id
                and e.course_id = s.course_id
                and e.status = 'active'
            )
            or exists (
              select 1 from public.cohort_members cm
              where cm.tenant_id = ctx.tenant_id
                and cm.student_id = ctx.student_id
                and cm.cohort_id = s.cohort_id
            )
          )
        order by s.scheduled_start_at asc
        limit 8
      ) q
    ), '[]'::jsonb),
    'pending_assignments', coalesce((
      select jsonb_agg(assignment_item order by assignment_item ->> 'due_at')
      from (
        select jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'due_at', a.due_at,
          'status', a.status,
          'course_title', c.title,
          'cohort_name', coh.name
        ) as assignment_item
        from public.assignments a
        left join public.courses c on c.id = a.course_id and c.tenant_id = a.tenant_id
        left join public.cohorts coh on coh.id = a.cohort_id and coh.tenant_id = a.tenant_id
        where a.tenant_id = ctx.tenant_id
          and a.status = 'published'
          and (
            exists (
              select 1 from public.enrollments e
              where e.tenant_id = ctx.tenant_id
                and e.student_id = ctx.student_id
                and e.course_id = a.course_id
                and e.status = 'active'
            )
            or exists (
              select 1 from public.cohort_members cm
              where cm.tenant_id = ctx.tenant_id
                and cm.student_id = ctx.student_id
                and cm.cohort_id = a.cohort_id
            )
          )
          and not exists (
            select 1 from public.assignment_submissions sub
            where sub.tenant_id = ctx.tenant_id
              and sub.assignment_id = a.id
              and sub.student_id = ctx.student_id
              and sub.status in ('submitted', 'reviewed', 'late')
          )
        order by a.due_at asc nulls last
        limit 8
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_mobile_trainer_home()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  ctx record;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select tm.tenant_id, tm.role, t
  into ctx
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = actor_id
    and tm.role = 'trainer'
  order by tm.created_at asc
  limit 1;

  if not found then
    raise exception 'Trainer team role required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tenant', public.mobile_tenant_branding_json(ctx.t),
    'role', ctx.role,
    'summary', jsonb_build_object(
      'upcoming_session_count', (
        select count(*)
        from public.sessions s
        where s.tenant_id = ctx.tenant_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
          and (
            s.trainer_user_id = actor_id
            or exists (
              select 1 from public.trainer_course_assignments tca
              where tca.tenant_id = ctx.tenant_id
                and tca.trainer_user_id = actor_id
                and tca.course_id = s.course_id
            )
            or exists (
              select 1 from public.trainer_cohort_assignments tcoa
              where tcoa.tenant_id = ctx.tenant_id
                and tcoa.trainer_user_id = actor_id
                and tcoa.cohort_id = s.cohort_id
            )
          )
      ),
      'pending_submission_count', (
        select count(*)
        from public.assignment_submissions sub
        join public.assignments a on a.id = sub.assignment_id and a.tenant_id = sub.tenant_id
        where sub.tenant_id = ctx.tenant_id
          and sub.status in ('submitted', 'late')
          and (
            a.trainer_user_id = actor_id
            or exists (
              select 1 from public.trainer_course_assignments tca
              where tca.tenant_id = ctx.tenant_id
                and tca.trainer_user_id = actor_id
                and tca.course_id = a.course_id
            )
            or exists (
              select 1 from public.trainer_cohort_assignments tcoa
              where tcoa.tenant_id = ctx.tenant_id
                and tcoa.trainer_user_id = actor_id
                and tcoa.cohort_id = a.cohort_id
            )
          )
      ),
      'active_delegated_permission_count', (
        select count(*)
        from public.delegated_permissions dp
        where dp.tenant_id = ctx.tenant_id
          and dp.user_id = actor_id
          and dp.status = 'active'
          and dp.starts_at <= now()
          and (dp.expires_at is null or dp.expires_at > now())
      ),
      'unread_notification_count', (
        select count(*)
        from public.notifications n
        where n.tenant_id = ctx.tenant_id
          and n.user_id = actor_id
          and n.status = 'unread'
      )
    ),
    'upcoming_sessions', coalesce((
      select jsonb_agg(session_item order by session_item ->> 'scheduled_start_at')
      from (
        select jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'scheduled_start_at', s.scheduled_start_at,
          'scheduled_end_at', s.scheduled_end_at,
          'delivery_mode', s.delivery_mode,
          'meeting_provider', s.meeting_provider,
          'course_title', c.title,
          'cohort_name', coh.name
        ) as session_item
        from public.sessions s
        left join public.courses c on c.id = s.course_id and c.tenant_id = s.tenant_id
        left join public.cohorts coh on coh.id = s.cohort_id and coh.tenant_id = s.tenant_id
        where s.tenant_id = ctx.tenant_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
          and (
            s.trainer_user_id = actor_id
            or exists (
              select 1 from public.trainer_course_assignments tca
              where tca.tenant_id = ctx.tenant_id
                and tca.trainer_user_id = actor_id
                and tca.course_id = s.course_id
            )
            or exists (
              select 1 from public.trainer_cohort_assignments tcoa
              where tcoa.tenant_id = ctx.tenant_id
                and tcoa.trainer_user_id = actor_id
                and tcoa.cohort_id = s.cohort_id
            )
          )
        order by s.scheduled_start_at asc
        limit 8
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_mobile_team_home()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  ctx record;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select tm.tenant_id, tm.role, t
  into ctx
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = actor_id
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  order by tm.created_at asc
  limit 1;

  if not found then
    raise exception 'Team membership required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tenant', public.mobile_tenant_branding_json(ctx.t),
    'role', ctx.role,
    'sections', public.mobile_team_sections_json(ctx.role),
    'summary', jsonb_build_object(
      'active_students', case when ctx.role = 'trainer' then (
        select count(distinct st.id)
        from public.students st
        where st.tenant_id = ctx.tenant_id
          and st.status = 'active'
          and (
            exists (
              select 1
              from public.enrollments e
              join public.trainer_course_assignments tca
                on tca.tenant_id = e.tenant_id
               and tca.course_id = e.course_id
              where e.tenant_id = ctx.tenant_id
                and e.student_id = st.id
                and tca.trainer_user_id = actor_id
            )
            or exists (
              select 1
              from public.cohort_members cm
              join public.trainer_cohort_assignments tcoa
                on tcoa.tenant_id = cm.tenant_id
               and tcoa.cohort_id = cm.cohort_id
              where cm.tenant_id = ctx.tenant_id
                and cm.student_id = st.id
                and tcoa.trainer_user_id = actor_id
            )
          )
      ) else (
        select count(*) from public.students st
        where st.tenant_id = ctx.tenant_id and st.status = 'active'
      ) end,
      'active_courses', case when ctx.role = 'trainer' then (
        select count(distinct course_id)
        from public.trainer_course_assignments tca
        where tca.tenant_id = ctx.tenant_id
          and tca.trainer_user_id = actor_id
      ) else (
        select count(*) from public.courses c
        where c.tenant_id = ctx.tenant_id and c.status = 'published'
      ) end,
      'active_cohorts', case when ctx.role = 'trainer' then (
        select count(distinct cohort_id)
        from public.trainer_cohort_assignments tcoa
        where tcoa.tenant_id = ctx.tenant_id
          and tcoa.trainer_user_id = actor_id
      ) else (
        select count(*) from public.cohorts coh
        where coh.tenant_id = ctx.tenant_id
      ) end,
      'sessions_next_7_days', (
        select count(*)
        from public.sessions s
        where s.tenant_id = ctx.tenant_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
          and s.scheduled_start_at < now() + interval '7 days'
          and (
            ctx.role <> 'trainer'
            or s.trainer_user_id = actor_id
            or exists (
              select 1 from public.trainer_course_assignments tca
              where tca.tenant_id = ctx.tenant_id
                and tca.trainer_user_id = actor_id
                and tca.course_id = s.course_id
            )
            or exists (
              select 1 from public.trainer_cohort_assignments tcoa
              where tcoa.tenant_id = ctx.tenant_id
                and tcoa.trainer_user_id = actor_id
                and tcoa.cohort_id = s.cohort_id
            )
          )
      ),
      'pending_payments', case when ctx.role in ('owner', 'admin', 'staff') then (
        select count(*)
        from public.payment_links pl
        where pl.tenant_id = ctx.tenant_id
          and pl.status in ('created', 'sent')
      ) else 0 end,
      'unread_notifications', (
        select count(*)
        from public.notifications n
        where n.tenant_id = ctx.tenant_id
          and n.user_id = actor_id
          and n.status = 'unread'
      )
    )
  );
end;
$$;

create or replace function public.get_mobile_notifications(
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  safe_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  resolved_tenant_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select tm.tenant_id
  into resolved_tenant_id
  from public.tenant_members tm
  where tm.user_id = actor_id
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  order by tm.created_at asc
  limit 1;

  if resolved_tenant_id is null then
    select spa.tenant_id
    into resolved_tenant_id
    from public.student_portal_accounts spa
    join public.students s on s.id = spa.student_id and s.tenant_id = spa.tenant_id
    where spa.user_id = actor_id
      and spa.status = 'active'
      and coalesce(s.portal_enabled, true) = true
      and s.status = 'active'
    order by spa.linked_at asc
    limit 1;
  end if;

  if resolved_tenant_id is null then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'limit', safe_limit,
      'offset', safe_offset,
      'unread_count', 0
    );
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(notification_item order by notification_item ->> 'created_at' desc)
      from (
        select jsonb_build_object(
          'id', n.id,
          'type', n.type,
          'title', n.title,
          'message', n.message,
          'severity', n.severity,
          'status', n.status,
          'action_url', n.action_url,
          'created_at', n.created_at,
          'read_at', n.read_at
        ) as notification_item
        from public.notifications n
        where n.tenant_id = resolved_tenant_id
          and n.user_id = actor_id
        order by n.created_at desc
        limit safe_limit
        offset safe_offset
      ) q
    ), '[]'::jsonb),
    'limit', safe_limit,
    'offset', safe_offset,
    'unread_count', (
      select count(*)
      from public.notifications n
      where n.tenant_id = resolved_tenant_id
        and n.user_id = actor_id
        and n.status = 'unread'
    )
  );
end;
$$;

create or replace function public.get_mobile_offline_manifest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  bootstrap jsonb;
  resolved_tenant_id uuid;
  resolved_mode text;
  resolved_role text;
  resolved_student_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  bootstrap := public.get_mobile_bootstrap();
  resolved_mode := bootstrap ->> 'mode';
  resolved_role := bootstrap ->> 'role';
  resolved_tenant_id := nullif(bootstrap #>> '{tenant,id}', '')::uuid;
  resolved_student_id := nullif(bootstrap #>> '{student,id}', '')::uuid;

  return jsonb_build_object(
    'server_time', now(),
    'mode', resolved_mode,
    'tenant_id', resolved_tenant_id,
    'sections', coalesce(bootstrap -> 'sections', '[]'::jsonb),
    'last_updated', case when resolved_tenant_id is null then '{}'::jsonb else jsonb_build_object(
      'courses', case
        when resolved_mode = 'student' then (
          select max(c.updated_at)
          from public.courses c
          join public.enrollments e
            on e.tenant_id = c.tenant_id
           and e.course_id = c.id
          where c.tenant_id = resolved_tenant_id
            and e.student_id = resolved_student_id
            and e.status = 'active'
        )
        when resolved_role = 'trainer' then (
          select max(c.updated_at)
          from public.courses c
          join public.trainer_course_assignments tca
            on tca.tenant_id = c.tenant_id
           and tca.course_id = c.id
          where c.tenant_id = resolved_tenant_id
            and tca.trainer_user_id = actor_id
        )
        when resolved_role in ('owner', 'admin') then (
          select max(c.updated_at)
          from public.courses c
          where c.tenant_id = resolved_tenant_id
        )
        else null
      end,
      'sessions', case
        when resolved_mode = 'student' then (
          select max(s.updated_at)
          from public.sessions s
          where s.tenant_id = resolved_tenant_id
            and (
              exists (
                select 1
                from public.enrollments e
                where e.tenant_id = resolved_tenant_id
                  and e.student_id = resolved_student_id
                  and e.course_id = s.course_id
                  and e.status = 'active'
              )
              or exists (
                select 1
                from public.cohort_members cm
                where cm.tenant_id = resolved_tenant_id
                  and cm.student_id = resolved_student_id
                  and cm.cohort_id = s.cohort_id
              )
            )
        )
        when resolved_role = 'trainer' then (
          select max(s.updated_at)
          from public.sessions s
          where s.tenant_id = resolved_tenant_id
            and (
              s.trainer_user_id = actor_id
              or exists (
                select 1
                from public.trainer_course_assignments tca
                where tca.tenant_id = resolved_tenant_id
                  and tca.trainer_user_id = actor_id
                  and tca.course_id = s.course_id
              )
              or exists (
                select 1
                from public.trainer_cohort_assignments tcoa
                where tcoa.tenant_id = resolved_tenant_id
                  and tcoa.trainer_user_id = actor_id
                  and tcoa.cohort_id = s.cohort_id
              )
            )
        )
        when resolved_role in ('owner', 'admin', 'staff') then (
          select max(s.updated_at)
          from public.sessions s
          where s.tenant_id = resolved_tenant_id
        )
        else null
      end,
      'assignments', case
        when resolved_mode = 'student' then (
          select max(a.updated_at)
          from public.assignments a
          where a.tenant_id = resolved_tenant_id
            and a.status = 'published'
            and (
              exists (
                select 1
                from public.enrollments e
                where e.tenant_id = resolved_tenant_id
                  and e.student_id = resolved_student_id
                  and e.course_id = a.course_id
                  and e.status = 'active'
              )
              or exists (
                select 1
                from public.cohort_members cm
                where cm.tenant_id = resolved_tenant_id
                  and cm.student_id = resolved_student_id
                  and cm.cohort_id = a.cohort_id
              )
            )
        )
        when resolved_role = 'trainer' then (
          select max(a.updated_at)
          from public.assignments a
          where a.tenant_id = resolved_tenant_id
            and (
              a.trainer_user_id = actor_id
              or exists (
                select 1
                from public.trainer_course_assignments tca
                where tca.tenant_id = resolved_tenant_id
                  and tca.trainer_user_id = actor_id
                  and tca.course_id = a.course_id
              )
              or exists (
                select 1
                from public.trainer_cohort_assignments tcoa
                where tcoa.tenant_id = resolved_tenant_id
                  and tcoa.trainer_user_id = actor_id
                  and tcoa.cohort_id = a.cohort_id
              )
            )
        )
        when resolved_role in ('owner', 'admin') then (
          select max(a.updated_at)
          from public.assignments a
          where a.tenant_id = resolved_tenant_id
        )
        else null
      end,
      'students', case
        when resolved_mode = 'student' then (
          select max(s.updated_at)
          from public.students s
          where s.tenant_id = resolved_tenant_id
            and s.id = resolved_student_id
            and coalesce(s.portal_enabled, true) = true
            and s.status = 'active'
        )
        when resolved_role = 'trainer' then (
          select max(st.updated_at)
          from public.students st
          where st.tenant_id = resolved_tenant_id
            and (
              exists (
                select 1
                from public.enrollments e
                join public.trainer_course_assignments tca
                  on tca.tenant_id = e.tenant_id
                 and tca.course_id = e.course_id
                where e.tenant_id = resolved_tenant_id
                  and e.student_id = st.id
                  and tca.trainer_user_id = actor_id
              )
              or exists (
                select 1
                from public.cohort_members cm
                join public.trainer_cohort_assignments tcoa
                  on tcoa.tenant_id = cm.tenant_id
                 and tcoa.cohort_id = cm.cohort_id
                where cm.tenant_id = resolved_tenant_id
                  and cm.student_id = st.id
                  and tcoa.trainer_user_id = actor_id
              )
            )
        )
        when resolved_role in ('owner', 'admin', 'staff') then (
          select max(st.updated_at)
          from public.students st
          where st.tenant_id = resolved_tenant_id
        )
        else null
      end,
      'payments', case
        when resolved_mode = 'student' then (
          select max(pl.updated_at)
          from public.payment_links pl
          where pl.tenant_id = resolved_tenant_id
            and pl.student_id = resolved_student_id
        )
        when resolved_role in ('owner', 'admin', 'staff') then (
          select max(pl.updated_at)
          from public.payment_links pl
          where pl.tenant_id = resolved_tenant_id
        )
        else null
      end,
      'notifications', (
        select max(n.created_at)
        from public.notifications n
        where n.tenant_id = resolved_tenant_id
          and n.user_id = actor_id
      )
    ) end
  );
end;
$$;

revoke execute on function public.mobile_tenant_branding_json(public.tenants) from public;
revoke execute on function public.mobile_team_sections_json(text) from public;
revoke execute on function public.mobile_role_permissions_json(text) from public;
revoke execute on function public.get_mobile_bootstrap() from public;
revoke execute on function public.get_mobile_student_home() from public;
revoke execute on function public.get_mobile_trainer_home() from public;
revoke execute on function public.get_mobile_team_home() from public;
revoke execute on function public.get_mobile_notifications(integer, integer) from public;
revoke execute on function public.get_mobile_offline_manifest() from public;

grant execute on function public.get_mobile_bootstrap() to authenticated;
grant execute on function public.get_mobile_student_home() to authenticated;
grant execute on function public.get_mobile_trainer_home() to authenticated;
grant execute on function public.get_mobile_team_home() to authenticated;
grant execute on function public.get_mobile_notifications(integer, integer) to authenticated;
grant execute on function public.get_mobile_offline_manifest() to authenticated;
