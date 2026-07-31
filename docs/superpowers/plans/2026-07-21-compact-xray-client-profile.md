# Compact Xray Client Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a valid compact Remnawave Xray client profile with direct routing for major Russian services and automatic healthy WL selection.

**Architecture:** Preserve the source profile's inbounds, outbounds, Remnawave UUID injection, loopback fallback, `leastLoad` balancers, and observatory. Replace the 8,000-line DNS/routing datasets with two DoH servers, private-network CIDRs, and a short domain-suffix list.

**Tech Stack:** JSON, Xray routing/balancer configuration, Remnawave client-profile extensions, Node.js JSON parser.

## Global Constraints

- No external geosite or rule-set dependency.
- Russian services in the approved compact list use `direct`; all other TCP/UDP uses `auto-wl`.
- WL outbounds use `leastLoad` and are monitored by `burstObservatory`.
- Preserve all six source Remnawave host UUIDs.

---

### Task 1: Compact profile

**Files:**
- Create: `configs/remnawave/compact-xray-client-profile.json`
- Test: JSON parsing and invariant assertions from the command line.

**Interfaces:**
- Consumes: the approved design and UUIDs from the supplied profile.
- Produces: an importable Remnawave Xray JSON profile.

- [ ] **Step 1: Establish the failing check**

Run a Node.js assertion that expects the output file, parses it, and checks the two balancers, six UUIDs, direct domains, and absence of large rule arrays. Expected: FAIL because the file does not exist.

- [ ] **Step 2: Create the minimal profile**

Write the compact JSON with two DoH servers, ordered routing rules, existing SOCKS/HTTP inbounds, three static outbounds, two `leastLoad` balancers, Remnawave injection, and a two-minute observatory check.

- [ ] **Step 3: Verify**

Run the same Node.js assertion. Expected: `compact profile ok`.

- [ ] **Step 4: Commit**

Commit the plan and profile without staging unrelated working-tree changes.
