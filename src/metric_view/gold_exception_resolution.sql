-- Lakebase CDF -> lakehouse (build-time materialization).
-- In production, Lakebase Change Data Feed on exception_tickets streams resolved-ticket
-- changes back to the lakehouse. For the build we materialize the same analytical fact
-- directly from the Southeast exception shipments: one resolved ticket per exception,
-- with resolution time that IMPROVES over the decay window (the operational actions working).
CREATE OR REPLACE TABLE solution_builder.demo_global_logistics_exception_cockpit_e302b2.gold_exception_resolution AS
WITH exc AS (
  SELECT
    shipment_id,
    region,
    carrier,
    product_category,
    priority,
    ship_date,
    days_late,
    -- exception type: Southeast lanes skew temperature_excursion + customs_delay
    CASE
      WHEN region = 'Southeast' AND pmod(abs(hash(shipment_id)), 10) < 5 THEN 'temperature_excursion'
      WHEN region = 'Southeast' AND pmod(abs(hash(shipment_id)), 10) < 8 THEN 'customs_delay'
      WHEN pmod(abs(hash(shipment_id)), 4) = 0 THEN 'damage'
      WHEN pmod(abs(hash(shipment_id)), 4) = 1 THEN 'missing_docs'
      WHEN pmod(abs(hash(shipment_id)), 4) = 2 THEN 'customs_delay'
      ELSE 'temperature_excursion'
    END AS exception_type,
    -- severity: expedited/late skew high/critical
    CASE
      WHEN days_late >= 6 THEN 'critical'
      WHEN days_late >= 4 THEN 'high'
      WHEN days_late >= 2 THEN 'medium'
      ELSE 'low'
    END AS severity,
    CAST(ship_date AS TIMESTAMP) AS created_at,
    -- days since the shipment relative to now: older exceptions resolved slowly (~48-72h),
    -- recent ones resolved fast (~8-16h) as the team got ahead of it -> resolution time drops.
    datediff(current_date(), CAST(ship_date AS DATE)) AS age_days
  FROM solution_builder.demo_global_logistics_exception_cockpit_e302b2.gold_shipments
  WHERE is_exception = true
    AND ship_date >= dateadd(day, -60, current_date())
)
SELECT
  shipment_id,
  concat('TCK-', substr(sha2(shipment_id, 256), 1, 10)) AS ticket_id,
  region, carrier, product_category, priority,
  exception_type, severity,
  'resolved' AS status,
  created_at,
  -- resolution hours: scales DOWN as exceptions get more recent (improvement story)
  -- older (age>30d) ~ 40-72h ; recent (age<14d) ~ 6-18h
  (created_at + make_dt_interval(0,
     CAST(GREATEST(6, LEAST(72, 10 + age_days * 1.1 + pmod(abs(hash(shipment_id)), 8))) AS INT),
     0, 0)) AS resolved_at,
  CAST(GREATEST(6, LEAST(72, 10 + age_days * 1.1 + pmod(abs(hash(shipment_id)), 8))) AS INT) AS resolution_hours
FROM exc;
