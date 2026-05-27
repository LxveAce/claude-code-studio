import React, { useCallback, useEffect, useState } from 'react';
import type {
  GitHubAuthState,
  GitHubBranch,
  GitHubCommit,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepoInfo,
  GitRepoState,
} from '../../../shared/types';
import { RepoHeader } from './RepoHeader';
import { CommitList } from './CommitList';
import { BranchList } from './BranchList';
import { PRList } from './PRList';
import { IssueList } from './IssueList';
import { ConnectGitHub } from './ConnectGitHub';
import { WorkingDirCard } from './WorkingDirCard';

type TabId = 'repo' | 'commits' | 'branches' | 'prs' | 'issues';

export function GitHubPanel() {
  const [auth, setAuth] = useState<GitHubAuthState | null>(null);
  const [cwd, setCwd] = useState<string>('');
  const [git, setGit] = useState<GitRepoState | null>(null);
  const [repoInfo, setRepoInfo] = useState<GitHubRepoInfo | null>(null);
  const [commits, setCommits] = useState<GitHubCommit[] | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[] | null>(null);
  const [prs, setPrs] = useState<GitHubPullRequest[] | null>(null);
  const [issues, setIssues] = useState<GitHubIssue[] | null>(null);
  const [tab, setTab] = useState<TabId>('repo');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    const next = await window.electronAPI.github.authState();
    setAuth(next);
  }, []);

  const refreshGit = useCallback(async () => {
    const [nextCwd, state] = await Promise.all([
      window.electronAPI.git.getCwd(),
      window.electronAPI.git.detect(),
    ]);
    setCwd(nextCwd);
    setGit(state);
  }, []);

  useEffect(() => {
    void refreshAuth();
    void refreshGit();
  }, [refreshAuth, refreshGit]);

  const loadRemote = useCallback(async () => {
    if (!git?.owner || !git?.repo || !auth?.hasToken) return;
    setLoading(true);
    setErr(null);
    try {
      const [info, c, b, p, i] = await Promise.all([
        window.electronAPI.github.getRepoInfo(git.owner, git.repo),
        window.electronAPI.github.listCommits(git.owner, git.repo),
        window.electronAPI.github.listBranches(git.owner, git.repo),
        window.electronAPI.github.listPullRequests(git.owner, git.repo, 'open'),
        window.electronAPI.github.listIssues(git.owner, git.repo, 'open'),
      ]);
      setRepoInfo(info);
      setCommits(c);
      setBranches(b);
      setPrs(p);
      setIssues(i);
    } catch (e: unknown) {
      setErr(extractError(e));
    } finally {
      setLoading(false);
    }
  }, [git?.owner, git?.repo, auth?.hasToken]);

  useEffect(() => {
    void loadRemote();
  }, [loadRemote]);

  const handlePickDir = async () => {
    const next = await window.electronAPI.git.pickDir();
    if (next) {
      setCwd(next);
      await refreshGit();
    }
  };

  const handleSetCwd = async (next: string) => {
    const applied = await window.electronAPI.git.setCwd(next);
    setCwd(applied);
    await refreshGit();
  };

  const handleConnect = async (token: string, allowPlaintext = false) => {
    const next = await window.electronAPI.github.setToken(token, allowPlaintext);
    setAuth(next);
  };

  const handleDisconnect = async () => {
    const next = await window.electronAPI.github.clearToken();
    setAuth(next);
    setRepoInfo(null);
    setCommits(null);
    setBranches(null);
    setPrs(null);
    setIssues(null);
  };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'repo', label: 'Repo' },
    { id: 'commits', label: 'Commits', count: commits?.length },
    { id: 'branches', label: 'Branches', count: branches?.length },
    { id: 'prs', label: 'PRs', count: prs?.length },
    { id: 'issues', label: 'Issues', count: issues?.length },
  ];

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 3, height: 14, borderRadius: 2,
          background: 'var(--accent-gradient)',
        }} />
        GitHub
      </h3>

      <WorkingDirCard
        cwd={cwd}
        git={git}
        onPickDir={handlePickDir}
        onSetCwd={handleSetCwd}
        onRefresh={refreshGit}
      />

      {!auth?.hasToken && (
        <ConnectGitHub
          onConnect={handleConnect}
          encryptionAvailable={auth?.encryptionAvailable ?? true}
        />
      )}

      {auth?.hasToken && (
        <SignedInBar auth={auth} onDisconnect={handleDisconnect} onRefresh={loadRemote} loading={loading} />
      )}

      {err && (
        <div style={{
          marginTop: 10,
          padding: '10px 12px',
          background: 'rgba(244,63,94,0.08)',
          border: '1px solid rgba(244,63,94,0.3)',
          borderRadius: 'var(--radius-md)',
          color: '#fda4af',
          fontSize: 11,
        }}>
          {err}
        </div>
      )}

      {auth?.hasToken && git?.owner && git?.repo && (
        <>
          <div style={{
            display: 'flex',
            gap: 4,
            marginTop: 12,
            marginBottom: 12,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 3,
          }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: tab === t.id ? 'var(--accent-gradient)' : 'transparent',
                  color: tab === t.id ? '#fff' : 'var(--text-secondary)',
                  fontSize: 10,
                  fontWeight: tab === t.id ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                {t.label}
                {typeof t.count === 'number' && (
                  <span style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    borderRadius: 8,
                    background: tab === t.id ? 'rgba(255,255,255,0.2)' : 'var(--bg-elevated)',
                    color: tab === t.id ? '#fff' : 'var(--text-muted)',
                  }}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === 'repo' && <RepoHeader info={repoInfo} loading={loading} />}
          {tab === 'commits' && <CommitList commits={commits} loading={loading} />}
          {tab === 'branches' && <BranchList branches={branches} loading={loading} />}
          {tab === 'prs' && <PRList prs={prs} loading={loading} />}
          {tab === 'issues' && <IssueList issues={issues} loading={loading} />}
        </>
      )}

      {auth?.hasToken && (!git?.owner || !git?.repo) && (
        <div style={{
          marginTop: 12,
          padding: '14px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)',
          fontSize: 11,
          lineHeight: 1.5,
        }}>
          {git?.found
            ? 'Git repo found, but no GitHub remote detected. Add one with: git remote add origin https://github.com/owner/repo.git'
            : 'Point the working directory above at a folder inside a git repository to load GitHub data.'}
        </div>
      )}
    </div>
  );
}

