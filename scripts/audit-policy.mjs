// Production dependencies may not have any known advisory. A development-only
// advisory without an upstream fix is accepted only while it is recorded with a
// reason and a review date, so an exception cannot outlive its justification.
const advisoryId = (via) => via.url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0] ?? `npm-${via.source}`;

function advisories(report) {
  if (!report || typeof report.vulnerabilities !== "object") throw new Error("Unexpected npm audit report.");
  const found = new Map();
  for (const entry of Object.values(report.vulnerabilities)) {
    // String entries only point at another vulnerable package; its own entry holds the advisory.
    for (const via of entry.via ?? []) {
      if (typeof via !== "object") continue;
      const advisory = { advisory: advisoryId(via), package: via.name ?? via.dependency, severity: via.severity, title: via.title };
      found.set(`${advisory.advisory}|${advisory.package}`, advisory);
    }
  }
  return found;
}

export function evaluateAudit({ production, full, exceptions, today }) {
  const errors = [], accepted = [], records = new Map();
  const shipped = advisories(production), all = advisories(full);
  const describe = (a) => `${a.advisory} ${a.package} (${a.severity}): ${a.title}`;
  for (const a of shipped.values()) errors.push(`Production dependency advisory: ${describe(a)}`);
  for (const record of exceptions) {
    if (!/^GHSA-/.test(record.advisory ?? "") || !record.package || !record.reason?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(record.reviewBy ?? "")) {
      errors.push(`Incomplete audit exception: ${JSON.stringify(record)}`);
    } else records.set(`${record.advisory}|${record.package}`, record);
  }
  for (const [key, a] of all) {
    if (shipped.has(key)) continue;
    const record = records.get(key);
    if (!record) errors.push(`Unreviewed development advisory: ${describe(a)}. Update the dependency or record a reviewed exception.`);
    else if (record.reviewBy < today) errors.push(`Audit exception expired on ${record.reviewBy}: ${describe(a)}. Check for an upstream fix and review the record again.`);
    else accepted.push({ ...a, reviewBy: record.reviewBy });
  }
  for (const [key, record] of records) {
    if (!all.has(key)) errors.push(`Stale audit exception: ${record.advisory} ${record.package} is no longer reported. Remove the record.`);
  }
  return { errors, accepted };
}
