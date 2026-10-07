# Databricks notebook source
"""
MedTranz Global — Global Logistics Command Center synthetic data generation.

Writes raw parquet datasets to the UC Volume raw_data/ landing zone:
  warehouses, hospitals, products, shipments (1M), inventory (50K)

Story: Southeast express/emergency exception spike peaking ~3 weeks ago at 3x
baseline on SwiftMed Freight + AeroCare Logistics; $1.6M expedited-freight +
backorder risk. See specifications/01-lakeflow.md.

DAB setup-job task: catalog/schema arrive via base_parameters (widgets) so the
same gen writes to whatever target the bundle resolved (dev-mode prefix aware).
On serverless the Spark session is already present; locally it falls back to
DatabricksSession.
"""

# COMMAND ----------

from datetime import datetime, timedelta
from pyspark.sql import functions as F
import numpy as np

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
assert CATALOG and SCHEMA, "catalog + schema are required"

VOL = f"/Volumes/{CATALOG}/{SCHEMA}/raw_data"

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.raw_data")
print(f"Writing raw parquet to {VOL}")

# COMMAND ----------

# ---- Time anchors (rolling) ----
NOW = datetime.now()
STORY_START = NOW - timedelta(days=365)
SPIKE_BUILD_START = NOW - timedelta(days=35)
SPIKE_PEAK = NOW - timedelta(days=21)
DECAY_START = NOW - timedelta(days=14)
START_EPOCH = int(STORY_START.timestamp())
NOW_EPOCH = int(NOW.timestamp())
PEAK_EPOCH = int(SPIKE_PEAK.timestamp())
BUILD_EPOCH = int(SPIKE_BUILD_START.timestamp())
DECAY_EPOCH = int(DECAY_START.timestamp())

REGIONS = ["Northeast", "Southeast", "Midwest", "Southwest", "West",
           "Pacific Northwest", "Mountain", "Great Lakes", "Mid-Atlantic",
           "South Central", "New England", "Capital Region"]
CARRIERS = ["SwiftMed Freight", "AeroCare Logistics", "MediLine Express",
            "Continental Cargo", "Vanguard Transport", "PrimeHealth Carriers"]
CATEGORIES = ["instruments", "implants", "capital_equipment"]
AFFECTED_CARRIERS = ["SwiftMed Freight", "AeroCare Logistics"]

# Rough region centroid coords for the map
REGION_COORDS = {
    "Northeast": (42.3, -71.9), "Southeast": (33.7, -84.4), "Midwest": (41.9, -87.6),
    "Southwest": (33.4, -112.1), "West": (34.0, -118.2), "Pacific Northwest": (47.6, -122.3),
    "Mountain": (39.7, -104.9), "Great Lakes": (42.3, -83.0), "Mid-Atlantic": (39.3, -76.6),
    "South Central": (29.8, -95.4), "New England": (43.7, -70.3), "Capital Region": (38.9, -77.0),
}

# COMMAND ----------

# ---------------------------------------------------------------------------
# Dimension tables
# ---------------------------------------------------------------------------

# Spark-native pseudo-company name (no faker dependency on serverless workers)
_WORDS_A = ["Summit", "Pioneer", "Meridian", "Vertex", "Horizon", "Apex", "Keystone",
            "Beacon", "Cardinal", "Lakeside", "Riverside", "Greenfield", "Harbor",
            "Granite", "Silverline", "Northgate", "Everest", "Catalyst", "Legacy", "Unity"]
_WORDS_B = ["Health", "Medical", "Care", "Clinical", "Bio", "MedTech", "Surgical",
            "Diagnostics", "Life Sciences", "Therapeutics", "Devices", "Systems"]

def company_name(seed_col):
    a = F.create_map([x for w in _WORDS_A for x in (F.lit(_WORDS_A.index(w)), F.lit(w))])
    b = F.create_map([x for w in _WORDS_B for x in (F.lit(_WORDS_B.index(w)), F.lit(w))])
    return F.concat_ws(" ",
        a[(F.abs(F.hash(seed_col)) % F.lit(len(_WORDS_A)))],
        b[(F.abs(F.hash(seed_col + F.lit(101))) % F.lit(len(_WORDS_B)))])

# warehouses: 24 (2 per region)
wh_rows = []
for i, region in enumerate(REGIONS):
    for j in range(2):
        idx = i * 2 + j
        lat, lng = REGION_COORDS[region]
        wh_rows.append((f"WH-{idx:02d}", f"{region} DC {j+1}", region,
                        round(lat + np.random.uniform(-0.5, 0.5), 4),
                        round(lng + np.random.uniform(-0.5, 0.5), 4)))
