// Paths whose names suggest secrets: never listed, diffed, fingerprinted or
// offered to a reviewer. By path only; secrets inside other files are not detected.

const SECRET_FILE = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|asc|gpg|ovpn|kdbx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /secret/i,
  /credential/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.git-credentials$/i,
  /^auth\.json$/i,
];
const SECRET_DIR = [/^secrets?$/i, /^\.ssh$/i, /^\.aws$/i, /^\.gnupg$/i, /secret/i, /credential/i];

export function isSecretPath(p: string): boolean {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return false;
  const file = parts[parts.length - 1];
  if (SECRET_FILE.some((r) => r.test(file))) return true;
  return parts.slice(0, -1).some((d) => SECRET_DIR.some((r) => r.test(d)));
}

/** git pathspecs that exclude secret files (for git diff / status commands given to reviewers). */
export const GIT_SECRET_EXCLUDES = [
  ":(exclude,glob)**/.env*",
  ":(exclude,glob)**/*.pem",
  ":(exclude,glob)**/*.key",
  ":(exclude,glob)**/*.p12",
  ":(exclude,glob)**/*.pfx",
  ":(exclude,glob)**/id_rsa*",
  ":(exclude,glob)**/id_ed25519*",
  ":(exclude,glob)**/*secret*",
  ":(exclude,glob)**/*Secret*",
  ":(exclude,glob)**/*credential*",
  ":(exclude,glob)**/*Credential*",
  ":(exclude,glob)**/.netrc",
  ":(exclude,glob)**/.npmrc",
  ":(exclude,glob)**/secrets/**",
  ":(exclude,glob)**/.ssh/**",
  ":(exclude,glob)**/.aws/**",
];
