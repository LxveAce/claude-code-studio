import * as fs from 'fs';
import * as path from 'path';

/**
 * Project-language detection — used by ModelsPanel to recommend models for
 * the role that fits the user's current working directory.
 *
 * The classification maps to the catalog's `roles` field:
 *   - 'frontend'   — UI work (React, Vue, Svelte, Angular, Tailwind, etc.)
 *   - 'backend'    — server / API / DB (Express, Django, FastAPI, Spring, etc.)
 *   - 'systems'    — Rust, Go, C/C++, Zig
 *   - 'data'       — Python data stack (pandas, numpy, jupyter, ml libs)
 *   - 'mobile'     — React Native, Flutter, native iOS/Android
 *   - 'devops'     — Dockerfile, k8s manifests, terraform, ansible
 *   - 'general'    — fallback when no signal
 *
 * Detection is best-effort and explicitly avoids deep traversal — only the
 * top level of the directory and one level of common config files is read.
 * Heavy recursion would slow first-render of the panel.
 */

export type ProjectRole =
  | 'frontend'
  | 'backend'
  | 'systems'
  | 'data'
  | 'mobile'
  | 'devops'
  | 'general';

export interface ProjectFingerprint {
  cwd: string;
  detectedLanguages: string[];
  /** Roles ranked by confidence (highest first). Always non-empty. */
  roles: ProjectRole[];
  /** Files that informed the decision — handy for debugging the heuristic. */
  signals: string[];
}

interface FileRule {
  /** Plain filename to match (case-insensitive). */
  filename: string;
  language: string;
  roles: ProjectRole[];
  /** Optional content keywords (lowercased) that strengthen the classification. */
  packageHints?: Record<string, ProjectRole[]>;
}

const RULES: FileRule[] = [
  {
    filename: 'package.json',
    language: 'JavaScript/TypeScript',
    roles: ['general'],
    packageHints: {
      react: ['frontend'],
      'react-dom': ['frontend'],
      vue: ['frontend'],
      svelte: ['frontend'],
      '@angular/core': ['frontend'],
      next: ['frontend', 'backend'],
      nuxt: ['frontend'],
      remix: ['frontend', 'backend'],
      tailwindcss: ['frontend'],
      express: ['backend'],
      fastify: ['backend'],
      koa: ['backend'],
      nestjs: ['backend'],
      '@nestjs/core': ['backend'],
      hapi: ['backend'],
      'react-native': ['mobile'],
      expo: ['mobile'],
      electron: ['frontend', 'backend'],
    },
  },
  {
    filename: 'pyproject.toml',
    language: 'Python',
    roles: ['general'],
    packageHints: {
      django: ['backend'],
      flask: ['backend'],
      fastapi: ['backend'],
      starlette: ['backend'],
      pandas: ['data'],
      numpy: ['data'],
      scipy: ['data'],
      jupyter: ['data'],
      torch: ['data'],
      tensorflow: ['data'],
      'scikit-learn': ['data'],
    },
  },
  {
    filename: 'requirements.txt',
    language: 'Python',
    roles: ['general'],
    packageHints: {
      django: ['backend'],
      flask: ['backend'],
      fastapi: ['backend'],
      pandas: ['data'],
      jupyter: ['data'],
      torch: ['data'],
    },
  },
  { filename: 'Cargo.toml', language: 'Rust', roles: ['systems', 'backend'] },
  { filename: 'go.mod', language: 'Go', roles: ['backend', 'systems'] },
  { filename: 'pom.xml', language: 'Java', roles: ['backend'] },
  { filename: 'build.gradle', language: 'Java/Kotlin', roles: ['backend'] },
  { filename: 'build.gradle.kts', language: 'Kotlin', roles: ['backend'] },
  { filename: 'Gemfile', language: 'Ruby', roles: ['backend'] },
  { filename: 'composer.json', language: 'PHP', roles: ['backend'] },
  { filename: 'Dockerfile', language: 'Docker', roles: ['devops'] },
  { filename: 'docker-compose.yml', language: 'Docker', roles: ['devops'] },
  { filename: 'docker-compose.yaml', language: 'Docker', roles: ['devops'] },
  { filename: 'kustomization.yaml', language: 'Kubernetes', roles: ['devops'] },
  { filename: 'Chart.yaml', language: 'Helm', roles: ['devops'] },
  { filename: 'main.tf', language: 'Terraform', roles: ['devops'] },
  { filename: 'pubspec.yaml', language: 'Dart/Flutter', roles: ['mobile'] },
  { filename: 'CMakeLists.txt', language: 'C/C++', roles: ['systems'] },
  { filename: 'Makefile', language: 'Make', roles: ['systems'] },
];

export function detectProject(cwd: string): ProjectFingerprint {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(cwd);
  } catch {
    return {
      cwd,
      detectedLanguages: [],
      roles: ['general'],
      signals: [],
    };
  }
  const present = new Set(entries.map((e) => e));

  const detectedLanguages = new Set<string>();
  const roleVotes = new Map<ProjectRole, number>();
  const signals: string[] = [];

  // Also look for any *.csproj in the top level for .NET.
  if (entries.some((e) => e.toLowerCase().endsWith('.csproj'))) {
    detectedLanguages.add('C#/.NET');
    vote(roleVotes, 'backend', 2);
    signals.push('.csproj');
  }

  for (const rule of RULES) {
    const hit = [...present].find((p) => p.toLowerCase() === rule.filename.toLowerCase());
    if (!hit) continue;
    signals.push(hit);
    detectedLanguages.add(rule.language);
    for (const r of rule.roles) vote(roleVotes, r, 2);

    if (rule.packageHints) {
      const fp = path.join(cwd, hit);
      let body = '';
      try {
        body = fs.readFileSync(fp, 'utf8').toLowerCase();
      } catch {
        // ignore unreadable
      }
      if (body) {
        for (const [pkg, roles] of Object.entries(rule.packageHints)) {
          if (body.includes(pkg.toLowerCase())) {
            for (const r of roles) vote(roleVotes, r, 3);
          }
        }
      }
    }
  }

  // If we got hits but no specialized role (only 'general'), keep 'general' high.
  if (roleVotes.size === 0) {
    vote(roleVotes, 'general', 1);
  }

  const roles = [...roleVotes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r]) => r);

  return {
    cwd,
    detectedLanguages: [...detectedLanguages],
    roles,
    signals,
  };
}

function vote(m: Map<ProjectRole, number>, role: ProjectRole, weight: number): void {
  m.set(role, (m.get(role) ?? 0) + weight);
}
