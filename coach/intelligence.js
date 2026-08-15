// LocalCoach — fully local, rule/template-based replacement for the API-backed
// AI Coach. No network calls. Consumes the same `context` shape AICoach.compileContext()
// already builds in index.html.
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

  function unlockNextConcept(ctx) {
    const already = new Set(ctx.alreadyUnlockedConcepts || []);
    for (const c of CONCEPT_LIBRARY) {
      if (!already.has(c.key) && c.test(ctx)) return { title: c.key, explanation: c.explanation };
    }
    return null;
  }

  function pickPrimarySignal(ctx) {
    const inj = (ctx.recentInjuries || [])[0];
    if (inj && inj.severity >= 6) return { kind: 'injury', data: inj };
    if ((ctx.stalledExercises || []).length) return { kind: 'plateau', data: ctx.stalledExercises[0] };
    const v = ctx.volumeTrend12wk || [];
    if (v.length >= 2) {
      const prev = v[v.length - 2], last = v[v.length - 1];
      if (prev > 0) {
        const pct = Math.round(((last - prev) / prev) * 100);
        if (pct <= -30) return { kind: 'volumeDrop', data: pct };
        if (pct >= 30) return { kind: 'volumeSpike', data: pct };
      }
    }
    if ((ctx.idleMuscles || []).length) return { kind: 'idleMuscle', data: ctx.idleMuscles[0] };
    if (ctx.consistency && ctx.consistency.avgWorkoutsPerWeekLast4wk < ctx.consistency.weeklyGoal - 0.5) {
      return { kind: 'consistency', data: ctx.consistency };
    }
    if ((ctx.imbalanceFlags || []).length) return { kind: 'imbalance', data: ctx.imbalanceFlags[0] };
    return { kind: 'onTrack', data: null };
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

  function tipFor(signal) {
    switch (signal.kind) {
      case 'injury':
        return `Your **${signal.data.bodyPart}** note (severity ${signal.data.severity}/10) means I'd ${adviceForBodyPart(signal.data.bodyPart)}.`;
      case 'plateau':
        return `**${signal.data}** hasn't moved in 3 sessions — try dropping ~10% and rebuilding an extra rep each session before retesting.`;
      case 'volumeDrop':
        return `Volume dropped ${Math.abs(signal.data)}% last week — could be a planned deload, or worth getting back on track this week.`;
      case 'volumeSpike':
        return `Volume jumped ${signal.data}% last week — ramping up that fast raises injury risk, consider holding steady this week.`;
      case 'idleMuscle':
        return `**${signal.data}** hasn't been trained in 7+ days — worth working it back in soon.`;
      case 'consistency':
        return `You're averaging ${signal.data.avgWorkoutsPerWeekLast4wk}/wk against a goal of ${signal.data.weeklyGoal} — hitting sessions consistently will do more than adding volume per session.`;
      case 'imbalance':
        return signal.data;
      default:
        return "Solid, consistent training — no red flags right now. Keep the current plan going.";
    }
  }

  const LocalCoach = {
    evolve(ctx) {
      const signal = pickPrimarySignal(ctx);
      const tip = tipFor(signal);
      const concept = unlockNextConcept(ctx);
      let notificationOffer = null;
      if (signal.kind === 'injury' || signal.kind === 'plateau' || signal.kind === 'volumeSpike') {
        notificationOffer = { title: signal.kind === 'injury' ? `Training note: ${signal.data.bodyPart}` : 'Coach flagged something', body: tip };
      }
      const memoryBits = [];
      if ((ctx.stalledExercises || []).length) memoryBits.push(`${ctx.stalledExercises.length} exercise(s) plateaued`);
      if ((ctx.idleMuscles || []).length) memoryBits.push(`${ctx.idleMuscles.length} muscle(s) idle 7+ days`);
      if ((ctx.recentInjuries || []).length) memoryBits.push('recent injury noted');
      const updatedMemory = memoryBits.length
        ? `Training goal: ${ctx.profile && ctx.profile.trainingGoal || 'general'}. Currently tracking: ${memoryBits.join(', ')}.`
        : (ctx.agentMemory || 'Training looks steady, no flags this cycle.');
      return { updatedMemory, newFacts: [], newConceptUnlock: concept, proactiveTip: tip, notificationOffer };
    },

    idleCheckIn(ctx, daysSinceLastWorkout) {
      if (daysSinceLastWorkout !== null && daysSinceLastWorkout >= 7) {
        return { proactiveTip: `It's been ${daysSinceLastWorkout} days since your last logged workout — even a short session helps keep momentum.` };
      }
      return { proactiveTip: tipFor(pickPrimarySignal(ctx)) };
    },

    injuryCheckIn(ctx, injury) {
      return { proactiveTip: `Noted your **${injury.bodyPart}** entry (severity ${injury.severity}/10) — I'd ${adviceForBodyPart(injury.bodyPart)} until it settles.` };
    },

    chat(ctx, userText) {
      const q = (userText || '').toLowerCase();
      let reply;
      if (/plateau|stuck|stall/.test(q)) {
        reply = (ctx.stalledExercises || []).length
          ? `Stalled right now: **${ctx.stalledExercises.join(', ')}**. Try a ~10% weight drop and rebuild an extra rep per session before retesting.`
          : "Nothing's currently plateaued in your last sessions — nice, keep the current progression going.";
      } else if (/deload|fatigue|tired|burn/.test(q)) {
        const v = ctx.volumeTrend12wk || [];
        const trendTxt = v.length >= 2 ? ` Your last two weeks: ${v[v.length - 2]}kg → ${v[v.length - 1]}kg.` : '';
        reply = `A deload (50-60% volume for a week) every 4-8 weeks helps fatigue dissipate.${trendTxt}`;
      } else if (/sore|pain|hurt|injur/.test(q)) {
        const inj = (ctx.recentInjuries || [])[0];
        reply = inj
          ? `Your most recent note was **${inj.bodyPart}** (severity ${inj.severity}/10) — ${adviceForBodyPart(inj.bodyPart)}.`
          : "No injuries logged recently — if something's bothering you, log it in the Injury/Pain Log so I can track it.";
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
        reply = tipFor(pickPrimarySignal(ctx));
      }
      return { reply, action: null };
    },
  };

  global.LocalCoach = LocalCoach;
})(window);