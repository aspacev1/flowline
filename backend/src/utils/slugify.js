export function slugifyOrgName(name, suffix) {
  const base = (name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeBase = base || "org";
  return suffix ? `${safeBase}-${suffix}` : safeBase;
}
