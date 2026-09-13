/* ─────────────────────────────────────────────────────────────────────────
   raft-lab/engine.js — Raft consensus (leader election + log replication)
   on a deterministic virtual clock, with a network you can break.

   The scheduler is seeded and time is advanced in fixed ticks, so a run is
   reproducible: the same seed and the same interventions give the same
   history, every time. That is what makes the invariant checker meaningful
   rather than decorative.
   ───────────────────────────────────────────────────────────────────────── */

import { rng } from '../../shared/lab.js';

export const CFG = {
  electionMin: 1500,      // ms — stretched from Raft's usual 150-300ms so a
  electionMax: 3000,      //      human can watch an election happen
  heartbeat: 600,
  latencyMin: 90,
  latencyMax: 260,
};

const FOLLOWER = 'follower', CANDIDATE = 'candidate', LEADER = 'leader';
export const ROLES = { FOLLOWER, CANDIDATE, LEADER };

let seqCounter = 0;

export class Cluster {
  constructor(size = 5, seed = 7) {
    this.rand = rng(seed);
    this.now = 0;
    this.size = size;
    this.messages = [];
    this.events = [];
    this.dropped = 0;
    this.delivered = 0;
    this.clientSeq = 0;
    this.nodes = Array.from({ length: size }, (_, id) => ({
      id,
      role: FOLLOWER,
      term: 0,
      votedFor: null,
      log: [],                 // 1-based: log[i-1] is entry i
      commitIndex: 0,
      applied: 0,
      nextIndex: new Array(size).fill(1),
      matchIndex: new Array(size).fill(0),
      votes: new Set(),
      alive: true,
      partition: 0,            // nodes only talk within the same partition
      electionAt: 0,
      heartbeatAt: 0,
      lastContact: 0,
      stateMachine: [],
    }));
    for (const n of this.nodes) this.resetElection(n);
  }

  /* ── clock ──────────────────────────────────────────────────────────── */
  resetElection(n) {
    n.electionAt = this.now + CFG.electionMin + this.rand() * (CFG.electionMax - CFG.electionMin);
  }

  log(kind, text, node) {
    this.events.push({ at: this.now, kind, text, node });
    if (this.events.length > 500) this.events.shift();
  }

  tick(dt) {
    this.now += dt;
    // deliver anything due
    const due = this.messages.filter((m) => m.deliverAt <= this.now);
    if (due.length) this.messages = this.messages.filter((m) => m.deliverAt > this.now);
    for (const m of due) this.receive(m);

    for (const n of this.nodes) {
      if (!n.alive) continue;
      if (n.role === LEADER) {
        if (this.now >= n.heartbeatAt) {
          n.heartbeatAt = this.now + CFG.heartbeat;
          for (const p of this.nodes) if (p.id !== n.id) this.sendAppend(n, p);
        }
        this.advanceCommit(n);
      } else if (this.now >= n.electionAt) {
        this.beginElection(n);
      }
      // apply committed entries
      while (n.applied < n.commitIndex) {
        n.applied++;
        n.stateMachine.push(n.log[n.applied - 1]);
      }
    }
  }

  /* ── network ────────────────────────────────────────────────────────── */
  send(from, to, type, payload) {
    const a = this.nodes[from], b = this.nodes[to];
    const latency = CFG.latencyMin + this.rand() * (CFG.latencyMax - CFG.latencyMin);
    const msg = {
      id: ++seqCounter, from, to, type, payload,
      sentAt: this.now, deliverAt: this.now + latency,
      // A partitioned or dead peer does not bounce the message back: the
      // sender simply never hears an answer, which is the whole difficulty.
      lost: !a.alive || !b.alive || a.partition !== b.partition,
    };
    this.messages.push(msg);
    return msg;
  }

  receive(m) {
    if (m.lost) { this.dropped++; return; }
    const n = this.nodes[m.to];
    if (!n.alive) { this.dropped++; return; }
    this.delivered++;
    const p = m.payload;

    // Rule for all servers: a higher term always wins, and you step down.
    if (p.term > n.term) {
      n.term = p.term;
      n.votedFor = null;
      if (n.role !== FOLLOWER) {
        this.log('stepdown', `s${n.id} saw term ${p.term} and stepped down`, n.id);
        n.role = FOLLOWER;
      }
    }

    switch (m.type) {
      case 'RequestVote': return this.onRequestVote(n, m, p);
      case 'RequestVoteResp': return this.onVoteResp(n, m, p);
      case 'AppendEntries': return this.onAppend(n, m, p);
      case 'AppendEntriesResp': return this.onAppendResp(n, m, p);
    }
  }

  /* ── elections ──────────────────────────────────────────────────────── */
  beginElection(n) {
    n.term++;
    n.role = CANDIDATE;
    n.votedFor = n.id;
    n.votes = new Set([n.id]);
    this.resetElection(n);
    this.log('election', `s${n.id} started an election for term ${n.term}`, n.id);
    for (const p of this.nodes) {
      if (p.id === n.id) continue;
      this.send(n.id, p.id, 'RequestVote', {
        term: n.term,
        lastLogIndex: n.log.length,
        lastLogTerm: n.log.length ? n.log[n.log.length - 1].term : 0,
      });
    }
  }

