/**
 * Eval-scene generator bench (same engine as the designer, no Angular).
 *
 *   npm run bench:generator
 *   npm run bench:generator -- 20
 *   npx --yes tsx scripts/bench-generator.ts 100 2 1
 *
 * Args: [runs=100] [parking=2] [startSeed=1]
 * Writes scripts/bench-generator-results.json (gitignored).
 * See docs/GENERATOR.md § Quality bench and docs/AGENT.md.
 */
import { writeFileSync } from 'node:fs';
import { CITY_TRACKS_BY_ID } from '../src/app/core/catalog/city-tracks';
import { generateLayout } from '../src/app/core/layout-engine/generate';
import { connectedGroupCount } from '../src/app/core/layout-engine/connections';
import { agentEvalScene } from '../src/app/core/layout-store/agent-scene';
import { buildAgentReport } from '../src/app/core/layout-store/agent-report';

const RUNS = Number(process.argv[2] ?? 100);
const parkingArg = Number(process.argv[3] ?? 2);
const PARKING = (parkingArg === 0 || parkingArg === 1 || parkingArg === 2 ? parkingArg : 2) as 0 | 1 | 2;
const TIMEOUT_MS = 4000;
const START_SEED = Number(process.argv[4] ?? 1);

const RIGHT_ARM_X = 227.2;
const UPPER_ARM_Y = 264.5;

type Row = {
  seed: number;
  ms: number;
  loop: boolean;
  cycles: number;
  score: number;
  parkingFound: number;
  unfinishedPorts: number;
  parts: number;
  flex: number;
  crossover: number;
  switches: number;
  unusedStraight: number;
  unusedCurve: number;
  unusedSwitch: number;
  unusedCrossover: number;
  unusedFlex: number;
  unusedRigid: number;
  groups: number;
  isolatedInner: boolean;
  reversingLoop: boolean;
  rightArm: boolean;
  upperArm: boolean;
  envelopeW: number;
  envelopeH: number;
  notes: string[];
};

function unusedQty(unused: Record<string, number>, id: string): number {
  return unused[id] ?? 0;
}

function runSeed(seed: number): Row {
  const { inventory, floorPlan } = agentEvalScene();
  const started = Date.now();
  const layout = generateLayout(inventory, { targetParkingSpots: PARKING }, {
    seed,
    timeoutMs: TIMEOUT_MS,
    floorPlan,
  });
  const ms = Date.now() - started;
  const report = buildAgentReport({
    seed,
    status: 'ready',
    preferences: { targetParkingSpots: PARKING },
    layout,
    collection: inventory,
    floorPlan,
  });
  const unused = report.unused;
  const env = report.envelope;
  return {
    seed,
    ms,
    loop: report.loop,
    cycles: report.cycles,
    score: Math.round(report.score * 10) / 10,
    parkingFound: report.parkingFound,
    unfinishedPorts: report.unfinishedPorts,
    parts: report.parts,
    flex: report.flex,
    crossover: report.crossover,
    switches: report.switches,
    unusedStraight: unusedQty(unused, 'straight-16'),
    unusedCurve: unusedQty(unused, 'curve-22'),
    unusedSwitch: unusedQty(unused, 'switch-left') + unusedQty(unused, 'switch-right'),
    unusedCrossover: unusedQty(unused, 'double-crossover'),
    unusedFlex: unusedQty(unused, 'flex-track'),
    unusedRigid:
      unusedQty(unused, 'straight-16') +
      unusedQty(unused, 'curve-22') +
      unusedQty(unused, 'switch-left') +
      unusedQty(unused, 'switch-right') +
      unusedQty(unused, 'double-crossover'),
    groups: connectedGroupCount(layout.parts, CITY_TRACKS_BY_ID),
    isolatedInner: layout.parts.some((part) => part.instanceId.startsWith('in')),
    reversingLoop: report.reverse.includes('reversing-loop'),
    rightArm: layout.parts.some((part) => part.x > RIGHT_ARM_X + 8),
    upperArm: layout.parts.some((part) => part.y < UPPER_ARM_Y - 8),
    envelopeW: env ? Math.round(env.maxX - env.minX) : 0,
    envelopeH: env ? Math.round(env.maxY - env.minY) : 0,
    notes: report.notes,
  };
}

