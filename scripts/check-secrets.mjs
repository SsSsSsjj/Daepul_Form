import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const secretPatterns = [
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/],
  ["OpenAI API key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

const dotenvSecretAssignment =
  /^\s*(?:[A-Z0-9_]*(?:CLIENT_SECRET|PRIVATE_KEY|SERVICE_ACCOUNT|ACCESS_TOKEN|REFRESH_TOKEN|API_TOKEN|PASSWORD))\s*=\s*(.+)\s*$/gim;

const safeExampleValue =
  /^(?:$|your[-_]|example|placeholder|\$\{|process\.env|import\.meta\.env)/i;

const trackedFiles = execFileSync("git", ["ls-files", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const findings = [];

for (const file of trackedFiles) {
  let contents;
  try {
    const buffer = readFileSync(file);
    if (buffer.length > 5 * 1024 * 1024 || buffer.includes(0)) continue;
    contents = buffer.toString("utf8");
  } catch {
    continue;
  }

  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(contents)) findings.push(`${file}: ${label}`);
  }

  dotenvSecretAssignment.lastIndex = 0;
  for (const match of contents.matchAll(dotenvSecretAssignment)) {
    const value = match[1].trim().replace(/^['"]|['"]$/g, "");
    if (!safeExampleValue.test(value)) {
      findings.push(`${file}: sensitive environment assignment`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets were found. Values are intentionally hidden:");
  for (const finding of [...new Set(findings)]) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed for ${trackedFiles.length} tracked files.`);