  onRequestVote(n, m, p) {
    const myLastTerm = n.log.length ? n.log[n.log.length - 1].term : 0;
    const upToDate = p.lastLogTerm > myLastTerm ||
      (p.lastLogTerm === myLastTerm && p.lastLogIndex >= n.log.length);
    const grant = p.term === n.term && (n.votedFor === null || n.votedFor === m.from) && upToDate;
    if (grant) {
      n.votedFor = m.from;
      this.resetElection(n);
    }
    this.send(n.id, m.from, 'RequestVoteResp', { term: n.term, granted: grant });
  }

  onVoteResp(n, m, p) {
    if (n.role !== CANDIDATE || p.term !== n.term) return;
    if (!p.granted) return;
    n.votes.add(m.from);
    if (n.votes.size > this.size / 2) this.becomeLeader(n);
  }

  becomeLeader(n) {
    n.role = LEADER;
    n.heartbeatAt = this.now;
    n.nextIndex = this.nodes.map(() => n.log.length + 1);
    n.matchIndex = this.nodes.map(() => 0);
    n.matchIndex[n.id] = n.log.length;
    this.log('leader', `s${n.id} won term ${n.term} with ${n.votes.size}/${this.size} votes`, n.id);
  }

  /* ── replication ────────────────────────────────────────────────────── */
  sendAppend(leader, peer) {
    const next = leader.nextIndex[peer.id];
    const prevIndex = next - 1;
    const prevTerm = prevIndex > 0 ? leader.log[prevIndex - 1]?.term ?? 0 : 0;
    const entries = leader.log.slice(prevIndex);
    this.send(leader.id, peer.id, 'AppendEntries', {
      term: leader.term, prevIndex, prevTerm, entries,
      leaderCommit: leader.commitIndex,
    });
  }

  onAppend(n, m, p) {
    if (p.term < n.term) {
      this.send(n.id, m.from, 'AppendEntriesResp', { term: n.term, ok: false, matchIndex: 0 });
      return;
    }
    n.role = FOLLOWER;
    n.lastContact = this.now;
    this.resetElection(n);

    const ok = p.prevIndex === 0 || (n.log.length >= p.prevIndex && n.log[p.prevIndex - 1].term === p.prevTerm);
    if (!ok) {
      // The consistency check failed: the leader will walk nextIndex back.
      this.send(n.id, m.from, 'AppendEntriesResp', { term: n.term, ok: false, matchIndex: 0, conflictAt: Math.min(n.log.length + 1, p.prevIndex) });
      return;
    }
    // Truncate anything that disagrees, then append. This is where a
    // follower's uncommitted tail gets overwritten by the new leader's.
    let idx = p.prevIndex;
    for (const e of p.entries) {
      idx++;
      if (n.log.length >= idx) {
        if (n.log[idx - 1].term !== e.term) {
          const lost = n.log.length - idx + 1;
          n.log.length = idx - 1;
          this.log('truncate', `s${n.id} discarded ${lost} uncommitted entr${lost === 1 ? 'y' : 'ies'}`, n.id);
          n.log.push({ ...e });
        }
      } else n.log.push({ ...e });
    }
    if (p.leaderCommit > n.commitIndex) n.commitIndex = Math.min(p.leaderCommit, n.log.length);
    this.send(n.id, m.from, 'AppendEntriesResp', { term: n.term, ok: true, matchIndex: n.log.length });
  }

  onAppendResp(n, m, p) {
    if (n.role !== LEADER || p.term !== n.term) return;
    if (p.ok) {
      n.matchIndex[m.from] = Math.max(n.matchIndex[m.from], p.matchIndex);
      n.nextIndex[m.from] = n.matchIndex[m.from] + 1;
    } else {
      n.nextIndex[m.from] = Math.max(1, (p.conflictAt ?? n.nextIndex[m.from]) - 1);
      this.sendAppend(n, this.nodes[m.from]);     // retry immediately
    }
  }

  advanceCommit(leader) {
    leader.matchIndex[leader.id] = leader.log.length;
    const sorted = [...leader.matchIndex].sort((a, b) => b - a);
    const majority = sorted[Math.floor(this.size / 2)];
    // Raft only commits an entry from the *current* term by counting replicas.
    if (majority > leader.commitIndex && leader.log[majority - 1]?.term === leader.term) {
      leader.commitIndex = majority;
      this.log('commit', `entry ${majority} committed on a majority`, leader.id);
    }
  }

