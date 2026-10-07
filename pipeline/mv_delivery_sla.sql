CREATE OR REPLACE VIEW solution_builder.demo_global_logistics_exception_cockpit_e302b2.mv_delivery_sla
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1
source: solution_builder.demo_global_logistics_exception_cockpit_e302b2.gold_delivery_performance
comment: "Governed delivery SLA / exception / freight metrics by date, region, carrier, priority, product_category."
dimensions:
  - name: date
    expr: metric_date
  - name: region
    expr: region
  - name: carrier
    expr: carrier
  - name: priority
    expr: priority
  - name: product_category
    expr: product_category
measures:
  - name: shipments
    expr: SUM(shipments_count)
  - name: exceptions
    expr: SUM(exception_count)
  - name: on_time
    expr: SUM(on_time_count)
  - name: sla_pct
    expr: SUM(on_time_count) / NULLIF(SUM(shipments_count),0)
  - name: exception_rate
    expr: SUM(exception_count) / NULLIF(SUM(shipments_count),0)
  - name: total_freight_usd
    expr: SUM(total_freight_usd)
  - name: expedited_freight_usd
    expr: SUM(expedited_freight_usd)
  - name: avg_days_late
    expr: SUM(avg_days_late * exception_count) / NULLIF(SUM(exception_count),0)
$$