function pct(n: number, total = RUNS): string {
  return `${((n / total) * 100).toFixed(1)}%`;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function main(): void {
  const rows: Row[] = [];
  const t0 = Date.now();
  for (let i = 0; i < RUNS; i += 1) {
    const seed = START_SEED + i;
    const row = runSeed(seed);
    rows.push(row);
    const n = i + 1;
    if (n % 5 === 0 || n === 1) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.error(
        `[${n}/${RUNS}] seed=${seed} loop=${row.loop} park=${row.parkingFound}/${PARKING} ` +
          `open=${row.unfinishedPorts} unused=${row.unusedRigid} ms=${row.ms} t=${elapsed}s`,
      );
    }
  }

  const loop = rows.filter((r) => r.loop).length;
  const closed = rows.filter((r) => r.unfinishedPorts === 0).length;
  const parkExact = rows.filter((r) => r.parkingFound === PARKING).length;
  const parkAtLeast1 = rows.filter((r) => r.parkingFound >= 1).length;
  const park0 = rows.filter((r) => r.parkingFound === 0).length;
  const xo = rows.filter((r) => r.crossover === 1).length;
  const allSwitches = rows.filter((r) => r.unusedSwitch === 0).length;
  const bothArms = rows.filter((r) => r.rightArm && r.upperArm).length;
  const missRight = rows.filter((r) => !r.rightArm).length;
  const missUpper = rows.filter((r) => !r.upperArm).length;
  const isolated = rows.filter((r) => r.isolatedInner).length;
  const groupsOk = rows.filter((r) => r.groups === 1).length;
  const flexUsed = rows.filter((r) => r.flex > 0).length;
  const reverse = rows.filter((r) => r.reversingLoop).length;
  const coreGood = rows.filter((r) => r.loop && r.unfinishedPorts === 0).length;
  const gold = rows.filter(
    (r) =>
      r.loop &&
      r.unfinishedPorts === 0 &&
      r.parkingFound === PARKING &&
      r.crossover === 1 &&
      r.unusedSwitch === 0 &&
      r.rightArm &&
      r.upperArm &&
      r.groups === 1 &&
      !r.isolatedInner,
  ).length;

  const summary = {
    runs: RUNS,
    parkingTarget: PARKING,
    startSeed: START_SEED,
    timeoutMs: TIMEOUT_MS,
    wallMs: Date.now() - t0,
    rates: {
      loop: loop,
      closed: closed,
      coreGood,
      parkExact,
      parkAtLeast1,
      park0,
      crossover: xo,
      allSwitches,
      bothArms,
      missRight,
      missUpper,
      isolatedInner: isolated,
      oneGroup: groupsOk,
      flexUsed,
      reversingLoop: reverse,
      gold,
    },
    unusedRigid: {
      mean: Math.round(mean(rows.map((r) => r.unusedRigid)) * 10) / 10,
      median: median(rows.map((r) => r.unusedRigid)),
      min: Math.min(...rows.map((r) => r.unusedRigid)),
      max: Math.max(...rows.map((r) => r.unusedRigid)),
    },
    unusedStraight: {
      mean: Math.round(mean(rows.map((r) => r.unusedStraight)) * 10) / 10,
      median: median(rows.map((r) => r.unusedStraight)),
    },
    unusedCurve: {
      mean: Math.round(mean(rows.map((r) => r.unusedCurve)) * 10) / 10,
      median: median(rows.map((r) => r.unusedCurve)),
    },
    score: {
      mean: Math.round(mean(rows.map((r) => r.score)) * 10) / 10,
      median: Math.round(median(rows.map((r) => r.score)) * 10) / 10,
      min: Math.min(...rows.map((r) => r.score)),
      max: Math.max(...rows.map((r) => r.score)),
    },
    parts: {
      mean: Math.round(mean(rows.map((r) => r.parts)) * 10) / 10,
      median: median(rows.map((r) => r.parts)),
    },
    ms: {
      mean: Math.round(mean(rows.map((r) => r.ms))),
      median: Math.round(median(rows.map((r) => r.ms))),
    },
    parkingHistogram: [0, 1, 2, 3].map((n) => ({
      n,
      count: rows.filter((r) => r.parkingFound === n).length,
    })),
    cyclesHistogram: Object.entries(
      rows.reduce<Record<string, number>>((acc, r) => {
        acc[String(r.cycles)] = (acc[String(r.cycles)] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([cycles, count]) => ({ cycles: Number(cycles), count }))
      .sort((a, b) => a.cycles - b.cycles),
    noteCounts: Object.entries(
      rows.reduce<Record<string, number>>((acc, r) => {
        for (const note of r.notes) {
          acc[note] = (acc[note] ?? 0) + 1;
        }
        return acc;
      }, {}),
    )
      .map(([note, count]) => ({ note, count }))
      .sort((a, b) => b.count - a.count),
    worstUnused: [...rows]
      .sort((a, b) => b.unusedRigid - a.unusedRigid)
      .slice(0, 8)
      .map((r) => ({ seed: r.seed, unusedRigid: r.unusedRigid, loop: r.loop, park: r.parkingFound })),
    noLoopSeeds: rows.filter((r) => !r.loop).map((r) => r.seed),
    openSeeds: rows.filter((r) => r.unfinishedPorts > 0).map((r) => r.seed),
    missRightSeeds: rows.filter((r) => !r.rightArm).map((r) => r.seed),
    missUpperSeeds: rows.filter((r) => !r.upperArm).map((r) => r.seed),
    noParkSeeds: rows.filter((r) => r.parkingFound === 0).map((r) => r.seed),
    noCrossoverSeeds: rows.filter((r) => r.crossover === 0).map((r) => r.seed),
    leftoverSwitchSeeds: rows.filter((r) => r.unusedSwitch > 0).map((r) => r.seed),
    isolatedSeeds: rows.filter((r) => r.isolatedInner).map((r) => r.seed),
    rows,
  };

  writeFileSync('scripts/bench-generator-results.json', JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        ...summary,
        rows: undefined,
        loopPct: pct(loop),
        closedPct: pct(closed),
        parkExactPct: pct(parkExact),
        goldPct: pct(gold),
        bothArmsPct: pct(bothArms),
        crossoverPct: pct(xo),
        allSwitchesPct: pct(allSwitches),
      },
      null,
      2,
    ),
  );
}

main();
