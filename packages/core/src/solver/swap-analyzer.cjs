/**
 * 交换分析器 — 借鉴四维排课 DtActSwapAnalysisResult 设计
 * 追踪每次退火交换前后的规则分项变化，提供定向优化决策支持
 */
class SwapAnalyzer {
  constructor(rules) {
    this.rules = rules;
    this.history = [];
    this.counters = {};        // ruleId → {before, after, net, improved, worsened}
    this.totalSwaps = 0;
    this.acceptedSwaps = 0;
    this.rejectedSwaps = 0;
    this.trackRules = (rules.swap_analysis?.track_rules) || [];
    this.logInterval = rules.swap_analysis?.logInterval || 500;

    // Initialize counters for tracked rules
    this.trackRules.forEach(id => {
      this.counters[id] = { improved: 0, worsened: 0, net: 0, bestReduction: 0 };
    });
  }

  /** Record a swap attempt */
  recordAttempt(beforeScore, afterScore, beforeDetails, afterDetails, accepted) {
    this.totalSwaps++;
    if (accepted) this.acceptedSwaps++;
    else this.rejectedSwaps++;

    // Analyze per-rule changes
    const changes = {};
    this.trackRules.forEach(id => {
      const before = beforeDetails[id] || 0;
      const after = afterDetails[id] || 0;
      const delta = after - before;
      changes[id] = { before, after, delta };
      if (delta < 0) {
        this.counters[id].improved++;
        this.counters[id].net += Math.abs(delta);
        if (Math.abs(delta) > this.counters[id].bestReduction) {
          this.counters[id].bestReduction = Math.abs(delta);
        }
      } else if (delta > 0) {
        this.counters[id].worsened++;
        this.counters[id].net -= delta;
      }
    });

    // Periodic logging
    if (this.totalSwaps % this.logInterval === 0) {
      this._logProgress();
    }
  }

  _logProgress() {
    const rate = (this.acceptedSwaps / this.totalSwaps * 100).toFixed(1);
    console.log('  [SwapAnalyzer] ' + this.totalSwaps + ' swaps, ' + rate + '% accepted');
    this.trackRules.forEach(id => {
      const c = this.counters[id];
      if (c.improved + c.worsened > 0) {
        console.log('    ' + id + ': improved=' + c.improved + ' worsened=' + c.worsened + ' net=' + c.net);
      }
    });
  }

  /** Get summary report */
  getReport() {
    return {
      totalSwaps: this.totalSwaps,
      acceptedSwaps: this.acceptedSwaps,
      rejectedSwaps: this.rejectedSwaps,
      acceptanceRate: this.totalSwaps > 0 ? (this.acceptedSwaps / this.totalSwaps * 100).toFixed(1) + '%' : 'N/A',
      ruleCounters: { ...this.counters },
      recommendation: this._generateRecommendation(),
    };
  }

  _generateRecommendation() {
    // Find the rule that worsened most → suggests penalty weight adjustment
    let worstRule = null, worstNet = 0;
    this.trackRules.forEach(id => {
      if (this.counters[id].net < worstNet) {
        worstNet = this.counters[id].net;
        worstRule = id;
      }
    });
    if (worstRule && worstNet < -50) {
      return 'Rule "' + worstRule + '" worsened by ' + Math.abs(worstNet) + '. Consider increasing its penalty weight or adding targeted swap logic.';
    }
    return 'All tracked rules improving or stable.';
  }

  /** Compute per-rule violation counts from assignments (for before/after comparison) */
  static computeRuleViolations(A, students, rules) {
    const violations = {};
    const trackRules = rules.swap_analysis?.track_rules || [];

    trackRules.forEach(id => {
      const rule = rules.rules.find(r => r.id === id);
      if (!rule) return;
      let count = 0;

      if (id === 'no_cluster') {
        // Count cluster violations per student
        students.slice(0, 5).forEach(stu => {
          const stuA = A.filter(a => a.student_id === stu.id);
          const byCourse = {};
          stuA.forEach(a => { if (!byCourse[a.course_id]) byCourse[a.course_id] = [0,0,0,0,0]; byCourse[a.course_id][parseInt(a.slot_id.charAt(1))-1]++; });
          Object.entries(byCourse).forEach(([, days]) => days.forEach(c => { if (c >= 2) count++; }));
        });
      } else if (id === 'no_p1_consecutive') {
        const tP1 = {};
        A.forEach(a => {
          if (a.teacher_id && a.slot_id && a.slot_id.endsWith('P1')) {
            if (!tP1[a.teacher_id]) tP1[a.teacher_id] = new Set();
            tP1[a.teacher_id].add(parseInt(a.slot_id.charAt(1)));
          }
        });
        Object.values(tP1).forEach(days => {
          const arr = [...days].sort((a,b)=>a-b);
          let c = 1;
          for (let i = 1; i < arr.length; i++) { if (arr[i]===arr[i-1]+1) c++; else c=1; if (c>=3) count++; }
        });
      } else if (id === 'no_self_study_morning') {
        students.slice(0, 5).forEach(stu => {
          count += A.filter(a => a.student_id === stu.id && a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
        });
      } else if (id === 'foreign_teacher_restrictions') {
        const teachers = rule.teachers || [];
        const periods = rule.forbidden_periods || [];
        teachers.forEach(tid => {
          periods.forEach(p => {
            count += A.filter(a => a.teacher_id === tid && a.slot_id && a.slot_id.endsWith('P'+p)).length;
          });
        });
      }

      violations[id] = count;
    });

    return violations;
  }
}

module.exports = { SwapAnalyzer };
