# Forge 1.3.3

Forge 1.3.3 corrects the Ontology Metrics relationship count in the Vault Health Dashboard.

---

## What changed

- Relationship types now come from the schema contract's `ontology.relationships` definitions.
- Dashboard refresh now reports the configured relationship catalog, even when exported ontology records do not currently contain relationship links.

---

## Scope notes

This is a dashboard metrics fix only. Schema structure, export behavior, and lint behavior are unchanged.