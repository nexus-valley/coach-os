-- Module 42.2: Secure automation execution RPC
-- Run after supabase/module41_automation_workflow_engine.sql.

-- Staff/trainers should be able to trigger automations through normal product
-- actions without reading workflow definitions. This replaces the temporary
-- Module 42.1 tenant-member SELECT policies with a SECURITY DEFINER execution
-- function that reads active rules internally and returns only summary counts.

alter table public.automation_runs
add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

create index if not exists automation_runs_tenant_created_by_idx
on public.automation_runs (tenant_id, created_by);

drop policy if exists "Tenant members can read active automation rules for execution" on public.automation_rules;
drop policy if exists "Tenant members can read active automation conditions for execution" on public.automation_rule_conditions;
drop policy if exists "Tenant members can read active automation actions for execution" on public.automation_rule_actions;
drop policy if exists "Tenant members can read own automation runs" on public.automation_runs;
drop policy if exists "Tenant members can create automation runs for active rules" on public.automation_runs;
drop policy if exists "Tenant members can update own automation runs" on public.automation_runs;
drop policy if exists "Tenant members can create own automation run logs" on public.automation_run_logs;

create or replace function public.run_automation_trigger(
  tenant_id uuid,
  trigger_type text,
  entity_type text,
  entity_id uuid default null,
  metadata_json jsonb default '{}'::jsonb
)
returns table (
  executed_count integer,
  skipped_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id alias for $1;
  v_trigger_type alias for $2;
  v_entity_type alias for $3;
  v_entity_id alias for $4;
  v_metadata_json alias for $5;
  v_actor uuid := auth.uid();
  v_rule record;
  v_action record;
  v_condition record;
  v_run_id uuid;
  v_context jsonb;
  v_actual jsonb;
  v_expected jsonb;
  v_key text;
  v_condition_passed boolean;
  v_conditions_passed boolean;
  v_action_title text;
  v_action_message text;
  v_due_at timestamptz;
  v_target_user uuid;
  v_inserted integer;
begin
  executed_count := 0;
  skipped_count := 0;
  failed_count := 0;

  if v_actor is null then
    return;
  end if;

  if not public.is_tenant_member(v_tenant_id, v_actor) then
    return;
  end if;

  v_context := jsonb_build_object(
    'entityId', v_entity_id,
    'entityType', v_entity_type,
    'metadata', coalesce(v_metadata_json, '{}'::jsonb),
    'triggerSource', v_trigger_type
  );

  for v_rule in
    select *
    from public.automation_rules ar
    where ar.tenant_id = v_tenant_id
      and ar.trigger_type = v_trigger_type
      and ar.status = 'active'
  loop
    if v_entity_id is not null and v_entity_type is not null and exists (
      select 1
      from public.automation_runs arun
      where arun.tenant_id = v_tenant_id
        and arun.rule_id = v_rule.id
        and arun.trigger_source = v_trigger_type
        and arun.entity_type = v_entity_type
        and arun.entity_id = v_entity_id
        and arun.status in ('queued', 'success', 'failed')
        and arun.started_at >= now() - interval '5 minutes'
    ) then
      insert into public.automation_runs (
        tenant_id,
        rule_id,
        trigger_source,
        entity_type,
        entity_id,
        status,
        completed_at,
        created_by,
        metadata_json
      )
      values (
        v_tenant_id,
        v_rule.id,
        v_trigger_type,
        v_entity_type,
        v_entity_id,
        'skipped',
        now(),
        v_actor,
        coalesce(v_metadata_json, '{}'::jsonb)
      )
      returning id into v_run_id;

      insert into public.automation_run_logs (
        tenant_id,
        run_id,
        log_level,
        message,
        metadata_json
      )
      values (
        v_tenant_id,
        v_run_id,
        'warning',
        'Duplicate automation trigger skipped within the debounce window.',
        jsonb_build_object('debounceWindowMinutes', 5)
      );

      skipped_count := skipped_count + 1;
      continue;
    end if;

    insert into public.automation_runs (
      tenant_id,
      rule_id,
      trigger_source,
      entity_type,
      entity_id,
      status,
      created_by,
      metadata_json
    )
    values (
      v_tenant_id,
      v_rule.id,
      v_trigger_type,
      v_entity_type,
      v_entity_id,
      'queued',
      v_actor,
      coalesce(v_metadata_json, '{}'::jsonb)
    )
    returning id into v_run_id;

    begin
      v_conditions_passed := true;

      for v_condition in
        select *
        from public.automation_rule_conditions arc
        where arc.tenant_id = v_tenant_id
          and arc.rule_id = v_rule.id
        order by arc.sort_order asc
      loop
        v_actual := v_context;
        foreach v_key in array string_to_array(
          coalesce(v_condition.value_json ->> 'field', 'entityType'),
          '.'
        )
        loop
          if v_actual is null then
            exit;
          end if;

          v_actual := v_actual -> v_key;
        end loop;

        v_expected := v_condition.value_json -> 'value';
        v_condition_passed := case v_condition.condition_type
          when 'not_equals' then v_actual is distinct from v_expected
          when 'greater_than' then
            coalesce((v_actual #>> '{}')::numeric, 0) >
            coalesce((v_expected #>> '{}')::numeric, 0)
          when 'less_than' then
            coalesce((v_actual #>> '{}')::numeric, 0) <
            coalesce((v_expected #>> '{}')::numeric, 0)
          when 'contains' then
            lower(coalesce(v_actual #>> '{}', '')) like
            '%' || lower(coalesce(v_expected #>> '{}', '')) || '%'
          when 'date_before' then
            (v_actual #>> '{}')::timestamptz <
            (v_expected #>> '{}')::timestamptz
          when 'date_after' then
            (v_actual #>> '{}')::timestamptz >
            (v_expected #>> '{}')::timestamptz
          else v_actual = v_expected
        end;

        if not coalesce(v_condition_passed, false) then
          v_conditions_passed := false;
          exit;
        end if;
      end loop;

      if not v_conditions_passed then
        update public.automation_runs
        set
          status = 'skipped',
          completed_at = now()
        where id = v_run_id;

        insert into public.automation_run_logs (
          tenant_id,
          run_id,
          log_level,
          message,
          metadata_json
        )
        values (
          v_tenant_id,
          v_run_id,
          'warning',
          'Automation conditions did not match.',
          '{}'::jsonb
        );

        skipped_count := skipped_count + 1;
        continue;
      end if;

      for v_action in
        select *
        from public.automation_rule_actions ara
        where ara.tenant_id = v_tenant_id
          and ara.rule_id = v_rule.id
        order by ara.sort_order asc
      loop
        v_action_title := coalesce(
          v_action.config_json ->> 'title',
          v_rule.name || ' automation'
        );
        v_action_message := coalesce(
          v_action.config_json ->> 'message',
          'Automation placeholder executed inside CoachFort.'
        );

        if v_action.action_type = 'create_notification' then
          v_inserted := 0;
          v_target_user := case
            when coalesce(v_action.config_json ->> 'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (v_action.config_json ->> 'user_id')::uuid
            else null
          end;

          if v_target_user is not null and exists (
            select 1
            from public.tenant_members tm
            where tm.tenant_id = v_tenant_id
              and tm.user_id = v_target_user
          ) then
            insert into public.notifications (
              tenant_id,
              user_id,
              type,
              title,
              message,
              entity_type,
              entity_id,
              severity,
              status,
              action_url,
              metadata_json
            )
            values (
              v_tenant_id,
              v_target_user,
              'system_notice',
              v_action_title,
              v_action_message,
              coalesce(v_entity_type, 'automation'),
              v_entity_id,
              'info',
              'unread',
              '/app/automations',
              jsonb_build_object(
                'automationActionId', v_action.id,
                'automationRuleId', v_rule.id,
                'triggerType', v_trigger_type
              )
            );
            v_inserted := 1;
          else
            insert into public.notifications (
              tenant_id,
              user_id,
              type,
              title,
              message,
              entity_type,
              entity_id,
              severity,
              status,
              action_url,
              metadata_json
            )
            select
              v_tenant_id,
              tm.user_id,
              'system_notice',
              v_action_title,
              v_action_message,
              coalesce(v_entity_type, 'automation'),
              v_entity_id,
              'info',
              'unread',
              '/app/automations',
              jsonb_build_object(
                'automationActionId', v_action.id,
                'automationRuleId', v_rule.id,
                'triggerType', v_trigger_type
              )
            from public.tenant_members tm
            where tm.tenant_id = v_tenant_id
              and tm.role in ('owner', 'admin');

            get diagnostics v_inserted = row_count;
          end if;

          insert into public.automation_run_logs (
            tenant_id,
            run_id,
            log_level,
            message,
            metadata_json
          )
          values (
            v_tenant_id,
            v_run_id,
            'info',
            case
              when v_inserted > 0 then 'Notification created.'
              else 'Notification output skipped because no target user was available.'
            end,
            jsonb_build_object('actionId', v_action.id, 'actionType', v_action.action_type)
          );
        elsif v_action.action_type = 'create_reminder' then
          v_due_at := now() + (
            greatest(
              0,
              coalesce((v_action.config_json ->> 'due_offset_days')::integer, 1)
            ) || ' days'
          )::interval;

          insert into public.reminders (
            tenant_id,
            title,
            description,
            reminder_type,
            due_at,
            status
          )
          values (
            v_tenant_id,
            v_action_title,
            v_action_message,
            'general',
            v_due_at,
            'pending'
          );

          insert into public.automation_run_logs (
            tenant_id,
            run_id,
            log_level,
            message,
            metadata_json
          )
          values (
            v_tenant_id,
            v_run_id,
            'info',
            'Reminder created.',
            jsonb_build_object('actionId', v_action.id, 'actionType', v_action.action_type)
          );
        elsif v_action.action_type in ('send_email_placeholder', 'send_whatsapp_placeholder') then
          insert into public.communication_logs (
            tenant_id,
            user_id,
            channel,
            type,
            status,
            target,
            subject,
            message,
            metadata_json
          )
          values (
            v_tenant_id,
            v_actor,
            case
              when v_action.action_type = 'send_email_placeholder' then 'email'
              else 'whatsapp'
            end,
            'automation_placeholder',
            'queued',
            v_action.config_json ->> 'target',
            v_action_title,
            v_action_message,
            jsonb_build_object(
              'automationActionId', v_action.id,
              'automationRuleId', v_rule.id,
              'entityId', v_entity_id,
              'entityType', v_entity_type,
              'triggerSource', v_trigger_type
            )
          );

          insert into public.automation_run_logs (
            tenant_id,
            run_id,
            log_level,
            message,
            metadata_json
          )
          values (
            v_tenant_id,
            v_run_id,
            'info',
            case
              when v_action.action_type = 'send_email_placeholder' then 'Email placeholder queued.'
              else 'WhatsApp placeholder queued.'
            end,
            jsonb_build_object('actionId', v_action.id, 'actionType', v_action.action_type)
          );
        else
          insert into public.automation_run_logs (
            tenant_id,
            run_id,
            log_level,
            message,
            metadata_json
          )
          values (
            v_tenant_id,
            v_run_id,
            'info',
            case v_action.action_type
              when 'add_internal_note' then 'Internal note placeholder recorded.'
              when 'generate_task_placeholder' then 'Task generation placeholder recorded.'
              else 'Automation action placeholder recorded.'
            end,
            jsonb_build_object('actionId', v_action.id, 'actionType', v_action.action_type)
          );
        end if;
      end loop;

      update public.automation_runs
      set
        status = 'success',
        completed_at = now()
      where id = v_run_id;

      insert into public.automation_run_logs (
        tenant_id,
        run_id,
        log_level,
        message,
        metadata_json
      )
      values (
        v_tenant_id,
        v_run_id,
        'info',
        'Automation executed successfully.',
        jsonb_build_object('triggerType', v_trigger_type)
      );

      executed_count := executed_count + 1;
    exception
      when others then
        update public.automation_runs
        set
          status = 'failed',
          completed_at = now(),
          error_message = left(sqlerrm, 500)
        where id = v_run_id;

        insert into public.automation_run_logs (
          tenant_id,
          run_id,
          log_level,
          message,
          metadata_json
        )
        values (
          v_tenant_id,
          v_run_id,
          'error',
          left(sqlerrm, 500),
          jsonb_build_object('sqlstate', sqlstate)
        );

        failed_count := failed_count + 1;
    end;
  end loop;

  return next;
end;
$$;

revoke execute on function public.run_automation_trigger(uuid, text, text, uuid, jsonb) from public;
grant execute on function public.run_automation_trigger(uuid, text, text, uuid, jsonb) to authenticated;