  /* ── interventions ──────────────────────────────────────────────────── */
  client(value) {
    const leader = this.nodes.find((n) => n.role === LEADER && n.alive);
    if (!leader) { this.log('reject', 'client request refused: no leader right now', null); return false; }
    const entry = { term: leader.term, value: value ?? String.fromCharCode(97 + (this.clientSeq++ % 26)), at: this.now };
    leader.log.push(entry);
    this.log('client', `"${entry.value}" accepted by s${leader.id} at index ${leader.log.length}`, leader.id);
    for (const p of this.nodes) if (p.id !== leader.id) this.sendAppend(leader, p);
    return true;
  }

  /** Write directly to one server, whatever it believes it is. The way to
      show a doomed write: hand it to a leader that has just been isolated. */
  clientTo(id, value) {
    const n = this.nodes[id];
    if (!n.alive || n.role !== 'leader') return this.client(value);
    n.log.push({ term: n.term, value, at: this.now });
    this.log('client', `"${value}" accepted by s${id} — which no longer has a quorum`, id);
    for (const p of this.nodes) if (p.id !== id) this.sendAppend(n, p);
    return true;
  }

  kill(id) {
    const n = this.nodes[id];
    n.alive = false;
    n.role = FOLLOWER;
    n.votes = new Set();
    this.log('crash', `s${id} crashed`, id);
  }

  revive(id) {
    const n = this.nodes[id];
    n.alive = true;
    n.role = FOLLOWER;
    this.resetElection(n);
    this.log('revive', `s${id} restarted (log survives, volatile state does not)`, id);
  }

  setPartition(id, group) {
    this.nodes[id].partition = group;
    this.log('partition', `s${id} moved to network side ${group === 0 ? 'A' : 'B'}`, id);
  }

  healPartitions() {
    for (const n of this.nodes) n.partition = 0;
    this.log('heal', 'the network healed', null);
  }

  /* ── invariants ─────────────────────────────────────────────────────── */
  /** The five safety properties from the Raft paper, checked continuously. */
  check() {
    const out = [];

    const leadersByTerm = new Map();
    for (const n of this.nodes) {
      if (n.role === LEADER && n.alive) {
        const list = leadersByTerm.get(n.term) || [];
        list.push(n.id);
        leadersByTerm.set(n.term, list);
      }
    }
    const doubled = [...leadersByTerm.entries()].filter(([, v]) => v.length > 1);
    out.push({
      name: 'Election Safety',
      detail: 'at most one leader per term',
      ok: doubled.length === 0,
      note: doubled.length ? `term ${doubled[0][0]} has leaders ${doubled[0][1].map((i) => 's' + i).join(', ')}` : null,
    });

    let matchOk = true, matchNote = null;
    for (let i = 0; i < this.nodes.length && matchOk; i++) {
      for (let j = i + 1; j < this.nodes.length && matchOk; j++) {
        const a = this.nodes[i].log, b = this.nodes[j].log;
        for (let k = 0; k < Math.min(a.length, b.length); k++) {
          if (a[k].term === b[k].term && a[k].value !== b[k].value) {
            matchOk = false;
            matchNote = `s${i} and s${j} disagree at index ${k + 1}`;
            break;
          }
        }
      }
    }
    out.push({ name: 'Log Matching', detail: 'same index + same term ⇒ same command', ok: matchOk, note: matchNote });

    let applyOk = true, applyNote = null;
    const applied = new Map();
    for (const n of this.nodes) {
      for (let i = 0; i < n.applied; i++) {
        const prev = applied.get(i);
        if (prev === undefined) applied.set(i, n.log[i].value);
        else if (prev !== n.log[i].value) { applyOk = false; applyNote = `index ${i + 1} applied as "${prev}" and "${n.log[i].value}"`; }
      }
    }
    out.push({ name: 'State Machine Safety', detail: 'no two nodes apply different commands at one index', ok: applyOk, note: applyNote });

    const committed = Math.max(...this.nodes.map((n) => n.commitIndex));
    const leader = this.nodes.find((n) => n.role === LEADER && n.alive);
    out.push({
      name: 'Leader Completeness',
      detail: 'a new leader holds every committed entry',
      ok: !leader || leader.log.length >= committed,
      note: leader && leader.log.length < committed ? `s${leader.id} is missing committed entries` : null,
    });

    return out;
  }

  /** A compact snapshot for the UI (and for assertions in tests). */
  snapshot() {
    return {
      now: this.now,
      leader: this.nodes.find((n) => n.role === LEADER && n.alive)?.id ?? null,
      term: Math.max(...this.nodes.map((n) => n.term)),
      committed: Math.max(...this.nodes.map((n) => n.commitIndex)),
      inFlight: this.messages.length,
      logs: this.nodes.map((n) => n.log.map((e) => e.term)),
    };
  }
}

/** Run a headless cluster for `ms`, optionally with scripted interventions. */
export function run(cluster, ms, script = [], dt = 20) {
  const pending = [...script].sort((a, b) => a.at - b.at);
  const end = cluster.now + ms;
  while (cluster.now < end) {
    while (pending.length && pending[0].at <= cluster.now) pending.shift().do(cluster);
    cluster.tick(dt);
  }
  return cluster;
}