warehouses = spark.createDataFrame(wh_rows, ["warehouse_id", "warehouse_name", "region", "wh_lat", "wh_lng"])
warehouses.write.mode("overwrite").parquet(f"{VOL}/warehouses")

# hospitals: ~400 across 12 regions
N_HOSP = 400
hosp = spark.range(0, N_HOSP, numPartitions=8).select(
    F.concat(F.lit("HOSP-"), F.lpad(F.col("id").cast("string"), 4, "0")).alias("destination_hospital"),
    (F.col("id") % F.lit(len(REGIONS))).alias("ridx"),
    F.col("id").alias("hid"),
)
region_map = F.create_map([x for r in REGIONS for x in (F.lit(REGIONS.index(r)), F.lit(r))])
hosp = hosp.withColumn("region", region_map[F.col("ridx")])
# coords from region centroid + jitter
lat_map = F.create_map([x for r in REGIONS for x in (F.lit(r), F.lit(REGION_COORDS[r][0]))])
lng_map = F.create_map([x for r in REGIONS for x in (F.lit(r), F.lit(REGION_COORDS[r][1]))])
hosp = (hosp
    .withColumn("dest_lat", F.round(lat_map[F.col("region")] + (F.rand() - 0.5) * 1.2, 4))
    .withColumn("dest_lng", F.round(lng_map[F.col("region")] + (F.rand() - 0.5) * 1.2, 4))
    .withColumn("hospital_name", F.concat(company_name(F.col("hid")), F.lit(" Medical Center")))
    .select("destination_hospital", "hospital_name", "region", "dest_lat", "dest_lng"))
hosp.write.mode("overwrite").parquet(f"{VOL}/hospitals")

# products: ~2100 SKUs (also sized so inventory = 24 warehouses x 2100 ≈ 50K rows)
N_PROD = 2100
cat_map = F.create_map([x for c in CATEGORIES for x in (F.lit(CATEGORIES.index(c)), F.lit(c))])
prod = spark.range(0, N_PROD, numPartitions=8).select(
    F.concat(F.lit("SKU-"), F.lpad(F.col("id").cast("string"), 6, "0")).alias("product_sku"),
    (F.col("id") % F.lit(len(CATEGORIES))).alias("cidx"),
    F.col("id").alias("pid"),
)
prod = (prod
    .withColumn("category", cat_map[F.col("cidx")])
    # weight by category: instruments light, implants medium, capital_equipment heavy
    .withColumn("unit_weight_kg", F.round(
        F.when(F.col("category") == "instruments", F.rand() * 3 + 0.5)
         .when(F.col("category") == "implants", F.rand() * 8 + 1)
         .otherwise(F.rand() * 180 + 20), 2))
    .withColumn("product_name", F.concat(
        company_name(F.col("pid")), F.lit(" "),
        F.when(F.col("category") == "instruments", F.lit("Surgical Kit"))
         .when(F.col("category") == "implants", F.lit("Implant"))
         .otherwise(F.lit("Imaging System"))))
    .select("product_sku", "product_name", "category", "unit_weight_kg"))
prod.write.mode("overwrite").parquet(f"{VOL}/products")

prod_lookup = spark.read.parquet(f"{VOL}/products")
hosp_lookup = spark.read.parquet(f"{VOL}/hospitals").select(
    "destination_hospital", F.col("region").alias("h_region"))
wh_lookup = spark.read.parquet(f"{VOL}/warehouses").select("warehouse_id")

print(f"dims: warehouses={warehouses.count()} hospitals={hosp_lookup.count()} products={prod_lookup.count()}")

# COMMAND ----------

# ---------------------------------------------------------------------------
# shipments: 1M rows
# ---------------------------------------------------------------------------
N_SHIP = 1000000
carrier_map = F.create_map([x for c in CARRIERS for x in (F.lit(CARRIERS.index(c)), F.lit(c))])

