# Tracky V2.78 Section 1 — Federated Site Identity, Device Roles & Site Topology

Section 1 introduces the local authoritative topology contract used by later V2.78 federation and mobile-transition work.

- Protocol: `physical_site_topology.v1`
- Stable UUIDs identify sites and devices.
- Built-in OTRO hardware profiles: Node, Desk, Studio, Team Node, Pocket, Custom.
- Hardware profile names never grant authority; authority is capability-driven.
- One active authority device per site.
- Mobile/Pocket devices participate in continuity but cannot be durable site authority.
- Cloud receives only a governed read-only topology summary and cannot assign local authority.
