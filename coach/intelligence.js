// LocalCoach — fully local, rule/template-based AI coach. No network calls.
// Consumes the same `context` shape AICoach.compileContext() builds in index.html.
(function (global) {
  const CONCEPT_LIBRARY = [
    { key: 'Progressive Overload', test: () => true,
      explanation: "Progressive overload means adding a little more stimulus over time — more weight, more reps, or more sets — so your body keeps adapting instead of plateauing." },
    { key: 'Autoregulation via RPE', test: ctx => (ctx.stalledExercises || []).length > 0,
      explanation: "Instead of a fixed weight every session, let RPE guide the load: if RPE 8 shows up 2 reps early, that's your cue to hold or drop weight next set." },
    { key: 'Deload Timing', test: ctx => {
        const v = ctx.volumeTrend12wk || [];
        if (v.length < 2) return false;
        const prev = v[v.length - 2], last = v[v.length - 1];
        return prev > 0 && ((last - prev) / prev) <= -0.3;
      },
      explanation: "A planned deload — a lighter week every 4-8 weeks — lets fatigue dissipate so your next block of training hits harder." },
    { key: 'Muscle Balance & PPL Split', test: ctx => (ctx.imbalanceFlags || []).length > 0 || (ctx.idleMuscles || []).length >= 2,
      explanation: "Muscles trained less often (or unevenly left/right) tend to lag and raise injury risk — rotating in accessory work for neglected areas keeps things balanced." },
    { key: 'Consistency Beats Intensity', test: ctx => ctx.consistency && ctx.consistency.avgWorkoutsPerWeekLast4wk < ctx.consistency.weeklyGoal - 0.5,
      explanation: "Hitting your weekly session count consistently drives more progress than occasional all-out sessions — frequency compounds." },
  ];

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.warn('LocalCoach: recovered from error', e); return fallback; }
  }

  // ── Linear regression trend detection ──
  // Simple least-squares slope over an array of numbers (x = index). Returns
  // {slope, pctChange} where pctChange is slope-per-step relative to the mean,
  // so a noisy but genuinely rising/falling series is caught even when the
  // last two points alone look flat or contradict the overall direction.
  function linearTrend(values) {
    const ys = (values || []).filter(v => typeof v === 'number' && !isNaN(v));
    const n = ys.length;
    if (n < 3) return null;
    const xs = ys.map((_, i) => i);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const pctChange = meanY !== 0 ? (slope / meanY) * 100 : 0;
    return { slope, pctChange, meanY };
  }

  function unlockNextConcept(ctx) {
    const already = new Set(ctx.alreadyUnlockedConcepts || []);
    for (const c of CONCEPT_LIBRARY) {
      if (!already.has(c.key) && c.test(ctx)) return { title: c.key, explanation: c.explanation };
    }
    return null;
  }

  // ── Multi-signal scoring ──
  // Collects every active signal (not just the first match) with a severity
  // score, so related signals (e.g. injury + plateau on the same muscle) can
  // be combined instead of silently dropping all but one.
  function muscleOfExercise(ctx, exName) {
    const w = (ctx.recentWorkouts || []).find(w => (w.exercises || []).some(e => e.name === exName));
    const ex = w && w.exercises.find(e => e.name === exName);
    return ex ? [...(ex.primaryMuscles || []), ...(ex.secondaryMuscles || [])] : [];
  }

  function collectSignals(ctx) {
    const signals = [];
    const inj = (ctx.recentInjuries || [])[0];
    if (inj) {
      const bp = (inj.bodyPart || '').toLowerCase();
      const guessed = new Set();
      (ctx.recentWorkouts || []).forEach(w => (w.exercises || []).forEach(e => {
        [...(e.primaryMuscles || []), ...(e.secondaryMuscles || [])].forEach(m => {
          if (bp && (m.toLowerCase().includes(bp) || bp.includes(m.toLowerCase()))) guessed.add(m);
        });
      }));
      signals.push({ kind: 'injury', data: inj, sev: Math.min(10, inj.severity || 5), muscles: Array.from(guessed) });
    }

    (ctx.stalledExercises || []).forEach(exName => {
      signals.push({ kind: 'plateau', data: exName, sev: 6, muscles: muscleOfExercise(ctx, exName) });
    });

    const v = ctx.volumeTrend12wk || [];
    if (v.length >= 2) {
      const prev = v[v.length - 2], last = v[v.length - 1];
      if (prev > 0) {
        const pct = Math.round(((last - prev) / prev) * 100);
        if (pct <= -30) signals.push({ kind: 'volumeDrop', data: pct, sev: 4 });
        if (pct >= 30) signals.push({ kind: 'volumeSpike', data: pct, sev: 7 });
      }
    }
    // Regression-based trend (12-week window): catches a sustained drift a raw
    // two-point delta would miss (e.g. a noisy but steadily-declining series).
    const vTrend = linearTrend(v);
    if (vTrend && Math.abs(vTrend.pctChange) >= 8) {
      signals.push({ kind: vTrend.pctChange < 0 ? 'volumeTrendDown' : 'volumeTrendUp', data: Math.round(vTrend.pctChange), sev: 3 });
    }
    // RPE creep at flat/similar weight = early overtraining signal, caught via
    // regression on avgRpe across each exercise's recent sessions.
    Object.entries(ctx.rpeTrendByExercise || {}).forEach(([exName, points]) => {
      if (!points || points.length < 3) return;
      const rpeSlope = linearTrend(points.map(p => p.avgRpe));
      const weights = points.map(p => p.topWeight);
      const weightFlat = Math.max(...weights) - Math.min(...weights) <= Math.max(...weights) * 0.03;
      if (rpeSlope && rpeSlope.slope > 0.15 && weightFlat) {
        signals.push({ kind: 'rpeCreep', data: exName, sev: 5, muscles: muscleOfExercise(ctx, exName) });
      }
    });
    (ctx.idleMuscles || []).forEach(m => signals.push({ kind: 'idleMuscle', data: m, sev: 3, muscles: [m] }));
    if (ctx.consistency && ctx.consistency.avgWorkoutsPerWeekLast4wk < ctx.consistency.weeklyGoal - 0.5) {
      signals.push({ kind: 'consistency', data: ctx.consistency, sev: 5 });
    }
    (ctx.imbalanceFlags || []).forEach(f => signals.push({ kind: 'imbalance', data: f, sev: 4 }));

    // Escalation: if the caller passes a rolling history of past signal kinds
    // (ctx.signalHistory, array of {kind, muscles?} from prior cycles), bump
    // severity for repeats so a 3rd consecutive plateau flag outranks a fresh
    // low-severity one instead of being treated identically each time.
    const hist = ctx.signalHistory || [];
    signals.forEach(s => {
      const repeats = hist.filter(h => h.kind === s.kind).length;
      if (repeats >= 2) s.sev = Math.min(10, s.sev + repeats);
    });

    return signals.sort((a, b) => b.sev - a.sev);
  }

  function pickPrimarySignal(ctx) {
    const all = collectSignals(ctx);
    if (!all.length) return { kind: 'onTrack', data: null, sev: 0 };
    return all[0];
  }

  const BODY_PART_ADVICE = {
    knee: "avoid deep loaded squats/lunges for now — try box squats or leg press with a partial range instead",
    shoulder: "skip overhead pressing — landmine presses load the same push pattern with less shoulder stress",
    wrist: "avoid straight-bar wrist extension under load — try neutral-grip dumbbell or fat-grip variations",
    back: "skip loaded spinal flexion/heavy hinge work — bodyweight or machine-supported movements are safer for now",
    elbow: "avoid heavy close-grip pressing/curls — reduce load and prioritize slower tempo",
  };
  function adviceForBodyPart(bodyPart) {
    const k = Object.keys(BODY_PART_ADVICE).find(k => (bodyPart || '').toLowerCase().includes(k));
    return k ? BODY_PART_ADVICE[k] : "scale back load on movements that stress that area and prioritize pain-free range of motion";
  }

  // ── Muscle-keyed substitution table ──
  // Maps a MUSCLE_GROUPS-style muscle name to safer substitute exercises,
  // used when an injury's body part can be resolved to the actual muscle(s)
  // trained by an exercise (via ctx exercise data) rather than only fuzzy
  // string-matching the free-text body-part label.
  const MUSCLE_SUBSTITUTIONS = {
    'Quadriceps': ['Leg Press (partial range)', 'Box Squat', 'Leg Extension (light)'],
    'Front Delts': ['Landmine Press', 'Neutral-Grip Dumbbell Press'],
    'Side Delts': ['Cable Lateral Raise (light)', 'Landmine Press'],
    'Forearms': ['Neutral-Grip Curl', 'Fat-Grip Farmer Carry (light)'],
    'Lower Back': ['Bird Dog', 'Machine-Supported Row', 'Trap Bar Deadlift (light)'],
    'Triceps': ['Neutral-Grip Pushdown', 'Slow-Tempo Dip (partial range)'],
    'Biceps': ['Neutral-Grip Curl', 'Cable Curl (light)'],
    'Chest': ['Machine Chest Press', 'Push-Up (incline, reduced ROM)'],
    'Hamstrings': ['Leg Curl (light)', 'Glute Bridge'],
  };
  function substitutionsForMuscles(muscles) {
    const subs = new Set();
    (muscles || []).forEach(m => (MUSCLE_SUBSTITUTIONS[m] || []).forEach(s => subs.add(s)));
    return Array.from(subs);
  }

  // ── Generic rule-chain evaluator ──
  // Any two active signals that both carry a `.muscles` array and overlap on
  // at least one muscle get chained together, regardless of which specific
  // kinds they are — replaces one-off pairwise checks with a rule that scales
  // to new signal kinds without new hardcoded branches.
  const OVERLAP_PHRASES = {
    'plateau:injury': (a, b) => `That also lines up with your recent **${b.data.bodyPart}** note — the plateau may be your body protecting that area, not just a training gap.`,
    'plateau:idleMuscle': (a, b) => `**${b.data}** has also gone quiet — the two are likely connected, so rotating in fresh volume there could unstick both.`,
    'plateau:rpeCreep': (a, b) => `Combined with rising RPE on **${b.data}**, this looks like broader fatigue rather than one stuck lift — a full deload week may serve better than a single-exercise fix.`,
    'injury:plateau': (a, b) => `Also worth noting: **${b.data}** has been plateaued — easing off it while this heals may help both.`,
  };
  function combineOverlaps(signal, ctx) {
    if (!signal.muscles || !signal.muscles.length) return [];
    const others = collectSignals(ctx).filter(s => s !== signal && s.muscles && s.muscles.length);
    const notes = [];
    others.forEach(o => {
      const shared = signal.muscles.some(m => o.muscles.some(m2 => m.toLowerCase() === m2.toLowerCase()));
      if (!shared) return;
      const phraseFn = OVERLAP_PHRASES[`${signal.kind}:${o.kind}`];
      if (phraseFn) notes.push(phraseFn(signal, o));
    });
    return notes;
  }

  // Human handoff threshold: severe/urgent injuries or repeated unresolved
  // flags are outside what local rule-based advice should resolve alone.
  function needsHumanHandoff(signal) {
    if (signal.kind === 'injury' && (signal.data.severity || 0) >= 8) return true;
    if (signal.sev >= 9) return true;
    return false;
  }
  const HANDOFF_CTA = "This is beyond what I can safely judge from training data alone — please check with a physio, doctor, or your coach in person.";

  function tipFor(signal, ctx) {
    const phase = ctx && ctx.periodization && ctx.periodization.phase;
    let base;
    switch (signal.kind) {
      case 'injury': {
        base = `Your **${signal.data.bodyPart}** note (severity ${signal.data.severity}/10) means I'd ${adviceForBodyPart(signal.data.bodyPart)}.`;
        // Muscle-keyed substitutions: try resolving the body part to a tracked
        // muscle via any exercise that mentions it, then offer concrete swaps.
        const bp = (signal.data.bodyPart || '').toLowerCase();
        const guessedMuscles = new Set();
        (ctx.recentWorkouts || []).forEach(w => (w.exercises || []).forEach(e => {
          [...(e.primaryMuscles || []), ...(e.secondaryMuscles || [])].forEach(m => {
            if (bp && (m.toLowerCase().includes(bp) || bp.includes(m.toLowerCase()))) guessedMuscles.add(m);
          });
        }));
        const subs = substitutionsForMuscles(Array.from(guessedMuscles));
        if (subs.length) base += ` Safer swaps to consider: **${subs.slice(0, 3).join(', ')}**.`;
        combineOverlaps(signal, ctx).forEach(note => { base += ' ' + note; });
        break;
      }
      case 'plateau': {
        const mem = (ctx.exerciseMemory || {})[signal.data];
        if (mem && mem.plateauCount >= 2 && mem.bestDeloadResponse === 'rest-preset-increase-helped') {
          base = `**${signal.data}** has plateaued ${mem.plateauCount} times before, and last time a longer rest window helped it break through — worth trying that again before changing the weight.`;
        } else if (mem && mem.plateauCount >= 2) {
          base = `**${signal.data}** has plateaued ${mem.plateauCount} times now — this exercise recurs, so a bigger deload (not just -10%) may be worth it.`;
        } else {
          base = `**${signal.data}** hasn't moved in 3 sessions — try dropping ~10% and rebuilding an extra rep each session before retesting.`;
        }
        // Phase-aware framing: a strength/power-phase plateau is often expected
        // overload, not a red flag — a hypertrophy/deload-phase plateau is more concerning.
        if (phase === 'strength' || phase === 'power') base += ` You're in a **${phase}** phase right now, so some stalling at the top is normal — don't over-react unless it drags past 4-5 sessions.`;
        else if (phase === 'deload') base += ` You're mid-**deload**, so this is expected — no action needed until the next block.`;
        // Multi-step reasoning via the generic rule-chain evaluator: chains
        // with any overlapping injury/idle-muscle/rpeCreep signal automatically.
        combineOverlaps(signal, ctx).forEach(note => { base += ' ' + note; });
        break;
      }
      case 'volumeDrop':
        base = `Volume dropped ${Math.abs(signal.data)}% last week — could be a planned deload, or worth getting back on track this week.`;
        break;
      case 'volumeSpike':
        base = `Volume jumped ${signal.data}% last week — ramping up that fast raises injury risk, consider holding steady this week.`;
        break;
      case 'volumeTrendDown':
        base = `Your 12-week volume trend is drifting down (~${Math.abs(signal.data)}%/week on average) — not a single bad week, but a slow decline worth noticing.`;
        break;
      case 'volumeTrendUp':
        base = `Your 12-week volume trend is climbing steadily (~${signal.data}%/week on average) — good progress, just keep an eye on recovery as it compounds.`;
        break;
      case 'rpeCreep':
        base = `**${signal.data}** shows RPE creeping up at roughly the same weight across recent sessions — an early fatigue signal, not yet a plateau. Consider an extra rest day before this exercise or a slight deload.`;
        break;
      case 'idleMuscle':
        base = `**${signal.data}** hasn't been trained in 7+ days — worth working it back in soon.`;
        break;
      case 'consistency':
        base = `You're averaging ${signal.data.avgWorkoutsPerWeekLast4wk}/wk against a goal of ${signal.data.weeklyGoal} — hitting sessions consistently will do more than adding volume per session.`;
        break;
      case 'imbalance':
        base = signal.data;
        break;
      default:
        base = "Solid, consistent training — no red flags right now. Keep the current plan going.";
        if ((ctx.recentInjuries || []).length === 0 && (ctx.nutritionRecent && (ctx.nutritionRecent.calories || []).length === 0)) {
          base += " If anything's felt off — soreness, fatigue, appetite — logging it in Injury Log or Nutrition helps me catch patterns sooner.";
        }
    }
    if (needsHumanHandoff(signal)) base += ` ⚠️ ${HANDOFF_CTA}`;
    return base;
  }

  // Structured action suggestion attached to a signal, mirroring the schema
  // AICoach.validateCoachAction/applyCoachAction already expects — lets
  // LocalCoach propose the same safe, user-confirmed app changes.
  function actionFor(signal) {
    if (signal.kind === 'injury') {
      return { type: 'logInjury', bodyPart: signal.data.bodyPart, severity: signal.data.severity, note: signal.data.note || '' };
    }
    if (signal.kind === 'plateau') {
      return { type: 'setRestPreset', exerciseName: signal.data, seconds: 150 };
    }
    return null;
  }

  const LocalCoach = {
    evolve(ctx) {
      return safe(() => {
        const signal = pickPrimarySignal(ctx);
        const tip = tipFor(signal, ctx);
        const concept = unlockNextConcept(ctx);
        let notificationOffer = null;
        if (signal.sev >= 6) {
          notificationOffer = { title: signal.kind === 'injury' ? `Training note: ${signal.data.bodyPart}` : 'Coach flagged something', body: tip };
        }
        const memoryBits = [];
        if ((ctx.stalledExercises || []).length) memoryBits.push(`${ctx.stalledExercises.length} exercise(s) plateaued`);
        if ((ctx.idleMuscles || []).length) memoryBits.push(`${ctx.idleMuscles.length} muscle(s) idle 7+ days`);
        if ((ctx.recentInjuries || []).length) memoryBits.push('recent injury noted');
        const updatedMemory = memoryBits.length
          ? `Training goal: ${ctx.profile && ctx.profile.trainingGoal || 'general'}. Currently tracking: ${memoryBits.join(', ')}.`
          : (ctx.agentMemory || 'Training looks steady, no flags this cycle.');
        return { updatedMemory, newFacts: [], newConceptUnlock: concept, proactiveTip: tip, notificationOffer, signalKind: signal.kind, action: actionFor(signal) };
      }, { updatedMemory: ctx && ctx.agentMemory || '', newFacts: [], newConceptUnlock: null, proactiveTip: "Couldn't fully analyze this cycle — I'll try again next time.", notificationOffer: null });
    },

    idleCheckIn(ctx, daysSinceLastWorkout) {
      return safe(() => {
        if (daysSinceLastWorkout !== null && daysSinceLastWorkout >= 7) {
          return { proactiveTip: `It's been ${daysSinceLastWorkout} days since your last logged workout — even a short session helps keep momentum.` };
        }
        return { proactiveTip: tipFor(pickPrimarySignal(ctx), ctx) };
      }, { proactiveTip: "Couldn't check in right now — log a workout and I'll pick this back up." });
    },

    injuryCheckIn(ctx, injury) {
      return safe(() => {
        const tip = `Noted your **${injury.bodyPart}** entry (severity ${injury.severity}/10) — I'd ${adviceForBodyPart(injury.bodyPart)} until it settles.`;
        return { proactiveTip: (injury.severity || 0) >= 8 ? `${tip} ⚠️ ${HANDOFF_CTA}` : tip };
      }, { proactiveTip: "Logged — I couldn't fully analyze this one, but flagging it is what matters most right now." });
    },

    chat(ctx, userText) {
      return safe(() => {
        const q = (userText || '').toLowerCase();
        let reply, action = null;
        if (/plateau|stuck|stall/.test(q)) {
          if ((ctx.stalledExercises || []).length) {
            const exName = ctx.stalledExercises[0];
            reply = `Stalled right now: **${ctx.stalledExercises.join(', ')}**. Try a ~10% weight drop and rebuild an extra rep per session before retesting.`;
            action = { type: 'setRestPreset', exerciseName: exName, seconds: 150 };
          } else {
            reply = "Nothing's currently plateaued in your last sessions — nice, keep the current progression going.";
          }
        } else if (/deload|fatigue|tired|burn/.test(q)) {
          const v = ctx.volumeTrend12wk || [];
          const trendTxt = v.length >= 2 ? ` Your last two weeks: ${v[v.length - 2]}kg → ${v[v.length - 1]}kg.` : '';
          reply = `A deload (50-60% volume for a week) every 4-8 weeks helps fatigue dissipate.${trendTxt}`;
        } else if (/sore|pain|hurt|injur/.test(q)) {
          const inj = (ctx.recentInjuries || [])[0];
          if (inj) {
            reply = `Your most recent note was **${inj.bodyPart}** (severity ${inj.severity}/10) — ${adviceForBodyPart(inj.bodyPart)}.`;
            if ((inj.severity || 0) >= 8) reply += ` ⚠️ ${HANDOFF_CTA}`;
            else action = { type: 'logInjury', bodyPart: inj.bodyPart, severity: inj.severity, note: inj.note || '' };
          } else {
            reply = "No injuries logged recently — if something's bothering you, log it in the Injury/Pain Log so I can track it.";
          }
        } else if (/rest|recovery/.test(q)) {
          reply = "Standard rest guidance: 2-3min for compound heavy lifts, 60-90s for isolation/hypertrophy work. Longer rest if RPE is creeping at the same weight.";
        } else if (/weight|goal|bulk|cut/.test(q)) {
          const wt = (ctx.weightTrend || []);
          reply = wt.length >= 2
            ? `Your weight trend: ${wt[0].kg}kg → ${wt[wt.length - 1].kg}kg over your last logged entries. Compare that pace against your goal direction in the You tab.`
            : "Log a couple more weight entries in the You tab and I can read your trend against your goal.";
        } else if (/balance|imbalance|left|right/.test(q)) {
          reply = (ctx.imbalanceFlags || []).length ? ctx.imbalanceFlags.join(' ') : "No left/right imbalance flags right now.";
        } else {
          const signal = pickPrimarySignal(ctx);
          reply = tipFor(signal, ctx);
          action = actionFor(signal);
          if (!/./.test(reply)) {
            // Low-confidence fallback: nothing matched a rule and no signal fired.
            reply = "I'm not confident enough to give specific advice from what's logged so far — try logging a workout, injury note, or weight entry, or check in with a coach/trainer directly.";
          }
        }
        return { reply, action };
      }, { reply: "Something went wrong reading your data just now — try again, or check in with a coach/trainer if this keeps happening.", action: null });
    },
  };

  global.LocalCoach = LocalCoach;
})(window);