ship = spark.range(0, N_SHIP, numPartitions=32).select(
    F.concat(F.lit("SHP-"), F.lpad(F.col("id").cast("string"), 8, "0")).alias("shipment_id"),
    F.col("id"),
    # uniform ship_date epoch over window
    (F.lit(START_EPOCH) + (F.rand(1) * F.lit(NOW_EPOCH - START_EPOCH))).cast("long").alias("ship_epoch"),
    (F.col("id") % F.lit(N_HOSP)).alias("hidx"),
    (F.abs(F.hash(F.col("id") + F.lit(7))) % F.lit(24)).alias("whidx"),
    (F.abs(F.hash(F.col("id") + F.lit(13))) % F.lit(N_PROD)).alias("pidx"),
    (F.abs(F.hash(F.col("id") + F.lit(29))) % F.lit(len(CARRIERS))).alias("cidx"),
    F.rand(3).alias("pr_roll"),
    F.rand(4).alias("exc_roll"),
    F.rand(5).alias("late_roll"),
)
# priority: standard 70 / express 22 / emergency 8
ship = ship.withColumn("priority",
    F.when(F.col("pr_roll") < 0.70, F.lit("standard"))
     .when(F.col("pr_roll") < 0.92, F.lit("express"))
     .otherwise(F.lit("emergency")))
ship = ship.withColumn("carrier", carrier_map[F.col("cidx")])
ship = ship.withColumn("destination_hospital",
    F.concat(F.lit("HOSP-"), F.lpad(F.col("hidx").cast("string"), 4, "0")))
ship = ship.withColumn("origin_warehouse",
    F.concat(F.lit("WH-"), F.lpad(F.col("whidx").cast("string"), 2, "0")))
ship = ship.withColumn("product_sku",
    F.concat(F.lit("SKU-"), F.lpad(F.col("pidx").cast("string"), 6, "0")))
# join region + product
ship = ship.join(hosp_lookup, "destination_hospital").withColumnRenamed("h_region", "region")
ship = ship.join(prod_lookup.select("product_sku", "category", "unit_weight_kg"), "product_sku")
ship = ship.withColumnRenamed("category", "product_category")

ship = ship.withColumn("ship_ts", F.to_timestamp(F.from_unixtime(F.col("ship_epoch"))))
# weight: unit weight * quantity-ish
ship = ship.withColumn("weight_kg", F.round(F.col("unit_weight_kg") * (F.rand(6) * 4 + 1), 2))
# lead time days by priority
ship = ship.withColumn("lead_days",
    F.when(F.col("priority") == "standard", F.lit(5))
     .when(F.col("priority") == "express", F.lit(2))
     .otherwise(F.lit(1)) + (F.abs(F.hash(F.col("id") + F.lit(41))) % F.lit(3)))
ship = ship.withColumn("estimated_delivery",
    F.expr("ship_ts + make_dt_interval(lead_days,0,0,0)"))

# ---- exception logic ----
# spike window flag & intensity (triangular build to peak then decay)
ship = ship.withColumn("in_spike_window",
    (F.col("ship_epoch") >= F.lit(BUILD_EPOCH)) & (F.col("ship_epoch") <= F.lit(NOW_EPOCH)))
# distance from peak as fraction; intensity 0..1 peaks at SPIKE_PEAK
ship = ship.withColumn("spike_intensity",
    F.when(~F.col("in_spike_window"), F.lit(0.0))
     .when(F.col("ship_epoch") <= F.lit(PEAK_EPOCH),
           (F.col("ship_epoch") - F.lit(BUILD_EPOCH)) / F.lit(max(PEAK_EPOCH - BUILD_EPOCH, 1)))
     .otherwise(
           F.greatest(F.lit(0.0),
               F.lit(1.0) - (F.col("ship_epoch") - F.lit(PEAK_EPOCH)) / F.lit(max(NOW_EPOCH - PEAK_EPOCH, 1)))))
# affected lane: Southeast + express/emergency + affected carriers (SwiftMed + AeroCare)
ship = ship.withColumn("affected_lane",
    (F.col("region") == F.lit("Southeast")) &
    (F.col("priority").isin("express", "emergency")) &
    (F.col("carrier").isin(*AFFECTED_CARRIERS)))
# Southeast express/emergency spillover (other carriers get a milder bump during the spike)
ship = ship.withColumn("se_spillover",
    (F.col("region") == F.lit("Southeast")) &
    (F.col("priority").isin("express", "emergency")) &
    (~F.col("carrier").isin(*AFFECTED_CARRIERS)))
