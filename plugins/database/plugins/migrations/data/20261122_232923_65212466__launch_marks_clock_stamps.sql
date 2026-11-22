-- migration: 20261122_232923__launch_marks_clock_stamps --
-- launch-timeline's marks become ClockStamps ({ wallMs, sleep }) so a stretch
-- is judged on awake time, not wall time a machine sleep inflates. Records
-- written before had wall instants only (epoch ms numbers): each becomes a
-- stamp whose sleep cannot be told (null — read as wall time, and counted as
-- such). The request gets its own stamp, from requested_at. A checkout step's
-- endAt becomes its end stamp the same way. Idempotent.
UPDATE "conversations_ext_launch" SET "marks" =
    COALESCE((
      SELECT jsonb_object_agg(e.k, CASE WHEN jsonb_typeof(e.v) = 'number'
        THEN jsonb_build_object('wallMs', e.v, 'sleep', NULL)
        ELSE e.v END)
      FROM jsonb_each("marks") AS e(k, v)
    ), '{}'::jsonb)
    || CASE WHEN "marks" ? 'requested' THEN '{}'::jsonb
       ELSE jsonb_build_object('requested', jsonb_build_object(
         'wallMs', round(extract(epoch FROM "requested_at") * 1000)::bigint,
         'sleep', NULL)) END
  WHERE NOT ("marks" ? 'requested')
     OR EXISTS (SELECT 1 FROM jsonb_each("marks") AS e(k, v)
                WHERE jsonb_typeof(e.v) = 'number');
UPDATE "conversations_ext_launch" SET "checkout_steps" =
    COALESCE((
      SELECT jsonb_agg(CASE WHEN s ? 'endAt'
        THEN (s - 'endAt') || jsonb_build_object('end',
          jsonb_build_object('wallMs', s->'endAt', 'sleep', NULL))
        ELSE s END ORDER BY i)
      FROM jsonb_array_elements("checkout_steps") WITH ORDINALITY AS a(s, i)
    ), '[]'::jsonb)
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("checkout_steps") AS a(s)
                WHERE s ? 'endAt');
