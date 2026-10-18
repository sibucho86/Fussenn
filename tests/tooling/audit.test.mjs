import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAudit } from "../../scripts/audit-policy.mjs";

const advisory = (name, id, severity = "high") => ({ source: 1, name, dependency: name, title: `${name} issue`, url: `https://github.com/advisories/${id}`, severity, range: "<=1.0.0" });
// Mirrors npm audit --json: the vulnerable package holds the advisory, packages above it only name it.
const report = (...chains) => ({ auditReportVersion: 2, vulnerabilities: Object.fromEntries(chains.flatMap(([leaf, id, ...parents]) => [
  [leaf, { name: leaf, severity: "high", via: [advisory(leaf, id)], effects: parents.slice(0, 1), nodes: [`node_modules/${leaf}`] }],
  ...parents.map((name, index) => [name, { name, severity: "high", via: [index ? parents[index - 1] : leaf], effects: parents.slice(index + 1, index + 2), nodes: [`node_modules/${name}`] }]),
])) });
const empty = report();
const record = (overrides = {}) => ({ advisory: "GHSA-aaaa-bbbb-cccc", package: "braces", reason: "Development lint only.", reviewBy: "2027-01-15", ...overrides });

test("accepts a reviewed development-only advisory once, until its review date", () => {
  const full = report(["braces", "GHSA-aaaa-bbbb-cccc", "micromatch", "fast-glob"]);
  const current = evaluateAudit({ production: empty, full, exceptions: [record()], today: "2026-10-15" });
  assert.deepEqual(current.errors, []);
  assert.equal(current.accepted.length, 1);
  const lastDay = evaluateAudit({ production: empty, full, exceptions: [record()], today: "2027-01-15" });
  assert.deepEqual(lastDay.errors, []);
  const expired = evaluateAudit({ production: empty, full, exceptions: [record()], today: "2027-01-16" });
  assert.match(expired.errors.join("\n"), /expired on 2027-01-15/);
  assert.equal(expired.accepted.length, 0);
});

test("never accepts a production advisory, even with a recorded exception", () => {
  const vulnerable = report(["next", "GHSA-dddd-eeee-ffff"]);
  const { errors, accepted } = evaluateAudit({ production: vulnerable, full: vulnerable, exceptions: [record({ advisory: "GHSA-dddd-eeee-ffff", package: "next" })], today: "2026-10-15" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Production dependency advisory: GHSA-dddd-eeee-ffff next/);
  assert.equal(accepted.length, 0);
});

test("rejects unreviewed advisories, stale records and incomplete records", () => {
  const full = report(["sprintf-js", "GHSA-gggg-hhhh-jjjj", "roarr"]);
  const { errors } = evaluateAudit({ production: empty, full, exceptions: [record(), record({ advisory: "GHSA-kkkk-mmmm-nnnn", reason: " " })], today: "2026-10-15" });
  assert.equal(errors.length, 3);
  assert.match(errors.join("\n"), /Incomplete audit exception/);
  assert.match(errors.join("\n"), /Unreviewed development advisory: GHSA-gggg-hhhh-jjjj sprintf-js/);
  assert.match(errors.join("\n"), /Stale audit exception: GHSA-aaaa-bbbb-cccc braces/);
});

test("an npm error report cannot pass as an empty audit", () => {
  assert.throws(() => evaluateAudit({ production: { error: { code: "ENOTFOUND" } }, full: empty, exceptions: [], today: "2026-10-15" }), /Unexpected npm audit report/);
});

test("passes with no advisories and no recorded exceptions", () => {
  assert.deepEqual(evaluateAudit({ production: empty, full: empty, exceptions: [], today: "2026-10-15" }), { errors: [], accepted: [] });
});

test("recorded exceptions are complete and name the reviewed dependency path", () => {
  const { exceptions } = JSON.parse(readFileSync(new URL("../../scripts/audit-exceptions.json", import.meta.url), "utf8"));
  for (const entry of exceptions) {
    assert.match(entry.advisory, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.match(entry.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.reason.trim() && entry.path.includes(entry.package));
  }
});