# base exception prob 6%; affected lane ramps to ~0.70 at peak, spillover to ~0.22 -> SE
# express/emergency blended ~0.38 at peak (3x+ baseline), region-level all-priority clearly elevated.
ship = ship.withColumn("exc_prob",
    F.lit(0.06)
    + F.when(F.col("affected_lane"), F.col("spike_intensity") * F.lit(0.64)).otherwise(F.lit(0.0))
    + F.when(F.col("se_spillover"), F.col("spike_intensity") * F.lit(0.16)).otherwise(F.lit(0.0)))
ship = ship.withColumn("is_exc_gen", F.col("exc_roll") < F.col("exc_prob"))

# recent in-transit (last 3 days, not yet delivered)
ship = ship.withColumn("is_recent", F.col("ship_epoch") >= F.lit(NOW_EPOCH - 3 * 86400))

# days late for exceptions
ship = ship.withColumn("days_late_gen",
    F.when(F.col("is_exc_gen") & (F.col("affected_lane") | F.col("se_spillover")), (F.col("late_roll") * 5 + 3).cast("int"))
     .when(F.col("is_exc_gen"), (F.col("late_roll") * 5 + 1).cast("int"))
     .otherwise(F.lit(0)))

ship = ship.withColumn("status",
    F.when(F.col("is_recent"), F.lit("in_transit"))
     .when(F.col("is_exc_gen"), F.lit("exception"))
     .otherwise(F.lit("delivered")))
ship = ship.withColumn("actual_delivery",
    F.when(F.col("is_recent"), F.lit(None).cast("timestamp"))
     .otherwise(F.expr("estimated_delivery + make_dt_interval(days_late_gen,0,0,0)")))

# freight cost: weight * priority mult + region factor; expedited surcharge on affected exceptions
ship = ship.withColumn("prio_mult",
    F.when(F.col("priority") == "standard", F.lit(1.0))
     .when(F.col("priority") == "express", F.lit(2.2))
     .otherwise(F.lit(4.5)))
ship = ship.withColumn("base_cost", F.col("weight_kg") * F.lit(3.5) * F.col("prio_mult") + F.lit(40))
ship = ship.withColumn("freight_cost_usd", F.round(
    F.col("base_cost") * F.when((F.col("affected_lane") | F.col("se_spillover")) & F.col("is_exc_gen"), F.lit(1.8)).otherwise(F.lit(1.0))
    * (F.lit(0.9) + F.rand(9) * 0.2), 2))

shipments_out = ship.select(
    "shipment_id", "origin_warehouse", "destination_hospital", "carrier", "status",
    F.col("ship_ts").alias("ship_date"), "estimated_delivery", "actual_delivery",
    "freight_cost_usd", "weight_kg", "priority", "region", "product_category")
shipments_out.write.mode("overwrite").parquet(f"{VOL}/shipments")
print(f"shipments written: {shipments_out.count()}")

# COMMAND ----------

# ---------------------------------------------------------------------------
# inventory: ~50K (24 warehouses x ~2100 SKUs)
# ---------------------------------------------------------------------------
wh_full = spark.read.parquet(f"{VOL}/warehouses").select("warehouse_id", "warehouse_name", "region")
# cross join a 2100-sku sample with 24 warehouses
sku_sample = prod_lookup.limit(2100).select(
    "product_sku", "product_name", "category").withColumnRenamed("category", "inv_category")
inv = wh_full.crossJoin(sku_sample)
inv = (inv
    .withColumn("rk", F.rand(11))
    .withColumn("quantity_on_hand", (F.rand(12) * 500 + 20).cast("int"))
    .withColumn("reorder_point", (F.rand(13) * 120 + 30).cast("int"))
    # ~8% below reorder, skewed Southeast implants/capital_equipment
    .withColumn("quantity_on_hand",
        F.when((F.col("region") == "Southeast") & (F.col("inv_category") != "instruments") & (F.col("rk") < 0.25),
               (F.col("reorder_point") * F.rand(14) * 0.7).cast("int"))
         .when(F.col("rk") < 0.06, (F.col("reorder_point") * F.rand(15) * 0.7).cast("int"))
         .otherwise(F.col("quantity_on_hand")))
    .withColumn("last_replenished", F.date_sub(F.current_date(), (F.rand(16) * 60).cast("int")))
    .select("warehouse_id", "warehouse_name", "product_sku", "product_name",
            F.col("inv_category").alias("category"), "quantity_on_hand", "reorder_point",
            "last_replenished", "region"))
inv.write.mode("overwrite").parquet(f"{VOL}/inventory")
print(f"inventory written: {inv.count()}")

print("DONE")
