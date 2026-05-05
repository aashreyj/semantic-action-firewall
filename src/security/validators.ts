import path from "node:path";

const sensitiveTargetPatterns = [
  /(^|\/)\.env(\.|$|\/)?/i,
  /(^|\/)id_rsa(\.|$|\/)?/i,
  /(^|\/)id_ed25519(\.|$|\/)?/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)secrets?(\.|$|\/)?/i,
  /(^|\/)credentials?(\.|$|\/)?/i,
  /(^|\/)auth(\.|$|\/)?/i,
  /(^|\/)token(\.|$|\/)?/i,
  /\/\.ssh\//i,
  /\/\.aws\//i,
];

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

export function resolveWorkspaceTarget(workspacePath: string, target: string): string {
  if (path.isAbsolute(target)) {
    return path.resolve(target);
  }

  return path.resolve(workspacePath, target);
}

export function isWithinWorkspace(target: string, workspacePath: string): boolean {
  const workspaceRoot = path.resolve(workspacePath);
  const resolvedTarget = resolveWorkspaceTarget(workspaceRoot, target);

  return resolvedTarget === workspaceRoot || resolvedTarget.startsWith(`${workspaceRoot}${path.sep}`);
}

export function isProtectedPath(target: string, protectedPaths: string[]): boolean {
  return protectedPaths.some((prefix) => {
    if (prefix === "/") {
      return target.startsWith("/");
    }

    return target === prefix || target.startsWith(`${prefix}/`);
  });
}

export function isSensitiveTarget(target: string): boolean {
  return sensitiveTargetPatterns.some((pattern) => pattern.test(target));
}

function extractHostname(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }

  const parseWithUrl = (value: string): string | null => {
    try {
      const parsed = new URL(value);
      return parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
  };

  const direct = parseWithUrl(trimmed);
  if (direct) {
    return direct;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const fallback = parseWithUrl(`https://${trimmed}`);
  return fallback;
}

export function isAllowedDomainTarget(target: string, allowedDomains: string[]): boolean {
  const hostname = extractHostname(target);
  if (!hostname) {
    return false;
  }

  return allowedDomains.some((rawDomain) => {
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      return false;
    }

    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}