function SignedInBar({
  auth,
  onDisconnect,
  onRefresh,
  loading,
}: {
  auth: GitHubAuthState;
  onDisconnect: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div style={{
      marginTop: 10,
      padding: '8px 12px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 11,
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: '#10b981',
        boxShadow: '0 0 6px rgba(16,185,129,0.5)',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          Connected as {auth.login ?? 'unknown'}
        </div>
        {auth.scopes.length > 0 && (
          <div style={{
            color: 'var(--text-muted)',
            fontSize: 10,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            scopes: {auth.scopes.join(', ')}
          </div>
        )}
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        title="Refresh"
        style={{
          padding: '4px 6px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          cursor: loading ? 'wait' : 'pointer',
          fontSize: 10,
        }}
      >
        {loading ? '...' : 'Refresh'}
      </button>
      <button
        onClick={onDisconnect}
        title="Disconnect"
        style={{
          padding: '4px 6px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 10,
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function extractError(e: unknown): string {
  // Octokit / GitHub-API-aware error classification (3.0.0-beta.3). Turns
  // raw stack traces into one-line actionable messages for the most common
  // failure modes.
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Unknown error';
  // Octokit attaches status + response.data; sniff the message which
  // already concatenates them in most cases.
  if (/HttpError.*401|Bad credentials|401\b/i.test(raw)) {
    return 'GitHub token rejected (401). The token may be revoked, expired, or missing scopes. Disconnect + re-add it.';
  }
  if (/HttpError.*403|rate limit|x-ratelimit/i.test(raw)) {
    // Try to parse a reset epoch out of the message if present.
    const resetMatch = raw.match(/reset(?:-?at)?[: ]+(\d{10,13})/i);
    if (resetMatch) {
      const epoch = parseInt(resetMatch[1], 10);
      const ms = epoch > 1e12 ? epoch : epoch * 1000;
      const when = new Date(ms);
      return `GitHub rate limit hit. Resets at ${when.toLocaleTimeString()} — slow down and try again then.`;
    }
    return 'GitHub rate limit hit (403). Wait a few minutes or use a token with higher quota.';
  }
  if (/HttpError.*404|Not Found/i.test(raw)) {
    return 'GitHub resource not found (404). Check the owner/repo names and that your token can see private repos if applicable.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|getaddrinfo/i.test(raw)) {
    return 'Network error reaching GitHub. Check your connection and try again.';
  }
  return raw;
}
