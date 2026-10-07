```json
[
  {
    "name": "Command Center",
    "story": "Shipment, inventory, hospital and carrier feeds ingest via Lakeflow into a governed medallion (gold_shipments / gold_inventory / gold_delivery_performance + mv_delivery_sla). Gold is synced into Lakebase (CONTINUOUS / TRIGGERED / SNAPSHOT) as the operational store; the AppKit Command Center + its embedded OpenAI-Agents-SDK assistant read Lakebase and query the Genie Agent, then write reroute/escalate/hold actions back to app-owned OLTP tables. Lakebase CDF streams those writes back to the lakehouse into mv_exception_resolution. AI/BI dashboard + Genie Agent + the app are all reached through Genie One. Out of scope on this tab: per-environment networking and the DAB deploy topology.",
    "aspect": "16:9",
    "theme": "slide",
    "direction": "horizontal",
    "options": {
      "trademarkLogos": true
    },
    "columns": [
      "sources",
      "data",
      "serve",
      "consume",
      "entry"
    ],
    "nodes": [
      {
        "id": "app",
        "type": "databricks-apps-work",
        "col": "consume",
        "row": 3,
        "ai_reasoning": "the Command Center: Plotly cockpit + embedded agent that queries Genie AND writes actions to Lakebase",
        "showDesc": true
      },
      {
        "id": "dashboard",
        "type": "ai-bi-dashboard",
        "col": "consume",
        "row": 1
      },
      {
        "id": "db-platform",
        "type": "db-platform",
        "pin": {
          "at": "top-left",
          "to": "platform-box"
        }
      },
      {
        "id": "genie",
        "type": "genie",
        "col": "consume",
        "row": 2
      },
      {
        "id": "genie-one",
        "type": "genie-one",
        "col": "entry",
        "rot": 90,
        "ai_reasoning": "business-user entry point fronting the consumption tiles; persona pill built in; edges auto-arrow"
      },
      {
        "id": "governance-block",
        "type": "governance-block",
        "pin": {
          "at": "top-right",
          "to": "platform-box"
        },
        "ai_reasoning": "Unity Catalog governs gold tables AND the registered Lakebase database — one governance layer across lakehouse + Lakebase"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "serve",
        "row": 3,
        "desc": "Synced gold + OLTP actions/tickets",
        "showDesc": true,
        "ai_reasoning": "operational store: synced tables (CONTINUOUS/TRIGGERED/SNAPSHOT) + app-owned shipment_actions / exception_tickets / coordinator_preferences"
      },
      {
        "id": "lakeflow",
        "type": "lakeflow-genie-block",
        "col": "data",
        "row": 1,
        "params": {
          "gold_desc": "gold_shipments · gold_inventory · gold_delivery_performance"
        },
        "ai_reasoning": "SDP medallion: raw parquet (Volume) → silver_shipments → the three gold tables"
      },
      {
        "id": "lakehouse",
        "type": "sql-lakehouse",
        "col": "serve",
        "row": 1,
        "desc": "Gold + mv_delivery_sla / mv_exception_resolution",
        "showDesc": true,
        "ai_reasoning": "governed serving copy + metric views; dashboard & Genie read here"
      },
      {
        "id": "platform-box",
        "type": "box",
        "wraps": [
          "lakeflow",
          "lakehouse",
          "lakebase",
          "dashboard",
          "genie",
          "app",
          "genie-one"
        ],
        "ai_reasoning": "wraps only Databricks components; raw source feeds stay outside the platform boundary"
      },
      {
        "id": "src-carriers",
        "type": "source",
        "col": "sources",
        "row": 4,
        "label": "Carrier feeds",
        "icon": "text"
      },
      {
        "id": "src-hospitals",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Hospital master",
        "icon": "text"
      },
      {
        "id": "src-inventory",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Inventory feeds",
        "icon": "text"
      },
      {
        "id": "src-shipments",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "Shipment events",
        "icon": "sensorSource",
        "ai_reasoning": "high-volume operational shipment stream (500K+/story) → lands on Lakeflow Connect port"
      }
    ],
    "edges": [
      {
        "id": "e-app-genie",
        "from": "app@t",
        "to": "genie@b",
        "label": "ask_genie"
      },
      {
        "id": "e-app-lb",
        "from": "lakebase@r",
        "to": "app@l",
        "flow": true,
        "label": "Read + write actions"
      },
      {
        "id": "e-carr",
        "from": "src-carriers@r",
        "to": "lakeflow@in-lakeflow-connect",
        "flow": true
      },
      {
        "id": "e-cdf",
        "from": "lakebase@t",
        "to": "lakehouse@b",
        "arrow": "end",
        "dashed": true,
        "labelPos": {
          "d": 24,
          "from": "source",
          "off": -28
        },
        "label": "Lakebase CDF"
      },
      {
        "id": "e-dash",
        "from": "lakehouse@r",
        "to": "dashboard@l",
        "flow": true
      },
      {
        "id": "e-genie",
        "from": "lakehouse@r",
        "to": "genie@l",
        "flow": true
      },
      {
        "id": "e-go-app",
        "from": "genie-one@l",
        "to": "app@r"
      },
      {
        "id": "e-go-dash",
        "from": "genie-one@l",
        "to": "dashboard@r"
      },
      {
        "id": "e-go-genie",
        "from": "genie-one@l",
        "to": "genie@r"
      },
      {
        "id": "e-gold",
        "from": "lakeflow@r",
        "to": "lakehouse@l",
        "flow": true
      },
      {
        "id": "e-hosp",
        "from": "src-hospitals@r",
        "to": "lakeflow@in-direct",
        "flow": true
      },
      {
        "id": "e-inv",
        "from": "src-inventory@r",
        "to": "lakeflow@in-lakeflow-connect",
        "flow": true
      },
      {
        "id": "e-ship",
        "from": "src-shipments@r",
        "to": "lakeflow@in-lakeflow-connect",
        "flow": true
      },
      {
        "id": "e-sync",
        "from": "lakehouse@b",
        "to": "lakebase@t",
        "flow": true,
        "labelPos": {
          "d": 24,
          "from": "source",
          "off": -42
        },
        "label": "Synced tables"
      }
    ]
  }
]
```
